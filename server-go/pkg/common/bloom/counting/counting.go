// Package counting provides a counting Bloom filter that supports element
// removal.
//
// Each cell is a 4-bit saturating counter (max value 15), packed two-per-byte
// to keep memory usage to half of a naive byte-per-counter layout. Removal
// decrements the k counters for a key; addition increments them.
//
// Counting filters trade roughly 4x memory for the ability to remove elements
// without corrupting shared bits. Note that removing a key that was never
// added (or removing the same key more times than it was added) can introduce
// false negatives, so callers should only remove keys known to be present.
package counting

import (
	"context"
	"sync"

	"github.com/heathcetide/DietDigiDose/pkg/common/bloom"
)

// MaxCounter is the largest value a single cell can hold before saturating.
const MaxCounter = 15

// Filter is a counting Bloom filter implementing bloom.Filter and bloom.Remover.
type Filter struct {
	mu     sync.Mutex
	counts []byte // packed 4-bit counters, two per byte
	m      uint64
	k      uint64
	closed bool
}

// New creates a counting Bloom filter.
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
	// Two 4-bit counters per byte.
	bytes := (cfg.m + 1) / 2
	return &Filter{
		counts: make([]byte, bytes),
		m:      cfg.m,
		k:      cfg.k,
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
	var idx []uint64
	idx = bloom.Indices(key, f.m, f.k, idx)
	for _, i := range idx {
		f.addLocked(i)
	}
	return nil
}

func (f *Filter) Remove(ctx context.Context, key string) error {
	if err := f.check(ctx, key); err != nil {
		return err
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.closed {
		return bloom.ErrClosed
	}
	var idx []uint64
	idx = bloom.Indices(key, f.m, f.k, idx)
	for _, i := range idx {
		f.subLocked(i)
	}
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
	var idx []uint64
	idx = bloom.Indices(key, f.m, f.k, idx)
	for _, i := range idx {
		if f.getLocked(i) == 0 {
			return false, nil
		}
	}
	return true, nil
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
	clear(f.counts)
	return nil
}

func (f *Filter) Close() error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.closed {
		return nil
	}
	f.closed = true
	f.counts = nil
	return nil
}

// M returns the number of cells in the filter.
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

// 4-bit counter access. Cell i lives in byte i/2; even cells occupy the low
// nibble, odd cells the high nibble.

func (f *Filter) getLocked(i uint64) byte {
	b := f.counts[i>>1]
	if i&1 == 0 {
		return b & 0x0f
	}
	return b >> 4
}

func (f *Filter) setLocked(i uint64, v byte) {
	if v > MaxCounter {
		v = MaxCounter
	}
	pos := i >> 1
	if i&1 == 0 {
		f.counts[pos] = (f.counts[pos] & 0xf0) | v
	} else {
		f.counts[pos] = (f.counts[pos] & 0x0f) | (v << 4)
	}
}

func (f *Filter) addLocked(i uint64) {
	v := f.getLocked(i)
	if v < MaxCounter {
		f.setLocked(i, v+1)
	}
}

func (f *Filter) subLocked(i uint64) {
	v := f.getLocked(i)
	if v > 0 {
		f.setLocked(i, v-1)
	}
}

// Ensure Filter implements bloom.Filter and bloom.Remover.
var (
	_ bloom.Filter  = (*Filter)(nil)
	_ bloom.Remover = (*Filter)(nil)
)
