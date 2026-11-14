package payment

import "context"

// PaymentProvider is the provider-neutral interface every adapter
// implements. Business code depends only on this interface; concrete
// adapters are constructed in their respective sub-packages.
//
// All methods are safe for concurrent use. Adapters hold only immutable
// configuration after construction.
type PaymentProvider interface {
	// Provider returns the gateway identifier. Stable across adapter
	// instances of the same gateway.
	Provider() Provider

	// CreateCheckout creates a checkout session or payment link for the
	// given request. The payer must be redirected to CheckoutResult.
	// CheckoutURL (or submit CheckoutResult.Params to it).
	CreateCheckout(ctx context.Context, req *CheckoutRequest) (*CheckoutResult, error)

	// VerifyWebhook verifies the webhook signature and parses the payload
	// into a normalized WebhookEvent. It MUST NOT perform any business
	// side effects; the caller is responsible for order reconciliation.
	// Returns ErrInvalidSignature when the signature does not match.
	VerifyWebhook(ctx context.Context, req *WebhookVerifyRequest) (*WebhookEvent, error)

	// BuildWebhookResponse constructs the provider-specific HTTP response
	// to send back after handling a webhook. success indicates whether
	// the event was processed successfully; msg is an optional message
	// for failure responses.
	BuildWebhookResponse(ctx context.Context, success bool, msg string) (*WebhookResponse, error)

	// QueryOrder queries the provider's API for the current status of an
	// order. Useful for reconciling missed or delayed webhooks. Returns
	// ErrOrderNotFound when the provider has no record of the order.
	QueryOrder(ctx context.Context, req *OrderQuery) (*OrderQueryResult, error)
}

// Configured reports whether the adapter has the minimum credentials to
// operate. Adapters implement this as a non-interface helper (e.g.
// `epay.New(cfg).Configured()`) so callers can gate checkout/webhook
// routes without constructing a full provider.
type Configured interface {
	Configured() bool
}

// Refunder is an optional capability interface for providers that support
// refund submission. Adapters implement this alongside PaymentProvider
// when the gateway exposes a refund API.
type Refunder interface {
	Refund(ctx context.Context, req *RefundRequest) (*RefundResult, error)
}

// BalanceQuerier is an optional capability interface for providers that
// support account balance queries. Adapters implement this alongside
// PaymentProvider when the gateway exposes a balance API.
type BalanceQuerier interface {
	QueryBalance(ctx context.Context) (*BalanceResult, error)
}
