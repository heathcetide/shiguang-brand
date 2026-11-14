// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package limiter defines a unified rate-limiting and concurrency-control
// interface with multiple pluggable implementations.
//
// The package follows the same "one interface, many backends" pattern used
// by [github.com/LingByte/ling-base/lock]. Each sub-package provides a
// concrete strategy:
//
//   - count/        — global concurrency cap (atomic or blocking)
//   - keycount/     — per-key concurrency cap (mutex, sync-atomic, or blocking)
//   - keysize/      — per-key cumulative byte-size cap
//   - tokenbucket/  — token-bucket rate limiter (QPS / burst)
//   - null/         — no-op implementation (disable limiting)
//
// Basic usage:
//
//	// Global max 100 concurrent
//	l := count.New(100)
//	if err := l.Acquire(nil); err != nil {
//	    // limit exceeded
//	}
//	defer l.Release(nil)
//
//	// Per-user max 5 concurrent
//	l := keycount.New(5)
//	l.Acquire([]byte("user123"))
//	defer l.Release([]byte("user123"))
//
//	// 100 requests per second, burst 200
//	l := tokenbucket.New(100, 200)
//	if err := l.Acquire(nil); err != nil {
//	    // rate limited
//	}
package limiter

import (
	"context"
	"errors"
)

// Sentinel errors returned by limiter implementations.
var (
	// ErrLimitExceeded is returned when Acquire cannot grant a permit
	// immediately (non-blocking mode).
	ErrLimitExceeded = errors.New("limiter: limit exceeded")

	// ErrKeyRequired is returned when an implementation requires a non-empty
	// key but received an empty one.
	ErrKeyRequired = errors.New("limiter: key must not be empty")

	// ErrInvalidLimit is returned when the configured limit is <= 0.
	ErrInvalidLimit = errors.New("limiter: limit must be greater than zero")

	// ErrInvalidSize is returned when the requested size is <= 0.
	ErrInvalidSize = errors.New("limiter: size must be greater than zero")
)

// Limiter is the core concurrency-control interface. Every implementation
// satisfies this contract.
//
//   - Running returns the current number of active permits (-1 if unknown).
//   - Acquire attempts to obtain a permit for the given key. In non-blocking
//     implementations it returns ErrLimitExceeded immediately when the limit
//     is reached. In blocking implementations it waits until a permit is
//     available or ctx is cancelled.
//   - Release frees a previously acquired permit.
type Limiter interface {
	// Running returns the current number of active permits, or -1 if the
	// implementation does not track this metric.
	Running() int

	// Acquire obtains a permit for the given key. The key may be nil for
	// global limiters. Returns ErrLimitExceeded (non-blocking) or
	// context.Canceled / context.DeadlineExceeded (blocking) on failure.
	Acquire(ctx context.Context, key []byte) error

	// Release frees a permit previously obtained via Acquire.
	Release(key []byte)
}

// StringLimiter is a string-keyed variant for convenience.
type StringLimiter interface {
	Running() int
	Acquire(ctx context.Context, key string) error
	Release(key string)
}

// SizeLimiter extends Limiter with byte-size-aware acquisition, useful for
// bandwidth or storage quotas.
type SizeLimiter interface {
	// Running returns the current total bytes held, or -1 if unknown.
	Running() int64

	// Acquire requests size bytes for the given key.
	Acquire(ctx context.Context, key []byte, size int64) error

	// Release returns size bytes for the given key.
	Release(key []byte, size int64)

	// Remaining returns the remaining capacity for the given key.
	Remaining(key []byte) int64
}

// AcquireString is a helper that wraps a Limiter with a string key.
func AcquireString(l Limiter, ctx context.Context, key string) error {
	return l.Acquire(ctx, []byte(key))
}

// ReleaseString is a helper that wraps a Limiter with a string key.
func ReleaseString(l Limiter, key string) {
	l.Release([]byte(key))
}
