// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package rocketmq

import (
	"context"
	"fmt"
	"sync"
	"sync/atomic"
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common/mq"
	rocketmq "github.com/apache/rocketmq-client-go/v2"
	"github.com/apache/rocketmq-client-go/v2/consumer"
	"github.com/apache/rocketmq-client-go/v2/primitive"
)

// Consumer implements mq.Consumer for RocketMQ using a push consumer.
type Consumer struct {
	broker  *Broker
	topic   string
	opts    mq.ConsumeOptions
	handler mq.Handler

	mu      sync.Mutex
	inner   rocketmq.PushConsumer
	running atomic.Bool
}

// Start subscribes to the topic and begins consuming.
func (c *Consumer) Start(ctx context.Context) error {
	if !c.running.CompareAndSwap(false, true) {
		return mq.ErrAlreadyRunning
	}

	// Derive a consumer group. RocketMQ requires a group name; we use
	// the broker's GroupName suffixed with the topic to keep consumers
	// on different topics in distinct groups.
	group := c.opts.ConsumerTag
	if group == "" {
		group = fmt.Sprintf("%s-%s", c.broker.cfg.GroupName, c.topic)
	}

	inner, err := c.broker.newConsumer(group)
	if err != nil {
		c.running.Store(false)
		return fmt.Errorf("rocketmq: new consumer: %w", err)
	}

	// Subscribe must be called before Start.
	err = inner.Subscribe(c.topic, consumer.MessageSelector{},
		func(ctx context.Context, msgs ...*primitive.MessageExt) (consumer.ConsumeResult, error) {
			result := consumer.ConsumeSuccess
			for _, m := range msgs {
				if !c.process(ctx, m) {
					result = consumer.ConsumeRetryLater
				}
			}
			return result, nil
		},
	)
	if err != nil {
		_ = inner.Shutdown()
		c.running.Store(false)
		return fmt.Errorf("rocketmq: subscribe: %w", err)
	}

	if err := inner.Start(); err != nil {
		_ = inner.Shutdown()
		c.running.Store(false)
		return fmt.Errorf("rocketmq: start consumer: %w", err)
	}

	c.mu.Lock()
	c.inner = inner
	c.mu.Unlock()

	return nil
}

// process handles a single delivery. It returns true when the message
// was consumed successfully (and should be acknowledged), false when it
// should be retried.
func (c *Consumer) process(ctx context.Context, m *primitive.MessageExt) bool {
	delivery := newDelivery(m)
	c.broker.metrics.RecordConsume()
	if delivery.Redelivered() {
		c.broker.metrics.RecordRedelivered()
	}

	err := c.handler(ctx, delivery)
	if c.opts.AutoAck {
		return true
	}

	if err != nil {
		c.broker.metrics.RecordError()
		c.broker.metrics.RecordNack()
		return false
	}

	if delivery.nacked || delivery.rejected {
		c.broker.metrics.RecordNack()
		return delivery.requeue
	}

	c.broker.metrics.RecordAck()
	return true
}

// Stop gracefully stops consuming.
func (c *Consumer) Stop(timeout time.Duration) error {
	if !c.running.Load() {
		return nil
	}

	c.mu.Lock()
	inner := c.inner
	c.mu.Unlock()

	if inner != nil {
		_ = inner.Shutdown()
	}

	c.mu.Lock()
	c.inner = nil
	c.mu.Unlock()

	c.running.Store(false)
	return nil
}

// IsRunning reports whether the consumer is actively consuming.
func (c *Consumer) IsRunning() bool {
	return c.running.Load()
}
