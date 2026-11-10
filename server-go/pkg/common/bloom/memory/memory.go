// Package memory provides a standard, in-process Bloom filter backed by a
// bit array. It uses the double-hashing technique to synthesize k hash
// functions from two FNV-1a hashes, keeping the implementation dependency-free.
//
// This implementation does NOT support removal: clearing a bit could
// incorrectly evict other elements that share it. Use bloom/counting if you
// need Remove, or call Reset to clear the whole filter.
package memory

import (
	"context"
	"sync"

	"github.com/heathcetide/DietDigiDose/pkg/common/bloom"
)

// Filter is a standard in-memory Bloom filter implementing bloom.Filter.
type Filter struct {
	mu     sync.Mutex
	bits   []byte
	m      uint64
	k      uint64
	closed bool
}

// New creates a standard Bloom filter.
//
// Geometry must be supplied via WithParams or WithCapacity; m must be greater
// than zero and k must be at least 1.
func New(opts ...Option) (*Filter, error) {
	cfg := applyOptions(opts...)
	if cfg.m == 0 {
		return nil, bloom.ErrInvalidCapacity
	}
	if cfg.k == 0 {
		return nil, bloom.ErrInvalidFalsePositiveRate
	}
	return &Filter{
		bits: make([]byte, bloom.BitsToBytes(cfg.m)),
		m:    cfg.m,
		k:    cfg.k,
	}, nil
}

func (f *Filter) Add(ctx context.Context, key string) error {
	if err := f.check(ctx, key); err != nil {
		return err
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.closed {
		return bloom.ErrClosed
	}
	f.setLocked(key)
	return nil
}

func (f *Filter) Test(ctx context.Context, key string) (bool, error) {
	if err := f.check(ctx, key); err != nil {
		return false, err
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.closed {
		return false, bloom.ErrClosed
	}
	return f.testLocked(key), nil
}

func (f *Filter) Reset(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.closed {
		return bloom.ErrClosed
	}
	clear(f.bits)
	return nil
}

func (f *Filter) Close() error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.closed {
		return nil
	}
	f.closed = true
	f.bits = nil
	return nil
}

// M returns the number of bits in the filter.
func (f *Filter) M() uint64 { return f.m }

// K returns the number of hash functions.
func (f *Filter) K() uint64 { return f.k }

func (f *Filter) check(ctx context.Context, key string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if key == "" {
		return bloom.ErrEmptyKey
	}
	return nil
}

func (f *Filter) setLocked(key string) {
	var idx []uint64
	idx = bloom.Indices(key, f.m, f.k, idx)
	for _, i := range idx {
		f.bits[i>>3] |= 1 << (i & 7)
	}
}

func (f *Filter) testLocked(key string) bool {
	var idx []uint64
	idx = bloom.Indices(key, f.m, f.k, idx)
	for _, i := range idx {
		if f.bits[i>>3]&(1<<(i&7)) == 0 {
			return false
		}
	}
	return true
}

// Ensure Filter implements bloom.Filter.
var _ bloom.Filter = (*Filter)(nil)
