// Package memory provides a simple concurrent in-memory cache with TTL.
package memory

import (
	"context"
	"sync"
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common/cache"
)

// Cache is a plain map-backed cache (no eviction besides TTL).
type Cache[K comparable, V any] struct {
	mu     sync.RWMutex
	items  map[K]entry[V]
	opts   cache.Options
	closed bool
	stopGC chan struct{}
	wg     sync.WaitGroup
}

type entry[V any] struct {
	value     V
	expiresAt time.Time
}

// New creates a memory cache.
func New[K comparable, V any](opts ...Option) *Cache[K, V] {
	cfg := applyOptions(opts...)
	c := &Cache[K, V]{
		items:  make(map[K]entry[V]),
		opts:   cfg.Options,
		stopGC: make(chan struct{}),
	}
	if cfg.cleanupInterval > 0 {
		c.wg.Add(1)
		go c.cleanupLoop(cfg.cleanupInterval)
	}
	return c
}

func (c *Cache[K, V]) Get(ctx context.Context, key K) (V, error) {
	if err := ctx.Err(); err != nil {
		var zero V
		return zero, err
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed {
		var zero V
		return zero, cache.ErrClosed
	}
	ent, ok := c.items[key]
	if !ok {
		var zero V
		return zero, cache.ErrNotFound
	}
	if expired(ent) {
		delete(c.items, key)
		var zero V
		return zero, cache.ErrNotFound
	}
	return ent.value, nil
}

func (c *Cache[K, V]) Set(ctx context.Context, key K, value V, ttl time.Duration) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	ttl = c.opts.ResolveTTL(ttl)
	var expiresAt time.Time
	if ttl > 0 {
		expiresAt = time.Now().Add(ttl)
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed {
		return cache.ErrClosed
	}
	c.items[key] = entry[V]{value: value, expiresAt: expiresAt}
	return nil
}

func (c *Cache[K, V]) Delete(ctx context.Context, key K) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed {
		return cache.ErrClosed
	}
	delete(c.items, key)
	return nil
}

func (c *Cache[K, V]) Exists(ctx context.Context, key K) (bool, error) {
	if err := ctx.Err(); err != nil {
		return false, err
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed {
		return false, cache.ErrClosed
	}
	ent, ok := c.items[key]
	if !ok {
		return false, nil
	}
	if expired(ent) {
		delete(c.items, key)
		return false, nil
	}
	return true, nil
}

func (c *Cache[K, V]) Clear(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed {
		return cache.ErrClosed
	}
	c.items = make(map[K]entry[V])
	return nil
}

func (c *Cache[K, V]) Close() error {
	c.mu.Lock()
	if c.closed {
		c.mu.Unlock()
		return nil
	}
	c.closed = true
	close(c.stopGC)
	c.items = nil
	c.mu.Unlock()
	c.wg.Wait()
	return nil
}

func (c *Cache[K, V]) Len() int {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return len(c.items)
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
			c.purge()
		}
	}
}

func (c *Cache[K, V]) purge() {
	now := time.Now()
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed {
		return
	}
	for k, ent := range c.items {
		if !ent.expiresAt.IsZero() && !ent.expiresAt.After(now) {
			delete(c.items, k)
		}
	}
}

func expired[V any](ent entry[V]) bool {
	return !ent.expiresAt.IsZero() && !ent.expiresAt.After(time.Now())
}

var _ cache.Cache[string, []byte] = (*Cache[string, []byte])(nil)
