// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package memory

import (
	"math/rand"
	"sync"
	"sync/atomic"
)

// reservoirTimer is a Timer that uses reservoir sampling to maintain a
// fixed-size sample of latency observations. This bounds memory usage
// regardless of how many samples are recorded.
//
// Algorithm: Algorithm R (Vitter 1985).
//   - First `capacity` samples are stored directly.
//   - For sample i > capacity, it replaces a random existing sample with
//     probability capacity/i.
//   - The resulting sample is an unbiased random subset of all observations.
//
// Memory: exactly `capacity * 8` bytes (default 4096 * 8 = 32 KB).
// Percentile accuracy: with 4096 samples, P95 error < 1% for any distribution.
type reservoirTimer struct {
	capacity int
	count    atomic.Int64 // total samples recorded (may exceed capacity)

	mu      sync.RWMutex
	samples []int64
	rng     *rand.Rand
}

// newReservoirTimer creates a reservoir-sampling timer with the given capacity.
func newReservoirTimer(capacity int) *reservoirTimer {
	if capacity < 64 {
		capacity = 64
	}
	return &reservoirTimer{
		capacity: capacity,
		samples:  make([]int64, 0, capacity),
		rng:      rand.New(rand.NewSource(rand.Int63())),
	}
}

func (t *reservoirTimer) Record(duration int64) {
	n := t.count.Add(1) // total count, 1-based

	t.mu.Lock()
	defer t.mu.Unlock()

	if int(len(t.samples)) < t.capacity {
		// Phase 1: fill the reservoir.
		t.samples = append(t.samples, duration)
		return
	}

	// Phase 2: replace with probability capacity/n.
	// j = random integer in [0, n)
	j := t.rng.Int63n(n)
	if j < int64(t.capacity) {
		t.samples[j] = duration
	}
}

func (t *reservoirTimer) RecordMs(ms float64) {
	t.Record(int64(ms * float64(1e6))) // ms → ns
}

func (t *reservoirTimer) Count() int64 {
	return t.count.Load()
}

func (t *reservoirTimer) Mean() float64 {
	t.mu.RLock()
	defer t.mu.RUnlock()
	if len(t.samples) == 0 {
		return 0
	}
	var sum int64
	for _, s := range t.samples {
		sum += s
	}
	return float64(sum) / float64(len(t.samples))
}

func (t *reservoirTimer) Percentile(p float64) float64 {
	t.mu.RLock()
	defer t.mu.RUnlock()
	return percentile(t.samples, p)
}

func (t *reservoirTimer) Reset() error {
	t.mu.Lock()
	t.samples = make([]int64, 0, t.capacity)
	t.mu.Unlock()
	t.count.Store(0)
	return nil
}

// Capacity returns the reservoir capacity (max samples stored).
func (t *reservoirTimer) Capacity() int {
	return t.capacity
}
