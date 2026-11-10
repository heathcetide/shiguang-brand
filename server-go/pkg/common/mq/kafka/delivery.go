// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package kafka

import (
	"context"
	"strconv"

	"github.com/heathcetide/DietDigiDose/pkg/common/mq"
	kafkago "github.com/segmentio/kafka-go"
)

// kafkaDelivery adapts a kafka-go Message to the mq.Delivery interface.
//
// Kafka does not have per-message ACK like AMQP. Instead, offsets are
// committed by the consumer. Ack() commits the current offset; Nack()
// and Reject() leave the offset uncommitted so the message is redelivered
// (when requeue is true) or skipped (when requeue is false).
type kafkaDelivery struct {
	msg      kafkago.Message
	reader   *kafkago.Reader
	consumer *Consumer

	// ackedManually is set when the handler explicitly calls Ack/Nack/
	// Reject, so the consumer loop knows not to auto-commit.
	ackedManually bool
}

// Message returns the underlying mq.Message.
func (d *kafkaDelivery) Message() *mq.Message {
	headers := make(map[string]any, len(d.msg.Headers))
	for _, h := range d.msg.Headers {
		headers[h.Key] = string(h.Value)
	}

	return &mq.Message{
		ID:           string(d.msg.Key),
		Exchange:     d.msg.Topic,
		RoutingKey:   d.partitionString(),
		Headers:      headers,
		Body:         d.msg.Value,
		Timestamp:    d.msg.Time,
		DeliveryMode: mq.Persistent, // Kafka always persists
	}
}

// Body returns the raw payload.
func (d *kafkaDelivery) Body() []byte { return d.msg.Value }

// Headers returns the message headers as a map[string]any.
func (d *kafkaDelivery) Headers() map[string]any {
	headers := make(map[string]any, len(d.msg.Headers))
	for _, h := range d.msg.Headers {
		headers[h.Key] = string(h.Value)
	}
	return headers
}

// RoutingKey returns the partition as a string (Kafka has no routing
// keys; partitions serve a similar role for ordering).
func (d *kafkaDelivery) RoutingKey() string { return d.partitionString() }

// Exchange returns the Kafka topic (Kafka has no exchanges; topics are
// the publish target).
func (d *kafkaDelivery) Exchange() string { return d.msg.Topic }

// Redelivered reports whether this message has been delivered before.
// Kafka does not track redelivery counts, so this always returns false.
func (d *kafkaDelivery) Redelivered() bool { return false }

// DeliveryTag returns the Kafka offset as the delivery tag.
func (d *kafkaDelivery) DeliveryTag() uint64 { return uint64(d.msg.Offset) }

// recordMetric safely calls a metrics function if the consumer and
// broker are non-nil (they may be nil in unit tests).
func (d *kafkaDelivery) recordMetric(fn func()) {
	if d.consumer != nil && d.consumer.broker != nil && d.consumer.broker.metrics != nil {
		fn()
	}
}

// commitCtx returns the consumer's context, or background if nil.
func (d *kafkaDelivery) commitCtx() context.Context {
	if d.consumer != nil && d.consumer.ctx != nil {
		return d.consumer.ctx
	}
	return context.Background()
}

// Ack commits the current offset, acknowledging successful processing.
func (d *kafkaDelivery) Ack() error {
	d.ackedManually = true
	if d.reader == nil {
		d.recordMetric(func() { d.consumer.broker.metrics.RecordAck() })
		return nil
	}
	if err := d.reader.CommitMessages(d.commitCtx(), d.msg); err != nil {
		d.recordMetric(func() { d.consumer.broker.metrics.RecordError() })
		return err
	}
	d.recordMetric(func() { d.consumer.broker.metrics.RecordAck() })
	return nil
}

// Nack negatively acknowledges the message. Since Kafka does not support
// per-message nack, this leaves the offset uncommitted. If requeue is
// true, the message will be redelivered on the next poll (because the
// offset is not advanced). If requeue is false, the consumer manually
// advances past this message by committing the next offset.
func (d *kafkaDelivery) Nack(requeue bool) error {
	d.ackedManually = true
	d.recordMetric(func() { d.consumer.broker.metrics.RecordNack() })

	if !requeue && d.reader != nil {
		// Skip this message by committing the next offset.
		skip := d.msg
		skip.Offset++
		if err := d.reader.CommitMessages(d.commitCtx(), skip); err != nil {
			d.recordMetric(func() { d.consumer.broker.metrics.RecordError() })
			return err
		}
	}
	return nil
}

// Reject is similar to Nack. If requeue is true, the offset is left
// uncommitted for redelivery; otherwise the message is skipped.
func (d *kafkaDelivery) Reject(requeue bool) error {
	d.ackedManually = true
	d.recordMetric(func() { d.consumer.broker.metrics.RecordReject() })

	if !requeue && d.reader != nil {
		skip := d.msg
		skip.Offset++
		if err := d.reader.CommitMessages(d.commitCtx(), skip); err != nil {
			d.recordMetric(func() { d.consumer.broker.metrics.RecordError() })
			return err
		}
	}
	return nil
}

// partitionString returns the partition number as a string.
func (d *kafkaDelivery) partitionString() string {
	return strconv.Itoa(d.msg.Partition)
}
