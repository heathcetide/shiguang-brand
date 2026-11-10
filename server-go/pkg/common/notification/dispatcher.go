// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package notification

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"time"
)

// ──────────────────────────────────────────────
// Channel interface
// ──────────────────────────────────────────────

// Channel is the unified notification channel interface. Each provider
// (email/SMS/IM/webhook/inbox) implements this interface.
type Channel interface {
	// Name returns a human-readable channel identifier (e.g. "email-primary").
	Name() string

	// Type returns the channel type (email, sms, im, webhook, inbox).
	Type() MessageType

	// Send delivers a message through this channel. Returns an error
	// if delivery fails; the Dispatcher may try the next channel.
	Send(ctx context.Context, msg Message) error

	// Enabled reports whether this channel is currently active.
	Enabled() bool
}

// ──────────────────────────────────────────────
// LogStore interface (pluggable persistence)
// ──────────────────────────────────────────────

// LogEntry represents a notification delivery log record.
type LogEntry struct {
	ID          string // unique log ID
	ChannelName string // channel that handled the send
	Type        MessageType
	To          string    // recipient
	Subject     string    // subject or title
	Content     string    // body or content
	Status      string    // "sent", "failed", "pending"
	ErrorMsg    string    // error message if failed
	MessageID   string    // provider message ID if available
	IPAddress   string    // client IP for audit
	RetryCount  int       // number of retries attempted
	SentAt      time.Time // when the send was attempted
	CreatedAt   time.Time // when the log was created
}

// LogStore is the pluggable persistence interface for notification logs.
// Applications provide a concrete implementation (e.g. gorm-backed).
// A nil/no-op store is acceptable for testing.
type LogStore interface {
	// CreateLog persists a log entry.
	CreateLog(entry LogEntry) error
	// UpdateStatus updates the status of a log entry by ID.
	UpdateStatus(id, status, errorMsg string) error
	// GetLog retrieves a log entry by ID.
	GetLog(id string) (*LogEntry, error)
}

// TemplateStore is the pluggable template loading interface.
type TemplateStore interface {
	// LoadTemplate returns the subject and body for a template code
	// and locale. The body may be HTML or plain text.
	LoadTemplate(code, locale string) (subject, body string, err error)
}

// NoopLogStore is a no-op LogStore for testing or when persistence
// is not required.
type NoopLogStore struct{}

func (NoopLogStore) CreateLog(entry LogEntry) error                 { return nil }
func (NoopLogStore) UpdateStatus(id, status, errorMsg string) error { return nil }
func (NoopLogStore) GetLog(id string) (*LogEntry, error)            { return nil, nil }

// ──────────────────────────────────────────────
// Dispatcher — multi-channel failover
// ──────────────────────────────────────────────

// Dispatcher manages multiple notification channels and provides
// multi-channel failover. When a Send is called, the dispatcher tries
// each enabled channel of the matching type in order until one succeeds.
type Dispatcher struct {
	mu       sync.RWMutex
	channels []Channel
	logStore LogStore
}

// NewDispatcher creates a new Dispatcher with no channels.
// A NoopLogStore is used by default.
func NewDispatcher() *Dispatcher {
	return &Dispatcher{
		logStore: NoopLogStore{},
	}
}

// NewDispatcherWithStore creates a Dispatcher with a custom LogStore.
func NewDispatcherWithStore(store LogStore) *Dispatcher {
	d := NewDispatcher()
	if store != nil {
		d.logStore = store
	}
	return d
}

// AddChannel registers a channel. Channels are tried in registration
// order for their respective message types.
func (d *Dispatcher) AddChannel(ch Channel) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.channels = append(d.channels, ch)
}

// RemoveChannel removes a channel by name. Returns true if found.
func (d *Dispatcher) RemoveChannel(name string) bool {
	d.mu.Lock()
	defer d.mu.Unlock()
	for i, ch := range d.channels {
		if ch.Name() == name {
			d.channels = append(d.channels[:i], d.channels[i+1:]...)
			return true
		}
	}
	return false
}

// Channels returns a copy of the registered channels.
func (d *Dispatcher) Channels() []Channel {
	d.mu.RLock()
	defer d.mu.RUnlock()
	out := make([]Channel, len(d.channels))
	copy(out, d.channels)
	return out
}

// SetLogStore replaces the log store.
func (d *Dispatcher) SetLogStore(store LogStore) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if store != nil {
		d.logStore = store
	}
}

// Send dispatches a message to all enabled channels of the matching
// type. It tries channels in order and returns nil on the first
// success. If all channels fail, it returns a combined error.
func (d *Dispatcher) Send(ctx context.Context, msg Message) error {
	d.mu.RLock()
	channels := make([]Channel, 0, len(d.channels))
	for _, ch := range d.channels {
		if ch.Enabled() && ch.Type() == msg.Type {
			channels = append(channels, ch)
		}
	}
	store := d.logStore
	d.mu.RUnlock()

	if len(channels) == 0 {
		return fmt.Errorf("notification: no enabled channels for type %q", msg.Type)
	}

	if msg.Timestamp.IsZero() {
		msg.Timestamp = time.Now()
	}

	var errs []string
	for _, ch := range channels {
		logID := generateLogID()
		entry := LogEntry{
			ID:          logID,
			ChannelName: ch.Name(),
			Type:        msg.Type,
			To:          msg.To,
			Subject:     msg.Subject,
			Content:     msg.Body,
			Status:      "pending",
			IPAddress:   msg.IPAddress,
			SentAt:      time.Now(),
			CreatedAt:   time.Now(),
		}
		_ = store.CreateLog(entry)

		err := ch.Send(ctx, msg)
		if err == nil {
			_ = store.UpdateStatus(logID, "sent", "")
			return nil
		}

		_ = store.UpdateStatus(logID, "failed", err.Error())
		errs = append(errs, fmt.Sprintf("%s: %v", ch.Name(), err))
	}

	return fmt.Errorf("notification: all channels failed: %s", strings.Join(errs, "; "))
}

// SendToType is a convenience that constructs a message of the given
// type and sends it.
func (d *Dispatcher) SendToType(ctx context.Context, typ MessageType, to, subject, body string) error {
	return d.Send(ctx, Message{
		Type:    typ,
		To:      to,
		Subject: subject,
		Body:    body,
	})
}

// ChannelNames returns the names of all registered channels.
func (d *Dispatcher) ChannelNames() []string {
	d.mu.RLock()
	defer d.mu.RUnlock()
	names := make([]string, len(d.channels))
	for i, ch := range d.channels {
		names[i] = ch.Name()
	}
	return names
}

// EnabledChannelCount returns the number of enabled channels for a
// given message type.
func (d *Dispatcher) EnabledChannelCount(typ MessageType) int {
	d.mu.RLock()
	defer d.mu.RUnlock()
	count := 0
	for _, ch := range d.channels {
		if ch.Enabled() && ch.Type() == typ {
			count++
		}
	}
	return count
}

// generateLogID produces a simple unique-ish log ID. Applications
// requiring globally unique IDs should use idgen.
func generateLogID() string {
	return fmt.Sprintf("log-%d", time.Now().UnixNano())
}
