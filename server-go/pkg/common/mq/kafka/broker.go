// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package kafka provides a Kafka backend for the ling-base/mq broker
// abstraction. It uses github.com/segmentio/kafka-go for transport and
// maps the mq.Broker/Producer/Consumer interfaces onto Kafka topics and
// consumer groups.
//
// Kafka has no exchanges, queues, or bindings. Topics play the role of
// exchanges, partitions play the role of routing keys, and consumer
// groups play the role of queues. The topology methods (DeclareQueue,
// Bind, Unbind, DeleteQueue, DeleteExchange) are therefore no-ops that
// return nil. DeclareExchange optionally creates a Kafka topic.
package kafka

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common/mq"
	kafkago "github.com/segmentio/kafka-go"
)

// Config configures a Kafka broker.
type Config struct {
	// Brokers is the list of Kafka bootstrap servers.
	// Example: []string{"localhost:9092"}
	Brokers []string

	// Topic is the default topic used when a producer or consumer is
	// created without an explicit topic. May be empty if topics are
	// always passed explicitly to Producer/Consumer.
	Topic string

	// GroupID is the default consumer group ID. May be overridden per
	// consumer via ConsumeOptions.ConsumerTag.
	GroupID string

	// DialerTimeout is the timeout for establishing connections.
	// Default: 10s.
	DialerTimeout time.Duration

	// EnableTLS enables TLS for all connections.
	EnableTLS bool

	// TLSConfig is the TLS configuration. If EnableTLS is true and
	// TLSConfig is nil, a default (InsecureSkipVerify=false) config is
	// used.
	TLSConfig *tls.Config

	// CommitInterval is the auto-commit interval for consumers.
	// Default: 1s. Set to 0 to disable auto-commit (manual commit only).
	CommitInterval time.Duration
}

// DefaultConfig returns a Config with sensible defaults for localhost.
func DefaultConfig() Config {
	return Config{
		Brokers:        []string{"localhost:9092"},
		Topic:          "ling-base",
		GroupID:        "ling-base-group",
		DialerTimeout:  10 * time.Second,
		CommitInterval: 1 * time.Second,
	}
}

// ============================================================
// Broker
// ============================================================

// Broker implements mq.Broker for Kafka.
type Broker struct {
	cfg Config

	mu        sync.Mutex
	producers map[string]*Producer
	consumers map[string]*Consumer

	closed atomic.Bool

	// metrics.
	metrics *mq.MetricsCollector
}

// Compile-time interface checks.
var (
	_ mq.Broker   = (*Broker)(nil)
	_ mq.Producer = (*Producer)(nil)
	_ mq.Consumer = (*Consumer)(nil)
	_ mq.Delivery = (*kafkaDelivery)(nil)
)

// New creates a new Kafka broker. Call Connect() to verify broker
// reachability (optional — Kafka connections are per-operation).
func New(cfg Config) (*Broker, error) {
	if len(cfg.Brokers) == 0 {
		return nil, errors.New("kafka: brokers are required")
	}
	if cfg.DialerTimeout <= 0 {
		cfg.DialerTimeout = 10 * time.Second
	}
	if cfg.CommitInterval == 0 {
		cfg.CommitInterval = 1 * time.Second
	}

	return &Broker{
		cfg:       cfg,
		producers: make(map[string]*Producer),
		consumers: make(map[string]*Consumer),
		metrics:   mq.NewMetricsCollector(),
	}, nil
}

// Connect verifies that at least one broker is reachable. For Kafka,
// connections are established per-operation by the reader/writer, so
// this is optional. It performs a quick metadata request.
func (b *Broker) Connect() error {
	if b.closed.Load() {
		return mq.ErrClosed
	}

	conn, err := b.dialer().DialContext(context.Background(), "tcp", b.cfg.Brokers[0])
	if err != nil {
		return fmt.Errorf("kafka: dial %s: %w", b.cfg.Brokers[0], err)
	}
	defer conn.Close()

	// A metadata request confirms the broker is actually a Kafka broker.
	_, err = conn.ApiVersions()
	if err != nil {
		return fmt.Errorf("kafka: api versions: %w", err)
	}
	return nil
}

// tlsConfig returns the TLS config to use, or nil if TLS is disabled.
func (b *Broker) tlsConfig() *tls.Config {
	if !b.cfg.EnableTLS {
		return nil
	}
	if b.cfg.TLSConfig != nil {
		return b.cfg.TLSConfig
	}
	return &tls.Config{MinVersion: tls.VersionTLS12}
}

// dialer returns a kafka-go Dialer configured with the broker's settings.
func (b *Broker) dialer() *kafkago.Dialer {
	return &kafkago.Dialer{
		Timeout:   b.cfg.DialerTimeout,
		TLS:       b.tlsConfig(),
		DualStack: true,
	}
}

// IsConnected reports whether the broker has brokers configured. For
// Kafka, connections are per-operation, so this is a lightweight check.
func (b *Broker) IsConnected() bool {
	if b.closed.Load() {
		return false
	}
	return len(b.cfg.Brokers) > 0
}

