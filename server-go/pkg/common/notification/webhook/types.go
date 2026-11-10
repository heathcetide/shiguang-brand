// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package webhook

import "time"

// Payload is the JSON body delivered to a webhook endpoint.
type Payload struct {
	Event     string         `json:"event"`
	Timestamp string         `json:"timestamp"`
	Data      map[string]any `json:"data,omitempty"`
}

// Delivery status constants used by DeliveryLog.Status.
const (
	// StatusPending means a delivery is awaiting its first attempt or a retry.
	StatusPending = "pending"
	// StatusSent means the delivery succeeded.
	StatusSent = "sent"
	// StatusFailed means the delivery failed but may still be retried.
	StatusFailed = "failed"
	// StatusDLQ means the delivery exhausted all retries and was moved to the dead-letter queue.
	StatusDLQ = "dlq"
)

// DeliveryLog records a single webhook delivery attempt and its retry state.
type DeliveryLog struct {
	ID          string    // unique delivery ID
	URL         string    // target webhook URL
	Event       string    // webhook event name
	Payload     []byte    // marshalled payload bytes
	Status      string    // one of the Status* constants
	ErrorMsg    string    // last error message (if any)
	RetryCount  int       // number of retries attempted so far
	NextRetryAt time.Time // when the next retry should be attempted
	CreatedAt   time.Time // when the log was created
}

// DeliveryStore is the pluggable persistence interface for webhook
// delivery logs. Applications provide a concrete implementation (e.g.
// gorm-backed); a no-op store is acceptable for testing.
type DeliveryStore interface {
	// CreateDelivery persists a new delivery log.
	CreateDelivery(log DeliveryLog) error
	// UpdateDelivery updates an existing delivery log in place.
	UpdateDelivery(log DeliveryLog) error
	// GetPendingRetries returns up to limit delivery logs that are
	// pending retry (Status == StatusPending and NextRetryAt <= now).
	GetPendingRetries(limit int) ([]DeliveryLog, error)
	// GetDelivery retrieves a delivery log by ID.
	GetDelivery(id string) (*DeliveryLog, error)
}

// NoopDeliveryStore is a no-op DeliveryStore for testing or when
// persistence is not required. Every method is a no-op.
type NoopDeliveryStore struct{}

// CreateDelivery implements DeliveryStore.
func (NoopDeliveryStore) CreateDelivery(log DeliveryLog) error { return nil }

// UpdateDelivery implements DeliveryStore.
func (NoopDeliveryStore) UpdateDelivery(log DeliveryLog) error { return nil }

// GetPendingRetries implements DeliveryStore.
func (NoopDeliveryStore) GetPendingRetries(limit int) ([]DeliveryLog, error) {
	return nil, nil
}

// GetDelivery implements DeliveryStore.
func (NoopDeliveryStore) GetDelivery(id string) (*DeliveryLog, error) {
	return nil, nil
}

// WebhookConfig describes a single webhook subscription.
type WebhookConfig struct {
	URL         string   // target webhook URL
	Secret      string   // optional HMAC-SHA256 signing secret
	Events      []string // event names to deliver; empty means all events
	Enabled     bool     // whether this subscription is active
	MaxAttempts int      // max delivery attempts before DLQ (0 => DefaultMaxAttempts)
}

// DefaultMaxAttempts is the default maximum number of delivery attempts
// (including the first attempt) before a webhook is moved to the DLQ.
const DefaultMaxAttempts = 5
