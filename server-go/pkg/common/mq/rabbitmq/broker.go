// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package rabbitmq provides a RabbitMQ backend for the ling-base/mq
// broker abstraction. It supports automatic reconnection, publisher
// confirms, QoS prefetch, concurrent consumers, and topology management.
package rabbitmq

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common/mq"
	amqp "github.com/rabbitmq/amqp091-go"
)

// Config configures a RabbitMQ broker.
type Config struct {
	// URL is the AMQP connection URL.
	// Example: "amqp://guest:guest@localhost:5672/"
	URL string

	// DialerTimeout is the timeout for establishing a connection.
	// Default: 10s.
	DialerTimeout time.Duration

	// ReconnectDelay is the delay between reconnection attempts.
	// Default: 5s.
	ReconnectDelay time.Duration

	// MaxReconnectAttempts is the maximum number of reconnection
	// attempts. 0 = unlimited.
	MaxReconnectAttempts int

	// Heartbeat is the AMQP heartbeat interval. Default: 10s.
	// Set to 0 to disable.
	Heartbeat time.Duration

	// ChannelCacheSize is the maximum number of channels cached per
	// connection. Default: 16.
	ChannelCacheSize int

	// Vhost is the RabbitMQ virtual host. If empty, uses the vhost
	// from the URL or "/".
	Vhost string
}

// DefaultConfig returns a Config with sensible defaults for localhost.
func DefaultConfig() Config {
	return Config{
		URL:              "amqp://guest:guest@localhost:5672/",
		DialerTimeout:    10 * time.Second,
		ReconnectDelay:   5 * time.Second,
		Heartbeat:        10 * time.Second,
		ChannelCacheSize: 16,
	}
}

// ============================================================
// Broker
// ============================================================

// Broker implements mq.Broker for RabbitMQ.
type Broker struct {
	cfg Config

	connMu sync.RWMutex
	conn   *amqp.Connection

	// channelPool is a simple channel pool for publishing/consuming.
	channelMu sync.Mutex
	channels  []*amqp.Channel

	// producers and consumers cache.
	producers sync.Map // map[string]*Producer
	consumers sync.Map // map[string]*Consumer

	// reconnection.
	reconnectMu  sync.Mutex
	reconnecting atomic.Bool
	closeCh      chan struct{}
	closed       atomic.Bool
	notifyClose  chan *amqp.Error

	// metrics.
	metrics *mq.MetricsCollector
}

// New creates a new RabbitMQ broker. Call Connect() to establish the
// connection.
func New(cfg Config) (*Broker, error) {
	if cfg.URL == "" {
		return nil, errors.New("rabbitmq: URL is required")
	}
	if cfg.DialerTimeout <= 0 {
		cfg.DialerTimeout = 10 * time.Second
	}
	if cfg.ReconnectDelay <= 0 {
		cfg.ReconnectDelay = 5 * time.Second
	}
	if cfg.Heartbeat < 0 {
		cfg.Heartbeat = 10 * time.Second
	}
	if cfg.ChannelCacheSize <= 0 {
		cfg.ChannelCacheSize = 16
	}

	return &Broker{
		cfg:     cfg,
		closeCh: make(chan struct{}),
		metrics: mq.NewMetricsCollector(),
	}, nil
}

// Connect establishes the connection to RabbitMQ.
func (b *Broker) Connect() error {
	if b.closed.Load() {
		return mq.ErrClosed
	}
	return b.connect()
}

func (b *Broker) connect() error {
	conn, err := amqp.DialConfig(b.cfg.URL, amqp.Config{
		Heartbeat: b.cfg.Heartbeat,
		Vhost:     b.cfg.Vhost,
		Dial:      dialer(b.cfg.DialerTimeout),
	})
	if err != nil {
		return fmt.Errorf("rabbitmq: dial: %w", err)
	}

	b.connMu.Lock()
	b.conn = conn
	b.connMu.Unlock()

	b.notifyClose = make(chan *amqp.Error, 1)
	conn.NotifyClose(b.notifyClose)

	go b.watchConnection()
	return nil
}

// watchConnection monitors the connection and triggers reconnection.
func (b *Broker) watchConnection() {
	select {
	case <-b.notifyClose:
		if b.closed.Load() {
			return
		}
		b.tryReconnect()
	case <-b.closeCh:
	}
}

// tryReconnect attempts to reconnect with backoff.
func (b *Broker) tryReconnect() {
	if !b.reconnecting.CompareAndSwap(false, true) {
		return
	}
	defer b.reconnecting.Store(false)

	for attempt := 1; ; attempt++ {
		if b.closed.Load() {
			return
		}
		if b.cfg.MaxReconnectAttempts > 0 && attempt > b.cfg.MaxReconnectAttempts {
			return
		}
		if err := b.connect(); err == nil {
			// Re-open channels for existing producers/consumers.
			b.recoverProducers()
			b.recoverConsumers()
			return
		}
		select {
		case <-time.After(b.cfg.ReconnectDelay):
		case <-b.closeCh:
			return
		}
	}
}

// recoverProducers reopens channels for all cached producers.
func (b *Broker) recoverProducers() {
	b.producers.Range(func(key, value any) bool {
		if p, ok := value.(*Producer); ok {
			_ = p.reopen()
		}
		return true
	})
}

// recoverConsumers restarts all cached consumers.
func (b *Broker) recoverConsumers() {
	b.consumers.Range(func(key, value any) bool {
		if c, ok := value.(*Consumer); ok {
			if c.running.Load() {
				_ = c.restart(context.Background())
			}
		}
		return true
	})
}

// IsConnected reports whether the broker is currently connected.
func (b *Broker) IsConnected() bool {
	b.connMu.RLock()
	defer b.connMu.RUnlock()
	return b.conn != nil && !b.conn.IsClosed()
}