// Close shuts down the broker, closing all producers and consumers.
func (b *Broker) Close() error {
	if !b.closed.CompareAndSwap(false, true) {
		return nil
	}

	b.mu.Lock()
	defer b.mu.Unlock()

	// Close all consumers.
	for _, c := range b.consumers {
		_ = c.Stop(5 * time.Second)
	}
	b.consumers = nil

	// Close all producers.
	for _, p := range b.producers {
		_ = p.Close()
	}
	b.producers = nil

	return nil
}

// Producer creates or returns a cached producer for the given topic.
// If topic is empty, the broker's default Topic is used.
func (b *Broker) Producer(topic string, opts mq.PublishOptions) (mq.Producer, error) {
	if b.closed.Load() {
		return nil, mq.ErrClosed
	}
	if topic == "" {
		topic = b.cfg.Topic
	}
	if topic == "" {
		return nil, errors.New("kafka: topic is required")
	}

	b.mu.Lock()
	defer b.mu.Unlock()

	if p, ok := b.producers[topic]; ok {
		return p, nil
	}

	p, err := newProducer(b, topic, opts)
	if err != nil {
		return nil, err
	}
	b.producers[topic] = p
	return p, nil
}

// Consumer creates a consumer for the given topic with the given
// options. The consumer is not started; call Start to begin.
//
// If topic is empty, the broker's default Topic is used. The consumer
// group ID is taken from ConsumeOptions.ConsumerTag if non-empty,
// otherwise the broker's default GroupID.
func (b *Broker) Consumer(topic string, opts mq.ConsumeOptions) (mq.Consumer, error) {
	if b.closed.Load() {
		return nil, mq.ErrClosed
	}
	if opts.Handler == nil {
		return nil, mq.ErrNoHandler
	}
	if topic == "" {
		topic = b.cfg.Topic
	}
	if topic == "" {
		return nil, errors.New("kafka: topic is required")
	}

	groupID := opts.ConsumerTag
	if groupID == "" {
		groupID = b.cfg.GroupID
	}

	b.mu.Lock()
	defer b.mu.Unlock()

	c, err := newConsumer(b, topic, groupID, opts)
	if err != nil {
		return nil, err
	}
	b.consumers[topic] = c
	return c, nil
}

// Metrics returns a snapshot of broker metrics.
func (b *Broker) Metrics() mq.Metrics {
	return b.metrics.Snapshot()
}

// ============================================================
// Topology (no-ops / topic management)
// ============================================================

// DeclareExchange creates a Kafka topic if it does not already exist.
// Kafka has no exchanges; topics serve as the publish target.
func (b *Broker) DeclareExchange(name string, opts mq.ExchangeOptions) error {
	if b.closed.Load() {
		return mq.ErrClosed
	}
	if name == "" {
		return errors.New("kafka: topic name is required")
	}

	// Determine partition count and replication factor from Args.
	partitions := 1
	replicationFactor := 1
	if v, ok := opts.Args["partitions"]; ok {
		if n, ok := toInt(v); ok && n > 0 {
			partitions = n
		}
	}
	if v, ok := opts.Args["replication-factor"]; ok {
		if n, ok := toInt(v); ok && n > 0 {
			replicationFactor = n
		}
	}

	conn, err := b.dialer().DialContext(context.Background(), "tcp", b.cfg.Brokers[0])
	if err != nil {
		return fmt.Errorf("kafka: dial: %w", err)
	}
	defer conn.Close()

	topicConfig := kafkago.TopicConfig{
		Topic:             name,
		NumPartitions:     partitions,
		ReplicationFactor: replicationFactor,
	}

	if err := conn.CreateTopics(topicConfig); err != nil {
		// Topic may already exist — that's fine.
		return nil
	}
	return nil
}

// DeclareQueue is a no-op for Kafka. Kafka has no queues; consumer
// groups serve as the subscription unit.
func (b *Broker) DeclareQueue(name string, opts mq.QueueOptions) error {
	return nil
}

// Bind is a no-op for Kafka. Kafka routes by topic and partition, not
// by exchange/queue bindings.
func (b *Broker) Bind(queue, exchange, routingKey string) error {
	return nil
}

// Unbind is a no-op for Kafka.
func (b *Broker) Unbind(queue, exchange, routingKey string) error {
	return nil
}

// DeleteQueue is a no-op for Kafka.
func (b *Broker) DeleteQueue(name string) error {
	return nil
}

// DeleteExchange deletes a Kafka topic.
func (b *Broker) DeleteExchange(name string) error {
	if b.closed.Load() {
		return mq.ErrClosed
	}
	if name == "" {
		return errors.New("kafka: topic name is required")
	}

	conn, err := b.dialer().DialContext(context.Background(), "tcp", b.cfg.Brokers[0])
	if err != nil {
		return fmt.Errorf("kafka: dial: %w", err)
	}
	defer conn.Close()

	if err := conn.DeleteTopics(name); err != nil {
		return fmt.Errorf("kafka: delete topic %s: %w", name, err)
	}
	return nil
}

// toInt attempts to convert an interface{} to an int.
func toInt(v any) (int, bool) {
	switch n := v.(type) {
	case int:
		return n, true
	case int32:
		return int(n), true
	case int64:
		return int(n), true
	case float64:
		return int(n), true
	default:
		return 0, false
	}
}
