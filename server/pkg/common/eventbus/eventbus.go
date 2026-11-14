// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package eventbus provides a lightweight in-process event bus with
// middleware support and observability metrics.
//
// This package is intentionally **memory-only** — it handles synchronous
// and asynchronous in-process pub/sub with wildcard topic matching.
// For cross-process, persistent, or broker-backed messaging (RabbitMQ,
// Kafka, RocketMQ, ActiveMQ, Redis Streams), use the [mq] package
// instead, which provides a unified Broker abstraction with pluggable
// backends.
//
// # Architecture
//
// The bus is built around three core concepts:
//
//   - Event:   a typed message with a name, timestamp, payload, and metadata.
//   - Handler: a function that processes events.
//   - Bus:     the central dispatcher that routes events to handlers.
//
// # Dispatch modes
//
//   - Sync      — Publish blocks until all handlers complete (default)
//   - Async     — Publish returns immediately; handlers run in background
//   - Parallel  — handlers run concurrently; Publish waits for all
//
// # Middleware
//
// Handlers can be wrapped with middleware for cross-cutting concerns:
//
//   - LoggingMiddleware   — structured logging of each event
//   - MetricsMiddleware   — per-handler count, latency, error rate
//   - RetryMiddleware     — automatic retry with backoff
//   - RecoverMiddleware   — panic recovery
//   - DeadLetterMiddleware— route failed events to a dead-letter handler
//
// # Observability
//
// Every Bus implementation exposes a Metrics snapshot:
//
//	m := bus.Metrics()
//	fmt.Println(m.Published, m.Delivered, m.Failed, m.AvgLatency)
//
// # Basic usage
//
//	bus := eventbus.NewBus()
//	defer bus.Close()
//
//	bus.Subscribe("user.created", func(ctx context.Context, e *eventbus.Event) error {
//	    log.Printf("user created: %s", e.Payload)
//	    return nil
//	})
//
//	bus.Publish(ctx, eventbus.New("user.created", userID))
package eventbus

import (
	"context"
	"fmt"
	"sync/atomic"
	"time"
)

// ============================================================
// Event
// ============================================================

// Event is a message published to the bus. It carries a name, timestamp,
// optional payload, and arbitrary metadata (headers).
type Event struct {
	// ID is a unique identifier for this event instance. Auto-generated
	// if empty.
	ID string `json:"id"`

	// Name is the event type, e.g. "user.created". Used for routing.
	Name string `json:"name"`

	// Time is when the event was created.
	Time time.Time `json:"time"`

	// Source is the originator of the event (optional, untyped).
	Source any `json:"source,omitempty"`

	// Payload is the event data (must be serializable for persistent backends).
	Payload any `json:"payload,omitempty"`

	// Headers are arbitrary key-value metadata.
	Headers map[string]string `json:"headers,omitempty"`

	// Attempt is the current delivery attempt (1-based). Incremented by
	// retry middleware.
	Attempt int `json:"attempt,omitempty"`
}

// New creates a new Event with the given name and payload.
func New(name string, payload any) *Event {
	return &Event{
		ID:      generateID(),
		Name:    name,
		Time:    time.Now(),
		Payload: payload,
		Attempt: 1,
	}
}

// NewWithSource creates a new Event with a source.
func NewWithSource(name string, source, payload any) *Event {
	e := New(name, payload)
	e.Source = source
	return e
}

// WithHeader adds a header and returns the event for chaining.
func (e *Event) WithHeader(key, val string) *Event {
	if e.Headers == nil {
		e.Headers = make(map[string]string)
	}
	e.Headers[key] = val
	return e
}

// String returns a human-readable representation.
func (e *Event) String() string {
	return fmt.Sprintf("Event[%s]#%s@%s", e.Name, e.ID, e.Time.Format(time.RFC3339Nano))
}

// ============================================================
// Handler
// ============================================================

// Handler processes a single event. Returning an error causes the event
// to be considered failed (subject to retry / dead-letter middleware).
type Handler func(ctx context.Context, e *Event) error

// Middleware wraps a Handler, adding cross-cutting behavior.
type Middleware func(next Handler) Handler

// ============================================================
// Bus interface
// ============================================================

// Bus is the core event bus interface. Every backend implements this.
type Bus interface {
	// Publish sends an event to all matching subscribers.
	// In sync mode, this blocks until all handlers complete.
	// In async mode, this returns immediately after enqueuing.
	Publish(ctx context.Context, e *Event) error

	// Subscribe registers a handler for the given topic.
	// Topic may contain wildcards:
	//   - "user.*"     matches "user.created", "user.deleted", etc.
	//   - "user.>"     matches "user.created", "user.profile.updated", etc.
	// Returns a Subscription that can be used to Unsubscribe.
	Subscribe(topic string, handler Handler) Subscription

	// Unsubscribe removes a subscription.
	Unsubscribe(sub Subscription) error

	// Close shuts down the bus, releasing all resources.
	// Pending events may be drained or dropped depending on the backend.
	Close() error

	// Metrics returns a snapshot of bus metrics.
	Metrics() Metrics
}

