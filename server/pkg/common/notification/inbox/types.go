// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package inbox

import "time"

// Filter constants used by List to narrow messages by read state.
const (
	FilterAll    = "all"
	FilterUnread = "unread"
	FilterRead   = "read"
)

// Message is a single in-app inbox notification addressed to a user.
type Message struct {
	ID          string    // unique message ID
	UserID      string    // recipient user ID
	Title       string    // short title / subject
	Content     string    // message body
	ActionURL   string    // optional action link
	ActionLabel string    // optional action button label
	Read        bool      // whether the message has been read
	CreatedAt   time.Time // creation time
	UpdatedAt   time.Time // last update time
}

// PageResult is the paginated result returned by List.
type PageResult struct {
	List        []Message // messages for the requested page
	Total       int64     // total messages matching the filter
	TotalUnread int64     // total unread messages for the user
	TotalRead   int64     // total read messages for the user
}

// IsValidFilter reports whether filter is one of the supported filter
// constants (all, unread, read).
func IsValidFilter(filter string) bool {
	switch filter {
	case FilterAll, FilterUnread, FilterRead:
		return true
	default:
		return false
	}
}
