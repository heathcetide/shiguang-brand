// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package count implements a global concurrency limiter using atomic
// counters (non-blocking) or a buffered channel semaphore (blocking).
package count

import (
	"context"
	"sync/atomic"

	"github.com/heathcetide/DietDigiDose/pkg/common/limiter"
)

const minusOne uint32 = ^uint32(0)

// atomicLimit is a non-blocking global concurrency limiter.
type atomicLimit struct {
	n       uint32
	current uint32
}

// New creates a non-blocking limiter that allows at most n concurrent
// permits. Acquire returns limiter.ErrLimitExceeded immediately when the
// limit is reached.
func New(n int) limiter.Limiter {
	return &atomicLimit{n: uint32(n)}
}

func (l *atomicLimit) Running() int {
	return int(atomic.LoadUint32(&l.current))
}

func (l *atomicLimit) Acquire(ctx context.Context, key []byte) error {
	if atomic.AddUint32(&l.current, 1) > l.n {
		atomic.AddUint32(&l.current, minusOne)
		return limiter.ErrLimitExceeded
	}
	return nil
}

func (l *atomicLimit) Release(key []byte) {
	atomic.AddUint32(&l.current, minusOne)
}

// ---------------------------------------------------------------
// Blocking variant
// ---------------------------------------------------------------

// blockingLimit is a blocking global concurrency limiter using a semaphore
// channel. Acquire blocks until a permit is available or ctx is cancelled.
type blockingLimit struct {
	ch chan struct{}
}

// NewBlocking creates a blocking limiter that allows at most n concurrent
// permits. Acquire blocks until a permit is available.
func NewBlocking(n int) limiter.Limiter {
	ch := make(chan struct{}, n)
	for i := 0; i < n; i++ {
		ch <- struct{}{}
	}
	return &blockingLimit{ch: ch}
}

func (l *blockingLimit) Running() int {
	return cap(l.ch) - len(l.ch)
}

func (l *blockingLimit) Acquire(ctx context.Context, key []byte) error {
	select {
	case <-l.ch:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (l *blockingLimit) Release(key []byte) {
	select {
	case l.ch <- struct{}{}:
	default:
		// Channel full — shouldn't happen if used correctly, but avoid
		// blocking on a double-release.
	}
}
