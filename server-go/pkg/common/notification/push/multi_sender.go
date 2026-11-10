// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package push

import (
	"context"
	"fmt"
	"sync"
)

// SenderChannel pairs a named provider with an enabled flag for use in
// a MultiSender.
type SenderChannel struct {
	Name     string
	Provider Provider
	Enabled  bool
}

// MultiSender sends push notifications through a set of channels with
// round-robin selection and automatic failover to the next enabled channel.
type MultiSender struct {
	channels      []SenderChannel
	startingIndex int
	mu            sync.Mutex
	currentIndex  int
}

// NewMultiSender creates a MultiSender over the given channels. The
// starting round-robin index defaults to 0.
func NewMultiSender(channels []SenderChannel) *MultiSender {
	ms := &MultiSender{
		channels: channels,
	}
	ms.currentIndex = ms.startingIndex
	return ms
}

// SetStartingIndex sets the initial round-robin pointer.
func (m *MultiSender) SetStartingIndex(i int) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.startingIndex = i
	m.currentIndex = i
}

// enabledChannels returns the subset of channels that are enabled.
func (m *MultiSender) enabledChannels() []SenderChannel {
	out := make([]SenderChannel, 0, len(m.channels))
	for _, c := range m.channels {
		if c.Enabled && c.Provider != nil {
			out = append(out, c)
		}
	}
	return out
}

// Send delivers req through the enabled channels in round-robin order,
// failing over to the next channel on error until one succeeds or all
// are exhausted.
func (m *MultiSender) Send(ctx context.Context, req SendRequest) (*SendResult, error) {
	enabled := m.enabledChannels()
	if len(enabled) == 0 {
		return nil, fmt.Errorf("push: no enabled channels")
	}

	start := m.nextIndex(len(enabled))
	n := len(enabled)

	var lastResult *SendResult
	var lastErr error
	for i := 0; i < n; i++ {
		ch := enabled[(start+i)%n]

		if err := ctx.Err(); err != nil {
			return lastResult, err
		}

		result, err := ch.Provider.Send(ctx, req)
		if err == nil && result != nil && result.Accepted {
			m.advanceIndex(start, i, n)
			return result, nil
		}
		lastErr = err
		lastResult = result
	}
	if lastErr == nil {
		lastErr = fmt.Errorf("push: all channels failed")
	}
	if lastResult == nil {
		lastResult = &SendResult{Status: "failed", Error: lastErr.Error()}
	}
	return lastResult, fmt.Errorf("push: all channels failed: %w", lastErr)
}

// nextIndex returns the current round-robin start index.
func (m *MultiSender) nextIndex(n int) int {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.currentIndex < 0 {
		m.currentIndex = 0
	}
	if n > 0 {
		m.currentIndex %= n
	}
	return m.currentIndex
}

// advanceIndex moves the round-robin pointer past the successful channel.
func (m *MultiSender) advanceIndex(start, offset, n int) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.currentIndex = (start + offset + 1) % n
}
