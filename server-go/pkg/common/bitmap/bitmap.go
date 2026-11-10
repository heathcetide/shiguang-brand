// Package bitmap defines a unified exact bitmap (bitset) interface and shared
// errors for in-memory and distributed backends.
//
// Unlike bloom filters, a bitmap is exact: Get(offset) returns whether bit
// offset is set, with no false positives or false negatives.
//
// Backends follow the same multi-module pattern as cache / bloom / lock:
// import only the driver you need.
package bitmap

import (
	"context"
	"errors"
	"io"
)

var (
	// ErrClosed is returned when an operation is attempted on a closed bitmap.
	ErrClosed = errors.New("bitmap: closed")

	// ErrInvalidCapacity is returned when capacity / size is invalid.
	ErrInvalidCapacity = errors.New("bitmap: capacity must be greater than zero")

	// ErrEmptyKey is returned when a required Redis (or similar) key is empty.
	ErrEmptyKey = errors.New("bitmap: key must not be empty")

	// ErrNotSupported is returned when a backend does not support an operation.
	ErrNotSupported = errors.New("bitmap: operation not supported by this backend")

	// ErrOffsetOutOfRange is returned when an offset exceeds a fixed-capacity
	// bitmap (dense memory with growth disabled).
	ErrOffsetOutOfRange = errors.New("bitmap: offset out of range")
)

// Bitmap is the common interface implemented by all bitmap backends.
//
// Offsets are zero-based bit positions. Set is idempotent; Clear on an unset
// bit is a no-op.
type Bitmap interface {
	// Set sets the bit at offset to 1.
	Set(ctx context.Context, offset uint64) error

	// Get reports whether the bit at offset is set.
	Get(ctx context.Context, offset uint64) (bool, error)

	// Clear sets the bit at offset to 0.
	Clear(ctx context.Context, offset uint64) error

	// Count returns the number of bits set to 1.
	Count(ctx context.Context) (uint64, error)

	// Reset clears every bit (empty set).
	Reset(ctx context.Context) error

	// Close releases resources. Safe to call multiple times.
	Close() error
}

// Batcher is implemented by backends that can set/get/clear many offsets in
// one round-trip (especially useful for Redis).
type Batcher interface {
	SetBatch(ctx context.Context, offsets []uint64) error
	GetBatch(ctx context.Context, offsets []uint64) ([]bool, error)
	ClearBatch(ctx context.Context, offsets []uint64) error
}

// Snapshotter is implemented by backends that can dump / restore exact state
// (memory, roaring). Use this to survive process restarts.
type Snapshotter interface {
	// WriteTo serializes the bitmap. Returns bytes written.
	WriteTo(w io.Writer) (int64, error)
	// ReadFrom replaces the bitmap contents from a previous WriteTo.
	ReadFrom(r io.Reader) (int64, error)
}
