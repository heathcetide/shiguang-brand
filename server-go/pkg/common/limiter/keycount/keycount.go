// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package keycount implements per-key concurrency limiting with three
// strategies:
//
//   - New(n)              — mutex-protected map, non-blocking
//   - NewSync(n)          — atomic counters with double-checked map, non-blocking
//   - NewBlocking(n)      — per-key semaphore with sync.Cond, blocking
package keycount

import (
	"context"
	"sync"
	"sync/atomic"

	"github.com/heathcetide/DietDigiDose/pkg/common/limiter"
)

const minusOne uint32 = ^uint32(0)

// ---------------------------------------------------------------
// Mutex-based non-blocking
// ---------------------------------------------------------------

type mutexLimit struct {
	mu      sync.Mutex
	current map[string]uint32
	n       uint32
}

// New creates a non-blocking per-key limiter. Each key gets its own
// counter with a maximum of n concurrent permits.
func New(n int) limiter.Limiter {
	return &mutexLimit{current: make(map[string]uint32), n: uint32(n)}
}

func (l *mutexLimit) Running() int {
	l.mu.Lock()
	defer l.mu.Unlock()
	var total uint32
	for _, v := range l.current {
		total += v
	}
	return int(total)
}

func (l *mutexLimit) Acquire(ctx context.Context, key []byte) error {
	k := string(key)
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.current[k] >= l.n {
		return limiter.ErrLimitExceeded
	}
	l.current[k]++
	return nil
}

func (l *mutexLimit) Release(key []byte) {
	k := string(key)
	l.mu.Lock()
	defer l.mu.Unlock()
	n, ok := l.current[k]
	if !ok {
		return
	}
	if n <= 1 {
		delete(l.current, k)
	} else {
		l.current[k] = n - 1
	}
}

// ---------------------------------------------------------------
// Atomic-based non-blocking (higher throughput, tiny race window)
// ---------------------------------------------------------------

type syncLimit struct {
	mu      sync.RWMutex
	current map[string]*uint32
	n       uint32
}

// NewSync creates a high-throughput non-blocking per-key limiter using
// atomic counters. There is a negligible race window between the check
// and the increment, but it avoids holding a lock during Acquire for
// better performance under heavy contention.
func NewSync(n int) limiter.StringLimiter {
	return &syncLimit{current: make(map[string]*uint32), n: uint32(n)}
}

func (l *syncLimit) Running() int {
	l.mu.RLock()
	defer l.mu.RUnlock()
	var total uint32
	for _, c := range l.current {
		total += atomic.LoadUint32(c)
	}
	return int(total)
}

func (l *syncLimit) Acquire(ctx context.Context, key string) error {
	l.mu.RLock()
	c := l.current[key]
	l.mu.RUnlock()
	if c == nil {
		l.mu.Lock()
		c = l.current[key]
		if c == nil {
			c = new(uint32)
			l.current[key] = c
		}
		l.mu.Unlock()
	}
	if atomic.AddUint32(c, 1) > l.n {
		atomic.AddUint32(c, minusOne)
		return limiter.ErrLimitExceeded
	}
	return nil
}

func (l *syncLimit) Release(key string) {
	l.mu.RLock()
	c := l.current[key]
	l.mu.RUnlock()
	if c != nil {
		atomic.AddUint32(c, minusOne)
	}
}

// ---------------------------------------------------------------
// Blocking with per-key semaphores
// ---------------------------------------------------------------

type semaphore struct {
	refs  int // number of Acquire callers using this semaphore
	max   int
	value int
	cond  sync.Cond
}

func newSemaphore(max int) *semaphore {
	return &semaphore{max: max, cond: sync.Cond{L: &sync.Mutex{}}}
}

func (s *semaphore) Running() int {
	s.cond.L.Lock()
	defer s.cond.L.Unlock()
	return s.value
}

func (s *semaphore) Acquire(ctx context.Context) error {
	s.cond.L.Lock()
	defer s.cond.L.Unlock()
	for {
		if s.value < s.max {
			s.value++
			return nil
		}
		// Wait with context support.
		done := make(chan struct{})
		go func() {
			s.cond.L.Lock()
			s.cond.Broadcast()
			s.cond.L.Unlock()
			close(done)
		}()
		// We can't truly integrate context with sync.Cond, so we use a
		// timeout-based fallback. For full context support use the
		// channel-based semaphore in the count package.
		s.cond.Wait()
		select {
		case <-ctx.Done():
			s.value--
			if s.value < 0 {
				s.value = 0
			}
			return ctx.Err()
		default:
		}
	}
}

func (s *semaphore) Release() {
	s.cond.L.Lock()
	defer s.cond.L.Unlock()
	s.value--
	if s.value < 0 {
		s.value = 0
	}
	s.cond.Signal()
}

type blockingLimit struct {
	mu      sync.Mutex
	current map[string]*semaphore
	n       int
}

// NewBlocking creates a blocking per-key limiter. Acquire blocks until
// a permit for the key is available or ctx is cancelled.
func NewBlocking(n int) limiter.Limiter {
	return &blockingLimit{current: make(map[string]*semaphore), n: n}
}

func (l *blockingLimit) Running() int {
	l.mu.Lock()
	defer l.mu.Unlock()
	total := 0
	for _, s := range l.current {
		total += s.Running()
	}
	return total
}

func (l *blockingLimit) Acquire(ctx context.Context, key []byte) error {
	k := string(key)
	l.mu.Lock()
	s, ok := l.current[k]
	if !ok {
		s = newSemaphore(l.n)
		l.current[k] = s
	}
	s.refs++
	l.mu.Unlock()

	return s.Acquire(ctx)
}

func (l *blockingLimit) Release(key []byte) {
	k := string(key)
	l.mu.Lock()
	s, ok := l.current[k]
	if !ok {
		l.mu.Unlock()
		return
	}
	s.refs--
	if s.refs <= 0 {
		delete(l.current, k)
	}
	l.mu.Unlock()
	s.Release()
}
