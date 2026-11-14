// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package redis provides a Redis-backed implementation of stats.Collector.
// All primitives map to native Redis data structures:
//
//   - Counter → INCR / INCRBY (string key)
//   - Gauge   → SET / INCR / DECR (string key)
//   - Set     → SADD / SISMEMBER / SCARD / SINTER (set key)
//   - HLL     → PFADD / PFCOUNT / PFMERGE (HyperLogLog key)
//   - Timer   → Sorted set (ZADD) + Lua script for percentiles
package redis

import (
	"context"
	"fmt"
	"sort"
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common/stats"
	"github.com/redis/go-redis/v9"
)

// Collector implements stats.Collector backed by Redis.
type Collector struct {
	client    *redis.Client
	keyPrefix string
	ctx       context.Context
}

// Option configures the Redis collector.
type Option func(*Collector)

// WithKeyPrefix sets a prefix for all Redis keys.
func WithKeyPrefix(prefix string) Option {
	return func(c *Collector) { c.keyPrefix = prefix }
}

// WithContext sets the default context for Redis operations.
func WithContext(ctx context.Context) Option {
	return func(c *Collector) { c.ctx = ctx }
}

// New creates a Redis-backed collector.
func New(client *redis.Client, opts ...Option) *Collector {
	c := &Collector{
		client:    client,
		keyPrefix: "stats:",
		ctx:       context.Background(),
	}
	for _, opt := range opts {
		opt(c)
	}
	return c
}

func (c *Collector) key(k string) string {
	return c.keyPrefix + k
}

func (c *Collector) Counter(key string) stats.Counter {
	return &counter{client: c.client, ctx: c.ctx, key: c.key("counter:" + key)}
}

func (c *Collector) Gauge(key string) stats.Gauge {
	return &gauge{client: c.client, ctx: c.ctx, key: c.key("gauge:" + key)}
}

func (c *Collector) Set(key string) stats.Set {
	return &set{client: c.client, ctx: c.ctx, key: c.key("set:" + key)}
}

func (c *Collector) HLL(key string) stats.HLL {
	return &hll{client: c.client, ctx: c.ctx, key: c.key("hll:" + key)}
}

func (c *Collector) Timer(key string) stats.Timer {
	return &timer{client: c.client, ctx: c.ctx, key: c.key("timer:" + key)}
}

func (c *Collector) Flush() error { return nil } // Redis is already persistent.
func (c *Collector) Close() error { return c.client.Close() }

// ──────────────────────────────────────────────
// Counter
// ──────────────────────────────────────────────

type counter struct {
	client *redis.Client
	ctx    context.Context
	key    string
}

func (c *counter) Incr() int64 {
	v, err := c.client.Incr(c.ctx, c.key).Result()
	if err != nil {
		return 0
	}
	return v
}

func (c *counter) IncrBy(delta int64) int64 {
	v, err := c.client.IncrBy(c.ctx, c.key, delta).Result()
	if err != nil {
		return 0
	}
	return v
}

func (c *counter) Get() int64 {
	v, err := c.client.Get(c.ctx, c.key).Int64()
	if err == redis.Nil {
		return 0
	}
	if err != nil {
		return 0
	}
	return v
}

func (c *counter) Reset() error {
	return c.client.Del(c.ctx, c.key).Err()
}

// ──────────────────────────────────────────────
// Gauge
// ──────────────────────────────────────────────

type gauge struct {
	client *redis.Client
	ctx    context.Context
	key    string
}

func (g *gauge) Set(value int64) {
	g.client.Set(g.ctx, g.key, value, 0)
}

func (g *gauge) Incr() int64 {
	v, err := g.client.Incr(g.ctx, g.key).Result()
	if err != nil {
		return 0
	}
	return v
}

func (g *gauge) Decr() int64 {
	v, err := g.client.Decr(g.ctx, g.key).Result()
	if err != nil {
		return 0
	}
	return v
}

func (g *gauge) Get() int64 {
	v, err := g.client.Get(g.ctx, g.key).Int64()
	if err == redis.Nil {
		return 0
	}
	if err != nil {
		return 0
	}
	return v
}

// ──────────────────────────────────────────────
// Set
// ──────────────────────────────────────────────

type set struct {
	client *redis.Client
	ctx    context.Context
	key    string
}

