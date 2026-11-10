// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package rocketmq provides a RocketMQ backend for the ling-base/mq
// broker abstraction. It wraps the official apache/rocketmq-client-go/v2
// client, mapping the broker-agnostic mq.Message / mq.Delivery / mq.Producer
// / mq.Consumer / mq.Broker interfaces onto RocketMQ topics, producer
// groups and push consumers.
//
// RocketMQ has no concept of exchanges, queues or bindings in the AMQP
// sense: it routes messages purely by topic (and optionally tag/sharding
// key). The topology-management methods on mq.Broker (DeclareExchange,
// DeclareQueue, Bind, Unbind, DeleteQueue, DeleteExchange) are therefore
// implemented as no-ops that return nil, except that DeclareExchange
// records the topic name so that producers can publish to it.
package rocketmq

import (
	"errors"
	"sync"
	"sync/atomic"

	"github.com/heathcetide/DietDigiDose/pkg/common/mq"
	rocketmq "github.com/apache/rocketmq-client-go/v2"
	"github.com/apache/rocketmq-client-go/v2/consumer"
	"github.com/apache/rocketmq-client-go/v2/primitive"
	"github.com/apache/rocketmq-client-go/v2/producer"
)

// Credentials holds the ACL credentials for a RocketMQ cluster.
type Credentials struct {
	// AccessKey is the ACL access key.
	AccessKey string

	// SecretKey is the ACL secret key.
	SecretKey string

	// SecurityToken is an optional temporary security token.
	SecurityToken string
}

// Config configures a RocketMQ broker.
type Config struct {
	// NameServer is the list of name-server addresses
	// (e.g. []string{"127.0.0.1:9876"}). Required.
	NameServer []string

	// GroupName is the default producer/consumer group name.
	// Default: "DEFAULT_PRODUCER" / "DEFAULT_CONSUMER".
	GroupName string

	// InstanceName is the client instance name. If empty the
	// client uses the process host name.
	InstanceName string

	// Credentials are the optional ACL credentials.
	Credentials Credentials

	// RetryCount is the number of retries on send failure.
	// Default: 2.
	RetryCount int
}

// DefaultConfig returns a Config with sensible defaults for a local
// name server. The NameServer field is left empty and must be set
// before calling New.
func DefaultConfig() Config {
	return Config{
		NameServer: []string{"127.0.0.1:9876"},
		GroupName:  "DEFAULT_PRODUCER",
		RetryCount: 2,
	}
}

// ============================================================
// Broker
// ============================================================

// Broker implements mq.Broker for RocketMQ.
type Broker struct {
	cfg Config

	mu        sync.RWMutex
	connected atomic.Bool
	closed    atomic.Bool

	// producers and consumers cache.
	producers sync.Map // map[string]*Producer
	consumers sync.Map // map[string]*Consumer

	// topics recorded via DeclareExchange (no-op topology).
	topics sync.Map // map[string]struct{}

	// metrics.
	metrics *mq.MetricsCollector
}

// New creates a new RocketMQ broker. Call Connect() to initialize the
// underlying RocketMQ client.
func New(cfg Config) (*Broker, error) {
	if len(cfg.NameServer) == 0 {
		return nil, errors.New("rocketmq: NameServer is required")
	}
	if cfg.GroupName == "" {
		cfg.GroupName = "DEFAULT_PRODUCER"
	}
	if cfg.RetryCount <= 0 {
		cfg.RetryCount = 2
	}

	return &Broker{
		cfg:     cfg,
		metrics: mq.NewMetricsCollector(),
	}, nil
}

// Connect initializes the RocketMQ client. RocketMQ clients are lazy:
// producers and consumers are created on demand, so Connect simply
// marks the broker as ready. A lightweight name-server resolver is
// validated here so that an invalid configuration is reported early.
func (b *Broker) Connect() error {
	if b.closed.Load() {
		return mq.ErrClosed
	}
	if b.connected.Load() {
		return nil
	}

	// Validate the name-server addresses by constructing a resolver.
	// This catches empty/invalid configurations before any producer or
	// consumer is created.
	if len(b.cfg.NameServer) == 0 {
		return errors.New("rocketmq: NameServer is required")
	}
	_ = primitive.NewPassthroughResolver(b.cfg.NameServer)

	b.connected.Store(true)
	return nil
}

// IsConnected reports whether the broker is currently connected.
func (b *Broker) IsConnected() bool {
	return b.connected.Load() && !b.closed.Load()
}

// Close shuts down the broker, closing all producers and consumers.
func (b *Broker) Close() error {
	if !b.closed.CompareAndSwap(false, true) {
		return nil
	}

	// Close all consumers.
	b.consumers.Range(func(key, value any) bool {
		if c, ok := value.(*Consumer); ok {
			_ = c.Stop(0)
		}
		return true
	})

	// Close all producers.
	b.producers.Range(func(key, value any) bool {
		if p, ok := value.(*Producer); ok {
			_ = p.Close()
		}
		return true
	})

	b.connected.Store(false)
	return nil
}

// Metrics returns a snapshot of broker metrics.
func (b *Broker) Metrics() mq.Metrics {
	return b.metrics.Snapshot()
}

// ============================================================
// Topology (no-ops — RocketMQ routes by topic)
// ============================================================

