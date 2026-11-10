// Package creem implements the [payment.PaymentProvider] interface for
// Creem (https://creem.io) hosted checkout.
//
// Creem is a merchant-of-record payment provider for international SaaS
// sales. The adapter talks to Creem's REST API to create checkouts and
// verifies webhook payloads using HMAC-SHA256 signatures.
//
// The adapter is stateless after construction and safe for concurrent use.
package creem

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common/payment"
)

// Config holds the Creem API credentials.
type Config struct {
	// APIKey is the Creem merchant API key (x-api-key header).
	APIKey string

	// WebhookSecret is the HMAC-SHA256 signing secret used to verify
	// webhook payloads (creem-signature header).
	WebhookSecret string

	// TestMode selects the test API endpoint (https://test-api.creem.io)
	// instead of the production endpoint (https://api.creem.io).
	TestMode bool

	// HTTPTimeout is the timeout for outbound API calls. Defaults to 30s.
	HTTPTimeout time.Duration
}

// Option mutates Config.
type Option func(*Config)

// WithHTTPTimeout sets the outbound HTTP timeout.
func WithHTTPTimeout(d time.Duration) Option {
	return func(c *Config) { c.HTTPTimeout = d }
}

// New constructs a Creem adapter.
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

// Adapter implements payment.PaymentProvider for Creem.
type Adapter struct {
	cfg Config
}

// Configured reports whether the adapter has the minimum credentials.
func (a *Adapter) Configured() bool {
	return a.cfg.APIKey != "" && a.cfg.WebhookSecret != ""
}

// Provider returns the gateway identifier.
func (a *Adapter) Provider() payment.Provider { return payment.ProviderCreem }

// apiBase returns the API endpoint for the configured mode.
func (a *Adapter) apiBase() string {
	if a.cfg.TestMode {
		return "https://test-api.creem.io"
	}
	return "https://api.creem.io"
}

