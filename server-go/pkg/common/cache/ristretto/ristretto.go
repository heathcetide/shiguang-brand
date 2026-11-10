// Package ristretto provides a Ristretto-backed implementation of cache.Cache.
package ristretto

import (
	"context"
	"errors"
	"time"

	"github.com/dgraph-io/ristretto/v2"

	"github.com/heathcetide/DietDigiDose/pkg/common/cache"
)

// Cache wraps Ristretto.
type Cache struct {
	rc     *ristretto.Cache[string, []byte]
	opts   cache.Options
	closed bool
	cost   int64
}

// New creates a Ristretto cache.
func New(numCounters, maxCost int64, opts ...Option) (*Cache, error) {
	if numCounters <= 0 || maxCost <= 0 {
		return nil, cache.ErrInvalidCapacity
	}
	cfg := applyOptions(opts...)
	rc, err := ristretto.NewCache(&ristretto.Config[string, []byte]{
		NumCounters: numCounters,
		MaxCost:     maxCost,
		BufferItems: 64,
	})
	if err != nil {
		return nil, err
	}
	cost := cfg.cost
	if cost <= 0 {
		cost = 1
	}
	return &Cache{rc: rc, opts: cfg.Options, cost: cost}, nil
}

// NewWithCache wraps an existing Ristretto cache.
func NewWithCache(rc *ristretto.Cache[string, []byte], opts ...Option) (*Cache, error) {
	if rc == nil {
		return nil, errors.New("ristretto: cache must not be nil")
	}
	cfg := applyOptions(opts...)
	cost := cfg.cost
	if cost <= 0 {
		cost = 1
	}
	return &Cache{rc: rc, opts: cfg.Options, cost: cost}, nil
}

func (c *Cache) Get(ctx context.Context, key string) ([]byte, error) {
	if err := c.check(ctx, key); err != nil {
		return nil, err
	}
	val, ok := c.rc.Get(c.opts.Key(key))
	if !ok {
		return nil, cache.ErrNotFound
	}
	out := make([]byte, len(val))
	copy(out, val)
	return out, nil
}

func (c *Cache) Set(ctx context.Context, key string, value []byte, ttl time.Duration) error {
	if err := c.check(ctx, key); err != nil {
		return err
	}
	ttl = c.opts.ResolveTTL(ttl)
	val := make([]byte, len(value))
	copy(val, value)
	full := c.opts.Key(key)
	ok := false
	if ttl > 0 {
		ok = c.rc.SetWithTTL(full, val, c.cost, ttl)
	} else {
		ok = c.rc.Set(full, val, c.cost)
	}
	if !ok {
		return errors.New("ristretto: rejected by admission policy")
	}
	c.rc.Wait()
	return nil
}

func (c *Cache) Delete(ctx context.Context, key string) error {
	if err := c.check(ctx, key); err != nil {
		return err
	}
	c.rc.Del(c.opts.Key(key))
	return nil
}

func (c *Cache) Exists(ctx context.Context, key string) (bool, error) {
	_, err := c.Get(ctx, key)
	if err != nil {
		if errors.Is(err, cache.ErrNotFound) {
			return false, nil
		}
		return false, err
	}
	return true, nil
}

func (c *Cache) Clear(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if c.closed {
		return cache.ErrClosed
	}
	c.rc.Clear()
	return nil
}

func (c *Cache) Close() error {
	if c.closed {
		return nil
	}
	c.closed = true
	c.rc.Close()
	return nil
}

func (c *Cache) check(ctx context.Context, key string) error {
	if c.closed {
		return cache.ErrClosed
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if key == "" {
		return cache.ErrEmptyKey
	}
	return nil
}

var _ cache.Cache[string, []byte] = (*Cache)(nil)
