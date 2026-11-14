// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package etcd implements distributed concurrency limiting using etcd
// leases. Each Acquire creates a lease-backed key; if the total number
// of keys with the given prefix exceeds max, the request is rejected.
// Leases auto-expire if a process crashes, preventing permanent leaks.
package etcd

import (
	"context"
	"fmt"
	"strconv"
	"sync"
	"sync/atomic"
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common/limiter"
)

// KeyValue represents a single etcd key-value pair.
type KeyValue struct {
	Key   string
	Value string
}

// Client is the etcd client interface required by this package.
// It abstracts the subset of *clientv3.Client operations used.
type Client interface {
	// Grant creates a lease with the given TTL (seconds) and returns its ID.
	Grant(ctx context.Context, ttl int64) (int64, error)
	// PutWithLease stores a key-value pair associated with the given lease.
	PutWithLease(ctx context.Context, key, val string, leaseID int64) error
	// Delete removes a key.
	Delete(ctx context.Context, key string) error
	// GetPrefix returns all key-value pairs under the given prefix.
	GetPrefix(ctx context.Context, prefix string) ([]KeyValue, error)
}

// ---------------------------------------------------------------
// Distributed concurrency limiter
// ---------------------------------------------------------------

type concurrencyLimit struct {
	client   Client
	prefix   string
	max      int64
	ttl      int64
	leaseIDs sync.Map // map[string]int64 — key → leaseID
	current  int64
}

// NewConcurrency creates a distributed concurrency limiter using etcd.
// Each Acquire creates a lease-backed key under the prefix. The lease
// auto-expires after ttl seconds, preventing leaks if a process crashes.
//
//   - prefix: etcd key prefix (e.g. "/limiter/myapp/")
//   - max:    maximum concurrent permits across all processes
//   - ttl:    lease TTL in seconds (safety expiry)
func NewConcurrency(client Client, prefix string, max int64, ttl int64) limiter.Limiter {
	return &concurrencyLimit{
		client: client,
		prefix: prefix,
		max:    max,
		ttl:    ttl,
	}
}

func (l *concurrencyLimit) Running() int {
	return int(atomic.LoadInt64(&l.current))
}

func (l *concurrencyLimit) Acquire(ctx context.Context, key []byte) error {
	k := l.prefix + string(key)

	kvs, err := l.client.GetPrefix(ctx, l.prefix)
	if err != nil {
		return fmt.Errorf("etcd limiter: get prefix failed: %w", err)
	}
	if int64(len(kvs)) >= l.max {
		return limiter.ErrLimitExceeded
	}

	leaseID, err := l.client.Grant(ctx, l.ttl)
	if err != nil {
		return fmt.Errorf("etcd limiter: grant lease failed: %w", err)
	}

	if err := l.client.PutWithLease(ctx, k, strconv.FormatInt(leaseID, 10), leaseID); err != nil {
		return fmt.Errorf("etcd limiter: put failed: %w", err)
	}

	l.leaseIDs.Store(k, leaseID)
	atomic.AddInt64(&l.current, 1)
	return nil
}

func (l *concurrencyLimit) Release(key []byte) {
	k := l.prefix + string(key)
	l.leaseIDs.Delete(k)

	if err := l.client.Delete(context.Background(), k); err == nil {
		atomic.AddInt64(&l.current, -1)
	}
}

// ---------------------------------------------------------------
// Distributed rate limiter (window-based with TTL keys)
// ---------------------------------------------------------------

type rateLimit struct {
	client Client
	prefix string
	max    int64
	window time.Duration
}

// NewRateLimit creates a distributed rate limiter using etcd keys with
// TTL. Each Acquire creates a unique key with a TTL equal to the window
// duration. If the count of keys under the prefix exceeds max, the
// request is rejected.
//
//   - prefix: etcd key prefix
//   - max:    maximum requests in the window
//   - window: time window duration
func NewRateLimit(client Client, prefix string, max int64, window time.Duration) limiter.Limiter {
	return &rateLimit{
		client: client,
		prefix: prefix,
		max:    max,
		window: window,
	}
}

func (l *rateLimit) Running() int {
	kvs, err := l.client.GetPrefix(context.Background(), l.prefix)
	if err != nil {
		return -1
	}
	return len(kvs)
}

func (l *rateLimit) Acquire(ctx context.Context, key []byte) error {
	kvs, err := l.client.GetPrefix(ctx, l.prefix)
	if err != nil {
		return fmt.Errorf("etcd limiter: get prefix failed: %w", err)
	}
	if int64(len(kvs)) >= l.max {
		return limiter.ErrLimitExceeded
	}

	ttl := int64(l.window.Seconds())
	if ttl < 1 {
		ttl = 1
	}
	leaseID, err := l.client.Grant(ctx, ttl)
	if err != nil {
		return fmt.Errorf("etcd limiter: grant lease failed: %w", err)
	}

	uniqueKey := l.prefix + string(key) + "/" + strconv.FormatInt(time.Now().UnixNano(), 36)
	if err := l.client.PutWithLease(ctx, uniqueKey, "1", leaseID); err != nil {
		return fmt.Errorf("etcd limiter: put failed: %w", err)
	}
	return nil
}

func (l *rateLimit) Release(key []byte) {
	// Rate limiter auto-expires keys via lease TTL.
}
