// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package im

import (
	"context"
	"fmt"

	"github.com/heathcetide/DietDigiDose/pkg/common/notification"
)

// Channel adapts an IM Provider to the notification.Channel interface
// so it can be registered with a notification.Dispatcher.
type Channel struct {
	name     string
	provider Provider
	enabled  bool
}

// NewChannel creates an IM Channel backed by the given provider. The
// channel is enabled by default.
func NewChannel(name string, provider Provider) *Channel {
	return &Channel{
		name:     name,
		provider: provider,
		enabled:  true,
	}
}

// Name returns the channel name.
func (c *Channel) Name() string { return c.name }

// Type returns notification.TypeIM.
func (c *Channel) Type() notification.MessageType { return notification.TypeIM }

// Enabled reports whether the channel is active.
func (c *Channel) Enabled() bool { return c.enabled }

// SetEnabled toggles the channel on or off.
func (c *Channel) SetEnabled(enabled bool) { c.enabled = enabled }

// Send converts a notification.Message into an im.Message and
// delivers it via the underlying provider.
func (c *Channel) Send(ctx context.Context, msg notification.Message) error {
	if c.provider == nil {
		return fmt.Errorf("im: channel %q has no provider", c.name)
	}
	imMsg := Message{
		Title:   msg.Title,
		Content: msg.Content,
	}
	if imMsg.Title == "" {
		imMsg.Title = msg.Subject
	}
	if imMsg.Content == "" {
		imMsg.Content = msg.Body
	}
	return c.provider.Send(ctx, imMsg)
}
