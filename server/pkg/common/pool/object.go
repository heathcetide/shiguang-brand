// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package pool provides reusable resource pooling primitives for the
// ling-base foundation library.
//
// It ships with three building blocks:
//
//   - ObjectPool: a generic, bounded object pool backed by a channel-based
//     idle queue and a configurable maximum open count. Get blocks when the
//     pool is at capacity and resumes as soon as an object is returned.
//   - ConnPool: a connection pool built on top of the object-pool concept
//     that adds health checks, per-connection max lifetime and background
//     idle eviction.
//   - WorkerPool: a fixed-size goroutine worker pool that dispatches
//     submitted tasks to N workers with graceful shutdown and panic
//     recovery.
package pool

import (
	"errors"
	"sync"
	"sync/atomic"
)

// ErrPoolClosed is returned when an operation is attempted on a closed pool.
var ErrPoolClosed = errors.New("pool: closed")

// Factory creates a new instance of T.
type Factory[T any] func() (T, error)

// Destroyer releases resources associated with x. It is optional; a nil
// destroyer means no cleanup is performed when an object is discarded.
type Destroyer[T any] func(x T)

// PoolStats describes a snapshot of a pool's current state.
type PoolStats struct {
	OpenCount int32
	IdleCount int
	InUse     int32
}

// ObjectPool is a generic, bounded pool of reusable objects.
//
// Objects are kept in a channel-based idle queue. Get returns an idle object
// when available, or creates a new one while the number of open objects is
// below maxOpen. When the pool is at capacity, Get blocks until an object is
// returned via Put.
type ObjectPool[T any] struct {
	factory   Factory[T]
	destroyer Destroyer[T]

	idle    chan T
	maxOpen int

	openCount atomic.Int32
	closed    atomic.Bool

	mu   sync.Mutex
	cond *sync.Cond
}

// NewObjectPool returns a new ObjectPool with the given factory, maximum open
// count and optional destroyer. The pool is ready to use immediately.
func NewObjectPool[T any](factory Factory[T], maxOpen int, destroyer Destroyer[T]) *ObjectPool[T] {
	if maxOpen < 0 {
		maxOpen = 0
	}
	p := &ObjectPool[T]{
		factory:   factory,
		destroyer: destroyer,
		idle:      make(chan T, maxOpen),
		maxOpen:   maxOpen,
	}
	p.cond = sync.NewCond(&p.mu)
	return p
}

// Get returns an object from the idle queue, or creates a new one if the pool
// is below maxOpen. It blocks while the pool is at capacity and resumes when
// an object is returned. It returns ErrPoolClosed if the pool is closed.
func (p *ObjectPool[T]) Get() (T, error) {
	var zero T
	if p.closed.Load() {
		return zero, ErrPoolClosed
	}

	select {
	case x := <-p.idle:
		return x, nil
	default:
	}

	p.mu.Lock()
	for {
		if p.closed.Load() {
			p.mu.Unlock()
			return zero, ErrPoolClosed
		}
		select {
		case x := <-p.idle:
			p.mu.Unlock()
			return x, nil
		default:
		}
		if p.openCount.Load() < int32(p.maxOpen) {
			p.openCount.Add(1)
			p.mu.Unlock()

			x, err := p.factory()
			if err != nil {
				p.mu.Lock()
				p.openCount.Add(-1)
				p.cond.Signal()
				p.mu.Unlock()
				return zero, err
			}
			return x, nil
		}
		p.cond.Wait()
	}
}

// Put returns x to the idle queue. If the pool is closed or the idle queue is
// full, the destroyer (if any) is invoked on x and the open count is
// decremented.
func (p *ObjectPool[T]) Put(x T) {
	p.mu.Lock()
	if p.closed.Load() {
		p.mu.Unlock()
		p.destroy(x)
		p.mu.Lock()
		p.openCount.Add(-1)
		p.cond.Signal()
		p.mu.Unlock()
		return
	}
	select {
	case p.idle <- x:
		p.cond.Signal()
		p.mu.Unlock()
	default:
		p.mu.Unlock()
		p.destroy(x)
		p.mu.Lock()
		p.openCount.Add(-1)
		p.cond.Signal()
		p.mu.Unlock()
	}
}

// Close closes the pool. It drains the idle queue, invoking the destroyer on
// every idle object, and marks the pool as closed so that further Get calls
// return ErrPoolClosed. It is safe to call Close more than once.
func (p *ObjectPool[T]) Close() {
	p.mu.Lock()
	if p.closed.Swap(true) {
		p.mu.Unlock()
		return
	}
	p.cond.Broadcast()
	p.mu.Unlock()

	for {
		select {
		case x := <-p.idle:
			p.destroy(x)
			p.mu.Lock()
			p.openCount.Add(-1)
			p.mu.Unlock()
		default:
			return
		}
	}
}

// Stats returns a snapshot of the pool's current state.
func (p *ObjectPool[T]) Stats() PoolStats {
	open := p.openCount.Load()
	idle := len(p.idle)
	inUse := open - int32(idle)
	if inUse < 0 {
		inUse = 0
	}
	return PoolStats{
		OpenCount: open,
		IdleCount: idle,
		InUse:     inUse,
	}
}

func (p *ObjectPool[T]) destroy(x T) {
	if p.destroyer != nil {
		p.destroyer(x)
	}
}
