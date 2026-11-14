// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package cache

import (
	"context"
	"encoding/json"
	"errors"
	"time"
)

// ──────────────────────────────────────────────
// Null-value marker
// ──────────────────────────────────────────────

// nullMarker is the sentinel byte slice stored in cache to represent
// "the key exists but has no value" (cache-penetration defense).
var nullMarker = []byte("\x00null\x00")

// isNullMarker reports whether b is the null sentinel.
func isNullMarker(b []byte) bool {
	return len(b) == len(nullMarker) && string(b) == string(nullMarker)
}

// ──────────────────────────────────────────────
// Locker interface (minimal, compatible with lock.Locker)
// ──────────────────────────────────────────────

// Locker is the minimal lock interface needed by the cache-aside
// helpers. It is satisfied by [lock.Locker] from common/lock and any
// implementation that provides TryLock/Unlock.
type Locker interface {
	TryLock(ctx context.Context) error
	Unlock(ctx context.Context) error
}

// ──────────────────────────────────────────────
// Cache-aside with null-value + double-check lock
// ──────────────────────────────────────────────

// CacheAsideOptions configures the [GetOrLoad] helper.
type CacheAsideOptions struct {
	// CacheTTL is the TTL for positive cache entries (real data).
	// Default: 30 minutes.
	CacheTTL time.Duration

	// NullTTL is the TTL for null-marker entries (cache-penetration
	// defense). Default: 5 minutes.
	NullTTL time.Duration

	// LockTTL is the TTL for the distributed lock lease. Default: 10s.
	// Only used when Locker is non-nil.
	LockTTL time.Duration

	// Locker is an optional distributed lock. When provided, GetOrLoad
	// uses a double-check-lock pattern: acquire lock → re-check cache →
	// load from source → write cache. When nil, GetOrLoad falls back to
	// a simple cache-aside without locking (suitable for low-concurrency
	// or single-process use).
	Locker Locker

	// NullMarkerEnabled controls whether a null marker is written to
	// cache when the loader returns ErrNotFound. This prevents cache
	// penetration (repeated DB queries for non-existent keys).
	// Default: true.
	NullMarkerEnabled bool
}

// DefaultCacheAsideOptions returns sensible defaults.
func DefaultCacheAsideOptions() CacheAsideOptions {
	return CacheAsideOptions{
		CacheTTL:          30 * time.Minute,
		NullTTL:           5 * time.Minute,
		LockTTL:           10 * time.Second,
		NullMarkerEnabled: true,
	}
}

// CacheAsideOption mutates CacheAsideOptions.
type CacheAsideOption func(*CacheAsideOptions)

// WithCacheTTL sets the positive cache TTL.
func WithCacheTTL(ttl time.Duration) CacheAsideOption {
	return func(o *CacheAsideOptions) { o.CacheTTL = ttl }
}

// WithNullTTL sets the null-marker cache TTL.
func WithNullTTL(ttl time.Duration) CacheAsideOption {
	return func(o *CacheAsideOptions) { o.NullTTL = ttl }
}

// WithLocker sets the distributed lock for double-check locking.
func WithLocker(l Locker) CacheAsideOption {
	return func(o *CacheAsideOptions) { o.Locker = l }
}

// WithNullMarker enables or disables the null-marker defense.
func WithNullMarker(enabled bool) CacheAsideOption {
	return func(o *CacheAsideOptions) { o.NullMarkerEnabled = enabled }
}

