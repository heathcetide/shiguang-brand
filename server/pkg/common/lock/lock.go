// Package lock defines a unified distributed lock interface.
package lock

import (
	"context"
	"errors"
	"time"
)

var (
	// ErrNotObtained is returned when a lock cannot be acquired.
	ErrNotObtained = errors.New("lock: not obtained")

	// ErrNotHeld is returned when unlocking or refreshing a lock that is not held.
	ErrNotHeld = errors.New("lock: not held")

	// ErrInvalidTTL is returned when TTL is invalid for the backend.
	ErrInvalidTTL = errors.New("lock: ttl must be greater than zero")

	// ErrEmptyKey is returned when the lock key is empty.
	ErrEmptyKey = errors.New("lock: key must not be empty")
)

// Locker is a distributed mutual-exclusion lock for a single key.
type Locker interface {
	// Lock blocks until the lock is acquired or ctx is done.
	Lock(ctx context.Context) error

	// TryLock attempts to acquire the lock once without blocking.
	TryLock(ctx context.Context) error

	// Unlock releases the lock.
	Unlock(ctx context.Context) error

	// Refresh extends the lock lease/TTL when supported.
	Refresh(ctx context.Context) error
}

// Options holds shared lock configuration.
type Options struct {
	// TTL is the lock lease duration. Required by most backends.
	TTL time.Duration

	// RetryDelay is the wait between Lock attempts.
	RetryDelay time.Duration

	// Value is an optional owner token. Generated when empty.
	Value string
}

// Option mutates Options.
type Option func(*Options)

// WithTTL sets the lock TTL / lease.
func WithTTL(ttl time.Duration) Option {
	return func(o *Options) { o.TTL = ttl }
}

// WithRetryDelay sets the delay between acquire retries.
func WithRetryDelay(d time.Duration) Option {
	return func(o *Options) { o.RetryDelay = d }
}

// WithValue sets a custom ownership token.
func WithValue(v string) Option {
	return func(o *Options) { o.Value = v }
}

// ApplyOptions builds Options with defaults.
func ApplyOptions(opts ...Option) Options {
	o := Options{
		TTL:        10 * time.Second,
		RetryDelay: 50 * time.Millisecond,
	}
	for _, opt := range opts {
		if opt != nil {
			opt(&o)
		}
	}
	return o
}
