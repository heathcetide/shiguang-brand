// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package activemq provides an ActiveMQ backend for the ling-base/mq
// broker abstraction. It communicates with the broker using the STOMP
// protocol (Streaming Text Oriented Messaging Protocol) via the
// go-stomp/stomp client library.
//
// ActiveMQ auto-creates destinations (queues/topics) on first use, so
// the topology-management methods on Broker (DeclareExchange, DeclareQueue,
// Bind, etc.) are no-ops and always return nil.
//
// # Basic usage
//
//	broker, _ := activemq.New(activemq.DefaultConfig())
//	_ = broker.Connect()
//	defer broker.Close()
//
//	producer, _ := broker.Producer("/queue/events", mq.PublishOptions{})
//	_ = producer.Publish(ctx, &mq.Message{Body: []byte("hello")})
//
//	consumer, _ := broker.Consumer("/queue/events", mq.ConsumeOptions{
//	    Handler: func(ctx context.Context, d mq.Delivery) error {
//	        fmt.Println(string(d.Body()))
//	        return d.Ack()
//	    },
//	})
//	_ = consumer.Start(ctx)
package activemq

import (
	"errors"
	"fmt"
	"net"
	"sync"
	"sync/atomic"
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common/mq"
	"github.com/go-stomp/stomp/v3"
)

// Config configures an ActiveMQ (STOMP) broker.
type Config struct {
	// Addr is the network address of the STOMP transport, e.g.
	// "localhost:61613". Required.
	Addr string

	// Network is the transport network ("tcp", "tcp4", "tcp6").
	// Default: "tcp".
	Network string

	// Login is the STOMP login (username). Optional.
	Login string

	// Passcode is the STOMP passcode (password). Optional.
	Passcode string

	// Vhost is the STOMP "host" header value (virtual host). If empty,
	// the host is derived from the remote address.
	Vhost string

	// Heartbeat is the desired STOMP heart-beat interval for both send
	// and receive directions. Default: 10s. Set to 0 to use the library
	// default (1 minute).
	Heartbeat time.Duration

	// ConnectTimeout is the timeout for establishing the underlying TCP
	// connection. Default: 10s.
	ConnectTimeout time.Duration
}

// DefaultConfig returns a Config with sensible defaults for a local
// ActiveMQ broker exposing the STOMP transport on port 61613.
func DefaultConfig() Config {
	return Config{
		Addr:           "localhost:61613",
		Network:        "tcp",
		Heartbeat:      10 * time.Second,
		ConnectTimeout: 10 * time.Second,
	}
}

// ============================================================
// Broker
// ============================================================

// Broker implements mq.Broker for ActiveMQ over STOMP.
type Broker struct {
	cfg Config

	connMu sync.RWMutex
	conn   *stomp.Conn

	producers sync.Map // map[string]*Producer
	consumers sync.Map // map[string]*Consumer

	closed  atomic.Bool
	closeMu sync.Mutex

	metrics *mq.MetricsCollector
}

// New creates a new ActiveMQ broker. The connection is not established
// until Connect is called.
func New(cfg Config) (*Broker, error) {
	if cfg.Addr == "" {
		return nil, errors.New("activemq: addr is required")
	}
	if cfg.Network == "" {
		cfg.Network = "tcp"
	}
	if cfg.Heartbeat < 0 {
		cfg.Heartbeat = 10 * time.Second
	}
	if cfg.ConnectTimeout <= 0 {
		cfg.ConnectTimeout = 10 * time.Second
	}

	return &Broker{
		cfg:     cfg,
		metrics: mq.NewMetricsCollector(),
	}, nil
}

// Connect establishes the STOMP connection to the ActiveMQ broker.
func (b *Broker) Connect() error {
	if b.closed.Load() {
		return mq.ErrClosed
	}

	netConn, err := net.DialTimeout(b.cfg.Network, b.cfg.Addr, b.cfg.ConnectTimeout)
	if err != nil {
		return fmt.Errorf("activemq: dial %s: %w", b.cfg.Addr, err)
	}

	var opts []func(*stomp.Conn) error
	if b.cfg.Login != "" || b.cfg.Passcode != "" {
		opts = append(opts, stomp.ConnOpt.Login(b.cfg.Login, b.cfg.Passcode))
	}
	if b.cfg.Vhost != "" {
		opts = append(opts, stomp.ConnOpt.Host(b.cfg.Vhost))
	}
	if b.cfg.Heartbeat > 0 {
		opts = append(opts, stomp.ConnOpt.HeartBeat(b.cfg.Heartbeat, b.cfg.Heartbeat))
	}

	conn, err := stomp.Connect(netConn, opts...)
	if err != nil {
		_ = netConn.Close()
		return fmt.Errorf("activemq: stomp connect: %w", err)
	}

	b.connMu.Lock()
	b.conn = conn
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
	return b.conn != nil
}

