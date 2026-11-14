// Copyright (c) 2026 LingByte
// SPDX-License-Identifier: MIT

package circuitbreaker

import (
	"errors"
	"math"
	"math/rand"
	"sync"
	"sync/atomic"
	"time"
)

// SREStateOpen rejects requests according to the calculated drop ratio.
const SREStateOpen int32 = 0

// SREStateClosed allows requests while the rolling failure ratio is healthy.
const SREStateClosed int32 = 1

// SREOption configures the SRE circuit breaker.
type SREOption func(*sreOptions)

type sreOptions struct {
	failureRatio float64
	request      int64
	bucket       int
	window       time.Duration
}

// WithSREFailureRatio sets the failure ratio threshold that starts rejection.
func WithSREFailureRatio(ratio float64) SREOption {
	return func(o *sreOptions) { o.failureRatio = ratio }
}

// WithSRERequest sets the minimum request count before rejection starts.
func WithSRERequest(r int64) SREOption {
	return func(o *sreOptions) { o.request = r }
}

// WithSREWindow sets the rolling statistical window.
func WithSREWindow(d time.Duration) SREOption {
	return func(o *sreOptions) { o.window = d }
}

// WithSREBucket sets the number of buckets in the rolling window.
func WithSREBucket(b int) SREOption {
	return func(o *sreOptions) { o.bucket = b }
}

// SREBreaker is a Google-SRE-style adaptive circuit breaker.
//
// Unlike the state-machine breaker (CircuitBreaker), the SRE breaker does
// not hard-open. Instead, when the rolling failure ratio exceeds the
// configured threshold, it probabilistically drops requests proportional
// to the excess failure rate. This provides graceful degradation under
// partial failures rather than an all-or-nothing trip.
type SREBreaker struct {
	stat   *sreRollingCounter
	random func() float64

	k       float64
	request int64
	state   int32
}

// NewSREBreaker returns an SRE-style adaptive circuit breaker.
func NewSREBreaker(opts ...SREOption) *SREBreaker {
	opt := sreOptions{
		failureRatio: 0.5,
		request:      20,
		bucket:       10,
		window:       3 * time.Second,
	}
	for _, o := range opts {
		o(&opt)
	}
	if opt.failureRatio < 0 || opt.failureRatio >= 1 {
		opt.failureRatio = 0.5
	}
	if opt.request < 1 {
		opt.request = 1
	}
	if opt.bucket < 1 {
		opt.bucket = 1
	}
	if opt.window <= 0 {
		opt.window = 3 * time.Second
	}
	bucketDuration := opt.window / time.Duration(opt.bucket)
	if bucketDuration <= 0 {
		bucketDuration = opt.window
	}
	rnd := rand.New(rand.NewSource(time.Now().UnixNano()))
	var randMu sync.Mutex
	return &SREBreaker{
		stat:    newSRERollingCounter(opt.bucket, bucketDuration),
		random:  func() float64 { randMu.Lock(); defer randMu.Unlock(); return rnd.Float64() },
		request: opt.request,
		k:       1 / (1 - opt.failureRatio),
		state:   SREStateClosed,
	}
}

// Allow reports whether the request can pass the breaker.
// Returns ErrNotAllowed if the request is dropped.
func (b *SREBreaker) Allow() error {
	successes, total := b.stat.summary()
	requests := b.k * float64(successes)
	if total < b.request || float64(total) < requests {
		atomic.CompareAndSwapInt32(&b.state, SREStateOpen, SREStateClosed)
		return nil
	}
	atomic.CompareAndSwapInt32(&b.state, SREStateClosed, SREStateOpen)
	dropRatio := math.Max(0, (float64(total)-requests)/float64(total+1))
	if b.random() < dropRatio {
		return ErrNotAllowed
	}
	return nil
}

// MarkSuccess records a successful request.
func (b *SREBreaker) MarkSuccess() { b.stat.add(1) }

// MarkFailed records a failed request.
func (b *SREBreaker) MarkFailed() { b.stat.add(0) }

// State returns the current SRE state (SREStateOpen or SREStateClosed).
func (b *SREBreaker) State() int32 { return atomic.LoadInt32(&b.state) }

// ErrNotAllowed is returned when the SRE breaker drops a request.
var ErrNotAllowed = errors.New("circuitbreaker: not allowed for circuit open")

// ──────────────────────────────────────────────
// Rolling counter
// ──────────────────────────────────────────────

type sreRollingCounter struct {
	mu             sync.Mutex
	buckets        []sreCounterBucket
	bucketDuration time.Duration
}

type sreCounterBucket struct {
	slot    int64
	success int64
	total   int64
}

func newSRERollingCounter(size int, bucketDuration time.Duration) *sreRollingCounter {
	return &sreRollingCounter{
		buckets:        make([]sreCounterBucket, size),
		bucketDuration: bucketDuration,
	}
}

func (r *sreRollingCounter) add(success int64) {
	slot := r.currentSlot()
	offset := int(slot % int64(len(r.buckets)))

	r.mu.Lock()
	defer r.mu.Unlock()
	bucket := &r.buckets[offset]
	if bucket.slot != slot {
		bucket.slot = slot
		bucket.success = 0
		bucket.total = 0
	}
	bucket.success += success
	bucket.total++
}

func (r *sreRollingCounter) summary() (success int64, total int64) {
	slot := r.currentSlot()
	size := int64(len(r.buckets))

	r.mu.Lock()
	defer r.mu.Unlock()
	for _, bucket := range r.buckets {
		if bucket.total == 0 || slot-bucket.slot >= size || bucket.slot > slot {
			continue
		}
		success += bucket.success
		total += bucket.total
	}
	return success, total
}

func (r *sreRollingCounter) currentSlot() int64 {
	return time.Now().UnixNano() / int64(r.bucketDuration)
}
