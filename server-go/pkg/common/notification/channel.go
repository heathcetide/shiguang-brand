// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package notification

import (
	"context"
	"fmt"
	"sync"
)

// ChannelFunc is a function adapter for the Channel interface. It is
// useful for creating simple channels without defining a full struct.
type ChannelFunc struct {
	ChannelName     string
	ChannelType     MessageType
	ChannelEnabled  bool
	SendFunc        func(ctx context.Context, msg Message) error
	mu              sync.RWMutex
	enabledOverride *bool
}

// Name returns the channel name.
func (c *ChannelFunc) Name() string { return c.ChannelName }

// Type returns the channel type.
func (c *ChannelFunc) Type() MessageType { return c.ChannelType }

// Send calls the configured send function.
func (c *ChannelFunc) Send(ctx context.Context, msg Message) error {
	if c.SendFunc == nil {
		return fmt.Errorf("notification: channel %q has no send function", c.ChannelName)
	}
	return c.SendFunc(ctx, msg)
}

// Enabled reports whether the channel is active.
func (c *ChannelFunc) Enabled() bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	if c.enabledOverride != nil {
		return *c.enabledOverride
	}
	return c.ChannelEnabled
}

// SetEnabled dynamically enables or disables the channel.
func (c *ChannelFunc) SetEnabled(enabled bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.enabledOverride = &enabled
}

// NewChannelFunc creates a simple channel from a function.
func NewChannelFunc(name string, typ MessageType, enabled bool, send func(ctx context.Context, msg Message) error) *ChannelFunc {
	return &ChannelFunc{
		ChannelName:    name,
		ChannelType:    typ,
		ChannelEnabled: enabled,
		SendFunc:       send,
	}
}

// BaseChannel is a reusable base struct for channel implementations.
// Embed it in a concrete channel struct to get Name/Type/Enabled
// boilerplate for free.
type BaseChannel struct {
	ChannelName string
	ChannelType MessageType
	IsEnabled   bool
}

func (b *BaseChannel) Name() string      { return b.ChannelName }
func (b *BaseChannel) Type() MessageType { return b.ChannelType }
func (b *BaseChannel) Enabled() bool     { return b.IsEnabled }
