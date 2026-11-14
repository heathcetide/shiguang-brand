// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package kafka

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common/mq"
	kafkago "github.com/segmentio/kafka-go"
)

// Producer implements mq.Producer for Kafka using a kafka.Writer.
type Producer struct {
	broker *Broker
	topic  string
	opts   mq.PublishOptions

	mu     sync.Mutex
	writer *kafkago.Writer
	closed bool
}

// newProducer creates a new Kafka producer.
func newProducer(b *Broker, topic string, opts mq.PublishOptions) (*Producer, error) {
	w := &kafkago.Writer{
		Addr:         kafkago.TCP(b.cfg.Brokers...),
		Topic:        topic,
		Balancer:     &kafkago.Hash{}, // partition by message key
		RequiredAcks: kafkago.RequireAll,
		BatchTimeout: 10 * time.Millisecond,
		Async:        false,
		Transport: &kafkago.Transport{
			TLS: b.tlsConfig(),
		},
	}

	return &Producer{
		broker: b,
		topic:  topic,
		opts:   opts,
		writer: w,
	}, nil
}

// Publish sends a message to the Kafka topic.
func (p *Producer) Publish(ctx context.Context, msg *mq.Message) error {
	if msg == nil {
		return errors.New("kafka: message is nil")
	}

	p.mu.Lock()
	closed := p.closed
	w := p.writer
	p.mu.Unlock()

	if closed || w == nil {
		return mq.ErrClosed
	}

	if msg.Timestamp.IsZero() {
		msg.Timestamp = time.Now()
	}

	// Build Kafka headers from mq.Message.Headers.
	var headers []kafkago.Header
	for k, v := range msg.Headers {
		headers = append(headers, kafkago.Header{
			Key:   k,
			Value: toBytes(v),
		})
	}

	// Use msg.ID as the Kafka message key (enables partition affinity).
	// If ID is empty, use RoutingKey as the key for partition routing.
	key := msg.ID
	if key == "" {
		key = msg.RoutingKey
	}

	kmsg := kafkago.Message{
		Key:     []byte(key),
		Value:   msg.Body,
		Headers: headers,
		Time:    msg.Timestamp,
	}

	err := w.WriteMessages(ctx, kmsg)
	if err != nil {
		p.broker.metrics.RecordError()
		return err
	}

	p.broker.metrics.RecordPublish()
	return nil
}

// Close releases producer resources.
func (p *Producer) Close() error {
	p.mu.Lock()
	defer p.mu.Unlock()

	p.closed = true
	if p.writer != nil {
		err := p.writer.Close()
		p.writer = nil
		return err
	}
	return nil
}

// toBytes converts a header value to a byte slice.
func toBytes(v any) []byte {
	switch val := v.(type) {
	case nil:
		return nil
	case []byte:
		return val
	case string:
		return []byte(val)
	default:
		return []byte(fmt.Sprintf("%v", v))
	}
}
