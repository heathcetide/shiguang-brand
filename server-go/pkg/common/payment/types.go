// Package payment defines a unified payment-provider interface and shared
// types for checkout creation, webhook verification, and order lifecycle
// management across multiple third-party payment gateways.
//
// The interface is provider-neutral: business code depends only on
// PaymentProvider, while concrete adapters live under sub-packages
// (epay, stripe, creem, waffo, waffopancake).
package payment

import (
	"errors"
	"time"
)

// Provider identifies a payment gateway. It is stable across adapters and
// used as the discriminator stored alongside orders.
type Provider string

const (
	ProviderEpay         Provider = "epay"
	ProviderStripe       Provider = "stripe"
	ProviderCreem        Provider = "creem"
	ProviderWaffo        Provider = "waffo"
	ProviderWaffoPancake Provider = "waffo_pancake"
)

// OrderStatus is the normalized lifecycle state of a payment order. Adapters
// map provider-specific states onto these values.
type OrderStatus string

const (
	StatusPending OrderStatus = "pending"
	StatusSuccess OrderStatus = "success"
	StatusFailed  OrderStatus = "failed"
	StatusExpired OrderStatus = "expired"
	StatusRefunded OrderStatus = "refunded"
)

// EventType is the normalized webhook event type.
type EventType string

const (
	EventCheckoutCompleted     EventType = "checkout.completed"
	EventCheckoutExpired       EventType = "checkout.expired"
	EventAsyncPaymentSucceeded EventType = "async_payment.succeeded"
	EventAsyncPaymentFailed    EventType = "async_payment.failed"
	EventPaymentNotification   EventType = "payment.notification"
	EventRefund                EventType = "refund"
	EventUnknown               EventType = "unknown"
)

// DeviceType selects the checkout page layout for gateways that distinguish
// PC vs mobile flows (e.g. Epay).
type DeviceType string

const (
	DevicePC     DeviceType = "pc"
	DeviceMobile DeviceType = "mobile"
)

// Money is the amount to charge, expressed in the provider's smallest unit
// convention. For most providers this is the major currency as a float64
// (e.g. USD 12.34). Adapters that require minor units (Stripe cents,
// Creem integer) convert internally.
type Money float64

// Currency is the ISO 4217 currency code (e.g. "USD", "CNY").
type Currency string

// CheckoutRequest is the provider-neutral input for creating a checkout
// session or payment link.
type CheckoutRequest struct {
	// TradeNo is the merchant-issued unique order reference. It is echoed
	// back in webhook events and used to reconcile the order.
	TradeNo string

	// Amount is the user-facing quantity being purchased (e.g. credits,
	// tokens, units). It is NOT the money amount; use Money for that.
	Amount int64

	// Money is the actual amount to charge the payer.
	Money Money

	// Currency is the charge currency. Defaults to "USD" when empty.
	Currency Currency

	// Name is a short description of the goods/plan, shown on the
	// provider's checkout page when supported.
	Name string

	// Device selects the checkout page layout when the provider supports it.
	Device DeviceType

	// NotifyURL is the webhook endpoint the provider should call.
	NotifyURL string

	// ReturnURL is the browser redirect target after the payer completes
	// or cancels the flow.
	ReturnURL string

	// CustomerEmail is optional; some providers pre-fill it on checkout.
	CustomerEmail string

	// CustomerID is an optional provider-side customer reference (e.g.
	// Stripe Customer object id). Empty for first-time checkouts.
	CustomerID string

	// ProductID is the provider-side product/price reference for gateways
	// that operate on pre-registered products (Creem, Waffo Pancake).
	ProductID string

	// Metadata is arbitrary key/value pairs forwarded to the provider when
	// supported. Useful for tying orders to internal entities.
	Metadata map[string]string

	// ClientIP is the payer's IP address. Required by some providers'
	// API-mode checkout (e.g. Epay /mapi.php) for risk control.
	ClientIP string

	// ExpiresInSeconds optionally limits the checkout session lifetime.
	ExpiresInSeconds *int
}

// CheckoutResult is the provider-neutral output of a checkout creation.
type CheckoutResult struct {
	// Provider is the gateway that produced this result.
	Provider Provider

	// CheckoutURL is the URL the payer's browser should be redirected to.
	// For providers that return a form instead of a URL, this is the form
	// action and Params holds the form fields.
	CheckoutURL string

	// SessionID is the provider-side session/order identifier, when
	// available. Useful for status polling.
	SessionID string

	// Params is the set of form parameters to submit to CheckoutURL when
	// the provider uses a form-post flow (e.g. Epay). Empty for redirect
	// flows.
	Params map[string]string

	// Raw is the raw provider response, retained for logging/debugging.
	Raw any
}

