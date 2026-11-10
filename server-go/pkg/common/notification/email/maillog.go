// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package email

import (
	"fmt"
	"strings"
	"sync"
	"time"
)

// ──────────────────────────────────────────────
// Mail log — persisted record of outbound emails
// ──────────────────────────────────────────────

// MailLog is a persisted record of an outbound email send attempt.
// It tracks the delivery lifecycle from initial send through webhook
// status updates (delivered, opened, bounced, etc.).
type MailLog struct {
	ID          string    // unique identifier (provider message ID or generated)
	Provider    string    // provider kind: "smtp", "sendcloud", etc.
	ChannelName string    // channel label for multi-channel setups
	ToEmail     string    // recipient address
	Subject     string    // email subject
	HtmlBody    string    // email HTML body
	Status      string    // delivery status (see status constants)
	ErrorMsg    string    // error message on failure
	MessageID   string    // provider-assigned message ID
	RetryCount  int       // number of retry attempts
	SentAt      time.Time // when the send was initiated
	CreatedAt   time.Time // when the log was created
	UpdatedAt   time.Time // when the log was last updated
}

// MailLogStore is the persistence abstraction for mail logs.
// Implementations may use an in-memory map, a database, or any other
// storage backend.
type MailLogStore interface {
	// CreateMailLog records a successful or accepted send.
	CreateMailLog(log *MailLog) error
	// CreateFailedMailLog records a send that failed after all retries.
	CreateFailedMailLog(log *MailLog) error
	// UpdateMailLogStatusByMessageID updates the status of a log entry
	// identified by its provider message ID. Status transitions follow
	// lifecycle ordering so late webhooks cannot downgrade a more
	// advanced status.
	UpdateMailLogStatusByMessageID(messageID, provider, status, errorMsg string) error
	// GetMailLogByMessageID returns a log entry by provider message ID.
	GetMailLogByMessageID(messageID string) (*MailLog, error)
	// GetMailLogs returns paginated logs, most recent first.
	GetMailLogs(page, pageSize int) ([]*MailLog, int64, error)
	// GetMailLogStats returns status counts.
	GetMailLogStats() (map[string]int64, error)
}

// ──────────────────────────────────────────────
// Mail log status transitions
// ──────────────────────────────────────────────

// mailStatusRank orders lifecycle states for webhook updates.
// Higher rank = more advanced. Terminal failure states use negative
// ranks so they always override success states.
func mailStatusRank(status string) int {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case StatusSent:
		return 1
	case StatusDelivered:
		return 2
	case StatusOpened:
		return 3
	case StatusClicked:
		return 4
	case StatusUnsubscribed:
		return 5
	case StatusUnknown:
		return 0
	default:
		return 0
	}
}

// isTerminalFailureStatus reports whether status is a terminal failure.
func isTerminalFailureStatus(status string) bool {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case StatusFailed, StatusSoftBounce, StatusInvalid, StatusSpam:
		return true
	default:
		return false
	}
}

// ResolveMailLogStatusTransition decides whether to apply an incoming
// status to a mail log row. It returns the next status and whether the
// update should be applied.
//
// Rules:
//   - Empty incoming status: no change.
//   - Same status: no change.
//   - Terminal failure incoming: always apply (overrides any success).
//   - Terminal failure current: do not downgrade.
//   - Higher rank incoming: apply.
//   - Lower or equal rank incoming: no change.
func ResolveMailLogStatusTransition(current, incoming string) (next string, apply bool) {
	current = strings.TrimSpace(current)
	incoming = strings.TrimSpace(incoming)
	if incoming == "" {
		return current, false
	}
	if current == incoming {
		return current, false
	}
	if isTerminalFailureStatus(incoming) {
		return incoming, true
	}
	if isTerminalFailureStatus(current) {
		return current, false
	}
	if mailStatusRank(incoming) > mailStatusRank(current) {
		return incoming, true
	}
	return current, false
}