// Close shuts down the broker.
func (b *Broker) Close() error {
	if !b.closed.CompareAndSwap(false, true) {
		return nil
	}
	close(b.closeCh)

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

	// Close all cached channels.
	b.channelMu.Lock()
	for _, ch := range b.channels {
		_ = ch.Close()
	}
	b.channels = nil
	b.channelMu.Unlock()

	// Close connection.
	b.connMu.Lock()
	if b.conn != nil {
		_ = b.conn.Close()
		b.conn = nil
	}
	b.connMu.Unlock()

	return nil
}

// getChannel returns a channel from the pool or creates a new one.
func (b *Broker) getChannel() (*amqp.Channel, error) {
	if !b.IsConnected() {
		return nil, mq.ErrNotConnected
	}

	b.channelMu.Lock()
	if len(b.channels) > 0 {
		ch := b.channels[len(b.channels)-1]
		b.channels = b.channels[:len(b.channels)-1]
		b.channelMu.Unlock()
		if !ch.IsClosed() {
			return ch, nil
		}
	} else {
		b.channelMu.Unlock()
	}

	b.connMu.RLock()
	conn := b.conn
	b.connMu.RUnlock()
	if conn == nil {
		return nil, mq.ErrNotConnected
	}
	return conn.Channel()
}

// putChannel returns a channel to the pool.
func (b *Broker) putChannel(ch *amqp.Channel) {
	if ch == nil || ch.IsClosed() {
		return
	}
	b.channelMu.Lock()
	if len(b.channels) < b.cfg.ChannelCacheSize {
		b.channels = append(b.channels, ch)
		b.channelMu.Unlock()
	} else {
		b.channelMu.Unlock()
		_ = ch.Close()
	}
}

// Metrics returns a snapshot of broker metrics.
func (b *Broker) Metrics() mq.Metrics {
	return b.metrics.Snapshot()
}

// ============================================================
// Topology
// ============================================================

// DeclareExchange declares an exchange.
func (b *Broker) DeclareExchange(name string, opts mq.ExchangeOptions) error {
	ch, err := b.getChannel()
	if err != nil {
		return err
	}
	defer b.putChannel(ch)

	if opts.Kind == "" {
		opts.Kind = "topic"
	}
	return ch.ExchangeDeclare(
		name,
		opts.Kind,
		opts.Durable,
		opts.AutoDelete,
		false, // internal
		opts.NoWait,
		opts.Args,
	)
}

// DeclareQueue declares a queue.
func (b *Broker) DeclareQueue(name string, opts mq.QueueOptions) error {
	ch, err := b.getChannel()
	if err != nil {
		return err
	}
	defer b.putChannel(ch)

	_, err = ch.QueueDeclare(
		name,
		opts.Durable,
		opts.AutoDelete,
		opts.Exclusive,
		opts.NoWait,
		opts.Args,
	)
	return err
}

// Bind binds a queue to an exchange.
func (b *Broker) Bind(queue, exchange, routingKey string) error {
	ch, err := b.getChannel()
	if err != nil {
		return err
	}
	defer b.putChannel(ch)
	return ch.QueueBind(queue, routingKey, exchange, false, nil)
}

// Unbind removes a binding.
func (b *Broker) Unbind(queue, exchange, routingKey string) error {
	ch, err := b.getChannel()
	if err != nil {
		return err
	}
	defer b.putChannel(ch)
	return ch.QueueUnbind(queue, routingKey, exchange, nil)
}

// DeleteQueue removes a queue.
func (b *Broker) DeleteQueue(name string) error {
	ch, err := b.getChannel()
	if err != nil {
		return err
	}
	defer b.putChannel(ch)
	_, err = ch.QueueDelete(name, false, false, false)
	return err
}

// DeleteExchange removes an exchange.
func (b *Broker) DeleteExchange(name string) error {
	ch, err := b.getChannel()
	if err != nil {
		return err
	}
	defer b.putChannel(ch)
	return ch.ExchangeDelete(name, false, false)
}

// ============================================================
// Producer / Consumer creation
// ============================================================

// Producer creates or returns a cached producer for the given exchange.
func (b *Broker) Producer(exchange string, opts mq.PublishOptions) (mq.Producer, error) {
	if b.closed.Load() {
		return nil, mq.ErrClosed
	}
	if !b.IsConnected() {
		return nil, mq.ErrNotConnected
	}

	if v, ok := b.producers.Load(exchange); ok {
		return v.(*Producer), nil
	}

	p := &Producer{
		broker:   b,
		exchange: exchange,
		opts:     opts,
	}
	if err := p.reopen(); err != nil {
		return nil, err
	}

	actual, loaded := b.producers.LoadOrStore(exchange, p)
	if loaded {
		_ = p.Close()
		return actual.(*Producer), nil
	}
	return p, nil
}

// Consumer creates a consumer for the given queue.
func (b *Broker) Consumer(queue string, opts mq.ConsumeOptions) (mq.Consumer, error) {
	if b.closed.Load() {
		return nil, mq.ErrClosed
	}
	if opts.Handler == nil {
		return nil, mq.ErrNoHandler
	}
	if !b.IsConnected() {
		return nil, mq.ErrNotConnected
	}

	c := &Consumer{
		broker: b,
		queue:  queue,
		opts:   opts,
	}
	if opts.QosPrefetchCount <= 0 {
		c.opts.QosPrefetchCount = 10
	}
	if opts.Concurrency <= 0 {
		c.opts.Concurrency = 1
	}

	// Apply middleware chain.
	chain := opts.Middleware
	c.handler = mq.Chain(chain...)(opts.Handler)

	b.consumers.Store(queue, c)
	return c, nil
}
