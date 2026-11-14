// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package redisstream

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common/mq"
	"github.com/redis/go-redis/v9"
)

// Producer implements mq.Producer for Redis Streams using XADD.
type Producer struct {
	broker *Broker
	stream string
	opts   mq.PublishOptions

	mu     sync.Mutex
	closed atomic.Bool
}

// Publish sends a message to the Redis stream via XADD.
//
// The mq.Message fields are mapped to stream fields as follows:
//   - "body"      -> msg.Body (string)
//   - "id"        -> msg.ID (if set)
//   - "headers"   -> msg.Headers (each key prefixed with "h_")
//   - metadata fields (content_type, correlation_id, reply_to, type,
//     user_id, app_id) are stored as individual stream fields.
//
// If the broker's MaxLen config is > 0, the stream is trimmed to
// approximately MaxLen entries on every publish (XADD ... MAXLEN ~ N).
func (p *Producer) Publish(ctx context.Context, msg *mq.Message) error {
	if p.closed.Load() {
		return mq.ErrClosed
	}
	if msg == nil {
		return errors.New("redisstream: message is nil")
	}

	p.broker.connMu.RLock()
	client := p.broker.client
	p.broker.connMu.RUnlock()
	if client == nil {
		return mq.ErrNotConnected
	}

	if msg.Timestamp.IsZero() {
		msg.Timestamp = time.Now()
	}

	args := &redis.XAddArgs{
		Stream: p.stream,
		Values: buildStreamValues(msg),
	}

	// Apply MaxLen trimming if configured on the broker.
	if p.broker.cfg.MaxLen > 0 {
		args.MaxLen = p.broker.cfg.MaxLen
		args.Approx = true
	}

	// If the message has an explicit ID, use it; otherwise let Redis
	// auto-generate with "*".
	if msg.ID != "" {
		args.ID = msg.ID
	} else {
		args.ID = "*"
	}

	start := time.Now()
	_, err := client.XAdd(ctx, args).Result()
	elapsed := time.Since(start)

	if err != nil {
		p.broker.metrics.RecordError()
		return err
	}

	p.broker.metrics.RecordPublish()
	_ = elapsed // reserved for future avg-latency tracking
	return nil
}

// Close releases producer resources. After Close, Publish returns ErrClosed.
func (p *Producer) Close() error {
	if !p.closed.CompareAndSwap(false, true) {
		return nil
	}
	return nil
}

// buildStreamValues converts an mq.Message into a map of stream field
// name -> value suitable for redis.XAddArgs.Values.
func buildStreamValues(msg *mq.Message) map[string]any {
	values := map[string]any{
		"body": string(msg.Body),
	}

	if msg.ID != "" {
		values["id"] = msg.ID
	}
	if msg.ContentType != "" {
		values["content_type"] = msg.ContentType
	}
	if msg.ContentEncoding != "" {
		values["content_encoding"] = msg.ContentEncoding
	}
	if msg.CorrelationID != "" {
		values["correlation_id"] = msg.CorrelationID
	}
	if msg.ReplyTo != "" {
		values["reply_to"] = msg.ReplyTo
	}
	if msg.Type != "" {
		values["type"] = msg.Type
	}
	if msg.UserID != "" {
		values["user_id"] = msg.UserID
	}
	if msg.AppID != "" {
		values["app_id"] = msg.AppID
	}
	if msg.RoutingKey != "" {
		values["routing_key"] = msg.RoutingKey
	}
	if !msg.Timestamp.IsZero() {
		values["timestamp"] = msg.Timestamp.UnixNano()
	}
	values["priority"] = msg.Priority
	values["delivery_mode"] = int(msg.DeliveryMode)

	for k, v := range msg.Headers {
		values["h_"+k] = v
	}

	return values
}
