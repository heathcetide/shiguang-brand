// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package mq

import (
	"context"
	"encoding/json"
	"fmt"
	"time"
)

// ============================================================
// BatchPublisher
// ============================================================

// BatchPublisher publishes multiple messages in a single broker
// transaction or network round-trip. Not all backends support batching;
// use PublishBatch as a fallback that calls Publish sequentially.
type BatchPublisher interface {
	PublishBatch(ctx context.Context, msgs []*Message) error
}

// PublishBatch is a fallback helper that publishes messages one by one
// using a standard Producer. Backends that support native batching
// should implement BatchPublisher directly.
func PublishBatch(ctx context.Context, p Producer, msgs []*Message) error {
	if p == nil {
		return fmt.Errorf("mq: producer is nil")
	}
	for i, msg := range msgs {
		if err := p.Publish(ctx, msg); err != nil {
			return fmt.Errorf("mq: batch publish failed at index %d: %w", i, err)
		}
	}
	return nil
}

// ============================================================
// JSON message helpers
// ============================================================

// NewJSONMessage creates a Message with a JSON-encoded body and
// ContentType set to "application/json".
func NewJSONMessage(payload any) (*Message, error) {
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("mq: marshal json: %w", err)
	}
	return &Message{
		Body:        body,
		ContentType: "application/json",
		Timestamp:   time.Now(),
	}, nil
}

// DecodeJSON decodes the delivery body into the target type.
func DecodeJSON(d Delivery, target any) error {
	if d == nil {
		return fmt.Errorf("mq: delivery is nil")
	}
	if err := json.Unmarshal(d.Body(), target); err != nil {
		return fmt.Errorf("mq: unmarshal json: %w", err)
	}
	return nil
}

// DecodeJSONBody decodes a raw message body into the target type.
func DecodeJSONBody(body []byte, target any) error {
	if err := json.Unmarshal(body, target); err != nil {
		return fmt.Errorf("mq: unmarshal json: %w", err)
	}
	return nil
}

// ============================================================
// HealthChecker
// ============================================================

// HealthChecker is implemented by brokers that support health checks.
// The Check method returns nil if the broker is healthy, or an error
// describing the problem.
type HealthChecker interface {
	Check(ctx context.Context) error
}

// HealthStatus describes the health of a broker.
type HealthStatus struct {
	Healthy   bool          `json:"healthy"`
	Backend   string        `json:"backend"`
	Error     string        `json:"error,omitempty"`
	Latency   time.Duration `json:"latency,omitempty"`
	Connected bool          `json:"connected"`
}

// String returns a human-readable health status.
func (h HealthStatus) String() string {
	if h.Healthy {
		return fmt.Sprintf("healthy (%s, connected=%v, latency=%v)", h.Backend, h.Connected, h.Latency)
	}
	return fmt.Sprintf("unhealthy (%s: %s)", h.Backend, h.Error)
}

// CheckHealth performs a health check with a timeout. If the broker
// implements HealthChecker, its Check method is called. Otherwise,
// IsConnected is used as a fallback.
func CheckHealth(ctx context.Context, b Broker, backend string) HealthStatus {
	start := time.Now()

	// Try HealthChecker interface first.
	if hc, ok := b.(HealthChecker); ok {
		if err := hc.Check(ctx); err != nil {
			return HealthStatus{
				Healthy:   false,
				Backend:   backend,
				Error:     err.Error(),
				Connected: b.IsConnected(),
				Latency:   time.Since(start),
			}
		}
		return HealthStatus{
			Healthy:   true,
			Backend:   backend,
			Connected: b.IsConnected(),
			Latency:   time.Since(start),
		}
	}

	// Fallback: use IsConnected.
	connected := b.IsConnected()
	return HealthStatus{
		Healthy:   connected,
		Backend:   backend,
		Connected: connected,
		Latency:   time.Since(start),
	}
}

// ============================================================
// Topology builder
// ============================================================

// Topology is a fluent builder for declaring exchanges, queues, and
// bindings on a broker. It collects declarations and applies them in
// order when Apply is called.
type Topology struct {
	broker Broker
	err    error

	exchanges []topologyExchange
	queues    []topologyQueue
	binds     []topologyBind
}

type topologyExchange struct {
	name string
	opts ExchangeOptions
}

type topologyQueue struct {
	name string
	opts QueueOptions
}

