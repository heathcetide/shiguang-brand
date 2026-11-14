// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package activemq

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"sync"
	"sync/atomic"
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common/mq"
	"github.com/go-stomp/stomp/v3"
	"github.com/go-stomp/stomp/v3/frame"
)

// Producer implements mq.Producer for ActiveMQ over STOMP. It sends
// messages to a fixed destination using the broker's shared STOMP
// connection.
type Producer struct {
	broker      *Broker
	destination string
	opts        mq.PublishOptions

	mu     sync.Mutex
	closed atomic.Bool
}

// Publish sends a message to the producer's destination. The
// mq.Message fields are mapped onto STOMP SEND frame headers.
func (p *Producer) Publish(ctx context.Context, msg *mq.Message) error {
	if p.closed.Load() {
		return mq.ErrClosed
	}
	if msg == nil {
		return errors.New("activemq: message is nil")
	}

	conn, err := p.broker.connection()
	if err != nil {
		return err
	}

	if msg.Timestamp.IsZero() {
		msg.Timestamp = time.Now()
	}

	contentType := msg.ContentType
	if contentType == "" {
		contentType = "application/octet-stream"
	}

	// Build SEND-frame options from the message metadata.
	var sendOpts []func(*frame.Frame) error
	for k, v := range msg.Headers {
		sendOpts = append(sendOpts, stomp.SendOpt.Header(k, toHeaderValue(v)))
	}

	if msg.ID != "" {
		sendOpts = append(sendOpts, stomp.SendOpt.Header("amq-message-id", msg.ID))
	}
	if msg.CorrelationID != "" {
		sendOpts = append(sendOpts, stomp.SendOpt.Header("correlation-id", msg.CorrelationID))
	}
	if msg.ReplyTo != "" {
		sendOpts = append(sendOpts, stomp.SendOpt.Header("reply-to", msg.ReplyTo))
	}
	if msg.Type != "" {
		sendOpts = append(sendOpts, stomp.SendOpt.Header("type", msg.Type))
	}
	if msg.AppID != "" {
		sendOpts = append(sendOpts, stomp.SendOpt.Header("app-id", msg.AppID))
	}
	if msg.ContentEncoding != "" {
		sendOpts = append(sendOpts, stomp.SendOpt.Header("content-encoding", msg.ContentEncoding))
	}
	if msg.Priority > 0 {
		sendOpts = append(sendOpts, stomp.SendOpt.Header("priority", strconv.Itoa(int(msg.Priority))))
	}
	if msg.Expiration > 0 {
		sendOpts = append(sendOpts, stomp.SendOpt.Header("expires", strconv.FormatInt(msg.Expiration.Milliseconds(), 10)))
	}
	if !msg.Timestamp.IsZero() {
		sendOpts = append(sendOpts, stomp.SendOpt.Header("timestamp", strconv.FormatInt(msg.Timestamp.UnixMilli(), 10)))
	}

	// Persistent delivery: ActiveMQ honours the "persistent" header
	// ("true"/"false") for STOMP messages.
	persistent := p.opts.Persistent || msg.DeliveryMode == mq.Persistent
	sendOpts = append(sendOpts, stomp.SendOpt.Header("persistent", strconv.FormatBool(persistent)))

	// ActiveMQ interprets STOMP frames without a content-length header
	// as text messages. We always include content-length (the library
	// does so by default), so no NoContentLength option is set.

	if err := conn.Send(p.destination, contentType, msg.Body, sendOpts...); err != nil {
		p.broker.metrics.RecordError()
		return fmt.Errorf("activemq: send: %w", err)
	}

	p.broker.metrics.RecordPublish()
	return nil
}

// Close releases producer resources. After Close, Publish returns
// ErrClosed. It is safe to call multiple times.
func (p *Producer) Close() error {
	if !p.closed.CompareAndSwap(false, true) {
		return nil
	}
	// Nothing to release at the connection level: the STOMP connection
	// is owned and closed by the broker.
	return nil
}

// toHeaderValue converts a header value (any) to its STOMP string
// representation.
func toHeaderValue(v any) string {
	switch val := v.(type) {
	case string:
		return val
	case []byte:
		return string(val)
	case bool:
		return strconv.FormatBool(val)
	case int:
		return strconv.Itoa(val)
	case int64:
		return strconv.FormatInt(val, 10)
	case uint64:
		return strconv.FormatUint(val, 10)
	case float64:
		return strconv.FormatFloat(val, 'f', -1, 64)
	default:
		return ""
	}
}
