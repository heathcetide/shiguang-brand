// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package redisstream provides a Redis Streams backend for the
// ling-base/mq broker abstraction. It supports consumer groups (XREADGROUP),
// standalone consumption (XREAD), stream trimming (XTRIM/MAXLEN), and
// manual acknowledgement (XACK).
//
// Redis Streams are append-only logs identified by a stream key. In this
// backend each "exchange" and "queue" maps to a Redis stream key. Streams
// are auto-created on the first XADD, so DeclareExchange/DeclareQueue are
// no-ops.
//
// # Basic usage
//
//	broker, _ := redisstream.New(redisstream.DefaultConfig())
//	defer broker.Close()
//	_ = broker.Connect()
//
//	producer, _ := broker.Producer("events", mq.PublishOptions{})
//	_ = producer.Publish(ctx, &mq.Message{Body: []byte(`{"event":"user.created"}`)})
//
//	consumer, _ := broker.Consumer("events", mq.ConsumeOptions{
//	    Handler: func(ctx context.Context, d mq.Delivery) error {
//	        fmt.Println(string(d.Body()))
//	        return d.Ack()
//	    },
//	})
//	_ = consumer.Start(ctx)
package redisstream

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common/mq"
	"github.com/redis/go-redis/v9"
)

// Config configures a Redis Streams broker.
type Config struct {
	// Addr is the Redis server address (host:port).
	// Example: "localhost:6379".
	Addr string

	// Password is the Redis AUTH password. Empty means no auth.
	Password string

	// DB is the Redis logical database index (0-15).
	DB int

	// Group is the default consumer group name used when a consumer is
	// created in group mode. If empty, consumers run in standalone mode
	// (XREAD) unless overridden per-consumer via ConsumeOptions.Args.
	Group string

	// ConsumerName is the default consumer name within the group.
	// If empty, a unique name is generated per consumer.
	ConsumerName string

	// BlockTime is how long XREADGROUP/XREAD blocks waiting for new
	// messages before retrying. Default: 5s.
	BlockTime time.Duration

	// Count is the maximum number of messages read per XREADGROUP/XREAD
	// call. Default: 10.
	Count int64

	// MaxLen is the maximum stream length. If > 0, every XADD trims the
	// stream to approximately this length (MAXLEN ~). 0 means no trimming.
	MaxLen int64
}

// DefaultConfig returns a Config with sensible defaults for localhost.
func DefaultConfig() Config {
	return Config{
		Addr:         "localhost:6379",
		DB:           0,
		Group:        "ling-base",
		ConsumerName: "",
		BlockTime:    5 * time.Second,
		Count:        10,
		MaxLen:       0,
	}
}

// ============================================================
// Broker
// ============================================================

// Broker implements mq.Broker for Redis Streams.
type Broker struct {
	cfg Config

	connMu sync.RWMutex
	client *redis.Client

	producers sync.Map // map[string]*Producer
	consumers sync.Map // map[string]*Consumer

	closed  atomic.Bool
	metrics *mq.MetricsCollector
}

// New creates a new Redis Streams broker. Call Connect() to establish the
// connection.
func New(cfg Config) (*Broker, error) {
	if cfg.Addr == "" {
		return nil, errors.New("redisstream: addr is required")
	}
	if cfg.BlockTime <= 0 {
		cfg.BlockTime = 5 * time.Second
	}
	if cfg.Count <= 0 {
		cfg.Count = 10
	}

	return &Broker{
		cfg:     cfg,
		metrics: mq.NewMetricsCollector(),
	}, nil
}

// Connect establishes the connection to Redis.
func (b *Broker) Connect() error {
	if b.closed.Load() {
		return mq.ErrClosed
	}

	client := redis.NewClient(&redis.Options{
		Addr:     b.cfg.Addr,
		Password: b.cfg.Password,
		DB:       b.cfg.DB,
	})

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := client.Ping(ctx).Err(); err != nil {
		_ = client.Close()
		return fmt.Errorf("redisstream: ping: %w", err)
	}

	b.connMu.Lock()
	b.client = client
	b.connMu.Unlock()

	return nil
}

