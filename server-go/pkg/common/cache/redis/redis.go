// Package redis provides a Redis-backed implementation of cache.Cache.
package redis

import (
	"context"
	"errors"
	"time"

	goredis "github.com/redis/go-redis/v9"

	"github.com/heathcetide/DietDigiDose/pkg/common/cache"
)

// Cache wraps a Redis client and implements cache.Cache.
type Cache struct {
	client goredis.Cmdable
	opts   cache.Options
	closer func() error
	closed bool
}

// New creates a Redis cache from go-redis Options.
func New(redisOpts *goredis.Options, opts ...Option) (*Cache, error) {
	if redisOpts == nil {
		return nil, errors.New("redis: options must not be nil")
	}
	client := goredis.NewClient(redisOpts)
	cfg := applyOptions(opts...)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := client.Ping(ctx).Err(); err != nil {
		_ = client.Close()
		return nil, err
	}

	return &Cache{
		client: client,
		opts:   cfg.Options,
		closer: client.Close,
	}, nil
}

// NewWithClient wraps an existing go-redis Cmdable (Client, ClusterClient, etc.).
// If the client implements Close(), it will be called by Cache.Close.
func NewWithClient(client goredis.Cmdable, opts ...Option) (*Cache, error) {
	if client == nil {
		return nil, errors.New("redis: client must not be nil")
	}
	cfg := applyOptions(opts...)

	c := &Cache{
		client: client,
		opts:   cfg.Options,
	}
	if closer, ok := client.(interface{ Close() error }); ok {
		c.closer = closer.Close
	}
	return c, nil
}

func (c *Cache) Get(ctx context.Context, key string) ([]byte, error) {
	if err := c.check(ctx, key); err != nil {
		return nil, err
	}

	val, err := c.client.Get(ctx, c.opts.Key(key)).Bytes()
	if err != nil {
		if errors.Is(err, goredis.Nil) {
			return nil, cache.ErrNotFound
		}
		return nil, err
	}
	return val, nil
}

func (c *Cache) Set(ctx context.Context, key string, value []byte, ttl time.Duration) error {
	if err := c.check(ctx, key); err != nil {
		return err
	}

	ttl = c.opts.ResolveTTL(ttl)
	return c.client.Set(ctx, c.opts.Key(key), value, ttl).Err()
}

func (c *Cache) Delete(ctx context.Context, key string) error {
	if err := c.check(ctx, key); err != nil {
		return err
	}
	return c.client.Del(ctx, c.opts.Key(key)).Err()
}

func (c *Cache) Exists(ctx context.Context, key string) (bool, error) {
	if err := c.check(ctx, key); err != nil {
		return false, err
	}

	n, err := c.client.Exists(ctx, c.opts.Key(key)).Result()
	if err != nil {
		return false, err
	}
	return n > 0, nil
}

// Clear removes keys matching the configured prefix.
// Without a prefix it runs FLUSHDB (use with care).
func (c *Cache) Clear(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if c.closed {
		return cache.ErrClosed
	}

	if c.opts.Prefix == "" {
		return c.client.FlushDB(ctx).Err()
	}

	var cursor uint64
	for {
		keys, next, err := c.client.Scan(ctx, cursor, c.opts.Prefix+"*", 100).Result()
		if err != nil {
			return err
		}
		if len(keys) > 0 {
			if err := c.client.Del(ctx, keys...).Err(); err != nil {
				return err
			}
		}
		cursor = next
		if cursor == 0 {
			break
		}
	}
	return nil
}

func (c *Cache) Close() error {
	if c.closed {
		return nil
	}
	c.closed = true
	if c.closer != nil {
		return c.closer()
	}
	return nil
}

// Client exposes the underlying go-redis Cmdable for advanced use.
func (c *Cache) Client() goredis.Cmdable {
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