// Subscription represents an active subscription.
type Subscription interface {
	// ID returns the unique subscription identifier.
	ID() string
	// Topic returns the subscribed topic pattern.
	Topic() string
}

// ============================================================
// Metrics
// ============================================================

// Metrics is a point-in-time snapshot of bus observability data.
type Metrics struct {
	Published    int64         // total events published
	Delivered    int64         // total events delivered to handlers
	Failed       int64         // total handler failures
	Pending      int64         // events currently in-flight
	Subscribers  int64         // active subscriber count
	AvgLatency   time.Duration // average publish→deliver latency
	TotalLatency time.Duration // cumulative latency (for avg computation)
}

// Snapshot captures metrics atomically. Implementations should call this
// from their Metrics() method.
type MetricsCollector struct {
	published    atomic.Int64
	delivered    atomic.Int64
	failed       atomic.Int64
	pending      atomic.Int64
	subscribers  atomic.Int64
	totalLatency atomic.Int64 // nanoseconds
}

// RecordPublish increments the published counter.
func (m *MetricsCollector) RecordPublish() { m.published.Add(1) }

// RecordDelivered increments delivered and accumulates latency.
func (m *MetricsCollector) RecordDelivered(latency time.Duration) {
	m.delivered.Add(1)
	m.totalLatency.Add(int64(latency))
	m.pending.Add(-1)
}

// RecordFailed increments the failed counter.
func (m *MetricsCollector) RecordFailed() { m.failed.Add(1) }

// RecordPending increments the pending counter.
func (m *MetricsCollector) RecordPending() { m.pending.Add(1) }

// RecordSubscribe increments the subscriber counter.
func (m *MetricsCollector) RecordSubscribe() { m.subscribers.Add(1) }

// RecordUnsubscribe decrements the subscriber counter.
func (m *MetricsCollector) RecordUnsubscribe() { m.subscribers.Add(-1) }

// Snapshot returns the current metrics.
func (m *MetricsCollector) Snapshot() Metrics {
	pub := m.published.Load()
	del := m.delivered.Load()
	tot := m.totalLatency.Load()
	var avg time.Duration
	if del > 0 {
		avg = time.Duration(tot / del)
	}
	return Metrics{
		Published:    pub,
		Delivered:    del,
		Failed:       m.failed.Load(),
		Pending:      m.pending.Load(),
		Subscribers:  m.subscribers.Load(),
		TotalLatency: time.Duration(tot),
		AvgLatency:   avg,
	}
}

// ============================================================
// Subscription (base implementation)
// ============================================================

// sub is the default Subscription implementation.
type sub struct {
	id    string
	topic string
}

func (s *sub) ID() string    { return s.id }
func (s *sub) Topic() string { return s.topic }

// NewSubscription creates a Subscription with the given id and topic.
// This is intended for backend implementations.
func NewSubscription(id, topic string) Subscription {
	return &sub{id: id, topic: topic}
}

// ============================================================
// Helpers
// ============================================================

var idCounter atomic.Uint64

// generateID produces a unique event ID.
func generateID() string {
	n := idCounter.Add(1)
	return fmt.Sprintf("evt-%d-%d", time.Now().UnixNano(), n)
}

// GenerateID produces a unique event ID (exported for backend use).
func GenerateID() string {
	return generateID()
}

// ApplyMiddleware wraps a handler with the given middleware chain.
// Middleware are applied in order: the first middleware in the slice
// becomes the outermost wrapper.
func ApplyMiddleware(handler Handler, mw ...Middleware) Handler {
	for i := len(mw) - 1; i >= 0; i-- {
		handler = mw[i](handler)
	}
	return handler
}

// TopicMatches checks if a topic pattern matches an event name.
// Supports:
//   - exact match: "user.created" == "user.created"
//   - single-level wildcard: "user.*" matches "user.created" but not "user.profile.updated"
//   - multi-level wildcard: "user.>" matches "user.created" and "user.profile.updated"
func TopicMatches(pattern, name string) bool {
	if pattern == "*" || pattern == name {
		return true
	}
	pParts := splitTopic(pattern)
	nParts := splitTopic(name)

	for i, p := range pParts {
		if p == ">" {
			return true // matches everything after this point
		}
		if i >= len(nParts) {
			return false
		}
		if p == "*" {
			continue // matches any single level
		}
		if p != nParts[i] {
			return false
		}
	}
	return len(pParts) == len(nParts)
}

// splitTopic splits a dot-separated topic into parts.
func splitTopic(topic string) []string {
	var parts []string
	start := 0
	for i := 0; i < len(topic); i++ {
		if topic[i] == '.' {
			parts = append(parts, topic[start:i])
			start = i + 1
		}
	}
	parts = append(parts, topic[start:])
	return parts
}

// ============================================================
// Errors
// ============================================================

// ErrClosed is returned when publishing to a closed bus.
var ErrClosed = fmt.Errorf("eventbus: bus is closed")

// IsClosed reports whether err is a bus-closed error.
func IsClosed(err error) bool {
	return err == ErrClosed
}
