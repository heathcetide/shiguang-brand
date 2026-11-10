// Copyright (c) 2026 heathcetide. All rights reserved.

// Package cache wraps ling-base/common/cache as a package-level singleton.
//
// Usage:
//
//	// Initialize at startup in main.go
//	pkgcache.Init(cfg.Cache)
//
//	// Call directly from handler / service
//	pkgcache.Set(ctx, "user:123", data, 10*time.Minute)
//	val, err := pkgcache.Get(ctx, "user:123")
//
// To switch to Redis backend:
//  1. go get github.com/heathcetide/DietDigiDose/pkg/common/cache/redis
//  2. Add a case "redis" in Init()
//  3. Set cache.driver in configs/config.yaml
package cache

import (
	"context"
	"fmt"
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common/cache"
	cachememory "github.com/heathcetide/DietDigiDose/pkg/common/cache/memory"
)

// Package-level singleton.
var (
	// C is the active cache instance. nil until Init() is called.
	C cache.ByteCache

	// DefaultTTL is the default time-to-live for cache entries.
	DefaultTTL time.Duration
)

// Init initializes the cache singleton from configuration.
// Default backend is memory (in-process, zero external dependencies).
func Init(driver, defaultTTL, cleanupInterval string) error {
	ttl, err := time.ParseDuration(defaultTTL)
	if err != nil || ttl <= 0 {
		ttl = 10 * time.Minute
	}
	DefaultTTL = ttl

	switch driver {
	case "memory", "":
		cleanup, _ := time.ParseDuration(cleanupInterval)
		if cleanup <= 0 {
			cleanup = time.Minute
		}
		C = cachememory.New[string, []byte](cachememory.WithCleanupInterval(cleanup))
	// ── Additional backends require go get of the corresponding module ──
	// case "redis":
	//     C = redis.New(redis.Config{Addr: addr, Password: password, DB: db})
	default:
		return fmt.Errorf("unsupported cache driver: %s (go get the corresponding module first)", driver)
	}
	return nil
}

// Convenience methods — operate on the global C

// Get retrieves a value from the cache. Returns cache.ErrNotFound if the key does not exist.
func Get(ctx context.Context, key string) ([]byte, error) {
	if C == nil {
		return nil, fmt.Errorf("cache not initialized, call Init() first")
	}
	return C.Get(ctx, key)
}

// Set stores a value in the cache. If ttl is 0, DefaultTTL is used.
func Set(ctx context.Context, key string, value []byte, ttl time.Duration) error {
	if C == nil {
		return fmt.Errorf("cache not initialized, call Init() first")
	}
	if ttl <= 0 {
		ttl = DefaultTTL
	}
	return C.Set(ctx, key, value, ttl)
}

// Delete removes a key from the cache.
func Delete(ctx context.Context, key string) error {
	if C == nil {
		return fmt.Errorf("cache not initialized, call Init() first")
	}
	return C.Delete(ctx, key)
}

// Exists checks whether a key exists in the cache.
func Exists(ctx context.Context, key string) (bool, error) {
	if C == nil {
		return false, fmt.Errorf("cache not initialized, call Init() first")
	}
	return C.Exists(ctx, key)
}

// Close releases cache resources.
func Close() error {
	if C != nil {
		return C.Close()
	}
	return nil
}
