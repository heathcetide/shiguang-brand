// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package memory provides an in-memory implementation of stats.Collector.
// All primitives are goroutine-safe and live in process memory.
// Use WithPersistence to periodically snapshot to a file.
package memory

import (
	"sync"
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common/stats"
	"github.com/axiomhq/hyperloglog"
)

// Collector implements stats.Collector with in-memory primitives.
type Collector struct {
	mu       sync.RWMutex
	counters map[string]*counter
	gauges   map[string]*gauge
	sets     map[string]*set
	hlls     map[string]*hll
	timers   map[string]*timer

	persist PersistFunc

	// Optimization options
	timerCapacity  int          // reservoir size for timers (0 = unlimited)
	bloomSetConfig *bloomConfig // if set, Set() returns Bloom filter

	// TTL
	ttlConfig  *TTLConfig
	ttlManager *ttlManager
}

// bloomConfig configures Bloom filter sets.
type bloomConfig struct {
	expectedN    int
	falsePosRate float64
}

// PersistFunc is called during Flush to serialize state.
type PersistFunc func(data *Snapshot) error

// Option configures the in-memory collector.
type Option func(*Collector)

// WithPersistence sets a persistence function called on Flush().
func WithPersistence(fn PersistFunc) Option {
	return func(c *Collector) { c.persist = fn }
}

// WithReservoirTimer sets a fixed capacity for all Timers, using reservoir
// sampling instead of storing all samples. This bounds memory usage.
//
// Default (0): store all samples (unbounded).
// Recommended: 4096 (32 KB per timer, P95 error < 1%).
func WithReservoirTimer(capacity int) Option {
	return func(c *Collector) { c.timerCapacity = capacity }
}

// WithBloomSet configures all Set() calls to return Bloom filter sets
// instead of exact map-based sets. This dramatically reduces memory for
// large-scale deduplication (e.g. 1M users → 1.4 MB vs 80 MB).
//
// Trade-off: Count() is approximate, Members() returns nil, Intersect() returns 0.
// Has() has no false negatives but may have false positives (~falsePositiveRate).
func WithBloomSet(expectedN int, falsePositiveRate float64) Option {
	return func(c *Collector) {
		c.bloomSetConfig = &bloomConfig{
			expectedN:    expectedN,
			falsePosRate: falsePositiveRate,
		}
	}
}

// New creates a new in-memory collector.
func New(opts ...Option) *Collector {
	c := &Collector{
		counters: make(map[string]*counter),
		gauges:   make(map[string]*gauge),
		sets:     make(map[string]*set),
		hlls:     make(map[string]*hll),
		timers:   make(map[string]*timer),
	}
	for _, opt := range opts {
		opt(c)
	}
	// Start TTL cleanup goroutine if configured.
	if c.ttlConfig != nil {
		c.ttlManager = newTTLManager(c, *c.ttlConfig)
		c.ttlManager.start()
	}
	return c
}

func (c *Collector) Counter(key string) stats.Counter {
	c.mu.RLock()
	if ctr, ok := c.counters[key]; ok {
		c.mu.RUnlock()
		return ctr
	}
	c.mu.RUnlock()

	c.mu.Lock()
	defer c.mu.Unlock()
	if ctr, ok := c.counters[key]; ok {
		return ctr
	}
	ctr := &counter{}
	c.counters[key] = ctr
	return ctr
}

func (c *Collector) Gauge(key string) stats.Gauge {
	c.mu.RLock()
	if g, ok := c.gauges[key]; ok {
		c.mu.RUnlock()
		return g
	}
	c.mu.RUnlock()

	c.mu.Lock()
	defer c.mu.Unlock()
	if g, ok := c.gauges[key]; ok {
		return g
	}
	g := &gauge{}
	c.gauges[key] = g
	return g
}

func (c *Collector) Set(key string) stats.Set {
	c.mu.RLock()
	if s, ok := c.sets[key]; ok {
		c.mu.RUnlock()
		return s
	}
	c.mu.RUnlock()

	c.mu.Lock()
	defer c.mu.Unlock()
	if s, ok := c.sets[key]; ok {
		return s
	}
	var s *set
	if c.bloomSetConfig != nil {
		// Bloom filter mode — wrap in a set adapter.
		// Note: bloomSet doesn't implement stats.Set directly because
		// Intersect needs stats.Set. We use a wrapper.
		s = &set{
			members: make(map[string]bool),
			bloom:   newBloomSet(c.bloomSetConfig.expectedN, c.bloomSetConfig.falsePosRate),
		}
	} else {
		s = &set{members: make(map[string]bool)}
	}
	c.sets[key] = s
	return s
}

