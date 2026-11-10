// Package noop provides a no-op cache useful for tests and feature flags.
package noop

import (
	"context"
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common/cache"
)

// Cache discards all writes and always misses on reads.
type Cache[K comparable, V any] struct{}

// New returns a no-op cache.
func New[K comparable, V any]() *Cache[K, V] { return &Cache[K, V]{} }

func (Cache[K, V]) Get(context.Context, K) (V, error) {
	var zero V
	return zero, cache.ErrNotFound
}

func (Cache[K, V]) Set(context.Context, K, V, time.Duration) error { return nil }

func (Cache[K, V]) Delete(context.Context, K) error { return nil }

func (Cache[K, V]) Exists(context.Context, K) (bool, error) { return false, nil }

func (Cache[K, V]) Clear(context.Context) error { return nil }

func (Cache[K, V]) Close() error { return nil }

var _ cache.Cache[string, []byte] = (*Cache[string, []byte])(nil)
