// Package bloom defines a unified Bloom-filter interface and shared errors
// for in-memory and distributed backends.
//
// A Bloom filter is a space-efficient probabilistic data structure used to
// test whether an element is a member of a set. False positives are possible,
// but false negatives are not: if Test reports "not present", the element was
// definitely never added.
package bloom

import (
	"context"
	"errors"
)

var (
	// ErrNotFound is returned when an element is reported as definitely absent.
	// (Most callers will simply use the bool returned by Test and never see this;
	// it is exposed for helpers that need a sentinel error.)
	ErrNotFound = errors.New("bloom: element not found")

	// ErrClosed is returned when an operation is attempted on a closed filter.
	ErrClosed = errors.New("bloom: closed")

	// ErrInvalidCapacity is returned when the expected number of elements is
	// less than or equal to zero.
	ErrInvalidCapacity = errors.New("bloom: expected number of elements must be greater than zero")

	// ErrInvalidFalsePositiveRate is returned when the target false-positive
	// probability is not in the open interval (0, 1).
	ErrInvalidFalsePositiveRate = errors.New("bloom: false-positive rate must be in (0, 1)")

	// ErrEmptyKey is returned when an empty key is added or tested.
	ErrEmptyKey = errors.New("bloom: key must not be empty")

	// ErrNotSupported is returned when a backend does not support an operation
	// (for example, Remove on a standard, non-counting filter).
	ErrNotSupported = errors.New("bloom: operation not supported by this backend")
)

// Filter is the common interface implemented by all Bloom-filter backends.
type Filter interface {
	// Add inserts key into the filter. It is idempotent: adding the same key
	// more than once has the same effect as adding it once.
	Add(ctx context.Context, key string) error

	// Test reports whether key might be in the filter. A false result means the
	// key is definitely not present; a true result means it is probably present
	// (subject to the configured false-positive rate).
	Test(ctx context.Context, key string) (bool, error)

	// Reset clears all bits in the filter, removing every element.
	Reset(ctx context.Context) error

	// Close releases resources held by the filter. It is safe to call multiple
	// times; subsequent calls are no-ops.
	Close() error
}

// Remover is implemented by backends that support element removal (e.g.
// counting filters). Standard bit-array filters do not support removal and
// will return ErrNotSupported.
type Remover interface {
	// Remove deletes key from the filter. Removing a key that was never added
	// is allowed but may corrupt the filter state for counting filters if the
	// caller removes a key more times than it was added.
	Remove(ctx context.Context, key string) error
}

// Batcher is implemented by backends that can add or test multiple keys in a
// single round-trip. This is most useful for distributed backends such as
// Redis, where batching avoids per-key network overhead.
type Batcher interface {
	AddBatch(ctx context.Context, keys []string) error
	TestBatch(ctx context.Context, keys []string) ([]bool, error)
}
