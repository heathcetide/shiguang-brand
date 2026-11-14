package redisbloom

import (
	"context"
	"fmt"
	"strings"
	"time"

	goredis "github.com/redis/go-redis/v9"
)

// Backend is the minimal RedisBloom command subset required by this filter.
// The default implementation, redisBackend, wraps a go-redis client. Tests
// and custom setups can provide their own implementation.
type Backend interface {
	// Reserve creates the Bloom filter with the given parameters. If the
	// filter already exists, implementations should return an error whose
	// message contains "item exists" so the caller can treat it as benign.
	Reserve(ctx context.Context, key string, errorRate float64, capacity int64, expansion int64, nonScaling bool) error

	// Add inserts item into the filter. Returns true if the item was newly
	// added, false if it was already present.
	Add(ctx context.Context, key, item string) (bool, error)

	// Exists reports whether item is probably in the filter.
	Exists(ctx context.Context, key, item string) (bool, error)

	// MAdd inserts multiple items in one round-trip. Returns one bool per
	// item (true if newly added).
	MAdd(ctx context.Context, key string, items []string) ([]bool, error)

	// MExists tests multiple items in one round-trip. Returns one bool per
	// item.
	MExists(ctx context.Context, key string, items []string) ([]bool, error)

	// Del deletes the keys.
	Del(ctx context.Context, keys ...string) error

	// Expire sets a TTL on the key.
	Expire(ctx context.Context, key string, ttl time.Duration) error
}

// cmdable is the minimal go-redis subset needed by redisBackend: it adds the
// Do method (for issuing BF.* commands) that goredis.Cmdable does not expose.
// Both *goredis.Client and *goredis.ClusterClient satisfy this interface.
type cmdable interface {
	goredis.Cmdable
	Do(ctx context.Context, args ...interface{}) *goredis.Cmd
}

// redisBackend wraps a go-redis client and implements Backend using BF.*
// commands.
type redisBackend struct {
	client cmdable
}

// NewBackend wraps a go-redis client (Client, ClusterClient, etc.) into a
// Backend.
func NewBackend(client cmdable) Backend {
	return &redisBackend{client: client}
}

func (b *redisBackend) Reserve(ctx context.Context, key string, errorRate float64, capacity int64, expansion int64, nonScaling bool) error {
	args := []interface{}{"BF.RESERVE", key, errorRate, capacity}
	if expansion > 0 {
		args = append(args, "EXPANSION", expansion)
	}
	if nonScaling {
		args = append(args, "NONSCALING")
	}
	return b.client.Do(ctx, args...).Err()
}

func (b *redisBackend) Add(ctx context.Context, key, item string) (bool, error) {
	n, err := b.client.Do(ctx, "BF.ADD", key, item).Int()
	if err != nil {
		return false, err
	}
	return n == 1, nil
}

func (b *redisBackend) Exists(ctx context.Context, key, item string) (bool, error) {
	n, err := b.client.Do(ctx, "BF.EXISTS", key, item).Int()
	if err != nil {
		return false, err
	}
	return n == 1, nil
}

func (b *redisBackend) MAdd(ctx context.Context, key string, items []string) ([]bool, error) {
	args := []interface{}{"BF.MADD", key}
	for _, item := range items {
		args = append(args, item)
	}
	val, err := b.client.Do(ctx, args...).Result()
	if err != nil {
		return nil, err
	}
	return parseBoolArray(val, len(items), "MADD")
}

func (b *redisBackend) MExists(ctx context.Context, key string, items []string) ([]bool, error) {
	args := []interface{}{"BF.MEXISTS", key}
	for _, item := range items {
		args = append(args, item)
	}
	val, err := b.client.Do(ctx, args...).Result()
	if err != nil {
		return nil, err
	}
	return parseBoolArray(val, len(items), "MEXISTS")
}

func (b *redisBackend) Del(ctx context.Context, keys ...string) error {
	return b.client.Del(ctx, keys...).Err()
}

func (b *redisBackend) Expire(ctx context.Context, key string, ttl time.Duration) error {
	return b.client.Expire(ctx, key, ttl).Err()
}

// parseBoolArray converts a Redis array reply into a []bool slice.
func parseBoolArray(val interface{}, expected int, cmd string) ([]bool, error) {
	arr, ok := val.([]interface{})
	if !ok {
		return nil, fmt.Errorf("redisbloom: unexpected %s response type %T", cmd, val)
	}
	results := make([]bool, expected)
	for i := 0; i < expected && i < len(arr); i++ {
		n, ok := arr[i].(int64)
		if !ok {
			return nil, fmt.Errorf("redisbloom: unexpected %s element type %T at index %d", cmd, arr[i], i)
		}
		results[i] = n == 1
	}
	return results, nil
}

// isItemExistsError reports whether err is the "item exists" error returned by
// BF.RESERVE when the filter key already exists. This is expected in
// multi-process scenarios where another process created the filter first.
func isItemExistsError(err error) bool {
	return err != nil && strings.Contains(err.Error(), "item exists")
}
