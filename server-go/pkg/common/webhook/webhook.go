// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package webhook sends HTTP webhook notifications with automatic JSON
// serialization, HMAC-SHA256 request signing, event filtering, and
// retry with exponential backoff.
//
// # Quick start
//
//	sender := webhook.NewSender(
//	    webhook.WithTimeout(10*time.Second),
//	    webhook.WithMaxRetries(3),
//	    webhook.WithRetryInterval(time.Second),
//	)
//
//	wh := &webhook.Webhook{
//	    URL:    "https://example.com/hook",
//	    Secret: "s3cr3t",
//	    Events: []string{"order.created", "order.paid"},
//	    Active: true,
//	}
//
//	err := sender.SendWithSignature(wh, "order.created", map[string]any{
//	    "order_id": "12345",
//	})
//
// # Signing
//
// When [Sender.SendWithSignature] is used, the request includes an
// `X-Webhook-Signature` header containing the lowercase hex-encoded
// HMAC-SHA256 of the JSON payload keyed by the webhook's Secret. The
// receiver should recompute the HMAC over the raw request body and
// compare it to this header to verify authenticity.
package webhook

import (
	"bytes"
	"crypto/hmac"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common/hash"
)

// Webhook describes a single webhook endpoint configuration.
type Webhook struct {
	// URL is the target endpoint that will receive POST requests.
	URL string
	// Secret is the shared secret used to compute the HMAC-SHA256
	// signature when sending with [Sender.SendWithSignature].
	Secret string
	// Events is the allow-list of event names this webhook should
	// receive. If a sent event is not in this list it is skipped.
	Events []string
	// Active controls whether the webhook is enabled.
	Active bool
}

// SenderOption configures a [Sender].
type SenderOption func(*Sender)

// WithTimeout sets the per-attempt HTTP client timeout. Default 10s.
func WithTimeout(d time.Duration) SenderOption {
	return func(s *Sender) {
		if d > 0 {
			s.timeout = d
		}
	}
}

// WithMaxRetries sets the maximum number of retry attempts after the
// initial request. Default 3. Set to 0 to disable retries.
func WithMaxRetries(n int) SenderOption {
	return func(s *Sender) {
		if n >= 0 {
			s.maxRetries = n
		}
	}
}

// WithRetryInterval sets the base interval for exponential backoff. The
// n-th retry waits for `interval * 2^n`. Default 1s.
func WithRetryInterval(d time.Duration) SenderOption {
	return func(s *Sender) {
		if d > 0 {
			s.retryInterval = d
		}
	}
}

// WithHTTPClient sets a custom *http.Client (useful for testing).
func WithHTTPClient(c *http.Client) SenderOption {
	return func(s *Sender) {
		if c != nil {
			s.client = c
		}
	}
}

// Sender delivers webhook notifications.
type Sender struct {
	client        *http.Client
	timeout       time.Duration
	maxRetries    int
	retryInterval time.Duration
}

// NewSender returns a new [Sender] configured with the given options.
func NewSender(opts ...SenderOption) *Sender {
	s := &Sender{
		client:        &http.Client{},
		timeout:       10 * time.Second,
		maxRetries:    3,
		retryInterval: 1 * time.Second,
	}
	for _, opt := range opts {
		opt(s)
	}
	return s
}

// ErrWebhookInactive is returned when the webhook is not active.
var ErrWebhookInactive = errors.New("webhook: inactive webhook")

// ErrEventNotSubscribed is returned when the webhook does not subscribe
// to the given event. It is NOT retried.
var ErrEventNotSubscribed = errors.New("webhook: event not subscribed")

// ErrEmptyURL is returned when the webhook URL is empty.
var ErrEmptyURL = errors.New("webhook: empty URL")

// Send delivers a webhook notification for the given event. The payload
// is JSON-serialized and sent as the request body with
// Content-Type: application/json. The request includes
// `X-Webhook-Event` and `X-Webhook-Timestamp` headers.
//
// If the webhook is inactive, the event is not in the webhook's Events
// list, or the URL is empty, an error is returned without retrying.
// Network/5xx errors are retried with exponential backoff.
func (s *Sender) Send(wh *Webhook, event string, payload any) error {
	return s.send(wh, event, payload, false)
}

