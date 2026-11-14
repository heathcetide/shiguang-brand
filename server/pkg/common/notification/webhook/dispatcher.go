// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package webhook

import (
	"bytes"
	"context"
	"crypto/hmac"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common/hash"
)

// ──────────────────────────────────────────────
// Dispatcher
// ──────────────────────────────────────────────

// Dispatcher delivers webhook payloads with retry and DLQ support.
type Dispatcher struct {
	store        DeliveryStore
	maxAttempts  int
	httpClient   *http.Client
	allowPrivate bool
}

// DispatcherOption configures a Dispatcher.
type DispatcherOption func(*Dispatcher)

// WithStore sets the delivery log store.
func WithStore(store DeliveryStore) DispatcherOption {
	return func(d *Dispatcher) {
		if store != nil {
			d.store = store
		}
	}
}

// WithMaxAttempts overrides the default max delivery attempts.
func WithMaxAttempts(n int) DispatcherOption {
	return func(d *Dispatcher) {
		if n > 0 {
			d.maxAttempts = n
		}
	}
}

// WithHTTPClient sets a custom HTTP client.
func WithHTTPClient(c *http.Client) DispatcherOption {
	return func(d *Dispatcher) {
		if c != nil {
			d.httpClient = c
		}
	}
}

// WithAllowPrivateURLs allows delivery to localhost and private IP ranges.
// Use only in development or testing.
func WithAllowPrivateURLs(allow bool) DispatcherOption {
	return func(d *Dispatcher) {
		d.allowPrivate = allow
	}
}

// NewDispatcher creates a new webhook Dispatcher.
func NewDispatcher(opts ...DispatcherOption) *Dispatcher {
	d := &Dispatcher{
		store:       NoopDeliveryStore{},
		maxAttempts: DefaultMaxAttempts,
		httpClient:  &http.Client{Timeout: 30 * time.Second},
	}
	for _, opt := range opts {
		opt(d)
	}
	return d
}

// Dispatch delivers an event payload to the configured webhook URL.
// If the webhook is disabled or the event doesn't match, it returns nil
// (skip). On delivery failure, a delivery log is created for retry.
func (d *Dispatcher) Dispatch(ctx context.Context, cfg WebhookConfig, event string, data map[string]any) error {
	if !cfg.Enabled {
		return nil
	}

	// Check event subscription.
	if len(cfg.Events) > 0 && !containsEvent(cfg.Events, event) {
		return nil
	}

	// Validate URL.
	if err := ValidateURL(cfg.URL, d.allowPrivate); err != nil {
		return fmt.Errorf("webhook: invalid URL: %w", err)
	}

	// Build payload.
	payload := Payload{
		Event:     event,
		Timestamp: strconv.FormatInt(time.Now().Unix(), 10),
		Data:      data,
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("webhook: marshal payload: %w", err)
	}

	maxAttempts := cfg.MaxAttempts
	if maxAttempts <= 0 {
		maxAttempts = d.maxAttempts
	}

	// Attempt delivery.
	deliveryID := generateDeliveryID()
	logEntry := DeliveryLog{
		ID:        deliveryID,
		URL:       cfg.URL,
		Event:     event,
		Payload:   body,
		Status:    StatusPending,
		CreatedAt: time.Now(),
	}
	_ = d.store.CreateDelivery(logEntry)

	err = d.doSend(ctx, cfg, body)
	if err == nil {
		logEntry.Status = StatusSent
		logEntry.RetryCount = 0
		_ = d.store.UpdateDelivery(logEntry)
		return nil
	}

	logEntry.ErrorMsg = err.Error()
	logEntry.RetryCount = 1
	if logEntry.RetryCount >= maxAttempts {
		logEntry.Status = StatusDLQ
	} else {
		logEntry.Status = StatusFailed
		logEntry.NextRetryAt = time.Now().Add(backoffDuration(logEntry.RetryCount))
	}
	_ = d.store.UpdateDelivery(logEntry)
	return err
}

