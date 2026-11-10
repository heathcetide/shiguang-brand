// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package stats provides an abstract, pluggable website metrics collection
// framework. It defines a unified set of primitives — Counter, Gauge, Set,
// HyperLogLog, and Timer — behind interfaces, with multiple backend
// implementations (in-memory, Redis, file-persisted).
//
// # Architecture
//
//	┌──────────────┐     ┌──────────────────────────────────┐
//	│  Your App    │────▶│  stats.Collector (interface)     │
//	│  (PV/UV/...) │     │  Counter / Gauge / Set / HLL     │
//	└──────────────┘     └──────────┬───────────────────────┘
//	                                │
//	        ┌───────────┬───────────┼───────────┐
//	        ▼           ▼           ▼           ▼
//	  ┌──────────┐ ┌────────┐ ┌─────────┐ ┌─────────┐
//	  │ memory   │ │ redis  │ │  file   │ │ custom  │
//	  │ (single) │ │(cluster│ │(persist)│ │ (impl)  │
//	  └──────────┘ └────────┘ └─────────┘ └─────────┘
//
// # Quick start (in-memory)
//
//	collector := memory.New()
//	pv := collector.Counter("pv:2026-08-18:/home")
//	pv.Incr()
//	fmt.Println(pv.Get()) // 1
//
//	uv := collector.HLL("uv:2026-08-18")
//	uv.Add("user-123")
//	fmt.Println(uv.Estimate()) // 1
//
// # Quick start (Redis)
//
//	collector := redis.New(redisClient)
//	pv := collector.Counter("pv:2026-08-18:/home")
//	pv.Incr()
//
// # Primitives
//
//   - Counter: monotonic increment (PV, clicks, errors, requests)
//   - Gauge:   arbitrary value (queue depth, active connections)
//   - Set:     exact deduplication (retention, new users — small scale)
//   - HLL:     probabilistic deduplication (UV, IP, DAU — large scale, ~12 KB)
//   - Timer:   latency samples + percentiles (response time, first screen)
package stats

// Collector is the root abstraction for all metrics backends.
// It acts as a factory for typed primitives, each identified by a string key.
// Implementations must be goroutine-safe.
type Collector interface {
	// Counter returns a Counter primitive for the given key.
	// Multiple calls with the same key return the same logical counter.
	Counter(key string) Counter

	// Gauge returns a Gauge primitive for the given key.
	Gauge(key string) Gauge

	// Set returns a Set primitive for exact deduplication.
	// Use for small cardinalities (e.g. retention sets up to ~100K).
	Set(key string) Set

	// HLL returns a HyperLogLog primitive for probabilistic deduplication.
	// Use for large cardinalities (UV, IP, DAU). Memory: ~12 KB per key.
	HLL(key string) HLL

	// Timer returns a Timer primitive for latency tracking.
	Timer(key string) Timer

	// Flush persists in-memory state to the underlying store (if applicable).
	// For Redis, this is a no-op. For file/memory, it writes to disk.
	Flush() error

	// Close releases any resources held by the collector.
	Close() error
}

// Counter is a monotonically increasing counter (PV, clicks, errors, QPS).
type Counter interface {
	// Incr increments by 1.
	Incr() int64

	// IncrBy increments by delta and returns the new value.
	IncrBy(delta int64) int64

	// Get returns the current count.
	Get() int64

	// Reset sets the counter to 0.
	Reset() error
}

// Gauge is a value that can go up or down (active connections, queue depth).
type Gauge interface {
	// Set sets the gauge to value.
	Set(value int64)

	// Incr increments the gauge by 1.
	Incr() int64

	// Decr decrements the gauge by 1.
	Decr() int64

	// Get returns the current value.
	Get() int64
}

// Set is an exact set for deduplication (retention, new user detection).
// For large-scale deduplication (UV, IP), use HLL instead.
type Set interface {
	// Add adds an element to the set. Returns true if newly added.
	Add(element string) bool

	// Has checks if an element exists in the set.
	Has(element string) bool

	// Count returns the exact cardinality.
	Count() int

	// Members returns all elements (use with care on large sets).
	Members() []string

	// Intersect returns the count of elements also in the other set.
	Intersect(other Set) int

	// Reset clears the set.
	Reset() error
}

// HLL is a HyperLogLog sketch for probabilistic cardinality estimation.
// Memory: ~12 KB per key. Error: ~0.81%. Use for UV, IP, DAU, MAU.
type HLL interface {
	// Add inserts an element into the sketch.
	Add(element string)

	// Estimate returns the estimated cardinality.
	Estimate() uint64

	// Merge merges another HLL into this one.
	Merge(other HLL) error

	// Reset clears the sketch.
	Reset() error
}

// Timer tracks latency samples and computes percentiles (P50/P95/P99).
type Timer interface {
	// Record adds a latency sample (in nanoseconds).
	Record(duration int64)

	// RecordMs adds a latency sample in milliseconds.
	RecordMs(ms float64)

	// Count returns the number of samples.
	Count() int64

	// Mean returns the average latency in nanoseconds.
	Mean() float64

	// Percentile returns the p-th percentile (0-100) in nanoseconds.
	// e.g. Percentile(95) for P95.
	Percentile(p float64) float64

	// Reset clears all samples.
	Reset() error
}