// SendWithSignature is like [Sender.Send] but additionally includes an
// `X-Webhook-Signature` header containing the hex-encoded HMAC-SHA256 of
// the JSON payload keyed by wh.Secret. If wh.Secret is empty this behaves
// identically to [Sender.Send].
func (s *Sender) SendWithSignature(wh *Webhook, event string, payload any) error {
	return s.send(wh, event, payload, true)
}

func (s *Sender) send(wh *Webhook, event string, payload any, sign bool) error {
	if wh == nil {
		return errors.New("webhook: nil webhook")
	}
	if !wh.Active {
		return ErrWebhookInactive
	}
	if wh.URL == "" {
		return ErrEmptyURL
	}
	if !eventSubscribed(wh.Events, event) {
		return ErrEventNotSubscribed
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("webhook: marshal payload: %w", err)
	}

	return s.doWithRetry(wh, event, body, sign)
}

// eventSubscribed reports whether event is in the events list. An empty
// events list means "all events" (subscribed to everything).
func eventSubscribed(events []string, event string) bool {
	if len(events) == 0 {
		return true
	}
	for _, e := range events {
		if e == event {
			return true
		}
	}
	return false
}

// doWithRetry performs the HTTP POST with exponential backoff retries.
// Non-retryable errors (inactive, not subscribed, empty URL, bad payload)
// are returned immediately by the caller before reaching here; this
// function retries on network errors and 5xx responses.
func (s *Sender) doWithRetry(wh *Webhook, event string, body []byte, sign bool) error {
	var lastErr error
	for attempt := 0; attempt <= s.maxRetries; attempt++ {
		err := s.doOnce(wh, event, body, sign)
		if err == nil {
			return nil
		}
		lastErr = err
		if !isRetryable(err) {
			return err
		}
		if attempt < s.maxRetries {
			backoff := s.retryInterval * (1 << attempt)
			time.Sleep(backoff)
		}
	}
	return fmt.Errorf("webhook: send failed after %d attempts: %w", s.maxRetries+1, lastErr)
}

// retryableError wraps an error to mark it as retryable.
type retryableError struct{ err error }

func (e *retryableError) Error() string { return e.err.Error() }
func (e *retryableError) Unwrap() error { return e.err }

// isRetryable reports whether the error should trigger a retry.
func isRetryable(err error) bool {
	var re *retryableError
	return errors.As(err, &re)
}

// doOnce performs a single HTTP POST attempt.
func (s *Sender) doOnce(wh *Webhook, event string, body []byte, sign bool) error {
	req, err := http.NewRequest(http.MethodPost, wh.URL, bytes.NewReader(body))
	if err != nil {
		return &retryableError{err}
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Webhook-Event", event)
	req.Header.Set("X-Webhook-Timestamp", strconv.FormatInt(time.Now().Unix(), 10))
	if sign && wh.Secret != "" {
		req.Header.Set("X-Webhook-Signature", hash.HMACSHA256Hex(body, []byte(wh.Secret)))
	}

	client := s.client
	if client == nil {
		client = &http.Client{}
	}
	resp, err := client.Do(req)
	if err != nil {
		return &retryableError{err}
	}
	defer func() { _ = resp.Body.Close() }()
	_, _ = io.Copy(io.Discard, resp.Body)

	if resp.StatusCode >= 500 {
		return &retryableError{fmt.Errorf("webhook: server returned status %d", resp.StatusCode)}
	}
	if resp.StatusCode >= 400 {
		return fmt.Errorf("webhook: client error status %d", resp.StatusCode)
	}
	return nil
}

// VerifySignature recomputes the HMAC-SHA256 of body keyed by secret and
// reports whether it equals sig (hex-encoded). It is a convenience for
// receivers and uses a constant-time comparison.
func VerifySignature(secret string, body []byte, sig string) bool {
	expected := hash.HMACSHA256Hex(body, []byte(secret))
	return hmac.Equal([]byte(strings.ToLower(sig)), []byte(expected))
}
