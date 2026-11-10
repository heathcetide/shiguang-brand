// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package rocketmq

import (
	"context"
	"errors"
	"strconv"
	"sync"
	"sync/atomic"
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common/mq"
	rocketmq "github.com/apache/rocketmq-client-go/v2"
	"github.com/apache/rocketmq-client-go/v2/primitive"
)

// Producer implements mq.Producer for RocketMQ.
type Producer struct {
	broker *Broker
	topic  string
	opts   mq.PublishOptions

	mu     sync.Mutex
	inner  rocketmq.Producer
	closed atomic.Bool
}

// start initializes and starts the underlying rocketmq producer.
func (p *Producer) start() error {
	inner, err := p.broker.newProducer()
	if err != nil {
		return err
	}
	if err := inner.Start(); err != nil {
		_ = inner.Shutdown()
		return err
	}
	p.mu.Lock()
	p.inner = inner
	p.mu.Unlock()
	return nil
}

// Publish sends a message to the producer's topic.
func (p *Producer) Publish(ctx context.Context, msg *mq.Message) error {
	if p.closed.Load() {
		return mq.ErrClosed
	}
	if msg == nil {
		return errors.New("rocketmq: message is nil")
	}

	p.mu.Lock()
	inner := p.inner
	p.mu.Unlock()
	if inner == nil {
		return mq.ErrClosed
	}

	if msg.Timestamp.IsZero() {
		msg.Timestamp = time.Now()
	}

	topic := p.topic
	if msg.Exchange != "" {
		topic = msg.Exchange
	}

	rm := primitive.NewMessage(topic, msg.Body)

	// Map headers / properties.
	if msg.ContentType != "" {
		rm.WithProperty("ContentType", msg.ContentType)
	}
	if msg.ContentEncoding != "" {
		rm.WithProperty("ContentEncoding", msg.ContentEncoding)
	}
	if msg.CorrelationID != "" {
		rm.WithProperty(primitive.PropertyCorrelationID, msg.CorrelationID)
	}
	if msg.ReplyTo != "" {
		rm.WithProperty("ReplyTo", msg.ReplyTo)
	}
	if msg.Type != "" {
		rm.WithProperty("Type", msg.Type)
	}
	if msg.UserID != "" {
		rm.WithProperty("UserID", msg.UserID)
	}
	if msg.AppID != "" {
		rm.WithProperty("AppID", msg.AppID)
	}
	if msg.ID != "" {
		rm.WithProperty("MessageID", msg.ID)
	}
	if !msg.Timestamp.IsZero() {
		rm.WithProperty("Timestamp", strconv.FormatInt(msg.Timestamp.UnixNano(), 10))
	}
	if msg.Expiration > 0 {
		rm.WithProperty("Expiration", strconv.FormatInt(msg.Expiration.Milliseconds(), 10))
	}
	// RoutingKey is mapped to a RocketMQ tag (best-effort).
	if msg.RoutingKey != "" {
		rm.WithTag(msg.RoutingKey)
	}
	// Copy arbitrary headers.
	for k, v := range msg.Headers {
		rm.WithProperty(k, toHeaderString(v))
	}

	result, err := inner.SendSync(ctx, rm)
	if err != nil {
		p.broker.metrics.RecordError()
		return err
	}
	if result.Status != primitive.SendOK {
		p.broker.metrics.RecordError()
		return errors.New("rocketmq: send failed, status: " + strconv.Itoa(int(result.Status)))
	}

	p.broker.metrics.RecordPublish()
	return nil
}

// Close releases producer resources.
func (p *Producer) Close() error {
	if !p.closed.CompareAndSwap(false, true) {
		return nil
	}
	p.mu.Lock()
	inner := p.inner
	p.inner = nil
	p.mu.Unlock()
	if inner != nil {
		return inner.Shutdown()
	}
	return nil
}

// toHeaderString converts a header value to its string representation.
func toHeaderString(v any) string {
	switch val := v.(type) {
	case string:
		return val
	case []byte:
		return string(val)
	case int:
		return strconv.Itoa(val)
	case int64:
		return strconv.FormatInt(val, 10)
	case bool:
		return strconv.FormatBool(val)
	default:
		return ""
	}
}
