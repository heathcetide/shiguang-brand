// Package stripe implements the [payment.PaymentProvider] interface for
// Stripe Checkout (v81).
//
// The adapter wraps github.com/stripe/stripe-go/v81 to create Checkout
// Sessions and verify webhook signatures. It is stateless after
// construction and safe for concurrent use.
package stripe

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common/payment"
	stripe "github.com/stripe/stripe-go/v81"
	"github.com/stripe/stripe-go/v81/checkout/session"
	stripewebhook "github.com/stripe/stripe-go/v81/webhook"
)

// Config holds the Stripe API credentials.
type Config struct {
	// APIKey is the secret key (sk_live_... or sk_test_...).
	APIKey string

	// WebhookSecret is the signing secret for the webhook endpoint
	// (whsec_...).
	WebhookSecret string

	// PriceID is the default Stripe Price object id used when the
	// CheckoutRequest does not carry a ProductID. May be empty if
	// callers always pass ProductID.
	PriceID string

	// UnitPrice is the fallback USD price per unit when PriceID is empty
	// and the adapter must build an inline price. Expressed in USD
	// major units (e.g. 8.0 means $8.00).
	UnitPrice float64

	// HTTPTimeout is the timeout for outbound API calls. Defaults to 30s.
	HTTPTimeout time.Duration
}

// Option mutates Config.
type Option func(*Config)

// WithHTTPTimeout sets the outbound HTTP timeout.
func WithHTTPTimeout(d time.Duration) Option {
	return func(c *Config) { c.HTTPTimeout = d }
}

// New constructs a Stripe adapter. Returns nil when not configured.
func New(cfg Config, opts ...Option) *Adapter {
	for _, o := range opts {
		if o != nil {
			o(&cfg)
		}
	}
	if cfg.HTTPTimeout <= 0 {
		cfg.HTTPTimeout = 30 * time.Second
	}
	return &Adapter{cfg: cfg}
}

// Adapter implements payment.PaymentProvider for Stripe.
type Adapter struct {
	cfg Config
}

// Configured reports whether the adapter has the minimum credentials.
func (a *Adapter) Configured() bool {
	return a.cfg.APIKey != "" && a.cfg.WebhookSecret != ""
}

// Provider returns the gateway identifier.
func (a *Adapter) Provider() payment.Provider { return payment.ProviderStripe }

// CreateCheckout creates a Stripe Checkout Session and returns its URL.
//
// Currency is mapped to Stripe's minor-unit convention (USD 12.34 -> 1234
// cents). The TradeNo is stored as client_reference_id and echoed back in
// webhook events.
func (a *Adapter) CreateCheckout(ctx context.Context, req *payment.CheckoutRequest) (*payment.CheckoutResult, error) {
	if !a.Configured() {
		return nil, payment.ErrNotConfigured
	}
	if req == nil || req.TradeNo == "" {
		return nil, fmt.Errorf("%w: missing trade_no", payment.ErrInvalidRequest)
	}
	if req.Money <= 0 {
		return nil, fmt.Errorf("%w: money must be > 0", payment.ErrInvalidRequest)
	}

	stripe.Key = a.cfg.APIKey

	currency := strings.ToLower(string(req.Currency))
	if currency == "" {
		currency = "usd"
	}

	params := &stripe.CheckoutSessionParams{
		ClientReferenceID: stripe.String(req.TradeNo),
		Mode:              stripe.String(string(stripe.CheckoutSessionModePayment)),
		SuccessURL:        stripe.String(req.ReturnURL),
		CancelURL:         stripe.String(req.ReturnURL),
		LineItems: []*stripe.CheckoutSessionLineItemParams{
			{
				Quantity: stripe.Int64(req.Amount),
			},
		},
	}
	if req.CustomerID != "" {
		params.Customer = stripe.String(req.CustomerID)
	}
	if req.CustomerEmail != "" {
		params.CustomerEmail = stripe.String(req.CustomerEmail)
	}
	if req.ExpiresInSeconds != nil {
		params.ExpiresAt = stripe.Int64(time.Now().Unix() + int64(*req.ExpiresInSeconds))
	}
	if req.Metadata != nil {
		params.Metadata = make(map[string]string, len(req.Metadata))
		for k, v := range req.Metadata {
			params.Metadata[k] = v
		}
	}

	if req.ProductID != "" {
		params.LineItems[0].Price = stripe.String(req.ProductID)
	} else if a.cfg.PriceID != "" {
		params.LineItems[0].Price = stripe.String(a.cfg.PriceID)
	} else {
		// Inline ad-hoc price (no pre-registered Price object).
		params.LineItems[0].PriceData = &stripe.CheckoutSessionLineItemPriceDataParams{
			Currency: stripe.String(currency),
			ProductData: &stripe.CheckoutSessionLineItemPriceDataProductDataParams{
				Name: stripe.String(orDefault(req.Name, fmt.Sprintf("Order %s", req.TradeNo))),
			},
			UnitAmount: stripe.Int64(int64(float64(req.Money) * 100)), // major -> minor
		}
	}

	sess, err := session.New(params)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", payment.ErrProviderError, err)
	}

	return &payment.CheckoutResult{
		Provider:    payment.ProviderStripe,
		CheckoutURL: sess.URL,
		SessionID:   sess.ID,
		Raw:         sess,
	}, nil
}

