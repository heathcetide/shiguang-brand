// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package rocketmq

import (
	"strconv"
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common/mq"
	"github.com/apache/rocketmq-client-go/v2/primitive"
)

// Delivery adapts a RocketMQ primitive.MessageExt to the mq.Delivery
// interface.
//
// RocketMQ push consumers acknowledge messages by returning a
// ConsumeResult from the subscribe callback rather than via an explicit
// ACK RPC. Therefore Ack/Nack/Reject here simply record the user's
// intent in the ackedManually/nacked flags; the consumer loop inspects
// these flags (together with the handler error) to decide the
// ConsumeResult. When AutoAck is enabled the framework ignores these
// flags entirely.
type Delivery struct {
	msg           *primitive.MessageExt
	ackedManually bool
	nacked        bool
	rejected      bool
	requeue       bool
}

// newDelivery constructs a Delivery from a RocketMQ message extension.
func newDelivery(m *primitive.MessageExt) *Delivery {
	return &Delivery{msg: m}
}

// Message returns the underlying mq.Message.
func (d *Delivery) Message() *mq.Message {
	m := d.msg
	props := m.GetProperties()
	headers := make(map[string]any, len(props))
	for k, v := range props {
		headers[k] = v
	}

	var ts time.Time
	if raw, ok := props["Timestamp"]; ok {
		if ns, err := strconv.ParseInt(raw, 10, 64); err == nil {
			ts = time.Unix(0, ns)
		}
	}
	if ts.IsZero() && m.BornTimestamp > 0 {
		ts = time.UnixMilli(m.BornTimestamp)
	}

	var expiration time.Duration
	if raw, ok := props["Expiration"]; ok {
		if ms, err := strconv.ParseInt(raw, 10, 64); err == nil {
			expiration = time.Duration(ms) * time.Millisecond
		}
	}

	var priority uint8
	if raw, ok := props["Priority"]; ok {
		if p, err := strconv.ParseUint(raw, 10, 8); err == nil {
			priority = uint8(p)
		}
	}

	return &mq.Message{
		ID:              m.MsgId,
		Exchange:        m.Topic,
		RoutingKey:      m.GetTags(),
		Headers:         headers,
		Body:            m.Body,
		ContentType:     props["ContentType"],
		ContentEncoding: props["ContentEncoding"],
		Priority:        priority,
		CorrelationID:   props[primitive.PropertyCorrelationID],
		ReplyTo:         props["ReplyTo"],
		Expiration:      expiration,
		Timestamp:       ts,
		Type:            props["Type"],
		UserID:          props["UserID"],
		AppID:           props["AppID"],
		DeliveryMode:    mq.Persistent, // RocketMQ persists by default
	}
}

// Body returns the raw payload.
func (d *Delivery) Body() []byte { return d.msg.Body }

// Headers returns the message headers (RocketMQ properties).
func (d *Delivery) Headers() map[string]any {
	props := d.msg.GetProperties()
	headers := make(map[string]any, len(props))
	for k, v := range props {
		headers[k] = v
	}
	return headers
}

// RoutingKey returns the message tag (RocketMQ's closest analogue to a
// routing key).
func (d *Delivery) RoutingKey() string { return d.msg.GetTags() }

// Exchange returns the source topic.
func (d *Delivery) Exchange() string { return d.msg.Topic }

// Redelivered reports whether this message has been delivered before.
func (d *Delivery) Redelivered() bool { return d.msg.ReconsumeTimes > 0 }

// DeliveryTag returns the queue offset as a stable delivery tag.
func (d *Delivery) DeliveryTag() uint64 { return uint64(d.msg.QueueOffset) }

// Ack acknowledges successful processing. For RocketMQ this records the
// intent; the consumer loop returns ConsumeSuccess.
func (d *Delivery) Ack() error {
	d.ackedManually = true
	return nil
}

// Nack negatively acknowledges the message. If requeue is true the
// consumer loop returns ConsumeRetryLater so the broker redelivers;
// otherwise the message is dropped (routed to the retry/dead-letter
// topic after exceeding the max reconsume count).
func (d *Delivery) Nack(requeue bool) error {
	d.ackedManually = true
	d.nacked = true
	d.requeue = requeue
	return nil
}

// Reject rejects the message. Behaves like Nack.
func (d *Delivery) Reject(requeue bool) error {
	d.ackedManually = true
	d.rejected = true
	d.requeue = requeue
	return nil
}
