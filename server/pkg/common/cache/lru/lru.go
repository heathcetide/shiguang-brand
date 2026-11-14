// Package lru provides a generic in-memory LRU cache with optional TTL
// (expiration). It uses hashicorp/golang-lru/v2 as the underlying LRU
// implementation and adds per-entry expiration on top.
//
// The Cache[K, V] type is generic over key and value types. It implements
// cache.Cache[K, V].
//
// Basic usage:
//
//	c, _ := lru.New[string, string](1024, lru.WithDefaultTTL(10*time.Second))
//	c.Set(context.Background(), "foo", "bar", 0)
//	val, _ := c.Get(context.Background(), "foo")
package lru

import (
	"context"
	"sync"
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common/cache"
	hashlru "github.com/hashicorp/golang-lru/v2"
)

// expiredValue wraps a cached value with its expiration time.
type expiredValue[V any] struct {
	expiresAt time.Time // zero means no expiration
	val       V
}

// Cache is a generic in-memory LRU cache with optional per-entry TTL.
// It implements cache.Cache[K, V].
type Cache[K comparable, V any] struct {
	inner   *hashlru.Cache[K, expiredValue[V]]
	opts    cache.Options
	closed  bool
	stopGC  chan struct{}
	wg      sync.WaitGroup
	cleanup time.Duration
}

// New creates an LRU cache with the given capacity (number of entries)
// and options. capacity must be greater than zero.
//
// WithDefaultTTL sets a TTL applied to entries when Set is called with
// ttl == 0. A zero default TTL means entries never expire unless a
// positive ttl is passed to Set.
//
// WithCleanupInterval enables a background goroutine that periodically
// purges expired entries. Pass 0 to disable (expired entries are still
// removed on access).
func New[K comparable, V any](capacity int, opts ...Option) (*Cache[K, V], error) {
	if capacity <= 0 {
		return nil, cache.ErrInvalidCapacity
	}
	cfg := applyOptions(opts...)
	c, err := hashlru.New[K, expiredValue[V]](capacity)
	if err != nil {
		return nil, err
	}
	cache := &Cache[K, V]{
		inner:   c,
		opts:    cfg.Options,
		stopGC:  make(chan struct{}),
		cleanup: cfg.cleanupInterval,
	}
	if cfg.cleanupInterval > 0 {
		cache.wg.Add(1)
		go cache.cleanupLoop(cfg.cleanupInterval)
	}
	return cache, nil
}

// Get returns the value for key, or cache.ErrNotFound if missing or expired.
func (c *Cache[K, V]) Get(ctx context.Context, key K) (V, error) {
	if err := ctx.Err(); err != nil {
		var zero V
		return zero, err
	}
	if c.closed {
		var zero V
		return zero, cache.ErrClosed
	}
	sv, ok := c.inner.Get(key)
	if !ok {
		var zero V
		return zero, cache.ErrNotFound
	}
	if isExpired(sv) {
		c.inner.Remove(key)
		var zero V
		return zero, cache.ErrNotFound
	}
	return sv.val, nil
}

// Set stores value under key. ttl > 0 sets a per-entry TTL;
// ttl == 0 uses the default TTL (which may mean no expiration).
func (c *Cache[K, V]) Set(ctx context.Context, key K, value V, ttl time.Duration) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if c.closed {
		return cache.ErrClosed
	}
	ttl = c.opts.ResolveTTL(ttl)
	var expiresAt time.Time
	if ttl > 0 {
		expiresAt = time.Now().Add(ttl)
	}
	c.inner.Add(key, expiredValue[V]{expiresAt: expiresAt, val: value})
	return nil
}

// Delete removes key. It is not an error if the key does not exist.
func (c *Cache[K, V]) Delete(ctx context.Context, key K) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if c.closed {
		return cache.ErrClosed
	}
	c.inner.Remove(key)
	return nil
}

// Exists reports whether key is present and not expired.
func (c *Cache[K, V]) Exists(ctx context.Context, key K) (bool, error) {
	if err := ctx.Err(); err != nil {
		return false, err
	}
	if c.closed {
		return false, cache.ErrClosed
	}
	sv, ok := c.inner.Peek(key)
	if !ok {
		return false, nil
	}
	if isExpired(sv) {
		c.inner.Remove(key)
		return false, nil
	}
	return true, nil
}

// Clear removes all entries.
func (c *Cache[K, V]) Clear(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if c.closed {
		return cache.ErrClosed
	}
	c.inner.Purge()
	return nil
}

// Close releases resources. The cache is no longer usable after Close.
func (c *Cache[K, V]) Close() error {
	if c.closed {
		return nil
	}
	c.closed = true
	close(c.stopGC)
	c.inner.Purge()
	c.wg.Wait()
	return nil
}

// Len returns the number of entries currently stored (including expired
// ones that have not yet been purged).
func (c *Cache[K, V]) Len() int {
	return c.inner.Len()
}

// Contains reports whether key exists without checking expiration.
func (c *Cache[K, V]) Contains(key K) bool {
	return c.inner.Contains(key)
}

// isExpired reports whether an entry has expired (expiresAt is non-zero
// and in the past).
func isExpired[V any](v expiredValue[V]) bool {
	return !v.expiresAt.IsZero() && !v.expiresAt.After(time.Now())
}

func (c *Cache[K, V]) cleanupLoop(interval time.Duration) {
	defer c.wg.Done()
	t := time.NewTicker(interval)
	defer t.Stop()
	for {
		select {
		case <-c.stopGC:
			return
		case <-t.C:
			c.purgeExpired()
		}
	}
}

func (c *Cache[K, V]) purgeExpired() {
	now := time.Now()
	keys := c.inner.Keys()
	for _, k := range keys {
		if sv, ok := c.inner.Peek(k); ok {
			if !sv.expiresAt.IsZero() && !sv.expiresAt.After(now) {
				c.inner.Remove(k)
			}
		}
	}
}

// Ensure Cache implements cache.Cache.
var _ cache.Cache[string, any] = (*Cache[string, any])(nil)
