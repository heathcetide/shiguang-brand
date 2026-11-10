// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package rabbitmq

import (
	"context"
	"fmt"
	"sync"
	"sync/atomic"
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common/mq"
	amqp "github.com/rabbitmq/amqp091-go"
)

// Consumer implements mq.Consumer for RabbitMQ.
type Consumer struct {
	broker  *Broker
	queue   string
	opts    mq.ConsumeOptions
	handler mq.Handler

	mu      sync.Mutex
	ch      *amqp.Channel
	cancel  context.CancelFunc
	running atomic.Bool
	wg      sync.WaitGroup
}

// Start begins consuming from the queue.
func (c *Consumer) Start(ctx context.Context) error {
	if !c.running.CompareAndSwap(false, true) {
		return mq.ErrAlreadyRunning
	}

	ch, err := c.broker.getChannel()
	if err != nil {
		c.running.Store(false)
		return err
	}

	// Set QoS.
	if err := ch.Qos(
		c.opts.QosPrefetchCount,
		c.opts.QosPrefetchSize,
		c.opts.QosGlobal,
	); err != nil {
		_ = ch.Close()
		c.running.Store(false)
		return fmt.Errorf("rabbitmq: set qos: %w", err)
	}

	c.mu.Lock()
	c.ch = ch
	c.mu.Unlock()

	tag := c.opts.ConsumerTag
	if tag == "" {
		tag = fmt.Sprintf("consumer-%s-%d", c.queue, time.Now().UnixNano())
	}

	deliveries, err := ch.Consume(
		c.queue,
		tag,
		c.opts.AutoAck,
		c.opts.Exclusive,
		false, // noLocal (not supported by RabbitMQ)
		c.opts.Args["noWait"] != nil,
		c.opts.Args,
	)
	if err != nil {
		_ = ch.Close()
		c.running.Store(false)
		return fmt.Errorf("rabbitmq: consume: %w", err)
	}

	ctx, cancel := context.WithCancel(ctx)
	c.mu.Lock()
	c.cancel = cancel
	c.mu.Unlock()

	// Start worker goroutines.
	for i := 0; i < c.opts.Concurrency; i++ {
		c.wg.Add(1)
		go c.worker(ctx, deliveries)
	}

	return nil
}

// worker processes deliveries from the channel.
func (c *Consumer) worker(ctx context.Context, deliveries <-chan amqp.Delivery) {
	defer c.wg.Done()

	for {
		select {
		case <-ctx.Done():
			return
		case d, ok := <-deliveries:
			if !ok {
				return
			}
			c.process(ctx, d)
		}
	}
}

// process handles a single delivery.
func (c *Consumer) process(ctx context.Context, d amqp.Delivery) {
	delivery := &amqpDelivery{d: d}
	c.broker.metrics.RecordConsume()
	if d.Redelivered {
		c.broker.metrics.RecordRedelivered()
	}

	err := c.handler(ctx, delivery)
	if c.opts.AutoAck {
		return
	}

	if err != nil {
		c.broker.metrics.RecordError()
		// Nack with requeue so the broker can redeliver or dead-letter.
		if nerr := d.Nack(false, true); nerr != nil {
			c.broker.metrics.RecordError()
		}
		c.broker.metrics.RecordNack()
		return
	}

	if !delivery.ackedManually {
		if aerr := d.Ack(false); aerr != nil {
			c.broker.metrics.RecordError()
		}
		c.broker.metrics.RecordAck()
	}
}

// Stop gracefully stops consuming.
func (c *Consumer) Stop(timeout time.Duration) error {
	if !c.running.Load() {
		return nil
	}

	c.mu.Lock()
	if c.cancel != nil {
		c.cancel()
	}
	ch := c.ch
	c.mu.Unlock()

	// Cancel the consumer on the broker.
	if ch != nil && !ch.IsClosed() {
		tag := c.opts.ConsumerTag
		if tag == "" {
			tag = fmt.Sprintf("consumer-%s", c.queue)
		}
		_ = ch.Cancel(tag, false)
	}

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
	if c.ch != nil {
		_ = c.ch.Close()
		c.ch = nil
	}
	c.mu.Unlock()

	c.running.Store(false)
	return nil
}

// IsRunning reports whether the consumer is actively consuming.
func (c *Consumer) IsRunning() bool {
	return c.running.Load()
}

// restart is called by the broker after reconnection.
func (c *Consumer) restart(ctx context.Context) error {
	c.running.Store(false)
	c.mu.Lock()
	c.ch = nil
	c.mu.Unlock()
	return c.Start(ctx)
}

// ============================================================
// amqpDelivery
// ============================================================

// amqpDelivery adapts amqp.Delivery to the mq.Delivery interface.
type amqpDelivery struct {
	d             amqp.Delivery
	ackedManually bool
}

func (a *amqpDelivery) Message() *mq.Message {
	return &mq.Message{
		ID:              a.d.MessageId,
		Exchange:        a.d.Exchange,
		RoutingKey:      a.d.RoutingKey,
		Headers:         a.d.Headers,
		Body:            a.d.Body,
		ContentType:     a.d.ContentType,
		ContentEncoding: a.d.ContentEncoding,
		Priority:        a.d.Priority,
		CorrelationID:   a.d.CorrelationId,
		ReplyTo:         a.d.ReplyTo,
		Timestamp:       a.d.Timestamp,
		Type:            a.d.Type,
		UserID:          a.d.UserId,
		AppID:           a.d.AppId,
		DeliveryMode:    mq.DeliveryMode(a.d.DeliveryMode),
	}
}

func (a *amqpDelivery) Body() []byte            { return a.d.Body }
func (a *amqpDelivery) Headers() map[string]any { return a.d.Headers }
func (a *amqpDelivery) RoutingKey() string      { return a.d.RoutingKey }
func (a *amqpDelivery) Exchange() string        { return a.d.Exchange }
func (a *amqpDelivery) Redelivered() bool       { return a.d.Redelivered }
func (a *amqpDelivery) DeliveryTag() uint64     { return a.d.DeliveryTag }

func (a *amqpDelivery) Ack() error {
	a.ackedManually = true
	return a.d.Ack(false)
}

func (a *amqpDelivery) Nack(requeue bool) error {
	a.ackedManually = true
	return a.d.Nack(false, requeue)
}

func (a *amqpDelivery) Reject(requeue bool) error {
	a.ackedManually = true
	return a.d.Reject(requeue)
}
