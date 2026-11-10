// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package kafka

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common/mq"
	kafkago "github.com/segmentio/kafka-go"
)

// Consumer implements mq.Consumer for Kafka using a kafka.Reader.
type Consumer struct {
	broker  *Broker
	topic   string
	groupID string
	opts    mq.ConsumeOptions
	handler mq.Handler

	mu      sync.Mutex
	reader  *kafkago.Reader
	ctx     context.Context
	cancel  context.CancelFunc
	running atomic.Bool
	wg      sync.WaitGroup
}

// newConsumer creates a new Kafka consumer.
func newConsumer(b *Broker, topic, groupID string, opts mq.ConsumeOptions) (*Consumer, error) {
	concurrency := opts.Concurrency
	if concurrency <= 0 {
		concurrency = 1
	}

	// Build the reader config.
	minBytes := 1
	maxBytes := 10 * 1024 * 1024 // 10MB

	readerCfg := kafkago.ReaderConfig{
		Brokers:  b.cfg.Brokers,
		Topic:    topic,
		GroupID:  groupID,
		MinBytes: minBytes,
		MaxBytes: maxBytes,
		Dialer: &kafkago.Dialer{
			Timeout:   b.cfg.DialerTimeout,
			TLS:       b.tlsConfig(),
			DualStack: true,
		},
	}

	// CommitInterval: if > 0, enable auto-commit; if 0, manual only.
	if b.cfg.CommitInterval > 0 {
		readerCfg.CommitInterval = b.cfg.CommitInterval
	}

	reader := kafkago.NewReader(readerCfg)

	handler := opts.Handler
	// Apply middleware in order (first is outermost).
	for i := len(opts.Middleware) - 1; i >= 0; i-- {
		handler = opts.Middleware[i](handler)
	}

	return &Consumer{
		broker:  b,
		topic:   topic,
		groupID: groupID,
		opts:    opts,
		handler: handler,
		reader:  reader,
	}, nil
}

// Start begins consuming from the Kafka topic. The consumer runs until
// ctx is cancelled or Stop is called.
func (c *Consumer) Start(ctx context.Context) error {
	if !c.running.CompareAndSwap(false, true) {
		return mq.ErrAlreadyRunning
	}

	ctx, cancel := context.WithCancel(ctx)
	c.mu.Lock()
	c.ctx = ctx
	c.cancel = cancel
	c.mu.Unlock()

	concurrency := c.opts.Concurrency
	if concurrency <= 0 {
		concurrency = 1
	}

	for i := 0; i < concurrency; i++ {
		c.wg.Add(1)
		go c.worker(ctx)
	}

	return nil
}

// worker reads messages from the Kafka reader and dispatches them to
// the handler.
func (c *Consumer) worker(ctx context.Context) {
	defer c.wg.Done()

	for {
		// Check context before each read.
		if err := ctx.Err(); err != nil {
			return
		}

		m, err := c.reader.ReadMessage(ctx)
		if err != nil {
			if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
				return
			}
			c.broker.metrics.RecordError()
			// Brief backoff on error to avoid a tight loop.
			select {
			case <-time.After(500 * time.Millisecond):
			case <-ctx.Done():
				return
			}
			continue
		}

		c.process(ctx, m)
	}
}

// process handles a single Kafka message.
func (c *Consumer) process(ctx context.Context, m kafkago.Message) {
	delivery := &kafkaDelivery{
		msg:      m,
		reader:   c.reader,
		consumer: c,
	}

	c.broker.metrics.RecordConsume()

	err := c.handler(ctx, delivery)

	if c.opts.AutoAck {
		// Auto-ack: commit the offset regardless of handler result.
		if cerr := c.reader.CommitMessages(ctx, m); cerr != nil {
			c.broker.metrics.RecordError()
		}
		c.broker.metrics.RecordAck()
		return
	}

	if err != nil {
		c.broker.metrics.RecordError()
		// If the handler returned an error and did not manually ack/nack,
		// nack with requeue so the message is redelivered.
		if !delivery.ackedManually {
			_ = delivery.Nack(true)
		}
		return
	}

	// Handler succeeded without manual ack — auto-commit the offset.
	if !delivery.ackedManually {
		if cerr := c.reader.CommitMessages(ctx, m); cerr != nil {
			c.broker.metrics.RecordError()
		} else {
			c.broker.metrics.RecordAck()
		}
	}
}

// Stop gracefully stops consuming, waiting for in-flight handlers to
// complete up to the given timeout.
func (c *Consumer) Stop(timeout time.Duration) error {
	if !c.running.Load() {
		return nil
	}

	c.mu.Lock()
	if c.cancel != nil {
		c.cancel()
	}
	c.mu.Unlock()

	// Wait for workers with timeout.
	done := make(chan struct{})
	go func() {
		c.wg.Wait()
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(timeout):
	}

	c.mu.Lock()
	if c.reader != nil {
		_ = c.reader.Close()
		c.reader = nil
	}
	c.mu.Unlock()

	c.running.Store(false)
	return nil
}

// IsRunning reports whether the consumer is actively consuming.
func (c *Consumer) IsRunning() bool {
	return c.running.Load()
}

// String returns a debug description of the consumer.
func (c *Consumer) String() string {
	return fmt.Sprintf("kafka.Consumer{topic:%s, group:%s, running:%v}", c.topic, c.groupID, c.running.Load())
}
