// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package keysize implements a per-key cumulative byte-size limiter.
// Unlike count-based limiters, each Acquire/Release carries a size
// (in bytes), and the total size per key is capped.
//
// It also provides KeySizeWriter, an io.WriteCloser that enforces the
// size limit transparently as data is written.
package keysize

import (
	"context"
	"io"
	"sync"

	"github.com/heathcetide/DietDigiDose/pkg/common/limiter"
)

// Limit implements limiter.SizeLimiter with per-key byte quotas.
type Limit struct {
	mu      sync.Mutex
	current map[string]int64
	max     int64
}

// New creates a per-key size limiter with a maximum of max bytes per key.
func New(max int64) *Limit {
	return &Limit{current: make(map[string]int64), max: max}
}

func (l *Limit) Running() int64 {
	l.mu.Lock()
	defer l.mu.Unlock()
	var total int64
	for _, v := range l.current {
		total += v
	}
	return total
}

func (l *Limit) Acquire(ctx context.Context, key []byte, size int64) error {
	if size <= 0 {
		return limiter.ErrInvalidSize
	}
	k := string(key)
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.current[k]+size > l.max {
		return limiter.ErrLimitExceeded
	}
	l.current[k] += size
	return nil
}

func (l *Limit) Release(key []byte, size int64) {
	k := string(key)
	l.mu.Lock()
	defer l.mu.Unlock()
	n, ok := l.current[k]
	if !ok {
		return
	}
	n -= size
	if n <= 0 {
		delete(l.current, k)
	} else {
		l.current[k] = n
	}
}

func (l *Limit) Remaining(key []byte) int64 {
	k := string(key)
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.max - l.current[k]
}

// KeySizeWriter wraps an io.WriteCloser and enforces a per-key size
// limit. Each Write acquires bytes from the limiter; Close releases
// the total accumulated bytes.
//
// Usage:
//
//	l := keysize.New(1 << 30) // 1 GB per key
//	w := keysize.NewWriter(l, []byte("upload-123"), fileWriter)
//	io.Copy(w, reader)
//	w.Close()
type KeySizeWriter struct {
	Key      []byte
	Limit    *Limit
	Wrc      io.WriteCloser
	written  int64
	isClosed bool
	sync.Mutex
}

// NewWriter creates a KeySizeWriter that enforces the given size limit
// for the given key while writing to wrc.
func NewWriter(l *Limit, key []byte, wrc io.WriteCloser) *KeySizeWriter {
	return &KeySizeWriter{Key: key, Limit: l, Wrc: wrc}
}

func (w *KeySizeWriter) Write(p []byte) (int, error) {
	n, err := w.Wrc.Write(p)
	if err != nil {
		return n, err
	}
	w.Lock()
	defer w.Unlock()
	if w.isClosed {
		return n, nil
	}
	if err := w.Limit.Acquire(context.Background(), w.Key, int64(n)); err != nil {
		return n, err
	}
	w.written += int64(n)
	return n, nil
}

func (w *KeySizeWriter) Close() error {
	w.Lock()
	defer w.Unlock()
	if w.isClosed {
		return nil
	}
	w.isClosed = true
	w.Limit.Release(w.Key, w.written)
	return w.Wrc.Close()
}

// Written returns the total bytes written so far.
func (w *KeySizeWriter) Written() int64 {
	w.Lock()
	defer w.Unlock()
	return w.written
}
