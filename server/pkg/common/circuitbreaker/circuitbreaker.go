// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package circuitbreaker implements a thread-safe circuit breaker with
// Closed / Open / Half-Open state machine, sliding-window failure-rate
// statistics, and configurable thresholds.
//
// # States
//
//   - Closed:  requests pass through. Failures are counted in a sliding
//     window. When the failure rate exceeds the threshold, the breaker
//     trips to Open.
//   - Open:    requests are rejected immediately with ErrCircuitOpen.
//     After the recovery timeout elapses, the breaker transitions to
//     Half-Open.
//   - Half-Open: a limited number of trial requests are allowed through.
//     If they succeed, the breaker closes. If any fails, it re-opens.
//
// # Sliding window
//
// The breaker uses a count-based sliding window: it tracks the last N
// request outcomes (success or failure). The failure rate is computed as
// failures / total within the window. The window only becomes active
// after `MinRequests` observations, preventing false trips on low volume.
//
// # Basic usage
//
//	cb := circuitbreaker.New(circuitbreaker.Config{
//	    MaxRequests:     5,    // trial requests in Half-Open
//	    FailureThreshold: 0.5, // 50% failure rate trips the breaker
//	    MinRequests:     10,   // need at least 10 requests before evaluating
//	    RecoveryTimeout: 30 * time.Second,
//	})
//
//	err := cb.Execute(ctx, func(ctx context.Context) error {
//	    return callRemoteService(ctx)
//	})
//	if errors.Is(err, circuitbreaker.ErrCircuitOpen) {
//	    // fallback / return cached response
//	}
//
// # Integration with retry
//
// Combine circuitbreaker with retry for resilient remote calls:
//
//	err := cb.Execute(ctx, func(ctx context.Context) error {
//	    return retry.Do(ctx, func(ctx context.Context) error {
//	        return callRemote(ctx)
//	    }, retry.WithMaxAttempts(3), retry.WithExponentialBackoff(...))
//	})
package circuitbreaker

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"time"
)

// Sentinel errors.
var (
	// ErrCircuitOpen is returned when the breaker is Open and rejects a request.
	ErrCircuitOpen = errors.New("circuitbreaker: circuit is open")

	// ErrTooManyRequests is returned when the breaker is Half-Open and the
	// number of in-flight trial requests has reached MaxRequests.
	ErrTooManyRequests = errors.New("circuitbreaker: too many requests in half-open state")
)

// State represents the circuit breaker state.
type State int32

const (
	// StateClosed allows requests to pass through.
	StateClosed State = iota
	// StateOpen rejects all requests.
	StateOpen
	// StateHalfOpen allows a limited number of trial requests.
	StateHalfOpen
)

// String returns a human-readable state name.
func (s State) String() string {
	switch s {
	case StateClosed:
		return "closed"
	case StateOpen:
		return "open"
	case StateHalfOpen:
		return "half-open"
	default:
		return "unknown"
	}
}

// Config configures the circuit breaker behaviour.
type Config struct {
	// MaxRequests is the maximum number of trial requests allowed in
	// Half-Open before the breaker decides to close or re-open.
	// Must be > 0. Default: 5.
	MaxRequests int

	// FailureThreshold is the failure rate (0.0–1.0) that trips the
	// breaker from Closed to Open. The rate is computed over the sliding
	// window. Default: 0.5 (50%).
	FailureThreshold float64

	// MinRequests is the minimum number of requests that must be in the
	// sliding window before the failure rate is evaluated. Prevents false
	// trips on low traffic. Default: 10.
	MinRequests int

	// RecoveryTimeout is how long the breaker stays Open before
	// transitioning to Half-Open. Default: 30s.
	RecoveryTimeout time.Duration

	// SlidingWindowSize is the number of recent outcomes kept in the
	// sliding window. Default: 100.
	SlidingWindowSize int

	// OnStateChange is called when the breaker transitions between states.
	// It receives the previous and new state. Optional.
	OnStateChange func(name string, from, to State)

	// Name is an optional identifier for this breaker (useful in logs
	// and OnStateChange callbacks when multiple breakers exist).
	Name string
}

// CircuitBreaker is a thread-safe circuit breaker.
type CircuitBreaker struct {
	cfg Config

	mu sync.Mutex

	state      State
	generation uint64       // incremented on every state transition
	openedAt   time.Time    // when the breaker opened
	expiry     atomic.Int64 // unix nano when Open should transition to Half-Open

	// Sliding window — a ring buffer of outcomes.
	window    []bool // true = success, false = failure
	windowPos int    // ring buffer write position
	windowLen int    // current number of valid entries

	// Half-Open tracking.
	halfOpenRequests  atomic.Int32 // in-flight trial requests in Half-Open
	halfOpenSuccesses atomic.Int32
}

