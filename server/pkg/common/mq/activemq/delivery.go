// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package activemq

import (
	"hash/fnv"
	"strconv"
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common/mq"
	"github.com/go-stomp/stomp/v3"
	"github.com/go-stomp/stomp/v3/frame"
)

// stompDelivery adapts a stomp.Message to the mq.Delivery interface.
type stompDelivery struct {
	msg           *stomp.Message
	destination   string
	ackedManually bool
}

// Message returns the underlying message as an mq.Message.
func (d *stompDelivery) Message() *mq.Message {
	msg := &mq.Message{
		Body:        d.msg.Body,
		ContentType: d.msg.ContentType,
		Exchange:    d.destination,
		RoutingKey:  d.destination,
		Headers:     stompHeadersToMap(d.msg.Header),
	}
	if d.msg.Header != nil {
		if v := d.msg.Header.Get("amq-message-id"); v != "" {
			msg.ID = v
		}
		if v := d.msg.Header.Get("correlation-id"); v != "" {
			msg.CorrelationID = v
		}
		if v := d.msg.Header.Get("reply-to"); v != "" {
			msg.ReplyTo = v
		}
		if v := d.msg.Header.Get("type"); v != "" {
			msg.Type = v
		}
		if v := d.msg.Header.Get("app-id"); v != "" {
			msg.AppID = v
		}
		if v := d.msg.Header.Get("content-encoding"); v != "" {
			msg.ContentEncoding = v
		}
		if v := d.msg.Header.Get("priority"); v != "" {
			if p, err := strconv.ParseUint(v, 10, 8); err == nil {
				msg.Priority = uint8(p)
			}
		}
		if v := d.msg.Header.Get("expires"); v != "" {
			if ms, err := strconv.ParseInt(v, 10, 64); err == nil && ms > 0 {
				msg.Expiration = time.Duration(ms) * time.Millisecond
			}
		}
		if v := d.msg.Header.Get("timestamp"); v != "" {
			if ms, err := strconv.ParseInt(v, 10, 64); err == nil {
				msg.Timestamp = time.UnixMilli(ms)
			}
		}
		if v := d.msg.Header.Get("persistent"); v == "true" {
			msg.DeliveryMode = mq.Persistent
		} else if v == "false" {
			msg.DeliveryMode = mq.Transient
		}
	}
	return msg
}

// Body returns the raw payload.
func (d *stompDelivery) Body() []byte { return d.msg.Body }

// Headers returns the message headers as a map.
func (d *stompDelivery) Headers() map[string]any { return stompHeadersToMap(d.msg.Header) }

// RoutingKey returns the destination (STOMP is destination-based, so
// the routing key is the destination itself).
func (d *stompDelivery) RoutingKey() string { return d.destination }

// Exchange returns the destination. STOMP has no separate exchange
// concept, so this is the destination.
func (d *stompDelivery) Exchange() string { return d.destination }

// Redelivered reports whether the message has been delivered before.
// ActiveMQ sets a "redelivered" header on redelivered STOMP messages.
func (d *stompDelivery) Redelivered() bool {
	if d.msg.Header == nil {
		return false
	}
	return d.msg.Header.Get("redelivered") == "true"
}

// DeliveryTag returns a broker-specific delivery tag. STOMP does not
// expose a numeric tag, so the message-id is hashed into a uint64.
func (d *stompDelivery) DeliveryTag() uint64 {
	if d.msg.Header == nil {
		return 0
	}
	id := d.msg.Header.Get(frame.MessageId)
	if id == "" {
		return 0
	}
	h := fnv.New64a()
	_, _ = h.Write([]byte(id))
	return h.Sum64()
}

// Ack acknowledges successful processing. For auto-ack subscriptions
// this is a no-op.
func (d *stompDelivery) Ack() error {
	d.ackedManually = true
	if d.msg == nil || d.msg.Conn == nil || !d.msg.ShouldAck() {
		return nil
	}
	return d.msg.Conn.Ack(d.msg)
}

// Nack negatively acknowledges the message. STOMP does not support a
// requeue flag; the requeue parameter is ignored and the message is
// Nacked (the broker decides redelivery based on its configuration).
// For auto-ack subscriptions this returns nil.
func (d *stompDelivery) Nack(requeue bool) error {
	_ = requeue // STOMP NACK has no requeue flag
	d.ackedManually = true
	if d.msg == nil || d.msg.Conn == nil || !d.msg.ShouldAck() {
		return nil
	}
	return d.msg.Conn.Nack(d.msg)
}

// Reject rejects the message. STOMP has no separate REJECT frame, so
// this is equivalent to Nack.
func (d *stompDelivery) Reject(requeue bool) error {
	return d.Nack(requeue)
}

// stompHeadersToMap converts a stomp frame.Header into a map[string]any.
// When the same key appears multiple times, the first value wins (per
// the STOMP specification).
func stompHeadersToMap(h *frame.Header) map[string]any {
	if h == nil {
		return nil
	}
	out := make(map[string]any, h.Len())
	for i := 0; i < h.Len(); i++ {
		k, v := h.GetAt(i)
		if _, exists := out[k]; !exists {
			out[k] = v
		}
	}
	return out
}
