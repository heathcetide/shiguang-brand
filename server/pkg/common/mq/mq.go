// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package mq provides a broker-agnostic message queue abstraction with
// pluggable backends (RabbitMQ, Redis Streams, Kafka, NATS, …).
//
// # Architecture
//
//   - Message:   a unit of data with headers, payload, and metadata.
//   - Delivery:  a Message received by a consumer, with ACK/Nack/Reject
//     semantics.
//   - Producer:  publishes messages to an exchange/topic.
//   - Consumer:  subscribes to a queue/topic and dispatches deliveries
//     to a Handler.
//   - Broker:    manages connections, declares topology, and creates
//     producers and consumers.
//   - Handler:   processes a Delivery.
//   - Middleware:wraps Handlers for retry, logging, metrics, dead-letter, etc.
//
// # Backends
//
//   - rabbitmq/ — RabbitMQ via amqp091-go (exchange/queue/binding, QoS,
//     publisher confirms, auto-reconnect)
//
// # Basic usage
//
//	broker, _ := rabbitmq.New(rabbitmq.Config{URL: "amqp://guest:guest@localhost:5672/"})
//	defer broker.Close()
//
//	producer, _ := broker.Producer("events", mq.PublishOptions{})
//	_ = producer.Publish(ctx, &mq.Message{
//	    Body: []byte(`{"event":"user.created"}`),
//	})
//
//	consumer, _ := broker.Consumer("events.queue", mq.ConsumeOptions{
//	    Handler: func(ctx context.Context, d mq.Delivery) error {
//	        fmt.Println(string(d.Body))
//	        return d.Ack()
//	    },
//	})
//	_ = consumer.Start(ctx)
package mq

import (
	"context"
	"errors"
	"time"
)

// ============================================================
// Errors
// ============================================================

// ErrClosed is returned when an operation is attempted on a closed
// broker/producer/consumer.
var ErrClosed = errors.New("mq: broker closed")

// ErrNotConnected is returned when the broker is not connected.
var ErrNotConnected = errors.New("mq: not connected")

// ErrAlreadyRunning is returned by Consumer.Start when the consumer is
// already running.
var ErrAlreadyRunning = errors.New("mq: consumer already running")

// ErrNoHandler is returned when a consumer is started without a handler.
var ErrNoHandler = errors.New("mq: no handler configured")

// ============================================================
// Message
// ============================================================

// Message is a unit of data published to the broker.
type Message struct {
	// ID is a unique identifier. If empty, the broker may generate one.
	ID string

	// Exchange is the target exchange (RabbitMQ) or topic (Kafka/NATS).
	// If empty, the producer's default exchange is used.
	Exchange string

	// RoutingKey is used by RabbitMQ to route the message.
	RoutingKey string

	// Headers are arbitrary key-value metadata.
	Headers map[string]any

	// Body is the raw message payload.
	Body []byte

	// ContentType is the MIME type of Body (e.g. "application/json").
	ContentType string

	// ContentEncoding is the encoding of Body (e.g. "gzip").
	ContentEncoding string

	// Priority is the message priority (0-9 for RabbitMQ).
	Priority uint8

	// CorrelationID is used for request/reply patterns.
	CorrelationID string

	// ReplyTo is the reply-to queue for RPC patterns.
	ReplyTo string

	// Expiration is the message TTL. Zero means no expiration.
	Expiration time.Duration

	// Timestamp is the message creation time. If zero, time.Now() is used.
	Timestamp time.Time

	// Type is a message type hint (optional).
	Type string

	// UserID is the user ID for RabbitMQ authenticated publishing.
	UserID string

	// AppID is the publishing application ID.
	AppID string

	// DeliveryMode selects persistent vs transient. Default: Persistent.
	DeliveryMode DeliveryMode
}

// DeliveryMode selects message persistence.
type DeliveryMode int

const (
	// Transient means the message is not persisted to disk.
	Transient DeliveryMode = 1
	// Persistent means the message is persisted to disk (survives broker restart).
	Persistent DeliveryMode = 2
)

// ============================================================
// Delivery
// ============================================================