// WebhookVerifyRequest carries the raw webhook payload and metadata needed
// to verify the provider's signature.
type WebhookVerifyRequest struct {
	// Provider identifies which adapter to use.
	Provider Provider

	// RawBody is the exact bytes received in the webhook request body.
	// Required by HMAC / Stripe signature verification.
	RawBody []byte

	// Signature is the value of the provider's signature header.
	// Header name is provider-specific (Stripe-Signature, creem-signature,
	// X-SIGNATURE, X-Waffo-Signature).
	Signature string

	// FormParams holds parsed form parameters for providers that send
	// webhook data as URL-encoded form fields (Epay GET/POST callbacks).
	FormParams map[string]string

	// Headers is the full webhook request header set, for adapters that
	// need additional headers beyond the signature.
	Headers map[string]string
}

// WebhookEvent is the normalized, signature-verified webhook payload.
type WebhookEvent struct {
	// Provider is the gateway that emitted this event.
	Provider Provider

	// EventType is the normalized event type.
	EventType EventType

	// TradeNo is the merchant order reference extracted from the event.
	// Empty when the provider did not echo it back.
	TradeNo string

	// ProviderOrderID is the provider's own order/session identifier.
	ProviderOrderID string

	// Status is the normalized order status derived from the event.
	Status OrderStatus

	// CustomerID is the provider-side customer reference, when present.
	CustomerID string

	// CustomerEmail is the payer's email, when present.
	CustomerEmail string

	// CustomerName is the payer's display name, when present.
	CustomerName string

	// MoneyPaid is the actually paid amount, when reported by the provider.
	MoneyPaid Money

	// Currency is the charge currency reported by the provider.
	Currency Currency

	// OrderType is the provider's order type discriminator (e.g. Creem
	// "onetime" vs recurring). Empty when not applicable.
	OrderType string

	// Mode distinguishes test vs production events for providers that
	// emit both (Creem, Waffo Pancake).
	Mode string

	// Raw is the original parsed payload, retained for logging/auditing.
	Raw any

	// RawBody is the raw webhook body bytes, retained for persistence.
	RawBody []byte
}

// WebhookResponse is the provider-neutral response to send back to the
// provider after handling a webhook. Providers have different expectations:
// Epay expects "success" text, Stripe expects 200 OK, Waffo expects a
// signed JSON body, etc.
type WebhookResponse struct {
	// StatusCode is the HTTP status to return.
	StatusCode int

	// Body is the response body bytes.
	Body []byte

	// ContentType is the response Content-Type header value.
	ContentType string

	// Headers holds additional response headers (e.g. X-SIGNATURE for
	// Waffo signed responses).
	Headers map[string]string
}

// OrderQuery is the provider-neutral input for querying an order's status
// from the provider's API (not via webhook).
type OrderQuery struct {
	TradeNo        string
	ProviderOrderID string
}

// OrderQueryResult is the provider-neutral output of an order status query.
type OrderQueryResult struct {
	TradeNo        string
	ProviderOrderID string
	Status         OrderStatus
	MoneyPaid      Money
	Currency       Currency
	PaidAt         *time.Time
	Raw            any
}

// Common sentinel errors returned by adapters. Adapters may wrap these with
// additional context using %w.
var (
	// ErrNotConfigured indicates the adapter is missing required credentials
	// or endpoint configuration.
	ErrNotConfigured = errors.New("payment: provider not configured")

	// ErrInvalidSignature indicates webhook signature verification failed.
	ErrInvalidSignature = errors.New("payment: invalid webhook signature")

	// ErrInvalidRequest indicates the checkout/webhook request is malformed
	// or missing required fields.
	ErrInvalidRequest = errors.New("payment: invalid request")

	// ErrProviderError indicates the provider returned an error response.
	ErrProviderError = errors.New("payment: provider error")

	// ErrOrderNotFound indicates the provider did not find the referenced
	// order.
	ErrOrderNotFound = errors.New("payment: order not found")

	// ErrRefundFailed indicates the provider rejected a refund request.
	ErrRefundFailed = errors.New("payment: refund failed")
)

// RefundRequest is the provider-neutral input for submitting a refund.
type RefundRequest struct {
	// TradeNo is the merchant order reference. Either TradeNo or
	// ProviderOrderID must be set.
	TradeNo string

	// ProviderOrderID is the provider's own order identifier.
	ProviderOrderID string

	// Money is the amount to refund. Some providers require this to
	// match the original charge exactly.
	Money Money

	// Reason is an optional refund reason.
	Reason string
}

// RefundResult is the provider-neutral output of a refund request.
type RefundResult struct {
	// TradeNo is the merchant order reference.
	TradeNo string

	// ProviderOrderID is the provider's own order identifier.
	ProviderOrderID string

	// ProviderRefundID is the provider's refund transaction id, when
	// available.
	ProviderRefundID string

	// Status is the refund status (typically StatusRefunded or
	// StatusPending).
	Status OrderStatus

	// Raw is the raw provider response.
	Raw any
}

// BalanceResult is the provider-neutral output of an account balance
// query.
type BalanceResult struct {
	// Balance is the current account balance.
	Balance Money

	// Currency is the balance currency, when reported.
	Currency Currency

	// Raw is the raw provider response.
	Raw any
}
