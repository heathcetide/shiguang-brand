// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package batch provides a batch accumulator that collects items and
// flushes them when one of the following conditions is met:
//   - the batch reaches a configured maximum size (count);
//   - the batch reaches a configured maximum byte size (if WithMaxBytes is set);
//   - a flush timer fires (time-based flush);
//   - Flush or FlushAndWait is called manually.
//
// # Quick start
//
//	b := batch.New(func(ctx context.Context, items []string) error {
//	    return db.WithContext(ctx).BatchInsert(items)
//	}, batch.WithSize(100), batch.WithInterval(5*time.Second))
//	defer b.Close()
//
//	for _, item := range data {
//	    b.Add(item) // non-blocking, flushes automatically
//	}
//
//	// Force flush remaining items and wait for completion.
//	if err := b.FlushAndWait(); err != nil { ... }
//
// # Concurrency
//
// Batch is safe for concurrent use. Add may block if the internal
// buffer is full, but it will not block on the flush handler itself —
// the handler runs in the same goroutine as the run loop.
package batch

import (
	"context"
	"fmt"
	"sync"
	"sync/atomic"
	"time"
)

// ──────────────────────────────────────────────
// Errors
// ──────────────────────────────────────────────

var (
	// ErrClosed is returned when Add is called after Close.
	ErrClosed = fmt.Errorf("batch: closed")
	// ErrHandlerNil is returned when no handler is provided.
	ErrHandlerNil = fmt.Errorf("batch: handler is nil")
)

// ──────────────────────────────────────────────
// Handler
// ──────────────────────────────────────────────

// Handler processes a batch of items. The context is canceled when
// the batch is being closed and the shutdown timeout has elapsed.
type Handler[T any] func(ctx context.Context, items []T) error

// ItemSizeFunc returns the byte size of an item. Used with WithMaxBytes.
type ItemSizeFunc[T any] func(item T) int

// ──────────────────────────────────────────────
// Config
// ──────────────────────────────────────────────

// Option configures a Batch.
type Option[T any] func(*Batch[T])

// WithSize sets the maximum number of items per batch.
// When the batch reaches this size, it is flushed automatically.
// Default is 1000.
func WithSize[T any](n int) Option[T] {
	return func(b *Batch[T]) {
		if n > 0 {
			b.maxSize = n
		}
	}
}

// WithMaxBytes sets the maximum total byte size per batch. When the
// accumulated byte size (computed via sizeFunc) reaches this limit,
// the batch is flushed automatically. Requires WithItemSize to be set.
func WithMaxBytes[T any](n int) Option[T] {
	return func(b *Batch[T]) {
		if n > 0 {
			b.maxBytes = n
		}
	}
}

// WithItemSize sets the function used to compute the byte size of
// each item. Required for WithMaxBytes to take effect.
func WithItemSize[T any](fn ItemSizeFunc[T]) Option[T] {
	return func(b *Batch[T]) {
		b.sizeFunc = fn
	}
}

// WithInterval sets the time-based flush interval. A flush is
// triggered after this duration even if the batch is not full.
// Default is 10 seconds. Set to 0 to disable time-based flushing.
func WithInterval[T any](d time.Duration) Option[T] {
	return func(b *Batch[T]) {
		b.interval = d
	}
}

// WithBufferSize sets the internal channel buffer size. Add will
// block if the buffer is full. Default is 0 (unbuffered).
func WithBufferSize[T any](n int) Option[T] {
	return func(b *Batch[T]) {
		if n >= 0 {
			b.chanSize = n
		}
	}
}

// WithErrorHandler sets a callback for handler errors.
func WithErrorHandler[T any](fn func(err error)) Option[T] {
	return func(b *Batch[T]) {
		b.errorHandler = fn
	}
}

// WithShutdownTimeout sets the timeout for the final flush during
// Close. If the handler does not complete within this time, Close
// returns ErrTimeout. Default is 30 seconds.
func WithShutdownTimeout[T any](d time.Duration) Option[T] {
	return func(b *Batch[T]) {
		if d > 0 {
			b.shutdownTimeout = d
		}
	}
}

// WithRetry sets the number of times to retry a failed flush before
// giving up and recording the error. Default is 0 (no retry).
func WithRetry[T any](n int) Option[T] {
	return func(b *Batch[T]) {
		if n >= 0 {
			b.maxRetry = n
		}
	}
}

// WithRetryDelay sets the delay between retry attempts.
// Default is 100ms.
func WithRetryDelay[T any](d time.Duration) Option[T] {
	return func(b *Batch[T]) {
		if d > 0 {
			b.retryDelay = d
		}
	}
}

// ──────────────────────────────────────────────
// Batch
// ──────────────────────────────────────────────