func (c *Collector) HLL(key string) stats.HLL {
	c.mu.RLock()
	if h, ok := c.hlls[key]; ok {
		c.mu.RUnlock()
		return h
	}
	c.mu.RUnlock()

	c.mu.Lock()
	defer c.mu.Unlock()
	if h, ok := c.hlls[key]; ok {
		return h
	}
	h := &hll{sketch: hyperloglog.New()}
	c.hlls[key] = h
	return h
}

func (c *Collector) Timer(key string) stats.Timer {
	c.mu.RLock()
	if t, ok := c.timers[key]; ok {
		c.mu.RUnlock()
		return t
	}
	c.mu.RUnlock()

	c.mu.Lock()
	defer c.mu.Unlock()
	if t, ok := c.timers[key]; ok {
		return t
	}
	var t *timer
	if c.timerCapacity > 0 {
		// Reservoir sampling mode — fixed memory.
		t = &timer{reservoir: newReservoirTimer(c.timerCapacity)}
	} else {
		// Unbounded mode — stores all samples.
		t = &timer{}
	}
	c.timers[key] = t
	return t
}

func (c *Collector) Flush() error {
	if c.persist == nil {
		return nil
	}
	return c.persist(c.Snapshot())
}

func (c *Collector) Close() error {
	if c.ttlManager != nil {
		c.ttlManager.stop()
	}
	return c.Flush()
}

// ──────────────────────────────────────────────
// Counter
// ──────────────────────────────────────────────

type counter struct {
	mu    sync.RWMutex
	value int64
}

func (c *counter) Incr() int64 { return c.IncrBy(1) }
func (c *counter) IncrBy(d int64) int64 {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.value += d
	return c.value
}
func (c *counter) Get() int64 {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.value
}
func (c *counter) Reset() error {
	c.mu.Lock()
	c.value = 0
	c.mu.Unlock()
	return nil
}

// ──────────────────────────────────────────────
// Gauge
// ──────────────────────────────────────────────

type gauge struct {
	mu    sync.RWMutex
	value int64
}

func (g *gauge) Set(v int64) {
	g.mu.Lock()
	g.value = v
	g.mu.Unlock()
}
func (g *gauge) Incr() int64 {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.value++
	return g.value
}
func (g *gauge) Decr() int64 {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.value--
	return g.value
}
func (g *gauge) Get() int64 {
	g.mu.RLock()
	defer g.mu.RUnlock()
	return g.value
}

// ──────────────────────────────────────────────
// Set
// ──────────────────────────────────────────────

type set struct {
	mu      sync.RWMutex
	members map[string]bool
	bloom   *bloomSet // if set, uses Bloom filter for approximate dedup
}

func (s *set) Add(element string) bool {
	if s.bloom != nil {
		return s.bloom.Add(element)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.members[element] {
		return false
	}
	s.members[element] = true
	return true
}
func (s *set) Has(element string) bool {
	if s.bloom != nil {
		return s.bloom.Has(element)
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.members[element]
}
func (s *set) Count() int {
	if s.bloom != nil {
		return s.bloom.Count()
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.members)
}
func (s *set) Members() []string {
	if s.bloom != nil {
		return nil // Bloom filters don't support enumeration
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]string, 0, len(s.members))
	for k := range s.members {
		out = append(out, k)
	}
	return out
}
func (s *set) Intersect(other stats.Set) int {
	if s.bloom != nil {
		return 0 // Bloom filters don't support intersection
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	o, ok := other.(*set)
	if !ok {
		// Fallback: use Has on the other set.
		count := 0
		for k := range s.members {
			if other.Has(k) {
				count++
			}
		}
		return count
	}
	o.mu.RLock()
	defer o.mu.RUnlock()
	// Iterate over the smaller set.
	small, large := s.members, o.members
	if len(o.members) < len(s.members) {
		small, large = large, small
	}
	count := 0
	for k := range small {
		if large[k] {
			count++
		}
	}
	return count
}
func (s *set) Reset() error {
	if s.bloom != nil {
		return s.bloom.Reset()
	}
	s.mu.Lock()
	s.members = make(map[string]bool)
	s.mu.Unlock()
	return nil
}

// ──────────────────────────────────────────────
// HLL
// ──────────────────────────────────────────────

type hll struct {
	mu     sync.RWMutex
	sketch *hyperloglog.Sketch
}

func (h *hll) Add(element string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.sketch.Insert([]byte(element))
}
func (h *hll) Estimate() uint64 {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return h.sketch.Estimate()
}
func (h *hll) Merge(other stats.HLL) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	o, ok := other.(*hll)
	if !ok {
		return stats.ErrMergeIncompatible
	}
	o.mu.RLock()
	defer o.mu.RUnlock()
	return h.sketch.Merge(o.sketch)
}

// MarshalBinary serializes the HLL sketch for persistence.
func (h *hll) MarshalBinary() ([]byte, error) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return h.sketch.MarshalBinary()
}

