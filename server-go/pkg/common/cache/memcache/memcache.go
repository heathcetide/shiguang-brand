// Package memcache provides a Memcached-backed implementation of cache.Cache.
package memcache

import (
	"context"
	"errors"
	"time"

	gomen "github.com/bradfitz/gomemcache/memcache"

	"github.com/heathcetide/DietDigiDose/pkg/common/cache"
)

// ClientAPI is the subset of gomemcache used by this adapter.
type ClientAPI interface {
	Get(key string) (*gomen.Item, error)
	Set(item *gomen.Item) error
	Delete(key string) error
}

// Cache wraps a Memcached client and implements cache.Cache.
type Cache struct {
	client ClientAPI
	opts   cache.Options
	closed bool
}

// New creates a Memcached cache connected to the given servers
// (host:port strings, e.g. "127.0.0.1:11211").
func New(servers []string, opts ...Option) (*Cache, error) {
	if len(servers) == 0 {
		return nil, errors.New("memcache: at least one server is required")
	}

	cfg := applyOptions(opts...)
	client := gomen.New(servers...)
	if cfg.timeout > 0 {
		client.Timeout = cfg.timeout
	}
	if cfg.maxIdleConns > 0 {
		client.MaxIdleConns = cfg.maxIdleConns
	}

	return &Cache{
		client: client,
		opts:   cfg.Options,
	}, nil
}

// NewWithClient wraps an existing ClientAPI (typically *memcache.Client).
func NewWithClient(client ClientAPI, opts ...Option) (*Cache, error) {
	if client == nil {
		return nil, errors.New("memcache: client must not be nil")
	}
	cfg := applyOptions(opts...)
	return &Cache{
		client: client,
		opts:   cfg.Options,
	}, nil
}

func (c *Cache) Get(ctx context.Context, key string) ([]byte, error) {
	if err := c.check(ctx, key); err != nil {
		return nil, err
	}

	item, err := c.client.Get(c.opts.Key(key))
	if err != nil {
		if errors.Is(err, gomen.ErrCacheMiss) {
			return nil, cache.ErrNotFound
		}
		return nil, err
	}
	out := make([]byte, len(item.Value))
	copy(out, item.Value)
	return out, nil
}

func (c *Cache) Set(ctx context.Context, key string, value []byte, ttl time.Duration) error {
	if err := c.check(ctx, key); err != nil {
		return err
	}

	ttl = c.opts.ResolveTTL(ttl)
	item := &gomen.Item{
		Key:   c.opts.Key(key),
		Value: value,
	}
	if ttl > 0 {
		item.Expiration = int32(ttl.Seconds())
		if item.Expiration <= 0 {
			item.Expiration = 1
		}
	}
	return c.client.Set(item)
}

func (c *Cache) Delete(ctx context.Context, key string) error {
	if err := c.check(ctx, key); err != nil {
		return err
	}

	err := c.client.Delete(c.opts.Key(key))
	if err != nil && !errors.Is(err, gomen.ErrCacheMiss) {
		return err
	}
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

// Clear is not supported by Memcached's standard protocol in a safe way
// (flush_all affects the whole server). It returns an error.
func (c *Cache) Clear(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if c.closed {
		return cache.ErrClosed
	}
	return errors.New("memcache: Clear is not supported; use Delete per key or flush at the server level")
}

func (c *Cache) Close() error {
	c.closed = true
	return nil
}

// Client exposes the underlying ClientAPI for advanced use.
func (c *Cache) Client() ClientAPI {
	return c.client
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
