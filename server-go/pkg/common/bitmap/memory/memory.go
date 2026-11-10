// Package memory provides an in-process dense bitmap backed by a growable
// []byte. It is exact, dependency-free, and fastest for small / dense universes
// (e.g. daily check-in flags 0–365).
//
// Persistence: state is volatile. Call WriteTo / ReadFrom (Snapshotter) or
// rebuild from a source of truth after restart.
package memory

import (
	"context"
	"encoding/binary"
	"io"
	"math/bits"
	"sync"

	"github.com/heathcetide/DietDigiDose/pkg/common/bitmap"
)

const snapshotMagic = "BM01"

// Bitmap is a dense in-memory bitset implementing bitmap.Bitmap,
// bitmap.Batcher, and bitmap.Snapshotter.
type Bitmap struct {
	mu       sync.RWMutex
	bits     []byte
	capacity uint64 // logical bit capacity when fixed; otherwise max grown
	fixed    bool
	closed   bool
}

// New creates a dense memory bitmap.
func New(opts ...Option) (*Bitmap, error) {
	cfg := applyOptions(opts...)
	if err := cfg.validate(); err != nil {
		return nil, err
	}
	b := &Bitmap{
		capacity: cfg.capacity,
		fixed:    cfg.fixed,
	}
	if cfg.capacity > 0 {
		b.bits = make([]byte, bitsToBytes(cfg.capacity))
	}
	return b, nil
}

func (b *Bitmap) Set(ctx context.Context, offset uint64) error {
	if err := b.check(ctx); err != nil {
		return err
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.closed {
		return bitmap.ErrClosed
	}
	if err := b.ensureLocked(offset); err != nil {
		return err
	}
	b.bits[offset>>3] |= 1 << (offset & 7)
	return nil
}

func (b *Bitmap) Get(ctx context.Context, offset uint64) (bool, error) {
	if err := b.check(ctx); err != nil {
		return false, err
	}
	b.mu.RLock()
	defer b.mu.RUnlock()
	if b.closed {
		return false, bitmap.ErrClosed
	}
	if b.fixed && offset >= b.capacity {
		return false, bitmap.ErrOffsetOutOfRange
	}
	byteIdx := offset >> 3
	if byteIdx >= uint64(len(b.bits)) {
		return false, nil
	}
	return b.bits[byteIdx]&(1<<(offset&7)) != 0, nil
}

func (b *Bitmap) Clear(ctx context.Context, offset uint64) error {
	if err := b.check(ctx); err != nil {
		return err
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.closed {
		return bitmap.ErrClosed
	}
	if b.fixed && offset >= b.capacity {
		return bitmap.ErrOffsetOutOfRange
	}
	byteIdx := offset >> 3
	if byteIdx >= uint64(len(b.bits)) {
		return nil
	}
	b.bits[byteIdx] &^= 1 << (offset & 7)
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
	var n uint64
	for _, by := range b.bits {
		n += uint64(bits.OnesCount8(by))
	}
	return n, nil
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
	clear(b.bits)
	return nil
}

func (b *Bitmap) Close() error {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.closed {
		return nil
	}
	b.closed = true
	b.bits = nil
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
		if err := b.ensureLocked(off); err != nil {
			return err
		}
		b.bits[off>>3] |= 1 << (off & 7)
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
		if b.fixed && off >= b.capacity {
			return nil, bitmap.ErrOffsetOutOfRange
		}
		byteIdx := off >> 3
		if byteIdx < uint64(len(b.bits)) {
			out[i] = b.bits[byteIdx]&(1<<(off&7)) != 0
		}
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
		if b.fixed && off >= b.capacity {
			return bitmap.ErrOffsetOutOfRange
		}
		byteIdx := off >> 3
		if byteIdx < uint64(len(b.bits)) {
			b.bits[byteIdx] &^= 1 << (off & 7)
		}
	}
	return nil
}

// WriteTo dumps a portable snapshot:
// magic(4) + fixed(1) + capacity(8 LE) + nbytes(8 LE) + bits[nbytes].
func (b *Bitmap) WriteTo(w io.Writer) (int64, error) {
	b.mu.RLock()
	defer b.mu.RUnlock()
	if b.closed {
		return 0, bitmap.ErrClosed
	}
	var n int64
	wn, err := io.WriteString(w, snapshotMagic)
	n += int64(wn)
	if err != nil {
		return n, err
	}
	var hdr [17]byte
	if b.fixed {
		hdr[0] = 1
	}
	binary.LittleEndian.PutUint64(hdr[1:9], b.capacity)
	binary.LittleEndian.PutUint64(hdr[9:17], uint64(len(b.bits)))
	wn, err = w.Write(hdr[:])
	n += int64(wn)
	if err != nil {
		return n, err
	}
	wn, err = w.Write(b.bits)
	return n + int64(wn), err
}

// ReadFrom restores a snapshot produced by WriteTo.
func (b *Bitmap) ReadFrom(r io.Reader) (int64, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.closed {
		return 0, bitmap.ErrClosed
	}
	var n int64
	magic := make([]byte, 4)
	rn, err := io.ReadFull(r, magic)
	n += int64(rn)
	if err != nil {
		return n, err
	}
	if string(magic) != snapshotMagic {
		return n, io.ErrUnexpectedEOF
	}
	var hdr [17]byte
	rn, err = io.ReadFull(r, hdr[:])
	n += int64(rn)
	if err != nil {
		return n, err
	}
	fixed := hdr[0] == 1
	capBits := binary.LittleEndian.Uint64(hdr[1:9])
	nbytes := binary.LittleEndian.Uint64(hdr[9:17])
	data := make([]byte, nbytes)
	if nbytes > 0 {
		rn, err = io.ReadFull(r, data)
		n += int64(rn)
		if err != nil {
			return n, err
		}
	}
	b.bits = data
	b.capacity = capBits
	b.fixed = fixed
	return n, nil
}

func (b *Bitmap) ensureLocked(offset uint64) error {
	if b.fixed {
		if offset >= b.capacity {
			return bitmap.ErrOffsetOutOfRange
		}
		return nil
	}
	need := bitsToBytes(offset + 1)
	if need <= len(b.bits) {
		return nil
	}
	grown := make([]byte, need)
	copy(grown, b.bits)
	b.bits = grown
	if b.capacity < offset+1 {
		b.capacity = offset + 1
	}
	return nil
}

func (b *Bitmap) check(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	return nil
}

func bitsToBytes(bits uint64) int {
	if bits == 0 {
		return 0
	}
	return int((bits + 7) / 8)
}

var (
	_ bitmap.Bitmap      = (*Bitmap)(nil)
	_ bitmap.Batcher     = (*Bitmap)(nil)
	_ bitmap.Snapshotter = (*Bitmap)(nil)
)