type topologyBind struct {
	queue      string
	exchange   string
	routingKey string
}

// NewTopology creates a new Topology builder for the given broker.
func NewTopology(b Broker) *Topology {
	return &Topology{broker: b}
}

// Exchange declares an exchange.
func (t *Topology) Exchange(name string, opts ...ExchangeOptions) *Topology {
	if t.err != nil {
		return t
	}
	o := DefaultExchangeOptions()
	if len(opts) > 0 {
		o = opts[0]
	}
	t.exchanges = append(t.exchanges, topologyExchange{name: name, opts: o})
	return t
}

// Queue declares a queue.
func (t *Topology) Queue(name string, opts ...QueueOptions) *Topology {
	if t.err != nil {
		return t
	}
	o := DefaultQueueOptions()
	if len(opts) > 0 {
		o = opts[0]
	}
	t.queues = append(t.queues, topologyQueue{name: name, opts: o})
	return t
}

// Bind binds a queue to an exchange.
func (t *Topology) Bind(queue, exchange, routingKey string) *Topology {
	if t.err != nil {
		return t
	}
	t.binds = append(t.binds, topologyBind{
		queue:      queue,
		exchange:   exchange,
		routingKey: routingKey,
	})
	return t
}

// Apply executes all collected declarations in order: exchanges first,
// then queues, then bindings. Returns the first error encountered.
func (t *Topology) Apply() error {
	if t.err != nil {
		return t.err
	}
	if t.broker == nil {
		return fmt.Errorf("mq: broker is nil")
	}

	for _, e := range t.exchanges {
		if err := t.broker.DeclareExchange(e.name, e.opts); err != nil {
			return fmt.Errorf("mq: declare exchange %q: %w", e.name, err)
		}
	}

	for _, q := range t.queues {
		if err := t.broker.DeclareQueue(q.name, q.opts); err != nil {
			return fmt.Errorf("mq: declare queue %q: %w", q.name, err)
		}
	}

	for _, b := range t.binds {
		if err := t.broker.Bind(b.queue, b.exchange, b.routingKey); err != nil {
			return fmt.Errorf("mq: bind %q to %q with %q: %w",
				b.queue, b.exchange, b.routingKey, err)
		}
	}

	return nil
}

// MustApply is like Apply but panics on error.
func (t *Topology) MustApply() {
	if err := t.Apply(); err != nil {
		panic(err)
	}
}

// Reset clears all collected declarations.
func (t *Topology) Reset() *Topology {
	t.exchanges = nil
	t.queues = nil
	t.binds = nil
	t.err = nil
	return t
}

// ============================================================
// Dead-letter configuration helpers
// ============================================================

// WithDeadLetter configures a queue to route dead-lettered messages to
// the specified exchange and routing key. This is RabbitMQ-specific
// (x-dead-letter-exchange / x-dead-letter-routing-key arguments) but
// the pattern is common across brokers.
func WithDeadLetter(opts QueueOptions, dlxExchange, dlxRoutingKey string) QueueOptions {
	if opts.Args == nil {
		opts.Args = make(map[string]any)
	}
	opts.Args["x-dead-letter-exchange"] = dlxExchange
	if dlxRoutingKey != "" {
		opts.Args["x-dead-letter-routing-key"] = dlxRoutingKey
	}
	return opts
}

// WithMessageTTL configures a queue with a message time-to-live.
// Messages that expire are dead-lettered (if DLX is configured) or
// discarded.
func WithMessageTTL(opts QueueOptions, ttl time.Duration) QueueOptions {
	if opts.Args == nil {
		opts.Args = make(map[string]any)
	}
	opts.Args["x-message-ttl"] = ttl.Milliseconds()
	return opts
}

// WithQueueTTL configures a queue that is automatically deleted after
// the specified period of inactivity (no consumers).
func WithQueueTTL(opts QueueOptions, ttl time.Duration) QueueOptions {
	if opts.Args == nil {
		opts.Args = make(map[string]any)
	}
	opts.Args["x-expires"] = ttl.Milliseconds()
	return opts
}

// WithMaxPriority configures a queue to support priority messages.
// The maxPriority value should be between 1 and 255.
func WithMaxPriority(opts QueueOptions, maxPriority int) QueueOptions {
	if opts.Args == nil {
		opts.Args = make(map[string]any)
	}
	opts.Args["x-max-priority"] = maxPriority
	return opts
}