func (s *set) Add(element string) bool {
	added, err := s.client.SAdd(s.ctx, s.key, element).Result()
	if err != nil {
		return false
	}
	return added > 0
}

func (s *set) Has(element string) bool {
	isMember, err := s.client.SIsMember(s.ctx, s.key, element).Result()
	if err != nil {
		return false
	}
	return isMember
}

func (s *set) Count() int {
	count, err := s.client.SCard(s.ctx, s.key).Result()
	if err != nil {
		return 0
	}
	return int(count)
}

func (s *set) Members() []string {
	members, err := s.client.SMembers(s.ctx, s.key).Result()
	if err != nil {
		return nil
	}
	return members
}

func (s *set) Intersect(other stats.Set) int {
	o, ok := other.(*set)
	if !ok {
		// Fallback: check each member.
		count := 0
		for _, m := range s.Members() {
			if other.Has(m) {
				count++
			}
		}
		return count
	}
	count, err := s.client.SInter(s.ctx, s.key, o.key).Result()
	if err != nil {
		return 0
	}
	return len(count)
}

func (s *set) Reset() error {
	return s.client.Del(s.ctx, s.key).Err()
}

// ──────────────────────────────────────────────
// HLL (Redis PFADD / PFCOUNT / PFMERGE)
// ──────────────────────────────────────────────

type hll struct {
	client *redis.Client
	ctx    context.Context
	key    string
}

func (h *hll) Add(element string) {
	h.client.PFAdd(h.ctx, h.key, element)
}

func (h *hll) Estimate() uint64 {
	count, err := h.client.PFCount(h.ctx, h.key).Result()
	if err != nil {
		return 0
	}
	return uint64(count)
}

func (h *hll) Merge(other stats.HLL) error {
	o, ok := other.(*hll)
	if !ok {
		return stats.ErrMergeIncompatible
	}
	return h.client.PFMerge(h.ctx, h.key, o.key).Err()
}

func (h *hll) Reset() error {
	return h.client.Del(h.ctx, h.key).Err()
}

// ──────────────────────────────────────────────
// Timer (Redis Sorted Set + percentile calc)
// ──────────────────────────────────────────────

type timer struct {
	client *redis.Client
	ctx    context.Context
	key    string
}

func (t *timer) Record(duration int64) {
	// Use ZADD with score = duration, member = unique timestamp for ordering.
	member := fmt.Sprintf("%d", time.Now().UnixNano())
	t.client.ZAdd(t.ctx, t.key, redis.Z{Score: float64(duration), Member: member})
}

func (t *timer) RecordMs(ms float64) {
	t.Record(int64(ms * float64(time.Millisecond)))
}

func (t *timer) Count() int64 {
	count, err := t.client.ZCard(t.ctx, t.key).Result()
	if err != nil {
		return 0
	}
	return count
}

func (t *timer) Mean() float64 {
	count := t.Count()
	if count == 0 {
		return 0
	}
	// Sum all scores.
	scores, err := t.client.ZRangeWithScores(t.ctx, t.key, 0, -1).Result()
	if err != nil || len(scores) == 0 {
		return 0
	}
	var sum float64
	for _, z := range scores {
		sum += z.Score
	}
	return sum / float64(len(scores))
}

func (t *timer) Percentile(p float64) float64 {
	count := t.Count()
	if count == 0 {
		return 0
	}
	if p < 0 {
		p = 0
	} else if p > 100 {
		p = 100
	}

	// Fetch all scores (ZRangeWithScores returns sorted by score).
	scores, err := t.client.ZRangeWithScores(t.ctx, t.key, 0, -1).Result()
	if err != nil || len(scores) == 0 {
		return 0
	}

	// Sort scores (ZRangeWithScores returns sorted by score already).
	sort.Slice(scores, func(i, j int) bool {
		return scores[i].Score < scores[j].Score
	})

	// Linear interpolation (same method as memory implementation).
	n := len(scores)
	rank := p / 100 * float64(n-1)
	lower := int(rank)
	upper := lower + 1
	if upper >= n {
		return scores[n-1].Score
	}
	frac := rank - float64(lower)
	return scores[lower].Score + frac*(scores[upper].Score-scores[lower].Score)
}

func (t *timer) Reset() error {
	return t.client.Del(t.ctx, t.key).Err()
}
