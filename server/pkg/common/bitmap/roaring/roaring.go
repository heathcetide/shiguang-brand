// Package roaring provides a sparse, compressed bitmap backed by
// github.com/RoaringBitmap/roaring. Prefer this over the dense memory backend
// when offsets are large and sparse (user IDs, product IDs, tag sets).
//
// Persistence: in-process state is volatile. Use WriteTo / ReadFrom
// (Snapshotter) to dump Roaring's portable format across restarts.
package roaring

import (
	"context"
	"io"
	"sync"

	"github.com/RoaringBitmap/roaring/v2"

	"github.com/heathcetide/DietDigiDose/pkg/common/bitmap"
)

// Bitmap wraps a Roaring bitmap and implements bitmap.Bitmap,
// bitmap.Batcher, and bitmap.Snapshotter.
type Bitmap struct {
	mu     sync.RWMutex
	rb     *roaring.Bitmap
	closed bool
}

// New creates an empty Roaring bitmap.
func New() *Bitmap {
	return &Bitmap{rb: roaring.New()}
}

func (b *Bitmap) Set(ctx context.Context, offset uint64) error {
	if err := b.check(ctx); err != nil {
		return err
	}
	if offset > ^uint64(0)>>32 {
		// roaring.Bitmap stores uint32 offsets.
		return bitmap.ErrOffsetOutOfRange
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.closed {
		return bitmap.ErrClosed
	}
	b.rb.Add(uint32(offset))
	return nil
}

func (b *Bitmap) Get(ctx context.Context, offset uint64) (bool, error) {
	if err := b.check(ctx); err != nil {
		return false, err
	}
	if offset > ^uint64(0)>>32 {
		return false, bitmap.ErrOffsetOutOfRange
	}
	b.mu.RLock()
	defer b.mu.RUnlock()
	if b.closed {
		return false, bitmap.ErrClosed
	}
	return b.rb.Contains(uint32(offset)), nil
}

func (b *Bitmap) Clear(ctx context.Context, offset uint64) error {
	if err := b.check(ctx); err != nil {
		return err
	}
	if offset > ^uint64(0)>>32 {
		return bitmap.ErrOffsetOutOfRange
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.closed {
		return bitmap.ErrClosed
	}
	b.rb.Remove(uint32(offset))
	return nil
}

func (b *Bitmap) Count(ctx context.Context) (uint64, error) {
	if err := b.check(ctx); err != nil {
		return 0, err
	}
	b.mu.RLock()
	defer b.mu.RUnlock()
	if b.closed {
		return 0, bitmap.ErrClosed
	}
	return b.rb.GetCardinality(), nil
}

func (b *Bitmap) Reset(ctx context.Context) error {
	if err := b.check(ctx); err != nil {
		return err
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.closed {
		return bitmap.ErrClosed
	}
	b.rb.Clear()
	return nil
}

func (b *Bitmap) Close() error {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.closed {
		return nil
	}
	b.closed = true
	b.rb = nil
	return nil
}

func (b *Bitmap) SetBatch(ctx context.Context, offsets []uint64) error {
	if err := b.check(ctx); err != nil {
		return err
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.closed {
		return bitmap.ErrClosed
	}
	for _, off := range offsets {
		if off > ^uint64(0)>>32 {
			return bitmap.ErrOffsetOutOfRange
		}
		b.rb.Add(uint32(off))
	}
	return nil
}

func (b *Bitmap) GetBatch(ctx context.Context, offsets []uint64) ([]bool, error) {
	if err := b.check(ctx); err != nil {
		return nil, err
	}
	b.mu.RLock()
	defer b.mu.RUnlock()
	if b.closed {
		return nil, bitmap.ErrClosed
	}
	out := make([]bool, len(offsets))
	for i, off := range offsets {
		if off > ^uint64(0)>>32 {
			return nil, bitmap.ErrOffsetOutOfRange
		}
		out[i] = b.rb.Contains(uint32(off))
	}
	return out, nil
}

func (b *Bitmap) ClearBatch(ctx context.Context, offsets []uint64) error {
	if err := b.check(ctx); err != nil {
		return err
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.closed {
		return bitmap.ErrClosed
	}
	for _, off := range offsets {
		if off > ^uint64(0)>>32 {
			return bitmap.ErrOffsetOutOfRange
		}
		b.rb.Remove(uint32(off))
	}
	return nil
}

// WriteTo serializes using Roaring's portable format.
func (b *Bitmap) WriteTo(w io.Writer) (int64, error) {
	b.mu.RLock()
	defer b.mu.RUnlock()
	if b.closed {
		return 0, bitmap.ErrClosed
	}
	return b.rb.WriteTo(w)
}

// ReadFrom replaces contents from a Roaring portable dump.
func (b *Bitmap) ReadFrom(r io.Reader) (int64, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.closed {
		return 0, bitmap.ErrClosed
	}
	nb := roaring.New()
	n, err := nb.ReadFrom(r)
	if err != nil {
		return n, err
	}
	b.rb = nb
	return n, nil
}

// AndInPlace keeps bits present in both this and other (Roaring-only helper).
func (b *Bitmap) AndInPlace(other *Bitmap) error {
	if other == nil {
		return nil
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	other.mu.RLock()
	defer other.mu.RUnlock()
	if b.closed || other.closed {
		return bitmap.ErrClosed
	}
	b.rb.And(other.rb)
	return nil
}

// OrInPlace unions other into this bitmap (Roaring-only helper).
func (b *Bitmap) OrInPlace(other *Bitmap) error {
	if other == nil {
		return nil
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	other.mu.RLock()
	defer other.mu.RUnlock()
	if b.closed || other.closed {
		return bitmap.ErrClosed
	}
	b.rb.Or(other.rb)
	return nil
}

func (b *Bitmap) check(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	return nil
}

var (
	_ bitmap.Bitmap      = (*Bitmap)(nil)
	_ bitmap.Batcher     = (*Bitmap)(nil)
	_ bitmap.Snapshotter = (*Bitmap)(nil)
)
