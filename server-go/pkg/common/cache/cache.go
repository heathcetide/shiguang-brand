// Package cache defines a unified generic caching interface and shared
// errors for in-memory and distributed cache backends.
//
// The Cache[K, V] interface is generic over key and value types.
// In-memory backends (lru, memory, ristretto) can use arbitrary types;
// distributed backends (redis, memcache, bigcache, freecache) typically
// use Cache[string, []byte].
package cache

import (
	"context"
	"errors"
	"time"
)

var (
	// ErrNotFound is returned when a key does not exist or has expired.
	ErrNotFound = errors.New("cache: key not found")

	// ErrClosed is returned when an operation is attempted on a closed cache.
	ErrClosed = errors.New("cache: closed")

	// ErrInvalidCapacity is returned when capacity is less than or equal to zero.
	ErrInvalidCapacity = errors.New("cache: capacity must be greater than zero")

	// ErrEmptyKey is returned when a key is empty.
	ErrEmptyKey = errors.New("cache: key must not be empty")
)

// Cache is the common generic interface implemented by all cache backends.
//
// In-memory backends can use arbitrary K and V types; distributed backends
// typically use Cache[string, []byte].
type Cache[K comparable, V any] interface {
	// Get returns the value for key. Returns ErrNotFound if missing or expired.
	Get(ctx context.Context, key K) (V, error)

	// Set stores value under key. A ttl of 0 means no expiration (backend permitting).
	Set(ctx context.Context, key K, value V, ttl time.Duration) error

	// Delete removes key. It is not an error if the key does not exist.
	Delete(ctx context.Context, key K) error

	// Exists reports whether key is present and not expired.
	Exists(ctx context.Context, key K) (bool, error)

	// Clear removes all entries from the cache.
	Clear(ctx context.Context) error

	// Close releases resources held by the cache.
	Close() error
}

// Getter is a read-only view of a cache.
type Getter[K comparable, V any] interface {
	Get(ctx context.Context, key K) (V, error)
	Exists(ctx context.Context, key K) (bool, error)
}

// Setter is a write-only view of a cache.
type Setter[K comparable, V any] interface {
	Set(ctx context.Context, key K, value V, ttl time.Duration) error
	Delete(ctx context.Context, key K) error
}

// ByteCache is a type alias for the common distributed-cache specialization:
// string keys and []byte values.
type ByteCache = Cache[string, []byte]