// Delivery is a Message received by a consumer. It provides ACK/Nack/Reject
// semantics for at-least-once or exactly-once processing.
type Delivery interface {
	// Message returns the underlying message.
	Message() *Message

	// Body returns the raw payload (convenience shortcut).
	Body() []byte

	// Headers returns the message headers.
	Headers() map[string]any

	// RoutingKey returns the routing key.
	RoutingKey() string

	// Exchange returns the source exchange.
	Exchange() string

	// Redelivered reports whether this message has been delivered before.
	Redelivered() bool

	// DeliveryTag is the broker-specific delivery tag.
	DeliveryTag() uint64

	// Ack acknowledges successful processing. The message is removed
	// from the queue.
	Ack() error

	// Nack negatively acknowledges the message. If requeue is true, the
	// message is requeued for redelivery; otherwise it is discarded or
	// routed to a dead-letter exchange (if configured).
	Nack(requeue bool) error

	// Reject rejects the message. If requeue is true, the message is
	// requeued. Reject is similar to Nack but typically does not support
	// multiple flag.
	Reject(requeue bool) error
}

// ============================================================
// Handler and Middleware
// ============================================================

// Handler processes a Delivery. Returning a nil error implies the message
// was processed successfully and the broker will ACK. Returning a non-nil
// error triggers Nack with requeue (or dead-letter, depending on config).
//
// If the handler calls Ack/Nack/Reject explicitly, the framework will
// NOT auto-ACK. Use HandlerFunc to convert a function to Handler.
type Handler func(ctx context.Context, d Delivery) error

// Middleware wraps a Handler, adding cross-cutting behavior.
type Middleware func(next Handler) Handler

// ============================================================
// Producer
// ============================================================

// Producer publishes messages to the broker.
type Producer interface {
	// Publish sends a message. If msg.ID is empty, a UUID is generated.
	// If msg.Timestamp is zero, time.Now() is used.
	Publish(ctx context.Context, msg *Message) error

	// Close releases producer resources. After Close, Publish returns
	// ErrClosed.
	Close() error
}

// ============================================================
// Consumer
// ============================================================

// Consumer subscribes to a queue and dispatches deliveries to a Handler.
type Consumer interface {
	// Start begins consuming. The consumer runs until ctx is cancelled
	// or Stop is called. Start is idempotent if already running.
	Start(ctx context.Context) error

	// Stop gracefully stops consuming, waiting for in-flight handlers
	// to complete up to the given timeout. A zero timeout returns
	// immediately after signalling.
	Stop(timeout time.Duration) error

	// IsRunning reports whether the consumer is actively consuming.
	IsRunning() bool
}

// ============================================================
// Broker
// ============================================================

// Broker manages connections and creates producers and consumers.
type Broker interface {
	// Connect establishes the connection to the broker.
	Connect() error

	// IsConnected reports whether the broker is currently connected.
	IsConnected() bool

	// Close shuts down the broker, closing all producers and consumers
	// and releasing the connection.
	Close() error

	// Producer creates or returns a cached producer for the given
	// exchange/topic.
	Producer(exchange string, opts PublishOptions) (Producer, error)

	// Consumer creates a consumer for the given queue with the given
	// options. The consumer is not started; call Start to begin.
	Consumer(queue string, opts ConsumeOptions) (Consumer, error)

	// DeclareExchange declares an exchange (RabbitMQ) or topic (Kafka).
	DeclareExchange(name string, opts ExchangeOptions) error

	// DeclareQueue declares a queue.
	DeclareQueue(name string, opts QueueOptions) error

	// Bind binds a queue to an exchange with a routing key.
	Bind(queue, exchange, routingKey string) error

	// Unbind removes a binding.
	Unbind(queue, exchange, routingKey string) error

	// DeleteQueue removes a queue.
	DeleteQueue(name string) error

	// DeleteExchange removes an exchange.
	DeleteExchange(name string) error
}

// ============================================================
// Options
// ============================================================

// PublishOptions configures a producer.
type PublishOptions struct {
	// Mandatory: if true, the broker returns an unroutable message
	// instead of silently dropping it.
	Mandatory bool

	// Immediate is a RabbitMQ-specific flag (deprecated in AMQP 0-9-1).
	Immediate bool

	// Persistent sets the default delivery mode for messages without
	// an explicit DeliveryMode.
	Persistent bool

	// Confirm enables publisher confirms (RabbitMQ).
	Confirm bool
}

