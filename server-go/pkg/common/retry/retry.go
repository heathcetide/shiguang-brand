// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package retry provides a flexible retry framework with configurable
// backoff strategies, max attempts, timeouts, and retryable-error filtering.
//
// # Strategies
//
// The package ships with two built-in backoff strategies:
//
//   - ExponentialBackoff: delay = base * factor^attempt, capped at maxDelay,
//     with optional jitter to avoid thundering-herd.
//   - FixedInterval: a constant delay between every attempt.
//
// Custom strategies can be created by implementing the Backoff interface.
//
// # Retryable errors
//
// By default every non-nil error is retried. Use WithRetryIf to restrict
// retries to specific error types (e.g. transient network errors).
//
// # Basic usage
//
//	err := retry.Do(ctx, func(ctx context.Context) error {
//	    return callRemoteAPI(ctx)
//	},
//	    retry.WithMaxAttempts(5),
//	    retry.WithExponentialBackoff(100*time.Millisecond, 10*time.Second, 2.0, true),
//	    retry.WithRetryIf(func(err error) bool {
//	        var netErr net.Error
//	        return errors.As(err, &netErr) && netErr.Timeout()
//	    }),
//	)
//
// # Decorator pattern
//
// Retry can wrap any func to produce a retried version:
//
//	retriedGet := retry.Decorate(
//	    func(ctx context.Context, url string) (*http.Response, error) {
//	        return http.Get(url)
//	    },
//	    retry.WithMaxAttempts(3),
//	    retry.WithFixedInterval(500*time.Millisecond),
//	)
//	resp, err := retriedGet(ctx, "https://example.com")
package retry

import (
	"context"
	"errors"
	"fmt"
	"math"
	"math/rand/v2"
	"strings"
	"time"
)

// Sentinel errors returned by the retry package.
var (
	// ErrMaxAttemptsExceeded is returned when all attempts are exhausted
	// and the last error is nil (e.g. OnRetry hook cancelled the loop).
	ErrMaxAttemptsExceeded = errors.New("retry: max attempts exceeded")

	// ErrNoOperation is returned when Do is called with a nil operation.
	ErrNoOperation = errors.New("retry: operation must not be nil")
)

// Operation is a function that the retry framework will attempt to execute.
type Operation func(ctx context.Context) error

// Backoff computes the delay before the next attempt.
// attempt is zero-based: 0 means the delay before the 1st retry (after the
// 1st attempt failed), 1 means the delay before the 2nd retry, etc.
type Backoff interface {
	NextDelay(attempt int) time.Duration
}

// ──────────────────────────────────────────────
// Built-in backoff strategies
// ──────────────────────────────────────────────

// ExponentialBackoff delays grow exponentially: base * factor^attempt,
// capped at maxDelay. When jitter is enabled, a random fraction of the
// computed delay is added (±25%) to avoid synchronized retry storms.
type ExponentialBackoff struct {
	Base     time.Duration // initial delay (must be > 0)
	MaxDelay time.Duration // upper bound (0 = no cap)
	Factor   float64       // multiplier per attempt (e.g. 2.0)
	Jitter   bool          // add ±25% random jitter
}

// NewExponentialBackoff is a convenience constructor with sensible defaults.
//   - base: initial delay
//   - maxDelay: upper bound (use 0 for no cap)
//   - factor: growth multiplier (typically 2.0)
//   - jitter: enable random jitter
func NewExponentialBackoff(base, maxDelay time.Duration, factor float64, jitter bool) *ExponentialBackoff {
	if base <= 0 {
		base = 100 * time.Millisecond
	}
	if factor <= 1.0 {
		factor = 2.0
	}
	return &ExponentialBackoff{Base: base, MaxDelay: maxDelay, Factor: factor, Jitter: jitter}
}

// NextDelay returns the delay for the given attempt (0-based).
func (e *ExponentialBackoff) NextDelay(attempt int) time.Duration {
	if attempt < 0 {
		attempt = 0
	}
	// delay = base * factor^attempt
	mult := math.Pow(e.Factor, float64(attempt))
	delay := time.Duration(float64(e.Base) * mult)

	if e.MaxDelay > 0 && delay > e.MaxDelay {
		delay = e.MaxDelay
	}

	if e.Jitter && delay > 0 {
		// ±25% jitter
		jitterRange := delay / 4
		offset := time.Duration(rand.Int64N(int64(jitterRange*2))) - jitterRange
		delay += offset
		if delay < 0 {
			delay = 0
		}
	}

	return delay
}

// FixedInterval is a backoff strategy that always returns the same delay.
type FixedInterval struct {
	Interval time.Duration
}

// NewFixedInterval creates a FixedInterval with the given delay.
// If interval <= 0 it defaults to 100ms.
func NewFixedInterval(interval time.Duration) *FixedInterval {
	if interval <= 0 {
		interval = 100 * time.Millisecond
	}
	return &FixedInterval{Interval: interval}
}

