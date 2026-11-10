// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package inbox

import (
	"context"
	"fmt"

	"github.com/heathcetide/DietDigiDose/pkg/common/notification"
)

// Channel wraps a Store to implement the notification.Channel
// interface, allowing in-app inbox notifications to be registered with
// a notification.Dispatcher.
type Channel struct {
	name    string
	store   Store
	enabled bool
}

// NewChannel creates an inbox Channel backed by the given Store.
// The channel is enabled by default.
func NewChannel(name string, store Store) *Channel {
	return &Channel{
		name:    name,
		store:   store,
		enabled: true,
	}
}

// Name returns the channel name.
func (c *Channel) Name() string { return c.name }

// Type returns notification.TypeInbox.
func (c *Channel) Type() notification.MessageType { return notification.TypeInbox }

// Enabled reports whether the channel is active.
func (c *Channel) Enabled() bool { return c.enabled }

// SetEnabled toggles the channel on or off.
func (c *Channel) SetEnabled(enabled bool) { c.enabled = enabled }

// Send delivers an inbox Message via the underlying Store. The
// recipient is taken from msg.UserID (falling back to msg.To), the
// title from msg.Title (falling back to msg.Subject), and the content
// from msg.Content (falling back to msg.Body).
func (c *Channel) Send(ctx context.Context, msg notification.Message) error {
	if c.store == nil {
		return fmt.Errorf("inbox: channel %q has no store", c.name)
	}

	userID := msg.UserID
	if userID == "" {
		userID = msg.To
	}
	title := msg.Title
	if title == "" {
		title = msg.Subject
	}
	content := msg.Content
	if content == "" {
		content = msg.Body
	}

	if userID == "" {
		return fmt.Errorf("inbox: userID is required")
	}
	if title == "" {
		return fmt.Errorf("inbox: title is required")
	}

	return c.store.Create(Message{
		UserID:      userID,
		Title:       title,
		Content:     content,
		ActionURL:   msg.ActionURL,
		ActionLabel: msg.ActionLabel,
	})
}
