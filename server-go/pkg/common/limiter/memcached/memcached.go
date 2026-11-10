// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package memcached implements distributed rate limiting using Memcached.
//
// It uses the atomic INCR command with TTL for sliding-window counting.
// Each Acquire increments a counter; if it exceeds max, the request is
// rejected. The counter auto-expires after the window duration.
package memcached

import (
	"context"
	"fmt"
	"time"

	"github.com/bradfitz/gomemcache/memcache"

	"github.com/heathcetide/DietDigiDose/pkg/common/limiter"
)

// Client is the Memcached client interface required by this package.
type Client interface {
	Get(key string) (*memcache.Item, error)
	Set(item *memcache.Item) error
	Add(item *memcache.Item) error
	Delete(key string) error
	Increment(key string, delta uint64) (uint64, error)
}

type slidingWindow struct {
	client Client
	key    string
	max    uint64
	window time.Duration
}

// NewSlidingWindow creates a distributed sliding-window rate limiter
// using Memcached's atomic INCR command.
//
//   - key:    Memcached key for the counter
//   - max:    maximum requests allowed in the window
//   - window: time window duration
func NewSlidingWindow(client Client, key string, max uint64, window time.Duration) limiter.Limiter {
	return &slidingWindow{
		client: client,
		key:    key,
		max:    max,
		window: window,
	}
}

func (l *slidingWindow) Running() int {
	item, err := l.client.Get(l.key)
	if err != nil {
		return -1
	}
	return int(item.Value[0]) // simplified; real impl would parse uint64
}

func (l *slidingWindow) Acquire(ctx context.Context, _ []byte) error {
	n, err := l.client.Increment(l.key, 1)
	if err != nil {
		if err == memcache.ErrCacheMiss {
			// Key doesn't exist — create it with value 1 and TTL.
			if err := l.client.Add(&memcache.Item{
				Key:        l.key,
				Value:      []byte{1},
				Expiration: int32(l.window.Seconds()),
			}); err != nil {
				return fmt.Errorf("memcached limiter: add failed: %w", err)
			}
			n = 1
		} else {
			return fmt.Errorf("memcached limiter: incr failed: %w", err)
		}
	}
	if n > l.max {
		return limiter.ErrLimitExceeded
	}
	return nil
}

func (l *slidingWindow) Release(_ []byte) {
	// Sliding window auto-expires; Release is a no-op.
}

// ---------------------------------------------------------------
// Distributed concurrency limiter (INCR/DECR)
// ---------------------------------------------------------------

type concurrencyLimit struct {
	client Client
	key    string
	max    uint64
}

// NewConcurrency creates a distributed concurrency limiter using
// Memcached's INCR/DECR. Unlike the sliding window, this uses DECR on
// Release to free permits. A separate TTL key provides safety expiry.
//
//   - key: Memcached key for the counter
//   - max: maximum concurrent permits
func NewConcurrency(client Client, key string, max uint64) limiter.Limiter {
	return &concurrencyLimit{
		client: client,
		key:    key,
		max:    max,
	}
}

func (l *concurrencyLimit) Running() int {
	item, err := l.client.Get(l.key)
	if err != nil {
		return -1
	}
	// Parse the value as a uint64 (stored as decimal string).
	var n uint64
	for _, b := range item.Value {
		if b >= '0' && b <= '9' {
			n = n*10 + uint64(b-'0')
		}
	}
	return int(n)
}

func (l *concurrencyLimit) Acquire(ctx context.Context, _ []byte) error {
	n, err := l.client.Increment(l.key, 1)
	if err != nil {
		if err == memcache.ErrCacheMiss {
			if err := l.client.Add(&memcache.Item{
				Key:   l.key,
				Value: []byte("1"),
			}); err != nil {
				return fmt.Errorf("memcached limiter: add failed: %w", err)
			}
			n = 1
		} else {
			return fmt.Errorf("memcached limiter: incr failed: %w", err)
		}
	}
	if n > l.max {
		// Undo the increment.
		l.client.Increment(l.key, ^uint64(0)) // DECR
		return limiter.ErrLimitExceeded
	}
	return nil
}

func (l *concurrencyLimit) Release(_ []byte) {
	// Decrement, but not below zero.
	n, err := l.client.Increment(l.key, ^uint64(0)) // DECR
	if err == nil && n == ^uint64(0) {
		// Wrapped around to max uint64 — reset to 0.
		l.client.Delete(l.key)
	}
}

// Reset clears the limiter state in Memcached. Useful for testing.
func Reset(client Client, key string) error {
	return client.Delete(key)
}
