// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package idempotency

import (
	"context"
	"time"

	goredis "github.com/redis/go-redis/v9"
)

// ──────────────────────────────────────────────
// RedisStorage
// ──────────────────────────────────────────────

// RedisClient is the Redis subset required by [RedisStorage].
type RedisClient interface {
	// Get is used to read the current state marker.
	Get(ctx context.Context, key string) *goredis.StringCmd
	// SetNX atomically claims a key.
	SetNX(ctx context.Context, key string, value interface{}, expiration time.Duration) *goredis.BoolCmd
	// Set overwrites a key with a new state.
	Set(ctx context.Context, key string, value interface{}, expiration time.Duration) *goredis.StatusCmd
	// Del removes a key.
	Del(ctx context.Context, keys ...string) *goredis.IntCmd
}

// RedisStorage implements [Storage] on top of Redis using SETNX for
// atomic claim and string markers for state.
//
// State encoding:
//   - IN_FLIGHT:     "0"
//   - ACCOMPLISHED:  "1"
type RedisStorage struct {
	client RedisClient
}

// NewRedisStorage creates a Redis-backed Storage. The client must be
// a *redis.Client or *redis.ClusterClient (or any type satisfying
// [RedisClient]).
func NewRedisStorage(client RedisClient) *RedisStorage {
	return &RedisStorage{client: client}
}

// Get implements Storage.
func (r *RedisStorage) Get(ctx context.Context, key string) (State, error) {
	val, err := r.client.Get(ctx, key).Result()
	if err == goredis.Nil {
		return StateAbsent, nil
	}
	if err != nil {
		return StateAbsent, err
	}
	switch val {
	case "1":
		return StateAccomplished, nil
	default:
		return StateInFlight, nil
	}
}

// SetIfAbsent implements Storage.
func (r *RedisStorage) SetIfAbsent(ctx context.Context, key string, ttl time.Duration) (bool, error) {
	ok, err := r.client.SetNX(ctx, key, "0", ttl).Result()
	if err != nil {
		return false, err
	}
	return ok, nil
}

// Set implements Storage.
func (r *RedisStorage) Set(ctx context.Context, key string, state State, ttl time.Duration) error {
	val := "0"
	if state == StateAccomplished {
		val = "1"
	}
	return r.client.Set(ctx, key, val, ttl).Err()
}

// Delete implements Storage.
func (r *RedisStorage) Delete(ctx context.Context, key string) error {
	return r.client.Del(ctx, key).Err()
}

// Close implements Storage. Redis clients are managed externally;
// this is a no-op.
func (r *RedisStorage) Close() error { return nil }