// InitialMailStatus returns the DB status right after a successful
// provider send. SMTP starts as "delivered" (synchronous handoff);
// SendCloud starts as "sent" (async, refined by webhooks).
func InitialMailStatus(kind string) string {
	switch kind {
	case "smtp":
		return StatusDelivered
	case "sendcloud":
		return StatusSent
	default:
		return StatusSent
	}
}

// ──────────────────────────────────────────────
// In-memory mail log store
// ──────────────────────────────────────────────

// MemoryMailLogStore is a thread-safe in-memory MailLogStore.
// It is primarily intended for testing and small-scale deployments.
type MemoryMailLogStore struct {
	mu    sync.RWMutex
	logs  map[string]*MailLog // keyed by MessageID
	order []string            // insertion order for pagination
}

// NewMemoryMailLogStore creates a new empty MemoryMailLogStore.
func NewMemoryMailLogStore() *MemoryMailLogStore {
	return &MemoryMailLogStore{
		logs: make(map[string]*MailLog),
	}
}

// CreateMailLog records a successful or accepted send.
func (s *MemoryMailLogStore) CreateMailLog(log *MailLog) error {
	if log == nil {
		return fmt.Errorf("email: nil mail log")
	}
	if log.MessageID == "" {
		return fmt.Errorf("email: mail log requires message ID")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now()
	if log.CreatedAt.IsZero() {
		log.CreatedAt = now
	}
	log.UpdatedAt = now
	s.logs[log.MessageID] = log
	s.order = append(s.order, log.MessageID)
	return nil
}

// CreateFailedMailLog records a send that failed after all retries.
func (s *MemoryMailLogStore) CreateFailedMailLog(log *MailLog) error {
	if log == nil {
		return fmt.Errorf("email: nil mail log")
	}
	if log.MessageID == "" {
		log.MessageID = fmt.Sprintf("failed-%d", time.Now().UnixNano())
	}
	log.Status = StatusFailed
	return s.CreateMailLog(log)
}

// UpdateMailLogStatusByMessageID updates the status of a log entry.
func (s *MemoryMailLogStore) UpdateMailLogStatusByMessageID(messageID, provider, status, errorMsg string) error {
	if messageID == "" {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	log, ok := s.logs[messageID]
	if !ok {
		return fmt.Errorf("email: mail log not found for message ID %q", messageID)
	}
	if provider != "" && log.Provider != provider {
		return fmt.Errorf("email: provider mismatch for message ID %q", messageID)
	}
	next, apply := ResolveMailLogStatusTransition(log.Status, status)
	if !apply {
		return nil
	}
	log.Status = next
	if errorMsg != "" {
		log.ErrorMsg = errorMsg
	}
	log.UpdatedAt = time.Now()
	return nil
}

// GetMailLogByMessageID returns a log entry by provider message ID.
func (s *MemoryMailLogStore) GetMailLogByMessageID(messageID string) (*MailLog, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	log, ok := s.logs[messageID]
	if !ok {
		return nil, fmt.Errorf("email: mail log not found for message ID %q", messageID)
	}
	return log, nil
}

// GetMailLogs returns paginated logs, most recent first.
func (s *MemoryMailLogStore) GetMailLogs(page, pageSize int) ([]*MailLog, int64, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	total := int64(len(s.order))
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 20
	}
	offset := (page - 1) * pageSize
	if offset >= len(s.order) {
		return nil, total, nil
	}
	// Return in reverse insertion order (most recent first).
	end := offset + pageSize
	if end > len(s.order) {
		end = len(s.order)
	}
	result := make([]*MailLog, 0, end-offset)
	for i := len(s.order) - 1 - offset; i >= 0 && len(result) < pageSize; i-- {
		if i < len(s.order) {
			result = append(result, s.logs[s.order[i]])
		}
	}
	return result, total, nil
}

// GetMailLogStats returns status counts.
func (s *MemoryMailLogStore) GetMailLogStats() (map[string]int64, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	stats := map[string]int64{"total": 0}
	for _, log := range s.logs {
		stats[log.Status]++
		stats["total"]++
	}
	return stats, nil
}