// NextDelay returns the constant interval.
func (f *FixedInterval) NextDelay(_ int) time.Duration {
	return f.Interval
}

// NoBackoff is a backoff strategy with zero delay — retry immediately.
type NoBackoff struct{}

// NextDelay returns zero.
func (NoBackoff) NextDelay(_ int) time.Duration { return 0 }

// ──────────────────────────────────────────────
// Options
// ──────────────────────────────────────────────

// CircuitBreaker is an optional interface that retry can integrate with.
// If set via WithCircuitBreaker, each attempt is wrapped in the breaker's
// Execute. When the breaker is open, the retry loop stops immediately
// with the breaker's error (e.g. ErrCircuitOpen).
//
// The circuitbreaker package's *CircuitBreaker satisfies this interface.
type CircuitBreaker interface {
	Execute(ctx context.Context, op func(context.Context) error) error
}

// Options configures the retry behaviour.
type Options struct {
	// MaxAttempts is the total number of attempts (including the first).
	// 0 or 1 means a single attempt with no retries.
	// < 0 means retry indefinitely until ctx is cancelled or timeout.
	MaxAttempts int

	// Timeout is the overall deadline for all attempts combined.
	// 0 means no overall timeout (rely on the caller's context).
	Timeout time.Duration

	// Backoff strategy. If nil, NoBackoff is used.
	Backoff Backoff

	// RetryIf decides whether an error is retryable.
	// If nil, all non-nil errors are retried.
	RetryIf func(error) bool

	// CircuitBreaker wraps each attempt. If the breaker is open, the
	// retry loop stops immediately. Optional.
	CircuitBreaker CircuitBreaker

	// OnRetry is called before each retry attempt (not before the first).
	// attempt is the 1-based index of the upcoming attempt.
	OnRetry func(attempt int, err error)

	// OnSuccess is called after a successful attempt (if ever).
	// attempts is the total number of attempts made (>= 1).
	OnSuccess func(attempts int)

	// OnError is called after all attempts are exhausted with the last error.
	OnError func(attempts int, err error)
}

// Option is a functional option for configuring Options.
type Option func(*Options)

// WithMaxAttempts sets the total number of attempts (including the first).
// Set to 0 or 1 for a single attempt. Set to a negative value for unlimited
// retries (until context cancellation or timeout).
func WithMaxAttempts(n int) Option {
	return func(o *Options) { o.MaxAttempts = n }
}

// WithTimeout sets the overall deadline for all attempts combined.
func WithTimeout(d time.Duration) Option {
	return func(o *Options) { o.Timeout = d }
}

// WithBackoff sets the backoff strategy.
func WithBackoff(b Backoff) Option {
	return func(o *Options) { o.Backoff = b }
}

// WithExponentialBackoff is a convenience that sets an ExponentialBackoff.
func WithExponentialBackoff(base, maxDelay time.Duration, factor float64, jitter bool) Option {
	return WithBackoff(NewExponentialBackoff(base, maxDelay, factor, jitter))
}

// WithFixedInterval is a convenience that sets a FixedInterval backoff.
func WithFixedInterval(interval time.Duration) Option {
	return WithBackoff(NewFixedInterval(interval))
}

// WithNoBackoff retries immediately with no delay.
func WithNoBackoff() Option {
	return WithBackoff(NoBackoff{})
}

// WithRetryIf sets a predicate that filters which errors are retryable.
func WithRetryIf(fn func(error) bool) Option {
	return func(o *Options) { o.RetryIf = fn }
}

// WithCircuitBreaker wraps each attempt in the given circuit breaker.
// When the breaker is open, the retry loop stops immediately with the
// breaker's error. This enables the pattern: retry handles transient
// failures within a single call, while the circuit breaker prevents
// cascading failures across calls to the same dependency.
func WithCircuitBreaker(cb CircuitBreaker) Option {
	return func(o *Options) { o.CircuitBreaker = cb }
}

// WithOnRetry sets a callback invoked before each retry.
func WithOnRetry(fn func(attempt int, err error)) Option {
	return func(o *Options) { o.OnRetry = fn }
}

// WithOnSuccess sets a callback invoked after a successful attempt.
func WithOnSuccess(fn func(attempts int)) Option {
	return func(o *Options) { o.OnSuccess = fn }
}

// WithOnError sets a callback invoked when all attempts are exhausted.
func WithOnError(fn func(attempts int, err error)) Option {
	return func(o *Options) { o.OnError = fn }
}

// ──────────────────────────────────────────────
// Core execution
// ──────────────────────────────────────────────