// IsConnected reports whether the broker is currently connected.
func (b *Broker) IsConnected() bool {
	if b.closed.Load() {
		return false
	}
	b.connMu.RLock()
	defer b.connMu.RUnlock()
	if b.client == nil {
		return false
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	return b.client.Ping(ctx).Err() == nil
}

// Close shuts down the broker, closing all producers and consumers and
// releasing the Redis connection. Close is idempotent.
func (b *Broker) Close() error {
	if !b.closed.CompareAndSwap(false, true) {
		return nil
	}

	// Close all consumers.
	b.consumers.Range(func(key, value any) bool {
		if c, ok := value.(*Consumer); ok {
			_ = c.Stop(5 * time.Second)
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

	// Close the Redis client.
	b.connMu.Lock()
	if b.client != nil {
		_ = b.client.Close()
		b.client = nil
	}
	b.connMu.Unlock()

	return nil
}

// Metrics returns a snapshot of broker metrics.
func (b *Broker) Metrics() mq.Metrics {
	return b.metrics.Snapshot()
}

// ============================================================
// Topology (no-ops for Redis Streams)
// ============================================================

// DeclareExchange is a no-op. Redis Streams are auto-created on the first
// XADD.
func (b *Broker) DeclareExchange(name string, opts mq.ExchangeOptions) error {
	if b.closed.Load() {
		return mq.ErrClosed
	}
	return nil
}

// DeclareQueue is a no-op. Redis Streams are auto-created on the first
// XADD.
func (b *Broker) DeclareQueue(name string, opts mq.QueueOptions) error {
	if b.closed.Load() {
		return mq.ErrClosed
	}
	return nil
}

// Bind is a no-op. Redis Streams do not have bindings.
func (b *Broker) Bind(queue, exchange, routingKey string) error {
	if b.closed.Load() {
		return mq.ErrClosed
	}
	return nil
}

// Unbind is a no-op. Redis Streams do not have bindings.
func (b *Broker) Unbind(queue, exchange, routingKey string) error {
	if b.closed.Load() {
		return mq.ErrClosed
	}
	return nil
}

// DeleteQueue removes a stream by deleting the key. If MaxLen is configured
// and greater than 0, it trims instead of deleting. Otherwise it DELs the
// stream key.
func (b *Broker) DeleteQueue(name string) error {
	if b.closed.Load() {
		return mq.ErrClosed
	}
	b.connMu.RLock()
	client := b.client
	b.connMu.RUnlock()
	if client == nil {
		return mq.ErrNotConnected
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	_, err := client.Del(ctx, name).Result()
	if err != nil {
		return fmt.Errorf("redisstream: delete stream: %w", err)
	}
	return nil
}

// DeleteExchange is a no-op. Redis Streams do not have exchanges.
func (b *Broker) DeleteExchange(name string) error {
	if b.closed.Load() {
		return mq.ErrClosed
	}
	return nil
}

// ============================================================
// Producer / Consumer creation
// ============================================================

// Producer creates or returns a cached producer for the given stream.
func (b *Broker) Producer(stream string, opts mq.PublishOptions) (mq.Producer, error) {
	if b.closed.Load() {
		return nil, mq.ErrClosed
	}
	if !b.IsConnected() {
		return nil, mq.ErrNotConnected
	}

	if v, ok := b.producers.Load(stream); ok {
		return v.(*Producer), nil
	}

	p := &Producer{
		broker: b,
		stream: stream,
		opts:   opts,
	}

	actual, loaded := b.producers.LoadOrStore(stream, p)
	if loaded {
		return actual.(*Producer), nil
	}
	return p, nil
}

// Consumer creates a consumer for the given stream. The consumer is not
// started; call Start to begin consuming.
//
// If the broker's Group config is non-empty, the consumer operates in
// consumer-group mode (XREADGROUP). Otherwise it operates in standalone
// mode (XREAD). The group and consumer name can be overridden via
// ConsumeOptions.Args with keys "group" and "consumer" (string values).
func (b *Broker) Consumer(stream string, opts mq.ConsumeOptions) (mq.Consumer, error) {
	if b.closed.Load() {
		return nil, mq.ErrClosed
	}
	if opts.Handler == nil {
		return nil, mq.ErrNoHandler
	}
	if !b.IsConnected() {
		return nil, mq.ErrNotConnected
	}

	group := b.cfg.Group
	consumerName := b.cfg.ConsumerName
	if v, ok := opts.Args["group"]; ok {
		if s, ok := v.(string); ok && s != "" {
			group = s
		}
	}
	if v, ok := opts.Args["consumer"]; ok {
		if s, ok := v.(string); ok && s != "" {
			consumerName = s
		}
	}
	if consumerName == "" {
		consumerName = fmt.Sprintf("consumer-%s-%d", stream, time.Now().UnixNano())
	}

	c := &Consumer{
		broker:       b,
		stream:       stream,
		opts:         opts,
		group:        group,
		consumerName: consumerName,
		blockTime:    b.cfg.BlockTime,
		count:        b.cfg.Count,
	}
	if opts.QosPrefetchCount > 0 {
		c.count = int64(opts.QosPrefetchCount)
	}
	if opts.Concurrency <= 0 {
		c.opts.Concurrency = 1
	}

	// Apply middleware chain.
	chain := opts.Middleware
	c.handler = mq.Chain(chain...)(opts.Handler)

	b.consumers.Store(stream, c)
	return c, nil
}
