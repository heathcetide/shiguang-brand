// Copyright (c) 2026 heathcetide. All rights reserved.

// Package lock wraps ling-base/common/lock distributed lock as a package-level singleton.
//
// Usage:
//
//	// Initialize at startup in main.go
//	pkglock.Init(cfg.Lock)
//
//	// Call directly from handler / service
//	mu, err := pkglock.New("order:123")
//	if err != nil { ... }
//	defer mu.Unlock(ctx)
//
// To switch to Redis backend:
//  1. go get github.com/heathcetide/DietDigiDose/pkg/common/lock/redis
//  2. Add a case "redis" in Init()
//  3. Set lock.driver in configs/config.yaml
package lock

import (
	"fmt"
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common/lock"
	"github.com/heathcetide/DietDigiDose/pkg/common/lock/memory"
)

// Package-level singleton.
var (
	// Manager is the active lock manager. nil until Init() is called.
	Manager *memory.Manager

	// DefaultTTL is the default lock time-to-live.
	DefaultTTL time.Duration

	// DefaultRetryDelay is the default lock acquisition retry interval.
	DefaultRetryDelay time.Duration
)

// Init initializes the lock manager singleton from configuration.
// Default backend is memory (in-process, single instance).
func Init(driver, defaultTTL, retryDelay string) error {
	ttl, err := time.ParseDuration(defaultTTL)
	if err != nil || ttl <= 0 {
		ttl = 10 * time.Second
	}
	DefaultTTL = ttl

	rd, err := time.ParseDuration(retryDelay)
	if err != nil || rd <= 0 {
		rd = 50 * time.Millisecond
	}
	DefaultRetryDelay = rd

	switch driver {
	case "memory", "":
		Manager = memory.NewManager()
	// ── Additional backends require go get of the corresponding module ──
	// case "redis":
	//     // Redis backend has no Manager concept; use redis.NewMutex directly
	//     // New() needs to dispatch by driver
	default:
		return fmt.Errorf("unsupported lock driver: %s (go get the corresponding module first)", driver)
	}
	return nil
}

// New creates a distributed lock with DefaultTTL and DefaultRetryDelay.
func New(key string) (lock.Locker, error) {
	if Manager == nil {
		return nil, fmt.Errorf("lock not initialized, call Init() first")
	}
	return Manager.NewMutex(key, lock.WithTTL(DefaultTTL), lock.WithRetryDelay(DefaultRetryDelay))
}

// NewWithTTL creates a distributed lock with a custom TTL.
func NewWithTTL(key string, ttl time.Duration) (lock.Locker, error) {
	if Manager == nil {
		return nil, fmt.Errorf("lock not initialized, call Init() first")
	}
	return Manager.NewMutex(key, lock.WithTTL(ttl), lock.WithRetryDelay(DefaultRetryDelay))
}
