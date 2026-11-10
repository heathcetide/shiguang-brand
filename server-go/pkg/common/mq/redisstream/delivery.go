// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package redisstream

import (
	"context"
	"fmt"
	"strconv"
	"sync"
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common/mq"
	"github.com/redis/go-redis/v9"
)

// streamDelivery adapts a redis.XMessage to the mq.Delivery interface.
type streamDelivery struct {
	msg         redis.XMessage
	stream      string
	group       string
	consumer    *Consumer
	redelivered bool

	mu            sync.Mutex
	ackedManually bool
}

// Message returns the underlying mq.Message reconstructed from the stream
// fields.
func (d *streamDelivery) Message() *mq.Message {
	msg := &mq.Message{
		Exchange:   d.stream,
		RoutingKey: d.stream,
	}

	values := d.msg.Values

	if v, ok := values["body"]; ok {
		if s, ok := v.(string); ok {
			msg.Body = []byte(s)
		}
	}
	if v, ok := values["id"]; ok {
		if s, ok := v.(string); ok {
			msg.ID = s
		}
	}
	if v, ok := values["content_type"]; ok {
		if s, ok := v.(string); ok {
			msg.ContentType = s
		}
	}
	if v, ok := values["content_encoding"]; ok {
		if s, ok := v.(string); ok {
			msg.ContentEncoding = s
		}
	}
	if v, ok := values["correlation_id"]; ok {
		if s, ok := v.(string); ok {
			msg.CorrelationID = s
		}
	}
	if v, ok := values["reply_to"]; ok {
		if s, ok := v.(string); ok {
			msg.ReplyTo = s
		}
	}
	if v, ok := values["type"]; ok {
		if s, ok := v.(string); ok {
			msg.Type = s
		}
	}
	if v, ok := values["user_id"]; ok {
		if s, ok := v.(string); ok {
			msg.UserID = s
		}
	}
	if v, ok := values["app_id"]; ok {
		if s, ok := v.(string); ok {
			msg.AppID = s
		}
	}
	if v, ok := values["routing_key"]; ok {
		if s, ok := v.(string); ok {
			msg.RoutingKey = s
		}
	}
	if v, ok := values["priority"]; ok {
		switch t := v.(type) {
		case int64:
			msg.Priority = uint8(t)
		case int:
			msg.Priority = uint8(t)
		case string:
			if n, err := strconv.ParseUint(t, 10, 8); err == nil {
				msg.Priority = uint8(n)
			}
		}
	}
	if v, ok := values["delivery_mode"]; ok {
		switch t := v.(type) {
		case int64:
			msg.DeliveryMode = mq.DeliveryMode(t)
		case int:
			msg.DeliveryMode = mq.DeliveryMode(t)
		case string:
			if n, err := strconv.Atoi(t); err == nil {
				msg.DeliveryMode = mq.DeliveryMode(n)
			}
		}
	}
	if v, ok := values["timestamp"]; ok {
		switch t := v.(type) {
		case int64:
			msg.Timestamp = time.Unix(0, t)
		case string:
			if n, err := strconv.ParseInt(t, 10, 64); err == nil {
				msg.Timestamp = time.Unix(0, n)
			}
		}
	}

	// Reconstruct headers from "h_" prefixed fields.
	headers := make(map[string]any)
	for k, v := range values {
		if len(k) > 2 && k[:2] == "h_" {
			headers[k[2:]] = v
		}
	}
	if len(headers) > 0 {
		msg.Headers = headers
	}

	// The stream message ID (e.g. "1234567890-0") is the delivery ID.
	msg.ID = d.msg.ID

	return msg
}

// Body returns the raw payload.
func (d *streamDelivery) Body() []byte {
	if v, ok := d.msg.Values["body"]; ok {
		if s, ok := v.(string); ok {
			return []byte(s)
		}
	}
	return nil
}

// Headers returns the message headers reconstructed from "h_" prefixed
// stream fields.
func (d *streamDelivery) Headers() map[string]any {
	headers := make(map[string]any)
	for k, v := range d.msg.Values {
		if len(k) > 2 && k[:2] == "h_" {
			headers[k[2:]] = v
		}
	}
	return headers
}

// RoutingKey returns the stream name (Redis Streams have no routing keys).
func (d *streamDelivery) RoutingKey() string {
	return d.stream
}

// Exchange returns the stream name (Redis Streams have no exchanges).
func (d *streamDelivery) Exchange() string {
	return d.stream
}

// Redelivered reports whether this message has been delivered before. In
// consumer-group mode, a message read from the pending entries list (PEL)
// is considered redelivered.
func (d *streamDelivery) Redelivered() bool {
	return d.redelivered
}

// DeliveryTag returns a numeric representation of the stream message ID.
// This is a best-effort conversion: the full ID is available via
// Message().ID. The numeric tag is derived from the timestamp portion of
// the Redis stream ID.
func (d *streamDelivery) DeliveryTag() uint64 {
	id := d.msg.ID
	if id == "" {
		return 0
	}
	// Redis stream IDs are of the form "<milliseconds>-<sequence>".
	for i := 0; i < len(id); i++ {
		if id[i] == '-' {
			n, _ := strconv.ParseUint(id[:i], 10, 64)
			return n
		}
	}
	n, _ := strconv.ParseUint(id, 10, 64)
	return n
}

// Ack acknowledges successful processing via XACK. Only valid in
// consumer-group mode; in standalone mode Ack is a no-op.
func (d *streamDelivery) Ack() error {
	d.mu.Lock()
	d.ackedManually = true
	d.mu.Unlock()

	if d.group == "" || d.consumer == nil {
		// Standalone mode: no ack needed.
		return nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	n, err := d.consumer.broker.client.XAck(ctx, d.stream, d.group, d.msg.ID).Result()
	if err != nil {
		d.consumer.broker.metrics.RecordError()
		return fmt.Errorf("redisstream: xack: %w", err)
	}
	if n > 0 {
		d.consumer.broker.metrics.RecordAck()
	}
	return nil
}

// Nack negatively acknowledges the message. In Redis Streams there is no
// explicit nack — the message stays in the pending entries list (PEL) and
// will be redelivered on the next XAUTOCLAIM or XREADGROUP with ID "0".
// If requeue is false, the message is claimed and immediately acked
// (effectively discarded).
func (d *streamDelivery) Nack(requeue bool) error {
	d.mu.Lock()
	d.ackedManually = true
	d.mu.Unlock()

	if d.consumer != nil {
		d.consumer.broker.metrics.RecordNack()
	}

	if !requeue && d.group != "" && d.consumer != nil {
		// Discard: ack the message so it is removed from the PEL.
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_, _ = d.consumer.broker.client.XAck(ctx, d.stream, d.group, d.msg.ID).Result()
	}
	return nil
}

// Reject is similar to Nack. If requeue is false, the message is acked
// (discarded). If requeue is true, the message stays in the PEL for
// redelivery.
func (d *streamDelivery) Reject(requeue bool) error {
	d.mu.Lock()
	d.ackedManually = true
	d.mu.Unlock()

	if d.consumer != nil {
		d.consumer.broker.metrics.RecordReject()
	}

	if !requeue && d.group != "" && d.consumer != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_, _ = d.consumer.broker.client.XAck(ctx, d.stream, d.group, d.msg.ID).Result()
	}
	return nil
}
