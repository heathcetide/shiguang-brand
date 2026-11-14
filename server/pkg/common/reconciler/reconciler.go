// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package reconciler implements the Kubernetes-style Reconciler/Controller
// pattern for eventual-consistency background work.
//
// # Design
//
// A [Reconciler] implements the business logic that drives a resource toward
// its desired state. A [Controller] wraps a Reconciler with:
//
//   - A work queue with deduplication (by key).
//   - Rate-limited requeue with exponential backoff.
//   - A configurable number of worker goroutines.
//   - Startup sync and event-driven enqueue.
//   - Graceful shutdown.
//
// This is a Go-native reimplementation of the pattern popularised by
// Kubernetes' client-go controller-runtime and Halo's Reconciler/Controller.
// It does NOT depend on Kubernetes or any external library.
//
// # Quick start
//
//	// 1. Implement Reconciler
//	type MyReconciler struct{}
//	func (r *MyReconciler) Reconcile(ctx context.Context, req reconciler.Request) (reconciler.Result, error) {
//	    // ... drive toward desired state ...
//	    return reconciler.Result{RequeueAfter: 30 * time.Second}, nil
//	}
//
//	// 2. Build and start controller
//	ctrl := reconciler.NewController("my-controller").
//	    WithReconciler(&MyReconciler{}).
//	    WithWorkers(2).
//	    WithRateLimiter(reconciler.DefaultRateLimiter()).
//	    Build()
//
//	ctx, cancel := context.WithCancel(context.Background())
//	defer cancel()
//	go ctrl.Start(ctx)
//
//	// 3. Enqueue work
//	ctrl.Enqueue(reconciler.Request{Key: "resource-1"})
//
//	// 4. Shutdown
//	cancel() // or ctrl.Stop()
package reconciler

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"time"
)

// ──────────────────────────────────────────────
// Core types
// ──────────────────────────────────────────────

// Request identifies a unit of reconciliation work by key.
type Request struct {
	// Key is the unique identifier of the resource to reconcile.
	// Convention: "namespace/name" or any application-defined string.
	Key string
}

// Result tells the Controller what to do after a reconcile pass.
type Result struct {
	// Requeue immediately re-enqueues the request.
	Requeue bool
	// RequeueAfter delays the next reconcile by this duration.
	// If both Requeue and RequeueAfter are set, RequeueAfter wins.
	RequeueAfter time.Duration
}

// Reconciler is implemented by the business logic that drives a resource
// toward its desired state.
//
// Reconcile must be idempotent — it may be called multiple times for the
// same Request. It should not return until the work for this pass is done
// (or an error occurs).
type Reconciler interface {
	Reconcile(ctx context.Context, req Request) (Result, error)
}

// ReconcilerFunc is a function adapter for Reconciler.
type ReconcilerFunc func(ctx context.Context, req Request) (Result, error)

func (f ReconcilerFunc) Reconcile(ctx context.Context, req Request) (Result, error) {
	return f(ctx, req)
}

// ──────────────────────────────────────────────
// Rate limiter
// ──────────────────────────────────────────────

// RateLimiter computes the delay before a failed request is retried.
type RateLimiter interface {
	// Delay returns the wait duration for the given key after n failures.
	// Return 0 to indicate "retry immediately".
	Delay(key string, failures int) time.Duration
}

// DefaultRateLimiter uses exponential backoff with jitter:
//
//	base * 2^failures, capped at max, with ±10% jitter.
//
// Defaults: base=5ms, max=1000s.
type DefaultRateLimiter struct {
	Base time.Duration
	Max  time.Duration
}

// NewDefaultRateLimiter creates a rate limiter with sensible defaults.
func NewDefaultRateLimiter() *DefaultRateLimiter {
	return &DefaultRateLimiter{
		Base: 5 * time.Millisecond,
		Max:  1000 * time.Second,
	}
}

// Delay implements RateLimiter.
func (r *DefaultRateLimiter) Delay(_ string, failures int) time.Duration {
	if r.Base <= 0 {
		r.Base = 5 * time.Millisecond
	}
	if r.Max <= 0 {
		r.Max = 1000 * time.Second
	}
	if failures <= 0 {
		return 0
	}
	// Exponential backoff: base * 2^failures
	d := r.Base
	for i := 0; i < failures && d < r.Max; i++ {
		d *= 2
	}
	if d > r.Max {
		d = r.Max
	}
	return d
}

// FixedIntervalRateLimiter always returns the same delay regardless of
// failure count.
type FixedIntervalRateLimiter struct {
	Interval time.Duration
}

func (r *FixedIntervalRateLimiter) Delay(_ string, _ int) time.Duration {
	return r.Interval
}

// NoRateLimiter always returns 0 (immediate retry).
type NoRateLimiter struct{}

func (NoRateLimiter) Delay(_ string, _ int) time.Duration { return 0 }

// ──────────────────────────────────────────────
// Work queue
// ──────────────────────────────────────────────

