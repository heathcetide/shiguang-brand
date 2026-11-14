// Package waffopancake implements the [payment.PaymentProvider] interface
// for Waffo Pancake hosted checkout using the official
// github.com/waffo-com/waffo-pancake-sdk-go SDK.
//
// Waffo Pancake is a hosted-checkout product offered by Waffo. The adapter
// creates authenticated checkout sessions bound to a stable buyer identity
// and verifies webhook signatures using the SDK's built-in public keys.
//
// The adapter is stateless after construction and safe for concurrent use.
package waffopancake

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common/payment"
	pancake "github.com/waffo-com/waffo-pancake-sdk-go"
)

// Config holds the Waffo Pancake SDK credentials.
type Config struct {
	// MerchantID is the Pancake merchant id (MER_{base62}).
	MerchantID string

	// PrivateKey is the merchant RSA private key in PEM or base64 form.
	PrivateKey string

	// ProductID is the default Pancake OnetimeProduct id used when the
	// CheckoutRequest does not carry a ProductID.
	ProductID string

	// HTTPTimeout is the timeout for outbound API calls. Defaults to 30s.
	HTTPTimeout time.Duration
}

// Option mutates Config.
type Option func(*Config)

// WithHTTPTimeout sets the outbound HTTP timeout.
func WithHTTPTimeout(d time.Duration) Option {
	return func(c *Config) { c.HTTPTimeout = d }
}

// New constructs a Waffo Pancake adapter.
func New(cfg Config, opts ...Option) *Adapter {
	for _, o := range opts {
		if o != nil {
			o(&cfg)
		}
	}
	return &Adapter{cfg: cfg}
}

// Adapter implements payment.PaymentProvider for Waffo Pancake.
type Adapter struct {
	cfg Config
}

// Configured reports whether the adapter has the minimum credentials.
func (a *Adapter) Configured() bool {
	return a.cfg.MerchantID != "" && a.cfg.PrivateKey != "" && a.cfg.ProductID != ""
}

// Provider returns the gateway identifier.
func (a *Adapter) Provider() payment.Provider { return payment.ProviderWaffoPancake }

// client builds a Pancake SDK client from the current configuration.
func (a *Adapter) client() (*pancake.Client, error) {
	c, err := pancake.New(pancake.Config{
		MerchantID: a.cfg.MerchantID,
		PrivateKey: a.cfg.PrivateKey,
	})
	if err != nil {
		return nil, fmt.Errorf("%w: build client: %v", payment.ErrNotConfigured, err)
	}
	return c, nil
}

// CreateCheckout creates an authenticated Pancake checkout session bound
// to req.CustomerID as the buyer identity. The session URL carries a
// #token=... fragment that pre-authenticates the buyer.
//
// req.ProductID overrides Config.ProductID when set. req.TradeNo is
// passed as orderMerchantExternalId and echoed back in webhook events.
func (a *Adapter) CreateCheckout(ctx context.Context, req *payment.CheckoutRequest) (*payment.CheckoutResult, error) {
	if !a.Configured() {
		return nil, payment.ErrNotConfigured
	}
	if req == nil || req.TradeNo == "" {
		return nil, fmt.Errorf("%w: missing trade_no", payment.ErrInvalidRequest)
	}

	productID := req.ProductID
	if productID == "" {
		productID = a.cfg.ProductID
	}
	if productID == "" {
		return nil, fmt.Errorf("%w: missing product_id", payment.ErrInvalidRequest)
	}

	// BuyerIdentity is required by the authenticated checkout flow. Fall
	// back to TradeNo when the caller did not provide a stable customer id.
	buyerIdentity := req.CustomerID
	if buyerIdentity == "" {
		buyerIdentity = req.TradeNo
	}

	currency := string(req.Currency)
	if currency == "" {
		currency = "USD"
	}

	client, err := a.client()
	if err != nil {
		return nil, err
	}

	params := pancake.AuthenticatedCheckoutParams{
		CreateCheckoutSessionParams: pancake.CreateCheckoutSessionParams{
			ProductID:               productID,
			Currency:                currency,
			BuyerEmail:              optionalString(req.CustomerEmail),
			ExpiresInSeconds:        req.ExpiresInSeconds,
			OrderMerchantExternalID: optionalString(req.TradeNo),
			Metadata:                req.Metadata,
		},
		BuyerIdentity: buyerIdentity,
	}
	if req.Money > 0 {
		params.PriceSnapshot = &pancake.PriceSnapshot{
			Amount:      fmt.Sprintf("%.2f", float64(req.Money)),
			TaxCategory: pancake.TaxCategory("saas"),
		}
	}

	session, err := client.Checkout.Authenticated.Create(ctx, params)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", payment.ErrProviderError, err)
	}
	if session == nil || session.CheckoutURL == "" || session.SessionID == "" {
		return nil, fmt.Errorf("%w: empty checkout session", payment.ErrProviderError)
	}

	return &payment.CheckoutResult{
		Provider:    payment.ProviderWaffoPancake,
		CheckoutURL: session.CheckoutURL,
		SessionID:   session.SessionID,
		Raw:         session,
	}, nil
}