// ProcessRetries processes pending retries from the store.
// Returns the number of deliveries processed.
func (d *Dispatcher) ProcessRetries(ctx context.Context) int {
	pending, err := d.store.GetPendingRetries(100)
	if err != nil || len(pending) == 0 {
		return 0
	}

	processed := 0
	for _, log := range pending {
		// Re-parse the webhook config from the log (URL only; no secret).
		cfg := WebhookConfig{
			URL:     log.URL,
			Enabled: true,
		}

		err := d.doSend(ctx, cfg, log.Payload)
		processed++

		if err == nil {
			log.Status = StatusSent
			_ = d.store.UpdateDelivery(log)
			continue
		}

		log.ErrorMsg = err.Error()
		log.RetryCount++
		if log.RetryCount >= d.maxAttempts {
			log.Status = StatusDLQ
		} else {
			log.Status = StatusFailed
			log.NextRetryAt = time.Now().Add(backoffDuration(log.RetryCount))
		}
		_ = d.store.UpdateDelivery(log)
	}

	return processed
}

// doSend performs the actual HTTP POST.
func (d *Dispatcher) doSend(ctx context.Context, cfg WebhookConfig, body []byte) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, cfg.URL, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("webhook: create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "ling-base-webhook/1.0")

	if cfg.Secret != "" {
		sig := SignPayload(body, cfg.Secret)
		req.Header.Set("X-Webhook-Signature", sig)
	}

	resp, err := d.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("webhook: send: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	_, _ = io.Copy(io.Discard, resp.Body)

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("webhook: HTTP %d", resp.StatusCode)
	}
	return nil
}

// ──────────────────────────────────────────────
// Signing
// ──────────────────────────────────────────────

// SignPayload computes the HMAC-SHA256 signature of the payload using
// the secret, returned as a base64-encoded string.
func SignPayload(payload []byte, secret string) string {
	return base64.StdEncoding.EncodeToString(hash.HMACSHA256(payload, []byte(secret)))
}

// VerifySignature checks whether the provided signature matches the
// HMAC-SHA256 of the payload.
func VerifySignature(payload []byte, secret, signature string) bool {
	expected := SignPayload(payload, secret)
	return hmac.Equal([]byte(expected), []byte(signature))
}

// ──────────────────────────────────────────────
// URL validation (SSRF protection)
// ──────────────────────────────────────────────

// ValidateURL checks that a URL is safe to deliver webhooks to. It
// rejects non-HTTP(S) schemes, localhost, and private IP ranges unless
// allowPrivate is true.
func ValidateURL(rawURL string, allowPrivate bool) error {
	u, err := url.Parse(rawURL)
	if err != nil {
		return fmt.Errorf("invalid URL: %w", err)
	}

	scheme := strings.ToLower(u.Scheme)
	if scheme != "http" && scheme != "https" {
		return fmt.Errorf("scheme %q not allowed (must be http or https)", scheme)
	}

	host := u.Hostname()
	if host == "" {
		return fmt.Errorf("empty host")
	}

	if !allowPrivate {
		if err := checkHostNotPrivate(host); err != nil {
			return err
		}
	}

	return nil
}

// checkHostNotPrivate rejects localhost, private IPs, and link-local addresses.
func checkHostNotPrivate(host string) error {
	lower := strings.ToLower(host)
	if lower == "localhost" || lower == "127.0.0.1" || lower == "0.0.0.0" || lower == "::1" {
		return fmt.Errorf("localhost addresses are not allowed")
	}

	ip := net.ParseIP(host)
	if ip == nil {
		// Domain name — allow (DNS resolution is deferred to the HTTP client).
		return nil
	}

	if ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsUnspecified() {
		return fmt.Errorf("private/loopback IP %s is not allowed", host)
	}

	return nil
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

func containsEvent(events []string, event string) bool {
	for _, e := range events {
		if strings.EqualFold(e, event) {
			return true
		}
	}
	return false
}

// backoffDuration computes exponential backoff: 2s, 4s, 8s, 16s, 32s (capped).
func backoffDuration(retryCount int) time.Duration {
	if retryCount <= 0 {
		return 2 * time.Second
	}
	d := time.Duration(1<<retryCount) * time.Second
	if d > 32*time.Second {
		return 32 * time.Second
	}
	return d
}

func generateDeliveryID() string {
	return fmt.Sprintf("wh-%d", time.Now().UnixNano())
}