// VerifyWebhook verifies the Stripe-Signature header and parses the event
// into a normalized WebhookEvent.
//
// req.RawBody must be the exact bytes of the webhook request body.
// req.Signature is the Stripe-Signature header value.
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

	event, err := stripewebhook.ConstructEventWithOptions(
		req.RawBody, req.Signature, a.cfg.WebhookSecret,
		stripewebhook.ConstructEventOptions{IgnoreAPIVersionMismatch: true},
	)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", payment.ErrInvalidSignature, err)
	}

	ev := &payment.WebhookEvent{
		Provider:       payment.ProviderStripe,
		ProviderOrderID: event.GetObjectValue("id"),
		TradeNo:        event.GetObjectValue("client_reference_id"),
		CustomerID:     event.GetObjectValue("customer"),
		Raw:            event,
		RawBody:        req.RawBody,
	}

	currency := strings.ToUpper(event.GetObjectValue("currency"))
	if currency != "" {
		ev.Currency = payment.Currency(currency)
	}
	if total := event.GetObjectValue("amount_total"); total != "" {
		var cents float64
		if _, err := fmt.Sscanf(total, "%f", &cents); err == nil {
			ev.MoneyPaid = payment.Money(cents / 100.0)
		}
	}

	switch stripe.EventType(event.Type) {
	case stripe.EventTypeCheckoutSessionCompleted:
		ev.EventType = payment.EventCheckoutCompleted
		ev.Status = payment.StatusSuccess
	case stripe.EventTypeCheckoutSessionExpired:
		ev.EventType = payment.EventCheckoutExpired
		ev.Status = payment.StatusExpired
	case stripe.EventTypeCheckoutSessionAsyncPaymentSucceeded:
		ev.EventType = payment.EventAsyncPaymentSucceeded
		ev.Status = payment.StatusSuccess
	case stripe.EventTypeCheckoutSessionAsyncPaymentFailed:
		ev.EventType = payment.EventAsyncPaymentFailed
		ev.Status = payment.StatusFailed
	default:
		ev.EventType = payment.EventUnknown
		ev.Status = payment.StatusPending
	}

	return ev, nil
}

// BuildWebhookResponse returns a 200 OK with empty body for Stripe.
// Stripe only requires the HTTP status; the body is ignored.
func (a *Adapter) BuildWebhookResponse(ctx context.Context, success bool, msg string) (*payment.WebhookResponse, error) {
	code := 200
	if !success {
		code = 500
	}
	return &payment.WebhookResponse{
		StatusCode:  code,
		ContentType: "application/json",
	}, nil
}

// QueryOrder retrieves a Checkout Session by TradeNo (client_reference_id).
// Stripe does not index by client_reference_id server-side, so this
// performs a list-and-filter. For high-volume deployments, prefer storing
// the SessionID at checkout time and querying by it.
func (a *Adapter) QueryOrder(ctx context.Context, req *payment.OrderQuery) (*payment.OrderQueryResult, error) {
	if !a.Configured() {
		return nil, payment.ErrNotConfigured
	}
	if req == nil || (req.TradeNo == "" && req.ProviderOrderID == "") {
		return nil, fmt.Errorf("%w: missing trade_no and provider_order_id", payment.ErrInvalidRequest)
	}

	stripe.Key = a.cfg.APIKey

	var sess *stripe.CheckoutSession
	if req.ProviderOrderID != "" {
		params := &stripe.CheckoutSessionParams{}
		s, err := session.Get(req.ProviderOrderID, params)
		if err != nil {
			return nil, fmt.Errorf("%w: %v", payment.ErrOrderNotFound, err)
		}
		sess = s
	} else {
		// Stripe does not expose client_reference_id as a direct list
		// filter; fall back to scanning recent sessions.
		params := &stripe.CheckoutSessionListParams{}
		params.Filters.AddFilter("limit", "", "100")
		iter := session.List(params)
		for iter.Next() {
			s := iter.CheckoutSession()
			if s.ClientReferenceID == req.TradeNo {
				sess = s
				break
			}
		}
		if sess == nil {
			return nil, payment.ErrOrderNotFound
		}
	}

	result := &payment.OrderQueryResult{
		TradeNo:        req.TradeNo,
		ProviderOrderID: sess.ID,
		Raw:            sess,
	}
	if sess.Currency != "" {
		result.Currency = payment.Currency(strings.ToUpper(string(sess.Currency)))
	}
	if sess.AmountTotal > 0 {
		result.MoneyPaid = payment.Money(float64(sess.AmountTotal) / 100.0)
	}
	switch sess.PaymentStatus {
	case "paid":
		result.Status = payment.StatusSuccess
	case "unpaid":
		if sess.Status == "expired" {
			result.Status = payment.StatusExpired
		} else {
			result.Status = payment.StatusPending
		}
	default:
		result.Status = payment.StatusFailed
	}
	if sess.Created > 0 {
		t := time.Unix(sess.Created, 0)
		result.PaidAt = &t
	}
	return result, nil
}

// orDefault returns v when non-empty, otherwise def.
func orDefault(v, def string) string {
	if v == "" {
		return def
	}
	return v
}

// jsonMarshal is a thin wrapper kept here so the adapter does not depend
// on encoding/json directly in business code; it is only used for
// debugging raw payloads.
func jsonMarshal(v any) []byte {
	b, _ := json.Marshal(v)
	return b
}

var _ = jsonMarshal
