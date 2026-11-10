// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package rabbitmq

import (
	"context"
	"errors"
	"strconv"
	"sync"
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common/mq"
	amqp "github.com/rabbitmq/amqp091-go"
)

// Producer implements mq.Producer for RabbitMQ.
type Producer struct {
	broker   *Broker
	exchange string
	opts     mq.PublishOptions

	mu       sync.Mutex
	ch       *amqp.Channel
	confirms chan amqp.Confirmation
	closed   bool
}

// reopen (re)opens the publishing channel.
func (p *Producer) reopen() error {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.closed {
		return mq.ErrClosed
	}

	// Close old channel if any.
	if p.ch != nil && !p.ch.IsClosed() {
		_ = p.ch.Close()
	}

	ch, err := p.broker.getChannel()
	if err != nil {
		return err
	}

	if p.opts.Confirm {
		if err := ch.Confirm(false); err != nil {
			_ = ch.Close()
			return err
		}
		p.confirms = make(chan amqp.Confirmation, 64)
		ch.NotifyPublish(p.confirms)
	}

	p.ch = ch
	return nil
}

// Publish sends a message to the exchange.
func (p *Producer) Publish(ctx context.Context, msg *mq.Message) error {
	if p.closed {
		return mq.ErrClosed
	}

	p.mu.Lock()
	ch := p.ch
	p.mu.Unlock()

	if ch == nil || ch.IsClosed() {
		if err := p.reopen(); err != nil {
			return err
		}
		p.mu.Lock()
		ch = p.ch
		p.mu.Unlock()
	}

	if msg == nil {
		return errors.New("rabbitmq: message is nil")
	}
	if msg.Timestamp.IsZero() {
		msg.Timestamp = time.Now()
	}

	deliveryMode := amqp.Transient
	if p.opts.Persistent || msg.DeliveryMode == mq.Persistent {
		deliveryMode = amqp.Persistent
	}

	publishing := amqp.Publishing{
		Headers:         msg.Headers,
		ContentType:     msg.ContentType,
		ContentEncoding: msg.ContentEncoding,
		DeliveryMode:    deliveryMode,
		Priority:        msg.Priority,
		CorrelationId:   msg.CorrelationID,
		ReplyTo:         msg.ReplyTo,
		Expiration:      formatExpiration(msg.Expiration),
		MessageId:       msg.ID,
		Timestamp:       msg.Timestamp,
		Type:            msg.Type,
		UserId:          msg.UserID,
		AppId:           msg.AppID,
		Body:            msg.Body,
	}

	err := ch.PublishWithContext(ctx,
		p.exchange,
		msg.RoutingKey,
		p.opts.Mandatory,
		p.opts.Immediate,
		publishing,
	)
	if err != nil {
		p.broker.metrics.RecordError()
		return err
	}

	p.broker.metrics.RecordPublish()

	if p.opts.Confirm && p.confirms != nil {
		select {
		case c, ok := <-p.confirms:
			if !ok {
				return errors.New("rabbitmq: confirm channel closed")
			}
			if !c.Ack {
				return errors.New("rabbitmq: message nacked by broker")
			}
		case <-ctx.Done():
			return ctx.Err()
		}
	}

	return nil
}

// Close releases producer resources.
func (p *Producer) Close() error {
	p.mu.Lock()
	defer p.mu.Unlock()

	p.closed = true
	if p.ch != nil && !p.ch.IsClosed() {
		return p.ch.Close()
	}
	return nil
}

// formatExpiration converts a duration to the AMQP expiration string
// (milliseconds). Empty string means no expiration.
func formatExpiration(d time.Duration) string {
	if d <= 0 {
		return ""
	}
	return strconv.FormatInt(d.Milliseconds(), 10)
}
