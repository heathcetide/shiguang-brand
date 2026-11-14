// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package activemq

import (
	"context"
	"fmt"
	"sync"
	"sync/atomic"
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common/mq"
	"github.com/go-stomp/stomp/v3"
	"github.com/go-stomp/stomp/v3/frame"
)

// Consumer implements mq.Consumer for ActiveMQ over STOMP. It subscribes
// to a destination and dispatches received messages to a handler.
type Consumer struct {
	broker      *Broker
	destination string
	opts        mq.ConsumeOptions
	handler     mq.Handler

	mu      sync.Mutex
	sub     *stomp.Subscription
	cancel  context.CancelFunc
	running atomic.Bool
	wg      sync.WaitGroup
}

// Start subscribes to the destination and begins dispatching messages
// to the handler. The consumer runs until ctx is cancelled or Stop is
// called.
func (c *Consumer) Start(ctx context.Context) error {
	if !c.running.CompareAndSwap(false, true) {
		return mq.ErrAlreadyRunning
	}

	conn, err := c.broker.connection()
	if err != nil {
		c.running.Store(false)
		return err
	}

	ackMode := stomp.AckClient
	if c.opts.AutoAck {
		ackMode = stomp.AckAuto
	}

	var subOpts []func(*frame.Frame) error
	if c.opts.ConsumerTag != "" {
		subOpts = append(subOpts, stomp.SubscribeOpt.Id(c.opts.ConsumerTag))
	}

	sub, err := conn.Subscribe(c.destination, ackMode, subOpts...)
	if err != nil {
		c.running.Store(false)
		return fmt.Errorf("activemq: subscribe: %w", err)
	}

	c.mu.Lock()
	c.sub = sub
	c.mu.Unlock()

	ctx, cancel := context.WithCancel(ctx)
	c.mu.Lock()
	c.cancel = cancel
	c.mu.Unlock()

	// Start worker goroutines. All workers read from the same
	// subscription channel; STOMP delivers messages for a single
	// subscription sequentially, so concurrency here only helps when
	// handler processing is slow relative to dispatch.
	for i := 0; i < c.opts.Concurrency; i++ {
		c.wg.Add(1)
		go c.worker(ctx, sub)
	}
	return nil
}

// worker reads messages from the subscription channel and dispatches
// them to the handler.
func (c *Consumer) worker(ctx context.Context, sub *stomp.Subscription) {
	defer c.wg.Done()

	for {
		select {
		case <-ctx.Done():
			return
		case msg, ok := <-sub.C:
			if !ok {
				return
			}
			c.process(ctx, msg)
		}
	}
}

// process handles a single STOMP message.
func (c *Consumer) process(ctx context.Context, msg *stomp.Message) {
	if msg == nil {
		return
	}
	if msg.Err != nil {
		c.broker.metrics.RecordError()
		return
	}

	delivery := &stompDelivery{
		msg:         msg,
		destination: c.destination,
	}
	c.broker.metrics.RecordConsume()
	if delivery.Redelivered() {
		c.broker.metrics.RecordRedelivered()
	}

	err := c.handler(ctx, delivery)
	if c.opts.AutoAck {
		return
	}

	if err != nil {
		c.broker.metrics.RecordError()
		if nerr := delivery.Nack(true); nerr != nil {
			c.broker.metrics.RecordError()
		}
		c.broker.metrics.RecordNack()
		return
	}

	if !delivery.ackedManually {
		if aerr := delivery.Ack(); aerr != nil {
			c.broker.metrics.RecordError()
		}
		c.broker.metrics.RecordAck()
	}
}

// Stop gracefully stops consuming, waiting for in-flight handlers to
// complete up to the given timeout. It is safe to call multiple times.
func (c *Consumer) Stop(timeout time.Duration) error {
	if !c.running.Load() {
		return nil
	}

	c.mu.Lock()
	if c.cancel != nil {
		c.cancel()
	}
	sub := c.sub
	c.mu.Unlock()

	// Unsubscribe on the broker.
	if sub != nil && sub.Active() {
		_ = sub.Unsubscribe()
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
	c.sub = nil
	c.cancel = nil
	c.mu.Unlock()

	c.running.Store(false)
	return nil
}

// IsRunning reports whether the consumer is actively consuming.
func (c *Consumer) IsRunning() bool {
	return c.running.Load()
}
