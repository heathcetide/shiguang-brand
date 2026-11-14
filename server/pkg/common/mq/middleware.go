// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package mq

import (
	"context"
	"fmt"
	"log/slog"
	"runtime/debug"
	"time"
)

// ============================================================
// RecoverMiddleware
// ============================================================

// RecoverMiddleware recovers from panics in the handler, logs the panic,
// and returns an error so the message is Nacked (and potentially
// requeued or dead-lettered).
func RecoverMiddleware(log *slog.Logger) Middleware {
	return func(next Handler) Handler {
		return func(ctx context.Context, d Delivery) (err error) {
			defer func() {
				if r := recover(); r != nil {
					if log != nil {
						log.ErrorContext(ctx, "mq: handler panic recovered",
							"panic", fmt.Sprint(r),
							"stack", string(debug.Stack()),
							"routing_key", d.RoutingKey(),
						)
					}
					err = fmt.Errorf("mq: handler panic: %v", r)
				}
			}()
			return next(ctx, d)
		}
	}
}

// ============================================================
// LoggingMiddleware
// ============================================================

// LoggingMiddleware logs each delivery before and after processing.
func LoggingMiddleware(log *slog.Logger) Middleware {
	return func(next Handler) Handler {
		return func(ctx context.Context, d Delivery) error {
			start := time.Now()
			if log != nil {
				log.InfoContext(ctx, "mq: consuming message",
					"routing_key", d.RoutingKey(),
					"exchange", d.Exchange(),
					"redelivered", d.Redelivered(),
				)
			}
			err := next(ctx, d)
			if log != nil {
				log.InfoContext(ctx, "mq: consumed message",
					"routing_key", d.RoutingKey(),
					"duration_ms", time.Since(start).Milliseconds(),
					"error", err,
				)
			}
			return err
		}
	}
}

// ============================================================
// MetricsMiddleware
// ============================================================

// MetricsMiddleware records delivery metrics in the given collector.
func MetricsMiddleware(collector *MetricsCollector) Middleware {
	return func(next Handler) Handler {
		return func(ctx context.Context, d Delivery) error {
			if collector != nil {
				collector.RecordConsume()
				if d.Redelivered() {
					collector.RecordRedelivered()
				}
			}
			err := next(ctx, d)
			if collector != nil && err != nil {
				collector.RecordError()
			}
			return err
		}
	}
}

// ============================================================
// RetryMiddleware
// ============================================================

// RetryConfig configures RetryMiddleware.
type RetryConfig struct {
	// MaxAttempts is the maximum number of delivery attempts (including
	// the first). Default: 3.
	MaxAttempts int

	// Backoff is the delay between retries. If BackoffFn is set, it
	// takes precedence. Default: 1s.
	Backoff time.Duration

	// BackoffFn is an optional function that computes the backoff for
	// a given attempt (1-based). If set, Backoff is ignored.
	BackoffFn func(attempt int) time.Duration
}

// DefaultRetryConfig returns sensible retry defaults.
func DefaultRetryConfig() RetryConfig {
	return RetryConfig{
		MaxAttempts: 3,
		Backoff:     1 * time.Second,
	}
}

// RetryMiddleware retries failed deliveries up to MaxAttempts. After
// exhausting retries, the original error is returned so the message
// can be Nacked/dead-lettered.
//
// Note: this middleware tracks attempts in-memory. For broker-level
// redelivery, rely on Nack(requeue=true) instead.
func RetryMiddleware(cfg RetryConfig) Middleware {
	if cfg.MaxAttempts < 1 {
		cfg.MaxAttempts = 1
	}
	if cfg.Backoff <= 0 && cfg.BackoffFn == nil {
		cfg.Backoff = 1 * time.Second
	}
	return func(next Handler) Handler {
		return func(ctx context.Context, d Delivery) error {
			var lastErr error
			for attempt := 1; attempt <= cfg.MaxAttempts; attempt++ {
				lastErr = next(ctx, d)
				if lastErr == nil {
					return nil
				}
				if ctx.Err() != nil {
					return ctx.Err()
				}
				if attempt < cfg.MaxAttempts {
					var wait time.Duration
					if cfg.BackoffFn != nil {
						wait = cfg.BackoffFn(attempt)
					} else {
						wait = cfg.Backoff * time.Duration(attempt)
					}
					select {
					case <-time.After(wait):
					case <-ctx.Done():
						return ctx.Err()
					}
				}
			}
			return fmt.Errorf("mq: retry exhausted after %d attempts: %w",
				cfg.MaxAttempts, lastErr)
		}
	}
}

// ============================================================
// DeadLetterMiddleware
// ============================================================

// DeadLetterMiddleware routes failed deliveries to a dead-letter handler
// and ACKs the original message so it is not redelivered.
func DeadLetterMiddleware(dlqHandler Handler) Middleware {
	return func(next Handler) Handler {
		return func(ctx context.Context, d Delivery) error {
			err := next(ctx, d)
			if err != nil && dlqHandler != nil {
				_ = dlqHandler(ctx, d)
				_ = d.Ack()
				return nil
			}
			return err
		}
	}
}

// ============================================================
// Chain
// ============================================================

// Chain composes multiple middleware into a single middleware.
// The first middleware in the slice is the outermost.
func Chain(mw ...Middleware) Middleware {
	if len(mw) == 0 {
		return func(next Handler) Handler { return next }
	}
	return func(next Handler) Handler {
		for i := len(mw) - 1; i >= 0; i-- {
			next = mw[i](next)
		}
		return next
	}
}
