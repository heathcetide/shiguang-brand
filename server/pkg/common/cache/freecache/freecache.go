// Package freecache provides a FreeCache-backed implementation of cache.Cache.
package freecache

import (
	"context"
	"errors"
	"time"

	"github.com/coocood/freecache"

	"github.com/heathcetide/DietDigiDose/pkg/common/cache"
)

// Cache wraps FreeCache.
type Cache struct {
	fc     *freecache.Cache
	opts   cache.Options
	closed bool
}

// New creates a FreeCache with the given size in bytes.
func New(size int, opts ...Option) (*Cache, error) {
	if size <= 0 {
		return nil, cache.ErrInvalidCapacity
	}
	cfg := applyOptions(opts...)
	return &Cache{
		fc:   freecache.NewCache(size),
		opts: cfg.Options,
	}, nil
}

// NewWithCache wraps an existing freecache.Cache.
func NewWithCache(fc *freecache.Cache, opts ...Option) (*Cache, error) {
	if fc == nil {
		return nil, errors.New("freecache: cache must not be nil")
	}
	cfg := applyOptions(opts...)
	return &Cache{fc: fc, opts: cfg.Options}, nil
}

func (c *Cache) Get(ctx context.Context, key string) ([]byte, error) {
	if err := c.check(ctx, key); err != nil {
		return nil, err
	}
	val, err := c.fc.Get([]byte(c.opts.Key(key)))
	if err != nil {
		if errors.Is(err, freecache.ErrNotFound) {
			return nil, cache.ErrNotFound
		}
		return nil, err
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
	expire := 0
	if ttl > 0 {
		expire = int(ttl.Seconds())
		if expire <= 0 {
			expire = 1
		}
	}
	return c.fc.Set([]byte(c.opts.Key(key)), value, expire)
}

func (c *Cache) Delete(ctx context.Context, key string) error {
	if err := c.check(ctx, key); err != nil {
		return err
	}
	c.fc.Del([]byte(c.opts.Key(key)))
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
	c.fc.Clear()
	return nil
}

func (c *Cache) Close() error {
	c.closed = true
	c.fc.Clear()
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