// VerifyWebhook verifies the X-Waffo-Signature header using the SDK's
// built-in public keys and parses the payload into a normalized
// WebhookEvent.
func (a *Adapter) VerifyWebhook(ctx context.Context, req *payment.WebhookVerifyRequest) (*payment.WebhookEvent, error) {
	if !a.Configured() {
		return nil, payment.ErrNotConfigured
	}
	if req == nil || len(req.RawBody) == 0 {
		return nil, fmt.Errorf("%w: empty body", payment.ErrInvalidRequest)
	}
	if req.Signature == "" {
		return nil, fmt.Errorf("%w: missing signature", payment.ErrInvalidSignature)
	}

	evt, err := pancake.VerifyWebhookTyped[pancake.WebhookEventData](string(req.RawBody), req.Signature, nil)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", payment.ErrInvalidSignature, err)
	}

	out := &payment.WebhookEvent{
		Provider: payment.ProviderWaffoPancake,
		Mode:     string(evt.Mode),
		Raw:      evt,
		RawBody:  req.RawBody,
	}

	if evt.Data.OrderMerchantExternalID != nil {
		out.TradeNo = *evt.Data.OrderMerchantExternalID
	}
	out.ProviderOrderID = evt.Data.OrderID
	out.CustomerEmail = evt.Data.BuyerEmail
	if evt.Data.MerchantProvidedBuyerIdentity != nil {
		out.CustomerID = *evt.Data.MerchantProvidedBuyerIdentity
	}
	if evt.Data.Currency != "" {
		out.Currency = payment.Currency(strings.ToUpper(evt.Data.Currency))
	}
	if evt.Data.Amount != "" {
		var m float64
		if _, err := fmt.Sscanf(evt.Data.Amount, "%f", &m); err == nil {
			out.MoneyPaid = payment.Money(m)
		}
	}

	switch evt.EventType {
	case "order.completed":
		out.EventType = payment.EventCheckoutCompleted
		out.Status = payment.StatusSuccess
	case "order.expired":
		out.EventType = payment.EventCheckoutExpired
		out.Status = payment.StatusExpired
	case "order.failed":
		out.EventType = payment.EventAsyncPaymentFailed
		out.Status = payment.StatusFailed
	case "refund.completed":
		out.EventType = payment.EventRefund
		out.Status = payment.StatusRefunded
	default:
		out.EventType = payment.EventUnknown
		out.Status = payment.StatusPending
	}

	return out, nil
}

// BuildWebhookResponse returns a plain-text "OK" / "retry" response for
// Waffo Pancake. Pancake does not require a signed response body.
func (a *Adapter) BuildWebhookResponse(ctx context.Context, success bool, msg string) (*payment.WebhookResponse, error) {
	body := "OK"
	code := 200
	if !success {
		body = "retry"
		code = 500
	}
	return &payment.WebhookResponse{
		StatusCode:  code,
		Body:        []byte(body),
		ContentType: "text/plain; charset=utf-8",
	}, nil
}

// QueryOrder is not supported by the Pancake public API in this adapter.
// Returns an error wrapping payment.ErrProviderError.
func (a *Adapter) QueryOrder(ctx context.Context, req *payment.OrderQuery) (*payment.OrderQueryResult, error) {
	return nil, fmt.Errorf("%w: pancake order query not implemented", payment.ErrProviderError)
}

// optionalString returns a *string copy of s when non-empty, otherwise nil.
func optionalString(s string) *string {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	v := s
	return &v
}
