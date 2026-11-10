// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package eventbus

import (
	"context"
	"fmt"
	"log"
	"sync"
	"time"
)

// ============================================================
// LoggingMiddleware
// ============================================================

// LoggingMiddleware logs each event before and after handler execution.
func LoggingMiddleware(logger *log.Logger) Middleware {
	if logger == nil {
		logger = log.Default()
	}
	return func(next Handler) Handler {
		return func(ctx context.Context, e *Event) error {
			logger.Printf("[eventbus] dispatching %s (attempt=%d)", e.String(), e.Attempt)
			start := time.Now()
			err := next(ctx, e)
			elapsed := time.Since(start)
			if err != nil {
				logger.Printf("[eventbus] handler failed for %s in %s: %v", e.Name, elapsed, err)
			} else {
				logger.Printf("[eventbus] handler ok for %s in %s", e.Name, elapsed)
			}
			return err
		}
	}
}

// ============================================================
// RecoverMiddleware
// ============================================================

// RecoverMiddleware catches panics in handlers and converts them to errors.
func RecoverMiddleware() Middleware {
	return func(next Handler) Handler {
		return func(ctx context.Context, e *Event) (err error) {
			defer func() {
				if r := recover(); r != nil {
					err = fmt.Errorf("eventbus: handler panicked for %s: %v", e.Name, r)
				}
			}()
			return next(ctx, e)
		}
	}
}

// ============================================================
// RetryMiddleware
// ============================================================

// RetryMiddleware retries a failed handler up to maxRetries times with
// the given backoff. The event's Attempt field is incremented on each retry.
func RetryMiddleware(maxRetries int, backoff time.Duration) Middleware {
	return func(next Handler) Handler {
		return func(ctx context.Context, e *Event) error {
			var lastErr error
			for i := 0; i <= maxRetries; i++ {
				e.Attempt = i + 1
				if err := next(ctx, e); err == nil {
					return nil
				} else {
					lastErr = err
				}
				if i < maxRetries {
					select {
					case <-time.After(backoff):
					case <-ctx.Done():
						return ctx.Err()
					}
				}
			}
			return lastErr
		}
	}
}

// ============================================================
// DeadLetterMiddleware
// ============================================================

// DeadLetterMiddleware routes events that fail after all retries to a
// dead-letter handler. This is useful for logging, alerting, or
// re-processing failed events.
func DeadLetterMiddleware(dlqHandler Handler) Middleware {
	return func(next Handler) Handler {
		return func(ctx context.Context, e *Event) error {
			err := next(ctx, e)
			if err != nil && dlqHandler != nil {
				// Send a copy to the DLQ with the error in headers.
				dlqEvent := *e
				if dlqEvent.Headers == nil {
					dlqEvent.Headers = make(map[string]string)
				}
				dlqEvent.Headers["x-error"] = err.Error()
				dlqEvent.Headers["x-dlq"] = "true"
				_ = dlqHandler(ctx, &dlqEvent)
			}
			return err
		}
	}
}

// ============================================================
// MetricsMiddleware
// ============================================================

// HandlerMetrics tracks per-topic handler execution counts, errors, and latency.
type HandlerMetrics struct {
	Calls   map[string]int64
	Errors  map[string]int64
	Latency map[string]time.Duration
	mu      sync.RWMutex
}

// NewHandlerMetrics creates a HandlerMetrics collector.
func NewHandlerMetrics() *HandlerMetrics {
	return &HandlerMetrics{
		Calls:   make(map[string]int64),
		Errors:  make(map[string]int64),
		Latency: make(map[string]time.Duration),
	}
}

// Record records a handler call result.
func (h *HandlerMetrics) Record(topic string, latency time.Duration, err error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.Calls[topic]++
	h.Latency[topic] += latency
	if err != nil {
		h.Errors[topic]++
	}
}

// Get returns the metrics for a topic.
func (h *HandlerMetrics) Get(topic string) (calls int64, errors int64, avgLatency time.Duration) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	calls = h.Calls[topic]
	errors = h.Errors[topic]
	if calls > 0 {
		avgLatency = h.Latency[topic] / time.Duration(calls)
	}
	return
}

// Topics returns all tracked topic names.
func (h *HandlerMetrics) Topics() []string {
	h.mu.RLock()
	defer h.mu.RUnlock()
	topics := make([]string, 0, len(h.Calls))
	for t := range h.Calls {
		topics = append(topics, t)
	}
	return topics
}

// MetricsMiddleware wraps a handler with per-topic metrics collection.
func MetricsMiddleware(collector *HandlerMetrics) Middleware {
	return func(next Handler) Handler {
		return func(ctx context.Context, e *Event) error {
			start := time.Now()
			err := next(ctx, e)
			collector.Record(e.Name, time.Since(start), err)
			return err
		}
	}
}