// UnmarshalBinary restores the HLL sketch from serialized data.
func (h *hll) UnmarshalBinary(data []byte) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.sketch.UnmarshalBinary(data)
}
func (h *hll) Reset() error {
	h.mu.Lock()
	h.sketch = hyperloglog.New()
	h.mu.Unlock()
	return nil
}

// ──────────────────────────────────────────────
// Timer
// ──────────────────────────────────────────────

type timer struct {
	mu        sync.RWMutex
	samples   []int64         // unbounded mode (nil if reservoir)
	reservoir *reservoirTimer // bounded mode (nil if unbounded)
}

func (t *timer) Record(duration int64) {
	if t.reservoir != nil {
		t.reservoir.Record(duration)
		return
	}
	t.mu.Lock()
	t.samples = append(t.samples, duration)
	t.mu.Unlock()
}

func (t *timer) RecordMs(ms float64) {
	t.Record(int64(ms * float64(time.Millisecond)))
}

func (t *timer) Count() int64 {
	if t.reservoir != nil {
		return t.reservoir.Count()
	}
	t.mu.RLock()
	defer t.mu.RUnlock()
	return int64(len(t.samples))
}

func (t *timer) Mean() float64 {
	if t.reservoir != nil {
		return t.reservoir.Mean()
	}
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

func (t *timer) Percentile(p float64) float64 {
	if t.reservoir != nil {
		return t.reservoir.Percentile(p)
	}
	t.mu.RLock()
	defer t.mu.RUnlock()
	return percentile(t.samples, p)
}

func (t *timer) Reset() error {
	if t.reservoir != nil {
		return t.reservoir.Reset()
	}
	t.mu.Lock()
	t.samples = nil
	t.mu.Unlock()
	return nil
}

// percentile computes the p-th percentile (0-100) of a sample slice.
// Uses linear interpolation between closest ranks (same method as numpy default).
func percentile(samples []int64, p float64) float64 {
	n := len(samples)
	if n == 0 {
		return 0
	}
	if p < 0 {
		p = 0
	} else if p > 100 {
		p = 100
	}
	// Copy and sort.
	sorted := make([]int64, n)
	copy(sorted, samples)
	sortInt64s(sorted)

	// Linear interpolation: rank = p/100 * (n-1)
	rank := p / 100 * float64(n-1)
	lower := int(rank)
	upper := lower + 1
	if upper >= n {
		return float64(sorted[n-1])
	}
	frac := rank - float64(lower)
	return float64(sorted[lower]) + frac*(float64(sorted[upper])-float64(sorted[lower]))
}

func sortInt64s(a []int64) {
	// Simple insertion sort for small slices; stdlib sort for large.
	if len(a) <= 32 {
		for i := 1; i < len(a); i++ {
			key := a[i]
			j := i - 1
			for j >= 0 && a[j] > key {
				a[j+1] = a[j]
				j--
			}
			a[j+1] = key
		}
		return
	}
	// Shell sort for larger slices.
	gap := len(a) / 2
	for gap > 0 {
		for i := gap; i < len(a); i++ {
			key := a[i]
			j := i
			for j >= gap && a[j-gap] > key {
				a[j] = a[j-gap]
				j -= gap
			}
			a[j] = key
		}
		gap /= 2
	}
}
