// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package webhook

import (
	"context"
	"fmt"

	"github.com/heathcetide/DietDigiDose/pkg/common/notification"
)

// Channel wraps a Dispatcher and WebhookConfig to implement the
// notification.Channel interface.
type Channel struct {
	name       string
	dispatcher *Dispatcher
	config     WebhookConfig
	enabled    bool
}

// NewChannel creates a new webhook channel.
func NewChannel(name string, dispatcher *Dispatcher, config WebhookConfig) *Channel {
	return &Channel{
		name:       name,
		dispatcher: dispatcher,
		config:     config,
		enabled:    config.Enabled,
	}
}

// Name returns the channel name.
func (c *Channel) Name() string { return c.name }

// Type returns notification.TypeWebhook.
func (c *Channel) Type() notification.MessageType { return notification.TypeWebhook }

// Enabled reports whether the channel is active.
func (c *Channel) Enabled() bool { return c.enabled }

// SetEnabled dynamically enables or disables the channel.
func (c *Channel) SetEnabled(enabled bool) { c.enabled = enabled }

// Send dispatches a webhook message.
func (c *Channel) Send(ctx context.Context, msg notification.Message) error {
	if c.dispatcher == nil {
		return fmt.Errorf("webhook: channel %q has no dispatcher", c.name)
	}

	event := msg.Event
	if event == "" {
		event = "notification"
	}

	data := msg.Data
	if data == nil {
		data = msg.Extras
	}

	cfg := c.config
	cfg.Enabled = c.enabled

	return c.dispatcher.Dispatch(ctx, cfg, event, data)
}