// Batch collects items and flushes them in batches to a Handler.
// It is generic and type-safe.
type Batch[T any] struct {
	handler         Handler[T]
	maxSize         int
	maxBytes        int
	sizeFunc        ItemSizeFunc[T]
	interval        time.Duration
	chanSize        int
	errorHandler    func(err error)
	shutdownTimeout time.Duration
	maxRetry        int
	retryDelay      time.Duration

	itemCh      chan T
	flushCh     chan struct{}
	flushWaitCh chan *flushRequest
	doneCh      chan struct{}
	closeCh     chan struct{}

	mu         sync.Mutex
	closed     bool
	lastErr    error
	errCount   int
	flushCount int
	itemCount  int64

	// pendingCount tracks items in the buffer (not yet flushed).
	pendingCount int64
	// pendingBytes tracks the byte size of buffered items.
	pendingBytes int64
}

// flushRequest is used by FlushAndWait to synchronize with the run loop.
// Must be passed by pointer so that the run loop's error is visible to
// the caller.
type flushRequest struct {
	done chan struct{}
	err  error
}

// New creates a new Batch with the given handler and options.
func New[T any](handler Handler[T], opts ...Option[T]) (*Batch[T], error) {
	if handler == nil {
		return nil, ErrHandlerNil
	}

	b := &Batch[T]{
		handler:         handler,
		maxSize:         1000,
		interval:        10 * time.Second,
		shutdownTimeout: 30 * time.Second,
		retryDelay:      100 * time.Millisecond,
	}

	for _, opt := range opts {
		opt(b)
	}

	b.itemCh = make(chan T, b.chanSize)
	b.flushCh = make(chan struct{}, 1)
	b.flushWaitCh = make(chan *flushRequest, 1)
	b.doneCh = make(chan struct{})
	b.closeCh = make(chan struct{})

	go b.run()

	return b, nil
}

// Add adds an item to the batch. It may block if the internal
// buffer is full. Returns ErrClosed if the batch is closed.
func (b *Batch[T]) Add(item T) error {
	b.mu.Lock()
	closed := b.closed
	b.mu.Unlock()

	if closed {
		return ErrClosed
	}

	b.itemCh <- item
	return nil
}

// TryAdd attempts to add an item without blocking. Returns true if
// the item was added, false if the buffer is full or the batch is closed.
func (b *Batch[T]) TryAdd(item T) bool {
	b.mu.Lock()
	closed := b.closed
	b.mu.Unlock()

	if closed {
		return false
	}

	select {
	case b.itemCh <- item:
		return true
	default:
		return false
	}
}

// Flush triggers a flush of the current batch. This is non-blocking;
// the flush happens in the background. Use FlushAndWait to block
// until the flush completes.
func (b *Batch[T]) Flush() {
	select {
	case b.flushCh <- struct{}{}:
	default:
	}
}

// FlushAndWait triggers a flush and blocks until it completes.
// Returns the handler error (if any) or ErrClosed if the batch is closed.
func (b *Batch[T]) FlushAndWait() error {
	b.mu.Lock()
	if b.closed {
		b.mu.Unlock()
		return ErrClosed
	}
	b.mu.Unlock()

	req := &flushRequest{done: make(chan struct{})}

	// Send the flush request. This may block if a previous
	// FlushAndWait is in progress.
	b.flushWaitCh <- req

	// Wait for the flush to complete.
	<-req.done
	return req.err
}

// Close flushes any remaining items and shuts down the batch.
// It blocks until all pending items have been processed or the
// shutdown timeout expires.
func (b *Batch[T]) Close() error {
	b.mu.Lock()
	if b.closed {
		b.mu.Unlock()
		return nil
	}
	b.closed = true
	b.mu.Unlock()

	close(b.closeCh)

	// Wait for the run loop to finish.
	<-b.doneCh
	return b.lastErr
}

// LastError returns the last error from the handler, if any.
func (b *Batch[T]) LastError() error {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.lastErr
}

// ErrorCount returns the total number of handler errors.
func (b *Batch[T]) ErrorCount() int {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.errCount
}

// FlushCount returns the total number of flushes performed.
func (b *Batch[T]) FlushCount() int {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.flushCount
}

// PendingCount returns the number of items currently buffered but
// not yet flushed.
func (b *Batch[T]) PendingCount() int {
	return int(atomic.LoadInt64(&b.pendingCount))
}

// PendingBytes returns the total byte size of items currently
// buffered but not yet flushed. Only meaningful if WithItemSize is set.
func (b *Batch[T]) PendingBytes() int {
	return int(atomic.LoadInt64(&b.pendingBytes))
}

// Stats returns current statistics.
func (b *Batch[T]) Stats() Stats {
	b.mu.Lock()
	defer b.mu.Unlock()
	return Stats{
		FlushCount:   b.flushCount,
		ErrorCount:   b.errCount,
		ItemCount:    b.itemCount,
		PendingCount: int(atomic.LoadInt64(&b.pendingCount)),
	}
}

// Stats holds batch statistics.
type Stats struct {
	FlushCount   int
	ErrorCount   int
	ItemCount    int64
	PendingCount int
}

// ──────────────────────────────────────────────
// Internal: run loop
// ──────────────────────────────────────────────