// DeclareExchange records a topic name. RocketMQ auto-creates topics
// on first publish (when autoCreateTopicEnable is on at the broker),
// so this is effectively a no-op that simply remembers the name.
func (b *Broker) DeclareExchange(name string, opts mq.ExchangeOptions) error {
	if b.closed.Load() {
		return mq.ErrClosed
	}
	if name == "" {
		return errors.New("rocketmq: topic name is required")
	}
	b.topics.Store(name, struct{}{})
	return nil
}

// DeclareQueue is a no-op: RocketMQ has no AMQP-style queues.
func (b *Broker) DeclareQueue(name string, opts mq.QueueOptions) error {
	if b.closed.Load() {
		return mq.ErrClosed
	}
	return nil
}

// Bind is a no-op: RocketMQ routing is topic-based.
func (b *Broker) Bind(queue, exchange, routingKey string) error {
	if b.closed.Load() {
		return mq.ErrClosed
	}
	return nil
}

// Unbind is a no-op: RocketMQ routing is topic-based.
func (b *Broker) Unbind(queue, exchange, routingKey string) error {
	if b.closed.Load() {
		return mq.ErrClosed
	}
	return nil
}

// DeleteQueue is a no-op: RocketMQ has no AMQP-style queues.
func (b *Broker) DeleteQueue(name string) error {
	if b.closed.Load() {
		return mq.ErrClosed
	}
	return nil
}

// DeleteExchange removes a recorded topic from the in-memory registry.
// It does not delete the topic from the broker.
func (b *Broker) DeleteExchange(name string) error {
	if b.closed.Load() {
		return mq.ErrClosed
	}
	b.topics.Delete(name)
	return nil
}

// ============================================================
// Producer / Consumer creation
// ============================================================

// Producer creates or returns a cached producer for the given topic.
func (b *Broker) Producer(topic string, opts mq.PublishOptions) (mq.Producer, error) {
	if b.closed.Load() {
		return nil, mq.ErrClosed
	}
	if !b.IsConnected() {
		return nil, mq.ErrNotConnected
	}
	if topic == "" {
		return nil, errors.New("rocketmq: topic is required")
	}

	if v, ok := b.producers.Load(topic); ok {
		return v.(*Producer), nil
	}

	p := &Producer{
		broker: b,
		topic:  topic,
		opts:   opts,
	}
	if err := p.start(); err != nil {
		return nil, err
	}

	actual, loaded := b.producers.LoadOrStore(topic, p)
	if loaded {
		_ = p.Close()
		return actual.(*Producer), nil
	}
	return p, nil
}

// Consumer creates a consumer for the given topic with the given options.
// The consumer is not started; call Start to begin consuming.
func (b *Broker) Consumer(topic string, opts mq.ConsumeOptions) (mq.Consumer, error) {
	if b.closed.Load() {
		return nil, mq.ErrClosed
	}
	if !b.IsConnected() {
		return nil, mq.ErrNotConnected
	}
	if opts.Handler == nil {
		return nil, mq.ErrNoHandler
	}
	if topic == "" {
		return nil, errors.New("rocketmq: topic is required")
	}

	c := &Consumer{
		broker: b,
		topic:  topic,
		opts:   opts,
	}
	if opts.Concurrency <= 0 {
		c.opts.Concurrency = 1
	}

	// Apply middleware chain.
	c.handler = mq.Chain(opts.Middleware...)(opts.Handler)

	b.consumers.Store(topic, c)
	return c, nil
}

// newProducer creates a rocketmq producer with the broker's config.
func (b *Broker) newProducer() (rocketmq.Producer, error) {
	opts := []producer.Option{
		producer.WithGroupName(b.cfg.GroupName),
		producer.WithNsResolver(primitive.NewPassthroughResolver(b.cfg.NameServer)),
		producer.WithRetry(b.cfg.RetryCount),
	}
	if b.cfg.InstanceName != "" {
		opts = append(opts, producer.WithInstanceName(b.cfg.InstanceName))
	}
	if !b.cfg.Credentials.isEmpty() {
		opts = append(opts, producer.WithCredentials(primitive.Credentials{
			AccessKey:     b.cfg.Credentials.AccessKey,
			SecretKey:     b.cfg.Credentials.SecretKey,
			SecurityToken: b.cfg.Credentials.SecurityToken,
		}))
	}
	return rocketmq.NewProducer(opts...)
}

// newConsumer creates a rocketmq push consumer with the broker's config.
func (b *Broker) newConsumer(group string) (rocketmq.PushConsumer, error) {
	if group == "" {
		group = b.cfg.GroupName
	}
	opts := []consumer.Option{
		consumer.WithGroupName(group),
		consumer.WithNsResolver(primitive.NewPassthroughResolver(b.cfg.NameServer)),
	}
	if b.cfg.InstanceName != "" {
		opts = append(opts, consumer.WithInstance(b.cfg.InstanceName))
	}
	if !b.cfg.Credentials.isEmpty() {
		opts = append(opts, consumer.WithCredentials(primitive.Credentials{
			AccessKey:     b.cfg.Credentials.AccessKey,
			SecretKey:     b.cfg.Credentials.SecretKey,
			SecurityToken: b.cfg.Credentials.SecurityToken,
		}))
	}
	return rocketmq.NewPushConsumer(opts...)
}

// isEmpty reports whether the credentials are unset.
func (c Credentials) isEmpty() bool {
	return c.AccessKey == "" || c.SecretKey == ""
}

// Compile-time interface compliance checks.
var (
	_ mq.Broker   = (*Broker)(nil)
	_ mq.Producer = (*Producer)(nil)
	_ mq.Consumer = (*Consumer)(nil)
	_ mq.Delivery = (*Delivery)(nil)
)
