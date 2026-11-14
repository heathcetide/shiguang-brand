// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package redisstream

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common/mq"
	"github.com/redis/go-redis/v9"
)

// Consumer implements mq.Consumer for Redis Streams.
//
// If a consumer group is configured (broker Group config or per-consumer
// override), the consumer uses XREADGROUP to read messages assigned to it
// by the group. Otherwise it uses XREAD in standalone mode.
type Consumer struct {
	broker *Broker
	stream string
	opts   mq.ConsumeOptions

	group        string
	consumerName string
	blockTime    time.Duration
	count        int64

	handler mq.Handler

	mu      sync.Mutex
	cancel  context.CancelFunc
	running atomic.Bool
	wg      sync.WaitGroup
}

// Start begins consuming from the stream. The consumer runs until ctx is
// cancelled or Stop is called.
func (c *Consumer) Start(ctx context.Context) error {
	if !c.running.CompareAndSwap(false, true) {
		return mq.ErrAlreadyRunning
	}

	c.broker.connMu.RLock()
	client := c.broker.client
	c.broker.connMu.RUnlock()
	if client == nil {
		c.running.Store(false)
		return mq.ErrNotConnected
	}

	// In group mode, ensure the consumer group exists. Ignore BUSYGROUP
	// (group already exists).
	if c.group != "" {
		if err := c.ensureGroup(ctx, client); err != nil {
			c.running.Store(false)
			return err
		}
	}

	ctx, cancel := context.WithCancel(ctx)
	c.mu.Lock()
	c.cancel = cancel
	c.mu.Unlock()

	for i := 0; i < c.opts.Concurrency; i++ {
		c.wg.Add(1)
		go c.worker(ctx)
	}

	return nil
}

// ensureGroup creates the consumer group if it does not already exist.
func (c *Consumer) ensureGroup(ctx context.Context, client *redis.Client) error {
	err := client.XGroupCreate(ctx, c.stream, c.group, "$").Err()
	if err == nil {
		return nil
	}
	// BUSYGROUP means the group already exists — that's fine.
	if isBusyGroupError(err) {
		return nil
	}
	return fmt.Errorf("redisstream: xgroup create: %w", err)
}

// isBusyGroupError reports whether err is a Redis BUSYGROUP error.
func isBusyGroupError(err error) bool {
	if err == nil {
		return false
	}
	s := err.Error()
	return strings.Contains(s, "BUSYGROUP")
}

// worker reads messages from the stream and dispatches them to the handler.
func (c *Consumer) worker(ctx context.Context) {
	defer c.wg.Done()

	for {
		if ctx.Err() != nil {
			return
		}

		var msgs []redis.XMessage
		var err error

		if c.group != "" {
			msgs, err = c.readGroup(ctx)
		} else {
			msgs, err = c.readStandalone(ctx)
		}

		if err != nil {
			if ctx.Err() != nil {
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

		for _, m := range msgs {
			c.process(ctx, m)
		}
	}
}

// readGroup reads new messages via XREADGROUP with the ">" ID.
func (c *Consumer) readGroup(ctx context.Context) ([]redis.XMessage, error) {
	c.broker.connMu.RLock()
	client := c.broker.client
	c.broker.connMu.RUnlock()
	if client == nil {
		return nil, mq.ErrNotConnected
	}

	args := &redis.XReadGroupArgs{
		Group:    c.group,
		Consumer: c.consumerName,
		Streams:  []string{c.stream, ">"},
		Count:    c.count,
		Block:    c.blockTime,
	}

	streams, err := client.XReadGroup(ctx, args).Result()
	if err != nil {
		if errors.Is(err, redis.Nil) {
			return nil, nil
		}
		return nil, err
	}

	for _, s := range streams {
		if s.Stream == c.stream {
			return s.Messages, nil
		}
	}
	return nil, nil
}

// readStandalone reads messages via XREAD starting from the last read ID.
// It tracks the last seen ID in the consumer to avoid re-reading.
func (c *Consumer) readStandalone(ctx context.Context) ([]redis.XMessage, error) {
	c.broker.connMu.RLock()
	client := c.broker.client
	c.broker.connMu.RUnlock()
	if client == nil {
		return nil, mq.ErrNotConnected
	}

	c.mu.Lock()
	lastID := c.opts.Args["last_id"]
	c.mu.Unlock()

	id, _ := lastID.(string)
	if id == "" {
		id = "$"
		// On first read, start from the beginning so we don't miss
		// messages published before the consumer started.
		id = "0"
	}

	args := &redis.XReadArgs{
		Streams: []string{c.stream, id},
		Count:   c.count,
		Block:   c.blockTime,
	}

	streams, err := client.XRead(ctx, args).Result()
	if err != nil {
		if errors.Is(err, redis.Nil) {
			return nil, nil
		}
		return nil, err
	}

	for _, s := range streams {
		if s.Stream == c.stream {
			if len(s.Messages) > 0 {
				last := s.Messages[len(s.Messages)-1].ID
				c.mu.Lock()
				c.opts.Args["last_id"] = last
				c.mu.Unlock()
			}
			return s.Messages, nil
		}
	}
	return nil, nil
}

// process handles a single delivery.
func (c *Consumer) process(ctx context.Context, m redis.XMessage) {
	delivery := &streamDelivery{
		msg:      m,
		stream:   c.stream,
		group:    c.group,
		consumer: c,
	}

	c.broker.metrics.RecordConsume()

	err := c.handler(ctx, delivery)
	if c.opts.AutoAck {
		// In auto-ack mode, ack regardless of handler result (group mode only).
		if c.group != "" {
			ackCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			_, _ = c.broker.client.XAck(ackCtx, c.stream, c.group, m.ID).Result()
			c.broker.metrics.RecordAck()
		}
		return
	}

	if err != nil {
		c.broker.metrics.RecordError()
		// Nack with requeue: leave the message in the PEL for redelivery.
		_ = delivery.Nack(true)
		return
	}

	// If the handler did not manually ack, ack now (group mode only).
	if c.group != "" && !delivery.ackedManually {
		ackCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		n, aerr := c.broker.client.XAck(ackCtx, c.stream, c.group, m.ID).Result()
		if aerr != nil {
			c.broker.metrics.RecordError()
		}
		if n > 0 {
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

	done := make(chan struct{})
	go func() {
		c.wg.Wait()
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(timeout):
	}

	c.running.Store(false)
	return nil
}

// IsRunning reports whether the consumer is actively consuming.
func (c *Consumer) IsRunning() bool {
	return c.running.Load()
}