// ConsumeOptions configures a consumer.
type ConsumeOptions struct {
	// Handler processes each delivery. Required.
	Handler Handler

	// Middleware wraps the handler. Applied in order: the first
	// middleware is the outermost.
	Middleware []Middleware

	// AutoAck: if true, messages are auto-acknowledged on delivery
	// (fire-and-forget). Default: false (manual ACK).
	AutoAck bool

	// QosPrefetchCount is the maximum number of unacknowledged
	// deliveries. Default: 10.
	QosPrefetchCount int

	// QosPrefetchSize is the maximum total bytes of unacknowledged
	// deliveries. Default: 0 (unlimited).
	QosPrefetchSize int

	// QosGlobal: if true, QoS applies to the entire channel, not just
	// the consumer. Default: false.
	QosGlobal bool

	// Concurrency is the number of goroutines processing deliveries.
	// Default: 1. Set > 1 for parallel processing.
	Concurrency int

	// ConsumerTag identifies this consumer in broker logs.
	ConsumerTag string

	// Exclusive: if true, only this consumer can access the queue.
	Exclusive bool

	// Args are additional broker-specific arguments (e.g. x-headers).
	Args map[string]any
}

// ExchangeOptions configures an exchange declaration.
type ExchangeOptions struct {
	// Kind is the exchange type: "direct", "topic", "fanout", "headers".
	// Default: "topic".
	Kind string

	// Durable: if true, the exchange survives broker restarts.
	// Default: true.
	Durable bool

	// AutoDelete: if true, the exchange is deleted when no queues are
	// bound. Default: false.
	AutoDelete bool

	// Internal: if true, the exchange cannot be published to directly
	// (RabbitMQ). Default: false.
	Internal bool

	// NoWait: if true, do not wait for a broker confirmation.
	// Default: false.
	NoWait bool

	// Args are additional broker-specific arguments.
	Args map[string]any
}

// DefaultExchangeOptions returns sensible defaults for an exchange.
func DefaultExchangeOptions() ExchangeOptions {
	return ExchangeOptions{
		Kind:       "topic",
		Durable:    true,
		AutoDelete: false,
		Internal:   false,
		NoWait:     false,
	}
}

// QueueOptions configures a queue declaration.
type QueueOptions struct {
	// Durable: if true, the queue survives broker restarts.
	// Default: true.
	Durable bool

	// AutoDelete: if true, the queue is deleted when the last consumer
	// disconnects. Default: false.
	AutoDelete bool

	// Exclusive: if true, the queue is only accessible by the declaring
	// connection and is deleted when the connection closes.
	// Default: false.
	Exclusive bool

	// NoWait: if true, do not wait for a broker confirmation.
	// Default: false.
	NoWait bool

	// Args are additional broker-specific arguments (e.g.
	// "x-message-ttl", "x-dead-letter-exchange").
	Args map[string]any
}

// DefaultQueueOptions returns sensible defaults for a queue.
func DefaultQueueOptions() QueueOptions {
	return QueueOptions{
		Durable:    true,
		AutoDelete: false,
		Exclusive:  false,
		NoWait:     false,
	}
}

// ============================================================
// Metrics
// ============================================================

// Metrics is a point-in-time snapshot of broker observability data.
type Metrics struct {
	Published    int64
	Consumed     int64
	Acked        int64
	Nacked       int64
	Rejected     int64
	Redelivered  int64
	Errors       int64
	AvgPublishMs float64
	AvgConsumeMs float64
}

// MetricsCollector is a thread-safe metrics collector.
type MetricsCollector struct {
	published   atomicCounter
	consumed    atomicCounter
	acked       atomicCounter
	nacked      atomicCounter
	rejected    atomicCounter
	redelivered atomicCounter
	errors      atomicCounter
}

// Snapshot returns a point-in-time copy of the metrics.
func (m *MetricsCollector) Snapshot() Metrics {
	return Metrics{
		Published:   m.published.load(),
		Consumed:    m.consumed.load(),
		Acked:       m.acked.load(),
		Nacked:      m.nacked.load(),
		Rejected:    m.rejected.load(),
		Redelivered: m.redelivered.load(),
		Errors:      m.errors.load(),
	}
}