// queueItem is an entry in the work queue.
type queueItem struct {
	key       string
	requeueAt time.Time
	failures  int
}

// workQueue is a deduplicated, rate-limited priority queue.
type workQueue struct {
	mu       sync.Mutex
	wakeCh   chan struct{} // signal channel for waking up Get
	items    map[string]*queueItem
	shutdown bool
}

func newWorkQueue() *workQueue {
	return &workQueue{
		items:  make(map[string]*queueItem),
		wakeCh: make(chan struct{}, 1),
	}
}

// signal wakes up a blocked Get without blocking.
func (q *workQueue) signal() {
	select {
	case q.wakeCh <- struct{}{}:
	default:
	}
}

// Add enqueues a key immediately (or updates an existing item to fire now).
func (q *workQueue) Add(key string) {
	q.mu.Lock()
	defer q.mu.Unlock()
	if q.shutdown {
		return
	}
	if item, ok := q.items[key]; ok {
		item.requeueAt = time.Now() // pull forward
	} else {
		q.items[key] = &queueItem{key: key, requeueAt: time.Now()}
	}
	q.signal()
}

// AddAfter enqueues a key with a delay.
func (q *workQueue) AddAfter(key string, delay time.Duration) {
	q.mu.Lock()
	defer q.mu.Unlock()
	if q.shutdown {
		return
	}
	requeueAt := time.Now().Add(delay)
	if item, ok := q.items[key]; ok {
		// Only push back if the new time is later.
		if requeueAt.After(item.requeueAt) {
			item.requeueAt = requeueAt
		}
	} else {
		q.items[key] = &queueItem{key: key, requeueAt: requeueAt}
	}
	q.signal()
}

// Get blocks until a key is ready to be processed, then returns it along
// with its failure count. Returns ok=false if the queue is shutting down.
func (q *workQueue) Get() (key string, failures int, ok bool) {
	for {
		q.mu.Lock()

		if q.shutdown {
			q.mu.Unlock()
			return "", 0, false
		}

		now := time.Now()
		var earliest *queueItem
		for _, item := range q.items {
			if item.requeueAt.After(now) {
				continue
			}
			if earliest == nil || item.requeueAt.Before(earliest.requeueAt) {
				earliest = item
			}
		}

		if earliest != nil {
			delete(q.items, earliest.key)
			q.mu.Unlock()
			return earliest.key, earliest.failures, true
		}

		// No item ready. Calculate the next wake-up time.
		var nextWake time.Duration
		for _, item := range q.items {
			wait := time.Until(item.requeueAt)
			if nextWake == 0 || wait < nextWake {
				nextWake = wait
			}
		}

		// Drain any pending wake signal.
		select {
		case <-q.wakeCh:
		default:
		}

		q.mu.Unlock()

		// Wait for either a signal or the timer to fire.
		if nextWake <= 0 {
			// No items — wait indefinitely for a signal.
			<-q.wakeCh
		} else {
			timer := time.NewTimer(nextWake)
			select {
			case <-q.wakeCh:
				timer.Stop()
			case <-timer.C:
			}
		}
	}
}

// Done is called after processing a key. If requeue is true, the key is
// re-added with rate-limited delay.
//
// If the key was already re-enqueued (e.g. via Add) while the worker was
// processing it, Done will only update the existing item if the new
// requeueAt is earlier (i.e. it won't push back an already-pulled-forward
// item).
func (q *workQueue) Done(key string, failures int, requeue bool, delay time.Duration) {
	q.mu.Lock()
	defer q.mu.Unlock()
	if q.shutdown || !requeue {
		return
	}
	requeueAt := time.Now().Add(delay)
	if existing, ok := q.items[key]; ok {
		// Only update if our requeue time is earlier than what's already
		// scheduled (don't push back an item that was pulled forward).
		if requeueAt.Before(existing.requeueAt) {
			existing.requeueAt = requeueAt
			existing.failures = failures
		}
	} else {
		q.items[key] = &queueItem{
			key:       key,
			requeueAt: requeueAt,
			failures:  failures,
		}
	}
	if delay <= 0 {
		q.signal()
	}
}

// Shutdown stops the queue. Get will return ok=false.
func (q *workQueue) Shutdown() {
	q.mu.Lock()
	q.shutdown = true
	q.mu.Unlock()
	q.signal()
}

// Len returns the number of pending items.
func (q *workQueue) Len() int {
	q.mu.Lock()
	defer q.mu.Unlock()
	return len(q.items)
}

// ──────────────────────────────────────────────
// Controller
// ──────────────────────────────────────────────

// Controller manages a Reconciler's lifecycle.
type Controller struct {
	name        string
	reconciler  Reconciler
	rateLimiter RateLimiter
	workers     int

	queue   *workQueue
	running atomic.Bool
	stopCh  chan struct{}
	wg      sync.WaitGroup

	// Metrics
	processedCount atomic.Int64
	errorCount     atomic.Int64
	requeueCount   atomic.Int64

	// Hooks
	onError func(key string, err error)
}

