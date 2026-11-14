// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package redis implements distributed rate limiting using Redis.
//
// Two strategies are provided:
//
//   - NewSlidingWindow(client, key, max, window) — sliding-window counter
//     using INCR + EXPIRE. Each Acquire increments a counter; if it exceeds
//     max within the window, the request is rejected.
//
//   - NewTokenBucket(client, key, rate, burst) — token-bucket using a Lua
//     script for atomic check-and-decrement. Tokens are refilled lazily.
//
// Both implementations satisfy the limiter.Limiter interface and are safe
// for concurrent use across multiple processes (distributed).
package redis

import (
	"context"
	"fmt"
	"time"

	goredis "github.com/redis/go-redis/v9"

	"github.com/heathcetide/DietDigiDose/pkg/common/limiter"
)

// Client is the Redis command subset required by this package.
type Client interface {
	Incr(ctx context.Context, key string) *goredis.IntCmd
	Expire(ctx context.Context, key string, expiration time.Duration) *goredis.BoolCmd
	Eval(ctx context.Context, script string, keys []string, args ...interface{}) *goredis.Cmd
	Get(ctx context.Context, key string) *goredis.StringCmd
	Del(ctx context.Context, keys ...string) *goredis.IntCmd
}

// ---------------------------------------------------------------
// Sliding window counter
// ---------------------------------------------------------------

// slidingWindow limits requests to max per window using a simple
// INCR + EXPIRE pattern. The counter is set to expire at the end of
// the window, so it automatically resets.
type slidingWindow struct {
	client Client
	key    string
	max    int64
	window time.Duration
}

// NewSlidingWindow creates a distributed sliding-window rate limiter.
//   - key:    Redis key prefix for the counter
//   - max:    maximum requests allowed in the window
//   - window: time window duration (e.g. 1*time.Second for QPS)
func NewSlidingWindow(client Client, key string, max int64, window time.Duration) limiter.Limiter {
	return &slidingWindow{
		client: client,
		key:    key,
		max:    max,
		window: window,
	}
}

func (l *slidingWindow) Running() int {
	n, err := l.client.Get(context.Background(), l.key).Int64()
	if err != nil {
		return -1
	}
	return int(n)
}

func (l *slidingWindow) Acquire(ctx context.Context, _ []byte) error {
	n, err := l.client.Incr(ctx, l.key).Result()
	if err != nil {
		return fmt.Errorf("redis limiter: incr failed: %w", err)
	}
	if n == 1 {
		// First request in the window — set expiry.
		l.client.Expire(ctx, l.key, l.window)
	}
	if n > l.max {
		return limiter.ErrLimitExceeded
	}
	return nil
}

func (l *slidingWindow) Release(_ []byte) {
	// Sliding window does not use Release; the counter auto-expires.
}

// ---------------------------------------------------------------
// Token bucket (Lua script for atomicity)
// ---------------------------------------------------------------

const tokenBucketScript = `
local key = KEYS[1]
local rate = tonumber(ARGV[1])
local burst = tonumber(ARGV[2])
local now = tonumber(ARGV[3])

local data = redis.call("HMGET", key, "tokens", "last_time")
local tokens = tonumber(data[1])
local last_time = tonumber(data[2])

if tokens == nil then
  tokens = burst
  last_time = now
end

local elapsed = math.max(0, now - last_time)
tokens = math.min(burst, tokens + elapsed * rate / 1000.0)

if tokens >= 1 then
  tokens = tokens - 1
  redis.call("HMSET", key, "tokens", tokens, "last_time", now)
  redis.call("EXPIRE", key, math.ceil(burst / rate) + 10)
  return 1
else
  redis.call("HMSET", key, "tokens", tokens, "last_time", now)
  redis.call("EXPIRE", key, math.ceil(burst / rate) + 10)
  return 0
end
`

type tokenBucket struct {
	client Client
	key    string
	rate   float64 // tokens per second
	burst  float64
}

// NewTokenBucket creates a distributed token-bucket rate limiter using
// a Lua script for atomic operation.
//   - key:   Redis key for the bucket state
//   - rate:  sustained tokens per second
//   - burst: maximum burst size
func NewTokenBucket(client Client, key string, rate, burst int) limiter.Limiter {
	return &tokenBucket{
		client: client,
		key:    key,
		rate:   float64(rate),
		burst:  float64(burst),
	}
}

func (l *tokenBucket) Running() int { return -1 }

func (l *tokenBucket) Acquire(ctx context.Context, _ []byte) error {
	now := time.Now().UnixMilli()
	res, err := l.client.Eval(ctx, tokenBucketScript, []string{l.key},
		l.rate, l.burst, now).Int()
	if err != nil {
		return fmt.Errorf("redis limiter: eval failed: %w", err)
	}
	if res == 0 {
		return limiter.ErrLimitExceeded
	}
	return nil
}

func (l *tokenBucket) Release(_ []byte) {
	// Token bucket auto-refills; Release is a no-op.
}

// ---------------------------------------------------------------
// Distributed concurrency counter (INCR/DECR with TTL safety)
// ---------------------------------------------------------------

const acquireScript = `
local key = KEYS[1]
local max = tonumber(ARGV[1])
local ttl = tonumber(ARGV[2])

local current = tonumber(redis.call("GET", key) or "0")
if current >= max then
  return 0
end
redis.call("INCR", key)
redis.call("EXPIRE", key, ttl)
return 1
`

type concurrencyLimit struct {
	client Client
	key    string
	max    int64
	ttl    time.Duration // safety expiry to prevent leaks if a process crashes
}

// NewConcurrency creates a distributed concurrency limiter. Each Acquire
// increments a shared counter; if it exceeds max, the request is rejected.
// A TTL is set on the counter to prevent permanent leaks if a process
// crashes without calling Release. Release decrements the counter.
//
//   - key: Redis key for the counter
//   - max: maximum concurrent permits
//   - ttl: safety expiry (should be longer than the longest expected operation)
func NewConcurrency(client Client, key string, max int64, ttl time.Duration) limiter.Limiter {
	return &concurrencyLimit{
		client: client,
		key:    key,
		max:    max,
		ttl:    ttl,
	}
}

func (l *concurrencyLimit) Running() int {
	n, err := l.client.Get(context.Background(), l.key).Int64()
	if err != nil {
		return -1
	}
	return int(n)
}

func (l *concurrencyLimit) Acquire(ctx context.Context, _ []byte) error {
	res, err := l.client.Eval(ctx, acquireScript, []string{l.key},
		l.max, int64(l.ttl.Seconds())).Int()
	if err != nil {
		return fmt.Errorf("redis limiter: eval failed: %w", err)
	}
	if res == 0 {
		return limiter.ErrLimitExceeded
	}
	return nil
}

func (l *concurrencyLimit) Release(_ []byte) {
	// Decrement, but don't go below zero.
	l.client.Eval(context.Background(), `
local key = KEYS[1]
local current = tonumber(redis.call("GET", key) or "0")
if current > 0 then
  redis.call("DECR", key)
end
`, []string{l.key})
}

// Reset clears the limiter state in Redis. Useful for testing.
func Reset(ctx context.Context, client Client, key string) error {
	return client.Del(ctx, key).Err()
}
