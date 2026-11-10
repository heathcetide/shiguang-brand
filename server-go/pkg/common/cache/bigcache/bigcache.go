// Package bigcache provides a BigCache-backed implementation of cache.Cache.
//
// Important: BigCache only supports a single global LifeWindow for all keys.
// The ttl argument of Set is not applied as a per-key TTL. Use WithStrictTTL
// if callers must be rejected when they pass a non-zero ttl.
package bigcache

import (
	"context"
	"errors"
	"sync/atomic"
	"time"

	"github.com/allegro/bigcache/v3"

	"github.com/heathcetide/DietDigiDose/pkg/common/cache"
)

// ErrPerKeyTTLUnsupported is returned when StrictTTL is enabled and Set is
// called with a non-zero ttl. BigCache cannot honor per-key expiration.
var ErrPerKeyTTLUnsupported = errors.New("bigcache: per-key TTL is not supported; use LifeWindow")

// Cache wraps BigCache.
type Cache struct {
	bc         *bigcache.BigCache
	opts       cache.Options
	lifeWindow time.Duration
	strictTTL  bool
	closed     atomic.Bool
}

// New creates a BigCache with the given life window.
// Prefer NewWithContext when initialization should respect cancellation.
func New(lifeWindow time.Duration, opts ...Option) (*Cache, error) {
	return NewWithContext(context.Background(), lifeWindow, opts...)
}

// NewWithContext creates a BigCache, passing ctx to bigcache.New.
func NewWithContext(ctx context.Context, lifeWindow time.Duration, opts ...Option) (*Cache, error) {
	if lifeWindow <= 0 {
		return nil, errors.New("bigcache: lifeWindow must be greater than zero")
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}

	cfg := applyOptions(opts...)
	config := bigcache.DefaultConfig(lifeWindow)
	if cfg.shards > 0 {
		config.Shards = cfg.shards
	}
	if cfg.maxEntriesInWindow > 0 {
		config.MaxEntriesInWindow = cfg.maxEntriesInWindow
	}
	if cfg.maxEntrySize > 0 {
		config.MaxEntrySize = cfg.maxEntrySize
	}
	if cfg.hardMaxCacheSize > 0 {
		config.HardMaxCacheSize = cfg.hardMaxCacheSize
	}

	bc, err := bigcache.New(ctx, config)
	if err != nil {
		return nil, err
	}
	return &Cache{
		bc:         bc,
		opts:       cfg.Options,
		lifeWindow: lifeWindow,
		strictTTL:  cfg.strictTTL,
	}, nil
}

// NewWithCache wraps an existing BigCache instance.
func NewWithCache(bc *bigcache.BigCache, opts ...Option) (*Cache, error) {
	if bc == nil {
		return nil, errors.New("bigcache: cache must not be nil")
	}
	cfg := applyOptions(opts...)
	return &Cache{
		bc:        bc,
		opts:      cfg.Options,
		strictTTL: cfg.strictTTL,
	}, nil
}

func (c *Cache) Get(ctx context.Context, key string) ([]byte, error) {
	if err := c.check(ctx, key); err != nil {
		return nil, err
	}
	val, err := c.bc.Get(c.opts.Key(key))
	if err != nil {
		if errors.Is(err, bigcache.ErrEntryNotFound) {
			return nil, cache.ErrNotFound
		}
		return nil, err
	}
	// BigCache may reuse internal buffers; always copy before returning.
	out := make([]byte, len(val))
	copy(out, val)
	return out, nil
}

// Set stores value under key.
//
// The ttl parameter cannot configure per-key expiry in BigCache; eviction is
// governed by the LifeWindow passed to New. When StrictTTL is enabled, a
// non-zero ttl returns ErrPerKeyTTLUnsupported.
func (c *Cache) Set(ctx context.Context, key string, value []byte, ttl time.Duration) error {
	if err := c.check(ctx, key); err != nil {
		return err
	}
	if c.strictTTL && ttl > 0 {
		return ErrPerKeyTTLUnsupported
	}

	// Copy so callers cannot mutate the cached entry via the original slice.
	val := make([]byte, len(value))
	copy(val, value)
	return c.bc.Set(c.opts.Key(key), val)
}

func (c *Cache) Delete(ctx context.Context, key string) error {
	if err := c.check(ctx, key); err != nil {
		return err
	}
	if err := c.bc.Delete(c.opts.Key(key)); err != nil && !errors.Is(err, bigcache.ErrEntryNotFound) {
		return err
	}
	return nil
}

func (c *Cache) Exists(ctx context.Context, key string) (bool, error) {
	if err := c.check(ctx, key); err != nil {
		return false, err
	}
	// Avoid Get's defensive copy; we only need presence.
	_, err := c.bc.Get(c.opts.Key(key))
	if err != nil {
		if errors.Is(err, bigcache.ErrEntryNotFound) {
			return false, nil
		}
		return false, err
	}
	return true, nil
}

func (c *Cache) Clear(ctx context.Context) error {
	if err := c.checkReady(ctx); err != nil {
		return err
	}
	return c.bc.Reset()
}

func (c *Cache) Close() error {
	if !c.closed.CompareAndSwap(false, true) {
		return nil
	}
	return c.bc.Close()
}

// Len returns the number of entries currently stored.
func (c *Cache) Len() int {
	return c.bc.Len()
}

// LifeWindow returns the configured global life window (zero if unknown,
// e.g. when constructed via NewWithCache without recording it).
func (c *Cache) LifeWindow() time.Duration {
	return c.lifeWindow
}

func (c *Cache) checkReady(ctx context.Context) error {
	if c.closed.Load() {
		return cache.ErrClosed
	}
	return ctx.Err()
}

func (c *Cache) check(ctx context.Context, key string) error {
	if err := c.checkReady(ctx); err != nil {
		return err
	}
	if key == "" {
		return cache.ErrEmptyKey
	}
	return nil
}

var _ cache.Cache[string, []byte] = (*Cache)(nil)