// connection returns the current STOMP connection or an error.
func (b *Broker) connection() (*stomp.Conn, error) {
	if b.closed.Load() {
		return nil, mq.ErrClosed
	}
	b.connMu.RLock()
	conn := b.conn
	b.connMu.RUnlock()
	if conn == nil {
		return nil, mq.ErrNotConnected
	}
	return conn, nil
}

// Close shuts down the broker, disconnecting the STOMP connection and
// closing all producers and consumers. It is safe to call multiple times.
func (b *Broker) Close() error {
	b.closeMu.Lock()
	defer b.closeMu.Unlock()
	if !b.closed.CompareAndSwap(false, true) {
		return nil
	}

	// Stop all consumers.
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

	// Disconnect the STOMP connection.
	b.connMu.Lock()
	if b.conn != nil {
		_ = b.conn.Disconnect()
		b.conn = nil
	}
	b.connMu.Unlock()
	return nil
}

// Metrics returns a snapshot of broker metrics.
func (b *Broker) Metrics() mq.Metrics {
	return b.metrics.Snapshot()
}

// ============================================================
// Topology (no-ops)
// ============================================================

// ActiveMQ auto-creates destinations on first use, so topology
// declarations are no-ops.

// DeclareExchange is a no-op; ActiveMQ auto-creates destinations.
func (b *Broker) DeclareExchange(name string, opts mq.ExchangeOptions) error {
	_ = name
	_ = opts
	return nil
}

// DeclareQueue is a no-op; ActiveMQ auto-creates destinations.
func (b *Broker) DeclareQueue(name string, opts mq.QueueOptions) error {
	_ = name
	_ = opts
	return nil
}

// Bind is a no-op; ActiveMQ routing is destination-based.
func (b *Broker) Bind(queue, exchange, routingKey string) error {
	_ = queue
	_ = exchange
	_ = routingKey
	return nil
}

// Unbind is a no-op.
func (b *Broker) Unbind(queue, exchange, routingKey string) error {
	_ = queue
	_ = exchange
	_ = routingKey
	return nil
}

// DeleteQueue is a no-op. STOMP does not provide a standard way to
// delete a destination; use the ActiveMQ JMX/admin API if required.
func (b *Broker) DeleteQueue(name string) error {
	_ = name
	return nil
}

// DeleteExchange is a no-op.
func (b *Broker) DeleteExchange(name string) error {
	_ = name
	return nil
}

// ============================================================
// Producer / Consumer creation
// ============================================================

// Producer creates or returns a cached producer for the given
// destination (e.g. "/queue/events" or "/topic/news").
func (b *Broker) Producer(destination string, opts mq.PublishOptions) (mq.Producer, error) {
	if b.closed.Load() {
		return nil, mq.ErrClosed
	}
	if destination == "" {
		return nil, errors.New("activemq: destination is required")
	}
	if _, err := b.connection(); err != nil {
		return nil, err
	}

	if v, ok := b.producers.Load(destination); ok {
		return v.(*Producer), nil
	}

	p := &Producer{
		broker:      b,
		destination: destination,
		opts:        opts,
	}
	actual, loaded := b.producers.LoadOrStore(destination, p)
	if loaded {
		return actual.(*Producer), nil
	}
	return p, nil
}

// Consumer creates a consumer for the given destination. The consumer
// is not started; call Start to begin receiving messages.
func (b *Broker) Consumer(destination string, opts mq.ConsumeOptions) (mq.Consumer, error) {
	if b.closed.Load() {
		return nil, mq.ErrClosed
	}
	if destination == "" {
		return nil, errors.New("activemq: destination is required")
	}
	if opts.Handler == nil {
		return nil, mq.ErrNoHandler
	}
	if _, err := b.connection(); err != nil {
		return nil, err
	}

	c := &Consumer{
		broker:      b,
		destination: destination,
		opts:        opts,
	}
	if opts.QosPrefetchCount <= 0 {
		c.opts.QosPrefetchCount = 10
	}
	if opts.Concurrency <= 0 {
		c.opts.Concurrency = 1
	}

	// Apply middleware chain.
	c.handler = mq.Chain(opts.Middleware...)(opts.Handler)

	b.consumers.Store(destination, c)
	return c, nil
}

// Compile-time interface compliance checks.
var (
	_ mq.Broker   = (*Broker)(nil)
	_ mq.Producer = (*Producer)(nil)
	_ mq.Consumer = (*Consumer)(nil)
	_ mq.Delivery = (*stompDelivery)(nil)
)
