// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package inbox

import "time"

// Store is the pluggable persistence interface for inbox messages.
// Applications provide a concrete implementation (e.g. gorm-backed);
// the in-box package ships an in-memory implementation for testing.
type Store interface {
	// Create persists a new message. The store is responsible for
	// assigning an ID and timestamps when they are zero.
	Create(msg Message) error

	// GetByID retrieves a single message by userID and ID.
	GetByID(userID, id string) (*Message, error)

	// List returns a paginated, filtered view of a user's messages.
	// filter is one of FilterAll / FilterUnread / FilterRead. The
	// titleKeyword and contentKeyword perform substring matches when
	// non-empty; startTime / endTime bound CreatedAt when non-zero.
	List(userID string, page, size int, filter, titleKeyword, contentKeyword string, startTime, endTime time.Time) (PageResult, error)

	// UnreadCount returns the number of unread messages for the user.
	UnreadCount(userID string) (int64, error)

	// MarkRead marks a single message as read.
	MarkRead(userID, id string) error

	// MarkAllRead marks every unread message for the user as read.
	MarkAllRead(userID string) error

	// Delete removes a single message by ID.
	Delete(userID, id string) error

	// BatchDelete removes multiple messages by ID and returns the
	// number actually removed.
	BatchDelete(userID string, ids []string) (int64, error)

	// CleanOldUnread deletes unread messages older than `before` across
	// all users and returns the number removed.
	CleanOldUnread(before time.Time) (int64, error)
}