func (b *Batch[T]) run() {
	defer close(b.doneCh)

	var buffer []T
	var currentBytes int
	var timer *time.Timer
	var timerC <-chan time.Time

	if b.interval > 0 {
		timer = time.NewTimer(b.interval)
		timerC = timer.C
	}
	defer func() {
		if timer != nil {
			timer.Stop()
		}
	}()

	// flushCtx is used for ongoing flush operations. When Close is
	// called, flushCtx is canceled so that any in-flight handler can
	// return promptly. A separate timeout-bounded context is used
	// for the final shutdown flush.
	flushCtx, flushCancel := context.WithCancel(context.Background())
	defer flushCancel()

	// Monitor closeCh in a separate goroutine so that even if the
	// run loop is blocked inside a handler call, canceling flushCtx
	// can unblock it.
	go func() {
		<-b.closeCh
		flushCancel()
	}()

	// shouldFlushByBytes returns true if the byte limit is reached.
	shouldFlushByBytes := func() bool {
		return b.maxBytes > 0 && b.sizeFunc != nil && currentBytes >= b.maxBytes
	}

	// shouldFlush returns true if any flush condition is met.
	shouldFlush := func() bool {
		return len(buffer) >= b.maxSize || shouldFlushByBytes()
	}

	// resetTimer resets the interval timer after a flush.
	resetTimer := func() {
		if timer != nil {
			if !timer.Stop() {
				select {
				case <-timer.C:
				default:
				}
			}
			timer.Reset(b.interval)
		}
	}

	// flush executes the handler with the current buffer, with retry support.
	flush := func(ctx context.Context) error {
		if len(buffer) == 0 {
			return nil
		}

		// Copy items to avoid mutation during handler execution.
		items := make([]T, len(buffer))
		copy(items, buffer)
		buffer = buffer[:0]
		oldBytes := currentBytes
		currentBytes = 0

		// Update pending counters.
		atomic.AddInt64(&b.pendingCount, -int64(len(items)))
		atomic.AddInt64(&b.pendingBytes, -int64(oldBytes))

		var err error
		for attempt := 0; attempt <= b.maxRetry; attempt++ {
			err = b.handler(ctx, items)
			if err == nil {
				break
			}
			if attempt < b.maxRetry {
				select {
				case <-time.After(b.retryDelay):
				case <-ctx.Done():
					return ctx.Err()
				}
			}
		}

		b.mu.Lock()
		b.flushCount++
		b.itemCount += int64(len(items))
		if err != nil {
			b.lastErr = err
			b.errCount++
		}
		errHandler := b.errorHandler
		b.mu.Unlock()

		if err != nil && errHandler != nil {
			errHandler(err)
		}

		resetTimer()
		return err
	}

	for {
		select {
		case <-b.closeCh:
			// flushCtx has already been canceled by the monitor goroutine.
			// Use a timeout-bounded context for the final shutdown flush.
			shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), b.shutdownTimeout)
			defer shutdownCancel()

			// Drain remaining items from the channel.
			drainDone := false
			for !drainDone {
				select {
				case item := <-b.itemCh:
					buffer = append(buffer, item)
					if b.sizeFunc != nil {
						currentBytes += b.sizeFunc(item)
					}
					atomic.AddInt64(&b.pendingCount, 1)
					if shouldFlush() {
						_ = flush(shutdownCtx)
					}
				default:
					drainDone = true
				}
			}
			// Final flush.
			b.lastErr = flush(shutdownCtx)
			return

		case item := <-b.itemCh:
			buffer = append(buffer, item)
			if b.sizeFunc != nil {
				sz := b.sizeFunc(item)
				currentBytes += sz
				atomic.AddInt64(&b.pendingBytes, int64(sz))
			}
			atomic.AddInt64(&b.pendingCount, 1)
			if shouldFlush() {
				_ = flush(flushCtx)
			}

		case <-b.flushCh:
			_ = flush(flushCtx)

		case req := <-b.flushWaitCh:
			req.err = flush(flushCtx)
			close(req.done)

		case <-timerC:
			_ = flush(flushCtx)
		}
	}
}

// ──────────────────────────────────────────────
// SimpleBatch (non-generic, for []any)
// ──────────────────────────────────────────────

// SimpleBatch is a non-generic batch accumulator for any items.
// It is less type-safe than Batch[T] but easier to use when
// mixing types.
type SimpleBatch struct {
	*Batch[any]
}

// NewSimpleBatch creates a new SimpleBatch.
func NewSimpleBatch(handler Handler[any], opts ...Option[any]) (*SimpleBatch, error) {
	b, err := New[any](handler, opts...)
	if err != nil {
		return nil, err
	}
	return &SimpleBatch{Batch: b}, nil
}

// ──────────────────────────────────────────────
// Context-aware batch (with context cancellation)
// ──────────────────────────────────────────────

// RunWithContext runs a batch that is canceled when ctx is canceled.
// This is a convenience function for short-lived batches.
func RunWithContext[T any](ctx context.Context, handler Handler[T], opts ...Option[T]) (*Batch[T], error) {
	b, err := New(handler, opts...)
	if err != nil {
		return nil, err
	}

	go func() {
		<-ctx.Done()
		_ = b.Close()
	}()

	return b, nil
}
