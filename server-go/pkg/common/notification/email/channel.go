// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package email

import (
	"context"
	"fmt"

	"github.com/heathcetide/DietDigiDose/pkg/common/notification"
)

// Channel adapts a Mailer to the notification.Channel interface so it
// can be registered with a Dispatcher.
type Channel struct {
	name    string
	mailer  *Mailer
	enabled bool
}

// NewChannel creates an email Channel backed by the given Mailer.
// The channel is enabled by default.
func NewChannel(name string, mailer *Mailer) *Channel {
	return &Channel{
		name:    name,
		mailer:  mailer,
		enabled: true,
	}
}

// Name returns the channel name.
func (c *Channel) Name() string { return c.name }

// Type returns notification.TypeEmail.
func (c *Channel) Type() notification.MessageType { return notification.TypeEmail }

// Enabled reports whether the channel is active.
func (c *Channel) Enabled() bool { return c.enabled }

// SetEnabled toggles the channel on or off.
func (c *Channel) SetEnabled(enabled bool) { c.enabled = enabled }

// Send delivers an email Message via the underlying Mailer. HTML
// bodies are preferred when present.
func (c *Channel) Send(ctx context.Context, msg notification.Message) error {
	if c.mailer == nil {
		return fmt.Errorf("email: channel %q has no mailer", c.name)
	}
	if msg.HTML != "" {
		return c.mailer.Send(ctx, msg.To, msg.Subject, msg.HTML)
	}
	return c.mailer.SendText(ctx, msg.To, msg.Subject, msg.Body)
}