// ControllerBuilder fluently constructs a Controller.
type ControllerBuilder struct {
	c *Controller
}

// NewController creates a new builder.
func NewController(name string) *ControllerBuilder {
	return &ControllerBuilder{
		c: &Controller{
			name:        name,
			workers:     1,
			rateLimiter: NewDefaultRateLimiter(),
			queue:       newWorkQueue(),
			stopCh:      make(chan struct{}),
		},
	}
}

// WithReconciler sets the Reconciler.
func (b *ControllerBuilder) WithReconciler(r Reconciler) *ControllerBuilder {
	b.c.reconciler = r
	return b
}

// WithReconcilerFunc sets a Reconciler function.
func (b *ControllerBuilder) WithReconcilerFunc(f ReconcilerFunc) *ControllerBuilder {
	b.c.reconciler = f
	return b
}

// WithWorkers sets the number of worker goroutines.
func (b *ControllerBuilder) WithWorkers(n int) *ControllerBuilder {
	if n < 1 {
		n = 1
	}
	b.c.workers = n
	return b
}

// WithRateLimiter sets the rate limiter.
func (b *ControllerBuilder) WithRateLimiter(rl RateLimiter) *ControllerBuilder {
	if rl != nil {
		b.c.rateLimiter = rl
	}
	return b
}

// WithErrorHandler sets a callback for reconcile errors.
func (b *ControllerBuilder) WithErrorHandler(fn func(key string, err error)) *ControllerBuilder {
	b.c.onError = fn
	return b
}

// Build returns the configured Controller.
func (b *ControllerBuilder) Build() *Controller {
	if b.c.reconciler == nil {
		b.c.reconciler = ReconcilerFunc(func(_ context.Context, _ Request) (Result, error) {
			return Result{}, errors.New("reconciler: no reconciler set")
		})
	}
	return b.c
}

// Start launches the controller workers. It blocks until ctx is cancelled
// or Stop is called. Start is idempotent — calling it on an already-running
// controller is a no-op.
func (c *Controller) Start(ctx context.Context) error {
	if !c.running.CompareAndSwap(false, true) {
		return fmt.Errorf("controller %q already running", c.name)
	}

	// Reset stop channel if previously stopped.
	select {
	case <-c.stopCh:
		c.stopCh = make(chan struct{})
	default:
	}

	for i := 0; i < c.workers; i++ {
		c.wg.Add(1)
		go c.worker(ctx, i)
	}

	// Wait for shutdown.
	select {
	case <-ctx.Done():
	case <-c.stopCh:
	}

	c.queue.Shutdown()
	c.wg.Wait()
	c.running.Store(false)
	return ctx.Err()
}

// Stop signals all workers to stop. It does not wait — call Start and
// wait for it to return, or use a cancellable context.
func (c *Controller) Stop() {
	select {
	case <-c.stopCh:
		// already closed
	default:
		close(c.stopCh)
	}
	c.queue.Shutdown()
}

// Enqueue adds a key to the work queue immediately.
func (c *Controller) Enqueue(req Request) {
	c.queue.Add(req.Key)
}

// EnqueueAfter adds a key to the work queue after a delay.
func (c *Controller) EnqueueAfter(req Request, delay time.Duration) {
	c.queue.AddAfter(req.Key, delay)
}

// IsRunning returns whether the controller is currently running.
func (c *Controller) IsRunning() bool {
	return c.running.Load()
}

// ProcessedCount returns the total number of successful reconcile passes.
func (c *Controller) ProcessedCount() int64 {
	return c.processedCount.Load()
}

// ErrorCount returns the total number of reconcile errors.
func (c *Controller) ErrorCount() int64 {
	return c.errorCount.Load()
}

// RequeueCount returns the total number of requeued requests.
func (c *Controller) RequeueCount() int64 {
	return c.requeueCount.Load()
}

// QueueDepth returns the number of pending items in the queue.
func (c *Controller) QueueDepth() int {
	return c.queue.Len()
}

// worker processes items from the queue.
func (c *Controller) worker(ctx context.Context, id int) {
	defer c.wg.Done()

	for {
		key, failures, ok := c.queue.Get()
		if !ok {
			return
		}

		result, err := c.reconciler.Reconcile(ctx, Request{Key: key})
		if err != nil {
			c.errorCount.Add(1)
			if c.onError != nil {
				c.onError(key, err)
			}
			// Rate-limited requeue on error.
			delay := c.rateLimiter.Delay(key, failures+1)
			c.queue.Done(key, failures+1, true, delay)
			continue
		}

		c.processedCount.Add(1)

		// Handle explicit requeue from result.
		switch {
		case result.RequeueAfter > 0:
			c.requeueCount.Add(1)
			c.queue.Done(key, 0, true, result.RequeueAfter)
		case result.Requeue:
			c.requeueCount.Add(1)
			c.queue.Done(key, 0, true, 0)
		default:
			c.queue.Done(key, 0, false, 0)
		}
	}
}