// CreateCheckout creates a Creem checkout session and returns the hosted
// checkout URL.
//
// req.ProductID must be a pre-registered Creem product id. req.TradeNo is
// passed as request_id and echoed back in webhook events.
func (a *Adapter) CreateCheckout(ctx context.Context, req *payment.CheckoutRequest) (*payment.CheckoutResult, error) {
	if !a.Configured() {
		return nil, payment.ErrNotConfigured
	}
	if req == nil || req.TradeNo == "" {
		return nil, fmt.Errorf("%w: missing trade_no", payment.ErrInvalidRequest)
	}
	if req.ProductID == "" {
		return nil, fmt.Errorf("%w: missing product_id", payment.ErrInvalidRequest)
	}

	type customer struct {
		Email string `json:"email"`
	}
	type checkoutReq struct {
		ProductID string            `json:"product_id"`
		RequestID string            `json:"request_id"`
		Customer  customer          `json:"customer"`
		Metadata  map[string]string `json:"metadata,omitempty"`
	}

	body := checkoutReq{
		ProductID: req.ProductID,
		RequestID: req.TradeNo,
		Customer:  customer{Email: req.CustomerEmail},
		Metadata:  req.Metadata,
	}
	if body.Metadata == nil {
		body.Metadata = map[string]string{}
	}
	if req.Name != "" {
		body.Metadata["product_name"] = req.Name
	}

	raw, err := json.Marshal(body)
	if err != nil {
		return nil, fmt.Errorf("%w: marshal: %v", payment.ErrInvalidRequest, err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, a.apiBase()+"/v1/checkouts", bytes.NewReader(raw))
	if err != nil {
		return nil, fmt.Errorf("%w: %v", payment.ErrInvalidRequest, err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("x-api-key", a.cfg.APIKey)

	resp, err := http.DefaultClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", payment.ErrProviderError, err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("%w: read body: %v", payment.ErrProviderError, err)
	}
	if resp.StatusCode/100 != 2 {
		return nil, fmt.Errorf("%w: http %d: %s", payment.ErrProviderError, resp.StatusCode, string(respBody))
	}

	var parsed struct {
		CheckoutURL string `json:"checkout_url"`
		ID          string `json:"id"`
	}
	if err := json.Unmarshal(respBody, &parsed); err != nil {
		return nil, fmt.Errorf("%w: decode: %v", payment.ErrInvalidRequest, err)
	}
	if parsed.CheckoutURL == "" {
		return nil, fmt.Errorf("%w: empty checkout_url", payment.ErrProviderError)
	}

	return &payment.CheckoutResult{
		Provider:    payment.ProviderCreem,
		CheckoutURL: parsed.CheckoutURL,
		SessionID:   parsed.ID,
		Raw:         parsed,
	}, nil
}

// VerifyWebhook verifies the creem-signature HMAC-SHA256 header and parses
// the JSON payload into a normalized WebhookEvent.
//
// req.RawBody must be the exact bytes of the webhook request body.
// req.Signature is the creem-signature header value.
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

	if !verifySignature(string(req.RawBody), req.Signature, a.cfg.WebhookSecret) {
		return nil, payment.ErrInvalidSignature
	}

	var ev creemWebhookEvent
	if err := json.Unmarshal(req.RawBody, &ev); err != nil {
		return nil, fmt.Errorf("%w: decode: %v", payment.ErrInvalidRequest, err)
	}

	out := &payment.WebhookEvent{
		Provider:       payment.ProviderCreem,
		ProviderOrderID: ev.Object.Order.ID,
		TradeNo:        ev.Object.RequestID,
		CustomerID:     ev.Object.Customer.ID,
		CustomerEmail:  ev.Object.Customer.Email,
		CustomerName:   ev.Object.Customer.Name,
		OrderType:      ev.Object.Order.Type,
		Mode:           ev.Object.Mode,
		Raw:            ev,
		RawBody:        req.RawBody,
	}
	if ev.Object.Order.Currency != "" {
		out.Currency = payment.Currency(strings.ToUpper(ev.Object.Order.Currency))
	}
	if ev.Object.Order.AmountPaid > 0 {
		// Creem amounts are in the currency's smallest unit.
		out.MoneyPaid = payment.Money(float64(ev.Object.Order.AmountPaid) / 100.0)
	}

	switch ev.EventType {
	case "checkout.completed":
		out.EventType = payment.EventCheckoutCompleted
		if ev.Object.Order.Status == "paid" {
			out.Status = payment.StatusSuccess
		} else {
			out.Status = payment.StatusPending
		}
	case "checkout.expired":
		out.EventType = payment.EventCheckoutExpired
		out.Status = payment.StatusExpired
	case "refund.created":
		out.EventType = payment.EventRefund
		out.Status = payment.StatusRefunded
	default:
		out.EventType = payment.EventUnknown
		out.Status = payment.StatusPending
	}

	return out, nil
}

// BuildWebhookResponse returns a 200 OK with empty body for Creem.
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

// QueryOrder is not currently supported by the Creem public API in this
// adapter. Returns an error wrapping payment.ErrProviderError.
func (a *Adapter) QueryOrder(ctx context.Context, req *payment.OrderQuery) (*payment.OrderQueryResult, error) {
	return nil, fmt.Errorf("%w: creem order query not implemented", payment.ErrProviderError)
}

// verifySignature computes the expected HMAC-SHA256 of payload under secret
// and compares it against the provided signature in constant time.
func verifySignature(payload, signature, secret string) bool {
	if secret == "" {
		return false
	}
	expected := computeSignature(payload, secret)
	return hmacEqual(signature, expected)
}

// computeSignature returns the lowercase hex HMAC-SHA256 of payload keyed
// by secret.
func computeSignature(payload, secret string) string {
	h := newHMAC(secret)
	h.Write([]byte(payload))
	return hexEncode(h.Sum(nil))
}

// creemWebhookEvent mirrors the Creem webhook payload structure.
type creemWebhookEvent struct {
	ID        string `json:"id"`
	EventType string `json:"eventType"`
	CreatedAt int64  `json:"created_at"`
	Object    struct {
		ID        string `json:"id"`
		Object    string `json:"object"`
		RequestID string `json:"request_id"`
		Order     struct {
			Object      string `json:"object"`
			ID          string `json:"id"`
			Customer    string `json:"customer"`
			Product     string `json:"product"`
			Amount      int    `json:"amount"`
			Currency    string `json:"currency"`
			SubTotal    int    `json:"sub_total"`
			TaxAmount   int    `json:"tax_amount"`
			AmountDue   int    `json:"amount_due"`
			AmountPaid  int    `json:"amount_paid"`
			Status      string `json:"status"`
			Type        string `json:"type"`
			Transaction string `json:"transaction"`
			CreatedAt   string `json:"created_at"`
			UpdatedAt   string `json:"updated_at"`
			Mode        string `json:"mode"`
		} `json:"order"`
		Product struct {
			ID            string  `json:"id"`
			Object        string  `json:"object"`
			Name          string  `json:"name"`
			Description   string  `json:"description"`
			Price         int     `json:"price"`
			Currency      string  `json:"currency"`
			BillingType   string  `json:"billing_type"`
			BillingPeriod string  `json:"billing_period"`
			Status        string  `json:"status"`
			TaxMode       string  `json:"tax_mode"`
			TaxCategory   string  `json:"tax_category"`
			CreatedAt     string  `json:"created_at"`
			UpdatedAt     string  `json:"updated_at"`
			Mode          string  `json:"mode"`
		} `json:"product"`
		Units int `json:"units"`
		Customer struct {
			ID        string `json:"id"`
			Object    string `json:"object"`
			Email     string `json:"email"`
			Name      string `json:"name"`
			Country   string `json:"country"`
			CreatedAt string `json:"created_at"`
			UpdatedAt string `json:"updated_at"`
			Mode      string `json:"mode"`
		} `json:"customer"`
		Status   string            `json:"status"`
		Metadata map[string]string `json:"metadata"`
		Mode     string            `json:"mode"`
	} `json:"object"`
}