// GetOrLoad implements the cache-aside pattern with optional
// double-check locking and null-value caching.
//
// Flow:
//  1. Read from cache. If hit and not a null marker → return value.
//  2. If hit and is a null marker → return ErrNotFound (cache penetration
//     defense: the key is known to not exist).
//  3. If a Locker is configured, acquire it (TryLock). If lock not
//     obtained, return ErrLockNotObtained (caller can retry).
//  4. Double-check: re-read cache (another goroutine may have filled it).
//  5. If still miss, call loader to fetch from the data source.
//  6. If loader returns data → write to cache with CacheTTL.
//  7. If loader returns ErrNotFound and NullMarkerEnabled → write null
//     marker with NullTTL.
//  8. Release lock.
//
// loader should return ErrNotFound when the key does not exist in the
// data source. Any other error is propagated without caching.
func GetOrLoad(
	ctx context.Context,
	c ByteCache,
	key string,
	loader func(context.Context) ([]byte, error),
	opts ...CacheAsideOption,
) ([]byte, error) {
	if loader == nil {
		return nil, ErrNotFound
	}

	o := DefaultCacheAsideOptions()
	for _, opt := range opts {
		if opt != nil {
			opt(&o)
		}
	}

	// Step 1: Try cache.
	val, err := c.Get(ctx, key)
	if err == nil {
		if isNullMarker(val) {
			return nil, ErrNotFound
		}
		return val, nil
	}
	if !errors.Is(err, ErrNotFound) {
		return nil, err
	}

	// Step 2: Acquire lock if configured.
	if o.Locker != nil {
		if err := o.Locker.TryLock(ctx); err != nil {
			return nil, ErrLockNotObtained
		}
		defer func() { _ = o.Locker.Unlock(ctx) }()

		// Step 3: Double-check cache after acquiring lock.
		val, err := c.Get(ctx, key)
		if err == nil {
			if isNullMarker(val) {
				return nil, ErrNotFound
			}
			return val, nil
		}
		if !errors.Is(err, ErrNotFound) {
			return nil, err
		}
	}

	// Step 4: Load from source.
	data, err := loader(ctx)
	if err != nil {
		if errors.Is(err, ErrNotFound) && o.NullMarkerEnabled {
			// Write null marker to prevent cache penetration.
			_ = c.Set(ctx, key, nullMarker, o.NullTTL)
		}
		return nil, err
	}

	// Step 5: Write to cache.
	if err := c.Set(ctx, key, data, o.CacheTTL); err != nil {
		// Cache write failure is non-fatal; return the data anyway.
		return data, nil
	}
	return data, nil
}

// GetOrLoadJSON is like [GetOrLoad] but handles JSON marshaling for
// typed values. The loader returns a value (not []byte), which is
// marshaled before caching. On a cache hit, the cached bytes are
// unmarshaled into dest.
//
//	var user *User
//	err := cache.GetOrLoadJSON(ctx, c, key, &user, func(ctx context.Context) (*User, error) {
//	    return db.GetUser(ctx, id) // returns ErrNotFound if missing
//	}, cache.WithLocker(locker))
func GetOrLoadJSON(
	ctx context.Context,
	c ByteCache,
	key string,
	dest any,
	loader func(context.Context) (any, error),
	opts ...CacheAsideOption,
) error {
	raw, err := GetOrLoad(ctx, c, key, func(ctx context.Context) ([]byte, error) {
		val, err := loader(ctx)
		if err != nil {
			return nil, err
		}
		return json.Marshal(val)
	}, opts...)
	if err != nil {
		return err
	}
	return json.Unmarshal(raw, dest)
}

// Invalidate removes a key from cache. Use this when the underlying
// data changes (e.g. after an update or delete).
func Invalidate(ctx context.Context, c ByteCache, key string) error {
	return c.Delete(ctx, key)
}

// InvalidateBatch removes multiple keys.
func InvalidateBatch(ctx context.Context, c ByteCache, keys ...string) error {
	for _, k := range keys {
		if err := c.Delete(ctx, k); err != nil && !errors.Is(err, ErrNotFound) {
			return err
		}
	}
	return nil
}

// ──────────────────────────────────────────────
// Errors
// ──────────────────────────────────────────────

// ErrLockNotObtained is returned by [GetOrLoad] when the distributed
// lock could not be acquired. The caller can retry or return a
// "please try again" response.
var ErrLockNotObtained = errors.New("cache: lock not obtained")
