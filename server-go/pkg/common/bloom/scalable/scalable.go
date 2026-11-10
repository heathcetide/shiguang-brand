// Package scalable implements a Scalable Bloom Filter (Almeida et al., 2007):
// a sequence of standard Bloom filters with geometrically growing capacities
// and geometrically tightening false-positive rates.
//
// When the current sub-filter reaches its expected element count, a new,
// larger sub-filter is allocated automatically. A key is reported present if
// any sub-filter reports it. Because each sub-filter tightens its FPR by a
// constant ratio r, the aggregate false-positive probability is bounded by
// p0 / (1 - r) regardless of how many sub-filters are created.
//
// This avoids the need to size the filter exactly up front: it grows to fit
// the data. Removal is not supported (the underlying sub-filters are standard
// bit-array filters); use bloom/counting for that.
package scalable

import (
	"context"
	"errors"
	"math"
	"sync"

	"github.com/heathcetide/DietDigiDose/pkg/common/bloom"
)

// subFilter is one slice of the SBF: a standard bit-array Bloom filter.
type subFilter struct {
	bits     []byte
	m        uint64
	k        uint64
	count    uint64 // number of Add operations that flipped new bits
	capacity uint64 // expected element count for this slice
}

// Filter is a Scalable Bloom Filter implementing bloom.Filter.
type Filter struct {
	mu      sync.Mutex
	cfg     config
	subs    []*subFilter
	current int
	closed  bool
}

// New creates a Scalable Bloom Filter.
//
// WithInitialCapacity and WithFalsePositiveRate are required. Growth and FPR
// ratios default to 2 and 0.9 respectively.
func New(opts ...Option) (*Filter, error) {
	cfg := applyOptions(opts...)
	if cfg.n0 == 0 {
		return nil, bloom.ErrInvalidCapacity
	}
	if !(cfg.p0 > 0 && cfg.p0 < 1) {
		return nil, bloom.ErrInvalidFalsePositiveRate
	}
	if cfg.growth <= 1 {
		return nil, errors.New("scalable: growth ratio must be greater than 1")
	}
	if !(cfg.fpRatio > 0 && cfg.fpRatio < 1) {
		return nil, errors.New("scalable: FPR ratio must be in (0, 1)")
	}

	f := &Filter{cfg: cfg}
	if err := f.grow(); err != nil {
		return nil, err
	}
	return f, nil
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

	cur := f.subs[f.current]
	if cur.count >= cur.capacity {
		if err := f.grow(); err != nil {
			return err
		}
		cur = f.subs[f.current]
	}

	var idx []uint64
	idx = bloom.Indices(key, cur.m, cur.k, idx)
	added := false
	for _, i := range idx {
		if cur.bits[i>>3]&(1<<(i&7)) == 0 {
			cur.bits[i>>3] |= 1 << (i & 7)
			added = true
		}
	}
	if added {
		cur.count++
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
	for _, s := range f.subs {
		var idx []uint64
		idx = bloom.Indices(key, s.m, s.k, idx)
		hit := true
		for _, i := range idx {
			if s.bits[i>>3]&(1<<(i&7)) == 0 {
				hit = false
				break
			}
		}
		if hit {
			return true, nil
		}
	}
	return false, nil
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
	// Drop all sub-filters and start fresh with a single slice.
	f.subs = nil
	f.current = 0
	return f.grow()
}

func (f *Filter) Close() error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.closed {
		return nil
	}
	f.closed = true
	f.subs = nil
	return nil
}

// NumSubFilters returns the number of sub-filters currently allocated.
func (f *Filter) NumSubFilters() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.subs)
}

// ApproximateCount returns the total number of Add operations that flipped new
// bits across all sub-filters (a lower-bound estimate of distinct elements).
func (f *Filter) ApproximateCount() uint64 {
	f.mu.Lock()
	defer f.mu.Unlock()
	var n uint64
	for _, s := range f.subs {
		n += s.count
	}
	return n
}

func (f *Filter) check(ctx context.Context, key string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if key == "" {
		return bloom.ErrEmptyKey
	}
	return nil
}

// grow allocates the next sub-filter. Caller must hold f.mu.
func (f *Filter) grow() error {
	i := len(f.subs)
	ps, err := f.cfg.estimateFor(i)
	if err != nil {
		return err
	}
	capacity := f.cfg.n0
	for j := 0; j < i; j++ {
		capacity = uint64(math.Round(float64(capacity) * f.cfg.growth))
	}
	if capacity == 0 {
		capacity = f.cfg.n0
	}
	s := &subFilter{
		bits:     make([]byte, bloom.BitsToBytes(ps.M)),
		m:        ps.M,
		k:        ps.K,
		capacity: capacity,
	}
	f.subs = append(f.subs, s)
	f.current = i
	return nil
}

// Ensure Filter implements bloom.Filter.
var _ bloom.Filter = (*Filter)(nil)