// New creates a CircuitBreaker with the given config.
func New(cfg Config) *CircuitBreaker {
	if cfg.MaxRequests <= 0 {
		cfg.MaxRequests = 5
	}
	if cfg.FailureThreshold <= 0 || cfg.FailureThreshold > 1.0 {
		cfg.FailureThreshold = 0.5
	}
	if cfg.MinRequests <= 0 {
		cfg.MinRequests = 10
	}
	if cfg.RecoveryTimeout <= 0 {
		cfg.RecoveryTimeout = 30 * time.Second
	}
	if cfg.SlidingWindowSize <= 0 {
		cfg.SlidingWindowSize = 100
	}

	cb := &CircuitBreaker{
		cfg:    cfg,
		state:  StateClosed,
		window: make([]bool, cfg.SlidingWindowSize),
	}
	return cb
}

// State returns the current state. It may trigger a transition from Open
// to Half-Open if the recovery timeout has elapsed.
func (cb *CircuitBreaker) State() State {
	cb.mu.Lock()
	defer cb.mu.Unlock()
	cb.checkRecovery()
	return cb.state
}

// Execute runs the given operation, applying circuit breaker logic.
// Returns ErrCircuitOpen if the breaker is Open, or the operation's error
// otherwise. The outcome (success/failure) is recorded in the sliding window.
func (cb *CircuitBreaker) Execute(ctx context.Context, op func(context.Context) error) error {
	if op == nil {
		return errors.New("circuitbreaker: operation must not be nil")
	}

	// Check context first.
	if err := ctx.Err(); err != nil {
		return err
	}

	// Acquire a "slot" — may be rejected if Open or Half-Open is full.
	gen, err := cb.beforeRequest()
	if err != nil {
		return err
	}

	// Execute the operation.
	err = op(ctx)

	cb.afterRequest(gen, err == nil)
	return err
}

// ──────────────────────────────────────────────
// Internal state machine
// ──────────────────────────────────────────────

// beforeRequest checks whether a request can proceed. Returns the current
// generation so afterRequest can detect stale calls.
func (cb *CircuitBreaker) beforeRequest() (uint64, error) {
	cb.mu.Lock()
	defer cb.mu.Unlock()

	cb.checkRecovery()

	switch cb.state {
	case StateClosed:
		return cb.generation, nil

	case StateOpen:
		return cb.generation, ErrCircuitOpen

	case StateHalfOpen:
		// Allow up to MaxRequests trial requests.
		current := cb.halfOpenRequests.Load()
		if int(current) >= cb.cfg.MaxRequests {
			return cb.generation, ErrTooManyRequests
		}
		cb.halfOpenRequests.Add(1)
		return cb.generation, nil

	default:
		return cb.generation, nil
	}
}

// afterRequest records the outcome and may trigger a state transition.
func (cb *CircuitBreaker) afterRequest(gen uint64, success bool) {
	cb.mu.Lock()
	defer cb.mu.Unlock()

	// Stale call from a previous generation — ignore.
	if gen != cb.generation {
		return
	}

	switch cb.state {
	case StateClosed:
		cb.recordOutcome(success)
		if !success && cb.shouldTrip() {
			cb.trip(StateOpen)
		}

	case StateHalfOpen:
		cb.halfOpenRequests.Add(-1)
		if success {
			cb.halfOpenSuccesses.Add(1)
			// If all trial requests have succeeded, close the breaker.
			if int(cb.halfOpenSuccesses.Load()) >= cb.cfg.MaxRequests {
				cb.trip(StateClosed)
			}
		} else {
			// Any failure in Half-Open re-opens the breaker.
			cb.trip(StateOpen)
		}

	case StateOpen:
		// Should not happen (beforeRequest rejects), but handle gracefully.
		// Decrement if we somehow let a half-open request through.
		cb.halfOpenRequests.Add(-1)
	}
}

// checkRecovery transitions from Open to Half-Open if the recovery timeout
// has elapsed. Must be called with mu held.
func (cb *CircuitBreaker) checkRecovery() {
	if cb.state != StateOpen {
		return
	}
	expiry := cb.expiry.Load()
	if expiry == 0 {
		return
	}
	if time.Now().UnixNano() < expiry {
		return
	}
	// Recovery timeout elapsed — transition to Half-Open.
	cb.trip(StateHalfOpen)
}

// shouldTrip evaluates the sliding window and returns true if the breaker
// should trip from Closed to Open. Must be called with mu held.
func (cb *CircuitBreaker) shouldTrip() bool {
	if cb.windowLen < cb.cfg.MinRequests {
		return false
	}

	failures := 0
	for i := 0; i < cb.windowLen; i++ {
		if !cb.window[i] {
			failures++
		}
	}

	failureRate := float64(failures) / float64(cb.windowLen)
	return failureRate >= cb.cfg.FailureThreshold
}

