// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package inbox

import (
	"fmt"
	"strconv"
	"strings"
	"sync"
	"time"
)

// MemoryStore is a goroutine-safe, in-memory implementation of Store.
// It is primarily intended for testing and small, ephemeral workloads.
type MemoryStore struct {
	mu        sync.RWMutex
	messages  map[string][]Message // keyed by userID
	idCounter int64
}

// NewMemoryStore creates a new empty MemoryStore.
func NewMemoryStore() *MemoryStore {
	return &MemoryStore{
		messages: make(map[string][]Message),
	}
}

// nextID returns a monotonically increasing ID string.
func (m *MemoryStore) nextID() string {
	m.idCounter++
	return strconv.FormatInt(m.idCounter, 10)
}

// Create persists a new message, assigning an ID and timestamps when
// they are zero.
func (m *MemoryStore) Create(msg Message) error {
	if msg.UserID == "" {
		return fmt.Errorf("inbox: userID is required")
	}
	m.mu.Lock()
	defer m.mu.Unlock()

	now := time.Now()
	if msg.ID == "" {
		msg.ID = m.nextID()
	}
	if msg.CreatedAt.IsZero() {
		msg.CreatedAt = now
	}
	if msg.UpdatedAt.IsZero() {
		msg.UpdatedAt = now
	}
	m.messages[msg.UserID] = append(m.messages[msg.UserID], msg)
	return nil
}

// GetByID retrieves a single message by userID and ID.
func (m *MemoryStore) GetByID(userID, id string) (*Message, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	for _, msg := range m.messages[userID] {
		if msg.ID == id {
			out := msg
			return &out, nil
		}
	}
	return nil, fmt.Errorf("inbox: message %q not found for user %q", id, userID)
}

// List returns a paginated, filtered view of a user's messages.
func (m *MemoryStore) List(userID string, page, size int, filter, titleKeyword, contentKeyword string, startTime, endTime time.Time) (PageResult, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	all := m.messages[userID]
	if !IsValidFilter(filter) {
		filter = FilterAll
	}

	var (
		filtered    = make([]Message, 0, len(all))
		totalUnread int64
		totalRead   int64
	)
	for _, msg := range all {
		if !msg.Read {
			totalUnread++
		} else {
			totalRead++
		}

		// read-state filter
		switch filter {
		case FilterUnread:
			if msg.Read {
				continue
			}
		case FilterRead:
			if !msg.Read {
				continue
			}
		}

		// keyword filters (case-insensitive substring)
		if titleKeyword != "" && !strings.Contains(strings.ToLower(msg.Title), strings.ToLower(titleKeyword)) {
			continue
		}
		if contentKeyword != "" && !strings.Contains(strings.ToLower(msg.Content), strings.ToLower(contentKeyword)) {
			continue
		}

		// time range
		if !startTime.IsZero() && msg.CreatedAt.Before(startTime) {
			continue
		}
		if !endTime.IsZero() && msg.CreatedAt.After(endTime) {
			continue
		}

		filtered = append(filtered, msg)
	}

	total := int64(len(filtered))

	// paginate (newest first by CreatedAt)
	sortByCreatedDesc(filtered)

	if page < 1 {
		page = 1
	}
	if size < 1 {
		size = 10
	}
	start := (page - 1) * size
	if start >= len(filtered) {
		return PageResult{
			List:        []Message{},
			Total:       total,
			TotalUnread: totalUnread,
			TotalRead:   totalRead,
		}, nil
	}
	end := start + size
	if end > len(filtered) {
		end = len(filtered)
	}

	pageList := make([]Message, end-start)
	copy(pageList, filtered[start:end])

	return PageResult{
		List:        pageList,
		Total:       total,
		TotalUnread: totalUnread,
		TotalRead:   totalRead,
	}, nil
}

// UnreadCount returns the number of unread messages for the user.
func (m *MemoryStore) UnreadCount(userID string) (int64, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	var count int64
	for _, msg := range m.messages[userID] {
		if !msg.Read {
			count++
		}
	}
	return count, nil
}

// MarkRead marks a single message as read.
func (m *MemoryStore) MarkRead(userID, id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	for i, msg := range m.messages[userID] {
		if msg.ID == id {
			if msg.Read {
				return nil // already read; idempotent
			}
			m.messages[userID][i].Read = true
			m.messages[userID][i].UpdatedAt = time.Now()
			return nil
		}
	}
	return fmt.Errorf("inbox: message %q not found for user %q", id, userID)
}

// MarkAllRead marks every unread message for the user as read.
func (m *MemoryStore) MarkAllRead(userID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	now := time.Now()
	for i := range m.messages[userID] {
		if !m.messages[userID][i].Read {
			m.messages[userID][i].Read = true
			m.messages[userID][i].UpdatedAt = now
		}
	}
	return nil
}

// Delete removes a single message by ID.
func (m *MemoryStore) Delete(userID, id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	list := m.messages[userID]
	for i, msg := range list {
		if msg.ID == id {
			m.messages[userID] = append(list[:i], list[i+1:]...)
			return nil
		}
	}
	return fmt.Errorf("inbox: message %q not found for user %q", id, userID)
}

// BatchDelete removes multiple messages by ID and returns the number
// actually removed.
func (m *MemoryStore) BatchDelete(userID string, ids []string) (int64, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	want := make(map[string]struct{}, len(ids))
	for _, id := range ids {
		want[id] = struct{}{}
	}

	list := m.messages[userID]
	kept := list[:0]
	var removed int64
	for _, msg := range list {
		if _, ok := want[msg.ID]; ok {
			removed++
			continue
		}
		kept = append(kept, msg)
	}
	m.messages[userID] = kept
	return removed, nil
}

// CleanOldUnread deletes unread messages older than `before` across all
// users and returns the number removed.
func (m *MemoryStore) CleanOldUnread(before time.Time) (int64, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	var removed int64
	for userID, list := range m.messages {
		kept := list[:0]
		for _, msg := range list {
			if !msg.Read && msg.CreatedAt.Before(before) {
				removed++
				continue
			}
			kept = append(kept, msg)
		}
		m.messages[userID] = kept
	}
	return removed, nil
}

// sortByCreatedDesc sorts messages newest-first by CreatedAt.
func sortByCreatedDesc(msgs []Message) {
	for i := 1; i < len(msgs); i++ {
		for j := i; j > 0 && msgs[j].CreatedAt.After(msgs[j-1].CreatedAt); {
			msgs[j], msgs[j-1] = msgs[j-1], msgs[j]
			j--
		}
	}
}
