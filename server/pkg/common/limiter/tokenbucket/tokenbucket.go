// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package tokenbucket implements a token-bucket rate limiter for QPS
// control. Tokens are refilled at a fixed rate (rate per second) up to
// a maximum burst size.
//
// Two variants are provided:
//
//   - New(rate, burst)         — non-blocking, returns ErrLimitExceeded
//   - NewBlocking(rate, burst) — blocks until a token is available or ctx is done
package tokenbucket

import (
	"context"
	"sync"
	"sync/atomic"
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common/limiter"
)

// non-blocking token bucket using lazy refill.
type bucket struct {
	mu       sync.Mutex
	rate     float64 // tokens per second
	burst    float64 // max tokens
	tokens   float64 // current tokens
	lastTime time.Time
}

// New creates a non-blocking token-bucket rate limiter.
//   - rate:  sustained tokens per second (QPS)
//   - burst: maximum burst size (initial token count)
//
// Acquire returns limiter.ErrLimitExceeded immediately when no token is
// available.
func New(rate, burst int) limiter.Limiter {
	if burst <= 0 {
		burst = rate
	}
	return &bucket{
		rate:     float64(rate),
		burst:    float64(burst),
		tokens:   float64(burst),
		lastTime: time.Now(),
	}
}

func (b *bucket) Running() int {
	return -1 // not meaningful for rate limiters
}

func (b *bucket) refill() {
	now := time.Now()
	elapsed := now.Sub(b.lastTime).Seconds()
	b.tokens += elapsed * b.rate
	if b.tokens > b.burst {
		b.tokens = b.burst
	}
	b.lastTime = now
}

func (b *bucket) Acquire(ctx context.Context, key []byte) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.refill()
	if b.tokens >= 1 {
		b.tokens--
		return nil
	}
	return limiter.ErrLimitExceeded
}

func (b *bucket) Release(key []byte) {
	// Token bucket doesn't use Release; tokens are auto-refilled.
}

// ---------------------------------------------------------------
// Blocking variant
// ---------------------------------------------------------------

type blockingBucket struct {
	rate   float64
	burst  float64
	tokens float64
	mu     sync.Mutex
	cond   *sync.Cond
	last   time.Time
	closed bool
}

// NewBlocking creates a blocking token-bucket rate limiter.
// Acquire blocks until a token is available or ctx is cancelled.
func NewBlocking(rate, burst int) limiter.Limiter {
	if burst <= 0 {
		burst = rate
	}
	b := &blockingBucket{
		rate:   float64(rate),
		burst:  float64(burst),
		tokens: float64(burst),
		last:   time.Now(),
	}
	b.cond = sync.NewCond(&b.mu)
	// Start a background goroutine that periodically refills the bucket
	// and broadcasts to any waiting Acquire callers. This avoids the
	// busy-wait pattern where each blocked goroutine independently sleeps
	// via time.After and re-checks tokens, causing redundant wakeups under
	// high concurrency.
	go b.refillLoop()
	return b
}

func (b *blockingBucket) Running() int { return -1 }

func (b *blockingBucket) refill() {
	now := time.Now()
	elapsed := now.Sub(b.last).Seconds()
	b.tokens += elapsed * b.rate
	if b.tokens > b.burst {
		b.tokens = b.burst
	}
	b.last = now
}

// refillLoop runs in a background goroutine, periodically refilling tokens
// and waking up all waiters via cond.Broadcast. The interval is chosen so
// that refill granularity is fine enough for the configured rate while
// staying lightweight (at most once per millisecond, at least every 10ms).
func (b *blockingBucket) refillLoop() {
	interval := time.Duration(float64(time.Second) / b.rate)
	if interval > 10*time.Millisecond {
		interval = 10 * time.Millisecond
	}
	if interval < time.Millisecond {
		interval = time.Millisecond
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		b.mu.Lock()
		if b.closed {
			b.mu.Unlock()
			return
		}
		b.refill()
		b.cond.Broadcast()
		b.mu.Unlock()
		<-ticker.C
	}
}

func (b *blockingBucket) Acquire(ctx context.Context, key []byte) error {
	// Quick check for context cancellation before locking.
	if err := ctx.Err(); err != nil {
		return err
	}

	b.mu.Lock()
	defer b.mu.Unlock()

	for b.tokens < 1 {
		ctxDone := ctx.Done()
		if ctxDone == nil {
			// No cancellation possible; wait for the next refill broadcast.
			b.cond.Wait()
			continue
		}

		// sync.Cond.Wait cannot be interrupted by a context, so spawn a
		// helper goroutine that broadcasts on ctx.Done() to wake us up.
		// The goroutine exits early via `wake` once we resume normally.
		wake := make(chan struct{})
		go func() {
			select {
			case <-ctxDone:
				b.mu.Lock()
				b.cond.Broadcast()
				b.mu.Unlock()
			case <-wake:
			}
		}()

		b.cond.Wait()
		close(wake)

		if err := ctx.Err(); err != nil {
			return err
		}
	}

	b.tokens--
	return nil
}

func (b *blockingBucket) Release(key []byte) {}

// Close stops the background refill goroutine and wakes up any waiters.
// It is safe to call multiple times.
func (b *blockingBucket) Close() {
	b.mu.Lock()
	b.closed = true
	b.cond.Broadcast()
	b.mu.Unlock()
}

// ---------------------------------------------------------------
// Atomic high-throughput variant (lock-free Acquire for low contention)
// ---------------------------------------------------------------

type atomicBucket struct {
	tokens   int64 // scaled by 1000 for atomic ops
	rate     int64 // tokens per second * 1000
	burst    int64
	lastNano int64
}

// NewAtomic creates a high-throughput non-blocking token-bucket using
// atomic operations. It is designed for scenarios with very high QPS
// where lock contention on the mutex variant becomes a bottleneck.
func NewAtomic(rate, burst int) limiter.Limiter {
	if burst <= 0 {
		burst = rate
	}
	return &atomicBucket{
		tokens:   int64(burst) * 1000,
		rate:     int64(rate) * 1000,
		burst:    int64(burst) * 1000,
		lastNano: time.Now().UnixNano(),
	}
}

func (b *atomicBucket) Running() int { return -1 }

func (b *atomicBucket) Acquire(ctx context.Context, key []byte) error {
	for {
		now := time.Now().UnixNano()
		last := atomic.LoadInt64(&b.lastNano)
		elapsed := now - last
		if elapsed > 0 && atomic.CompareAndSwapInt64(&b.lastNano, last, now) {
			refill := elapsed * b.rate / int64(time.Second)
			if refill > 0 {
				// Atomically add refill tokens, then cap at burst.
				// Using atomic.AddInt64 avoids the non-atomic
				// load-modify-store that previously overwrote
				// concurrent token decrements.
				newTokens := atomic.AddInt64(&b.tokens, refill)
				if newTokens > b.burst {
					// Cap at burst. This CAS may fail if another
					// goroutine modified tokens concurrently; in
					// that case the excess will be corrected on the
					// next refill or simply allow a small transient
					// overshoot, which is acceptable.
					atomic.CompareAndSwapInt64(&b.tokens, newTokens, b.burst)
				}
			}
		}

		// CAS loop to consume one token (1000 milli-tokens).
		for {
			t := atomic.LoadInt64(&b.tokens)
			if t < 1000 {
				return limiter.ErrLimitExceeded
			}
			if atomic.CompareAndSwapInt64(&b.tokens, t, t-1000) {
				return nil
			}
		}
	}
}

func (b *atomicBucket) Release(key []byte) {}