// Do executes the given operation with retry logic according to opts.
//
// The operation is called at least once. If it returns a non-nil error that
// satisfies RetryIf (or all errors if RetryIf is nil), the framework waits
// according to the Backoff strategy and tries again, up to MaxAttempts.
//
// If the context is cancelled or the overall Timeout is reached, Do returns
// immediately with the context/timeout error (or the last operation error,
// whichever is more descriptive).
func Do(ctx context.Context, op Operation, opts ...Option) error {
	if op == nil {
		return ErrNoOperation
	}

	cfg := applyOptions(opts)

	// Apply overall timeout if configured.
	if cfg.Timeout > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, cfg.Timeout)
		defer cancel()
	}

	if cfg.Backoff == nil {
		cfg.Backoff = NoBackoff{}
	}

	retryIf := cfg.RetryIf
	if retryIf == nil {
		retryIf = func(error) bool { return true }
	}

	var lastErr error
	attempts := 0

	for {
		attempts++

		// Check context before each attempt.
		if err := ctx.Err(); err != nil {
			if lastErr != nil {
				return fmt.Errorf("%w (last error: %v)", err, lastErr)
			}
			return err
		}

		// Execute the operation — optionally through a circuit breaker.
		var err error
		if cfg.CircuitBreaker != nil {
			err = cfg.CircuitBreaker.Execute(ctx, op)
		} else {
			err = op(ctx)
		}

		if err == nil {
			if cfg.OnSuccess != nil {
				cfg.OnSuccess(attempts)
			}
			return nil
		}

		lastErr = err

		// If the circuit breaker is open, stop immediately — no retry.
		// The breaker's error (e.g. ErrCircuitOpen) is returned directly.
		if cfg.CircuitBreaker != nil && isCircuitOpen(err) {
			if cfg.OnError != nil {
				cfg.OnError(attempts, err)
			}
			return err
		}

		// Non-retryable error — stop immediately.
		if !retryIf(err) {
			if cfg.OnError != nil {
				cfg.OnError(attempts, err)
			}
			return err
		}

		// Check if we've exhausted attempts.
		// MaxAttempts <= 0 means unlimited (only bounded by ctx/timeout).
		if cfg.MaxAttempts > 0 && attempts >= cfg.MaxAttempts {
			if cfg.OnError != nil {
				cfg.OnError(attempts, err)
			}
			return fmt.Errorf("%w (after %d attempts, last error: %v)", ErrMaxAttemptsExceeded, attempts, err)
		}

		// Notify retry callback.
		if cfg.OnRetry != nil {
			cfg.OnRetry(attempts+1, err)
		}

		// Compute and wait for backoff delay.
		delay := cfg.Backoff.NextDelay(attempts - 1)
		if delay > 0 {
			timer := time.NewTimer(delay)
			select {
			case <-ctx.Done():
				timer.Stop()
				if lastErr != nil {
					return fmt.Errorf("%w (last error: %v)", ctx.Err(), lastErr)
				}
				return ctx.Err()
			case <-timer.C:
			}
		}
	}
}

// ──────────────────────────────────────────────
// Decorator pattern
// ──────────────────────────────────────────────

// Decorate wraps a function with retry logic, returning a new function with
// the same signature. This enables the decorator pattern:
//
//	retriedFn := retry.Decorate(
//	    func(ctx context.Context, x int) (int, error) { return risky(x) },
//	    retry.WithMaxAttempts(3),
//	    retry.WithFixedInterval(100*time.Millisecond),
//	)
//	result, err := retriedFn(ctx, 42)
func Decorate[T any, R any](
	fn func(ctx context.Context, args T) (R, error),
	opts ...Option,
) func(ctx context.Context, args T) (R, error) {
	return func(ctx context.Context, args T) (R, error) {
		var result R
		err := Do(ctx, func(ctx context.Context) error {
			r, e := fn(ctx, args)
			if e == nil {
				result = r
			}
			return e
		}, opts...)
		return result, err
	}
}

// Decorate0 wraps a function with no arguments and no return value.
func Decorate0(
	fn func(ctx context.Context) error,
	opts ...Option,
) func(ctx context.Context) error {
	return func(ctx context.Context) error {
		return Do(ctx, fn, opts...)
	}
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

func applyOptions(opts []Option) Options {
	cfg := Options{
		MaxAttempts: 3, // sensible default
	}
	for _, opt := range opts {
		opt(&cfg)
	}
	return cfg
}

// IsMaxAttempts reports whether err is (or wraps) ErrMaxAttemptsExceeded.
func IsMaxAttempts(err error) bool {
	return errors.Is(err, ErrMaxAttemptsExceeded)
}

// isCircuitOpen checks if an error is a circuit-open error. We use a string
// check rather than importing the circuitbreaker package to avoid a circular
// dependency. The circuitbreaker package's ErrCircuitOpen has the message
// "circuitbreaker: circuit is open"; we match on a stable substring so the
// check still works even if the error is wrapped or the prefix changes.
func isCircuitOpen(err error) bool {
	if err == nil {
		return false
	}
	return strings.Contains(err.Error(), "circuit is open")
}