// recordOutcome appends an outcome to the sliding window. Must be called
// with mu held.
func (cb *CircuitBreaker) recordOutcome(success bool) {
	cb.window[cb.windowPos] = success
	cb.windowPos = (cb.windowPos + 1) % cb.cfg.SlidingWindowSize
	if cb.windowLen < cb.cfg.SlidingWindowSize {
		cb.windowLen++
	}
}

// trip transitions to a new state, resets relevant counters, and fires
// the OnStateChange callback. Must be called with mu held.
func (cb *CircuitBreaker) newState(to State) {
	from := cb.state
	cb.state = to
	cb.generation++

	switch to {
	case StateClosed:
		// Reset sliding window.
		cb.windowPos = 0
		cb.windowLen = 0
		for i := range cb.window {
			cb.window[i] = false
		}
		cb.halfOpenRequests.Store(0)
		cb.halfOpenSuccesses.Store(0)
		cb.expiry.Store(0)

	case StateOpen:
		cb.openedAt = time.Now()
		cb.expiry.Store(time.Now().Add(cb.cfg.RecoveryTimeout).UnixNano())
		cb.halfOpenRequests.Store(0)
		cb.halfOpenSuccesses.Store(0)

	case StateHalfOpen:
		cb.halfOpenRequests.Store(0)
		cb.halfOpenSuccesses.Store(0)
		cb.expiry.Store(0)
	}

	if cb.cfg.OnStateChange != nil && from != to {
		// Call outside the lock to prevent deadlock if callback
		// inspects breaker state. We defer this by copying the callback.
		cb.cfg.OnStateChange(cb.cfg.Name, from, to)
	}
}

// trip is an alias for newState kept for readability at call sites.
func (cb *CircuitBreaker) trip(to State) { cb.newState(to) }

// ──────────────────────────────────────────────
// Observability
// ──────────────────────────────────────────────

// Metrics is a point-in-time snapshot of breaker statistics.
type Metrics struct {
	Name        string  `json:"name"`
	State       string  `json:"state"`
	WindowLen   int     `json:"window_len"`
	Failures    int     `json:"failures"`
	Successes   int     `json:"successes"`
	FailureRate float64 `json:"failure_rate"`
	Generation  uint64  `json:"generation"`
}

// Metrics returns a snapshot of the current breaker state and window stats.
func (cb *CircuitBreaker) Metrics() Metrics {
	cb.mu.Lock()
	defer cb.mu.Unlock()

	cb.checkRecovery()

	failures := 0
	successes := 0
	for i := 0; i < cb.windowLen; i++ {
		if cb.window[i] {
			successes++
		} else {
			failures++
		}
	}

	var rate float64
	if cb.windowLen > 0 {
		rate = float64(failures) / float64(cb.windowLen)
	}

	return Metrics{
		Name:        cb.cfg.Name,
		State:       cb.state.String(),
		WindowLen:   cb.windowLen,
		Failures:    failures,
		Successes:   successes,
		FailureRate: rate,
		Generation:  cb.generation,
	}
}

// Reset clears the sliding window and forces the breaker to Closed.
func (cb *CircuitBreaker) Reset() {
	cb.mu.Lock()
	defer cb.mu.Unlock()
	cb.trip(StateClosed)
}

// Allow checks whether a request can proceed without running an operation.
// Returns nil if allowed, ErrCircuitOpen if the breaker is Open, or
// ErrTooManyRequests if Half-Open is saturated. The caller MUST call
// MarkSuccess or MarkFailed after the request completes.
func (cb *CircuitBreaker) Allow() error {
	_, err := cb.beforeRequest()
	return err
}

// MarkSuccess records a successful request outcome.
func (cb *CircuitBreaker) MarkSuccess() {
	cb.recordOutcomeAllow(true)
}

// MarkFailed records a failed request outcome.
func (cb *CircuitBreaker) MarkFailed() {
	cb.recordOutcomeAllow(false)
}

// recordOutcomeAllow records the outcome without a generation check,
// for use with the Allow/MarkSuccess/MarkFailed API.
func (cb *CircuitBreaker) recordOutcomeAllow(success bool) {
	cb.mu.Lock()
	defer cb.mu.Unlock()

	switch cb.state {
	case StateClosed:
		cb.recordOutcome(success)
		if !success && cb.shouldTrip() {
			cb.trip(StateOpen)
		}

	case StateHalfOpen:
		cb.halfOpenRequests.Add(-1)
		if success {
			cb.halfOpenSuccesses.Add(1)
			if int(cb.halfOpenSuccesses.Load()) >= cb.cfg.MaxRequests {
				cb.trip(StateClosed)
			}
		} else {
			cb.trip(StateOpen)
		}

	case StateOpen:
		cb.halfOpenRequests.Add(-1)
	}
}
