// Package waffo implements the [payment.PaymentProvider] interface for
// Waffo Payment Services (https://waffo.com) using the official
// github.com/waffo-com/waffo-go SDK.
//
// Waffo is a global payment gateway focused on Southeast Asia. The adapter
// creates orders via the SDK and verifies webhook signatures using the
// Waffo public key.
//
// The adapter is stateless after construction and safe for concurrent use.
package waffo

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common/payment"
	"github.com/waffo-com/waffo-go"
	"github.com/waffo-com/waffo-go/config"
	"github.com/waffo-com/waffo-go/core"
	"github.com/waffo-com/waffo-go/types/order"
)

// Environment selects the Waffo API environment.
type Environment string

const (
	EnvSandbox    Environment = "sandbox"
	EnvProduction Environment = "production"
)

// Config holds the Waffo SDK credentials.
type Config struct {
	// Environment selects sandbox vs production.
	Environment Environment

	// APIKey is the merchant API key.
	APIKey string

	// PrivateKey is the merchant RSA private key (base64-encoded).
	PrivateKey string

	// PublicKey is the Waffo platform public key (base64-encoded),
	// used to verify webhook signatures.
	PublicKey string

	// MerchantID is the merchant id assigned by Waffo.
	MerchantID string

	// HTTPTimeout is the timeout for outbound API calls. Defaults to 30s.
	HTTPTimeout time.Duration
}

// Option mutates Config.
type Option func(*Config)

// WithHTTPTimeout sets the outbound HTTP timeout.
func WithHTTPTimeout(d time.Duration) Option {
	return func(c *Config) { c.HTTPTimeout = d }
}

// New constructs a Waffo adapter. Returns nil when not configured.
func New(cfg Config, opts ...Option) *Adapter {
	for _, o := range opts {
		if o != nil {
			o(&cfg)
		}
	}
	return &Adapter{cfg: cfg}
}

// Adapter implements payment.PaymentProvider for Waffo.
type Adapter struct {
	cfg Config
}

// Configured reports whether the adapter has the minimum credentials.
func (a *Adapter) Configured() bool {
	return a.cfg.APIKey != "" && a.cfg.PrivateKey != "" && a.cfg.PublicKey != ""
}

// Provider returns the gateway identifier.
func (a *Adapter) Provider() payment.Provider { return payment.ProviderWaffo }

// sdk builds a Waffo SDK instance from the current configuration.
func (a *Adapter) sdk() (*waffo.Waffo, error) {
	env := config.Sandbox
	if a.cfg.Environment == EnvProduction {
		env = config.Production
	}
	builder := config.NewConfigBuilder().
		APIKey(a.cfg.APIKey).
		PrivateKey(a.cfg.PrivateKey).
		WaffoPublicKey(a.cfg.PublicKey).
		Environment(env)
	if a.cfg.MerchantID != "" {
		builder = builder.MerchantID(a.cfg.MerchantID)
	}
	cfg, err := builder.Build()
	if err != nil {
		return nil, fmt.Errorf("%w: build config: %v", payment.ErrNotConfigured, err)
	}
	return waffo.New(cfg), nil
}

// zeroDecimalCurrencies are currencies that do not use fractional units.
var zeroDecimalCurrencies = map[string]bool{
	"IDR": true, "JPY": true, "KRW": true, "VND": true,
}

// formatAmount formats the charge amount according to the currency's
// decimal convention.
func formatAmount(amount float64, currency string) string {
	if zeroDecimalCurrencies[strings.ToUpper(currency)] {
		return fmt.Sprintf("%.0f", amount)
	}
	return fmt.Sprintf("%.2f", amount)
}

// CreateCheckout creates a Waffo order and returns the payment redirect URL.
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

	sdk, err := a.sdk()
	if err != nil {
		return nil, err
	}

	currency := string(req.Currency)
	if currency == "" {
		currency = "USD"
	}

	goodsName := req.Name
	if goodsName == "" {
		goodsName = fmt.Sprintf("Recharge %d", req.Amount)
	}

	params := &order.CreateOrderParams{
		PaymentRequestID: req.TradeNo,
		MerchantOrderID:  req.TradeNo,
		OrderAmount:       formatAmount(float64(req.Money), currency),
		OrderCurrency:    currency,
		OrderDescription: goodsName,
		OrderRequestedAt: time.Now().UTC().Format("2006-01-02T15:04:05.000Z"),
		NotifyURL:        req.NotifyURL,
		MerchantInfo: &order.MerchantInfo{
			MerchantID: a.cfg.MerchantID,
		},
		UserInfo: &order.UserInfo{
			UserEmail:    req.CustomerEmail,
			UserTerminal: "WEB",
		},
		PaymentInfo: &order.PaymentInfo{
			ProductName:   "ONE_TIME_PAYMENT",
			PayMethodType: req.ProductID, // optional; empty lets Waffo pick
		},
		GoodsInfo: &order.GoodsInfo{
			GoodsName: goodsName,
		},
		SuccessRedirectURL: req.ReturnURL,
		FailedRedirectURL:  req.ReturnURL,
	}

	resp, err := sdk.Order().Create(ctx, params, nil)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", payment.ErrProviderError, err)
	}
	if !resp.IsSuccess() {
		return nil, fmt.Errorf("%w: code=%s message=%q", payment.ErrProviderError, resp.Code, resp.Message)
	}

	data := resp.GetData()
	paymentURL := data.FetchRedirectURL()
	if paymentURL == "" {
		paymentURL = data.OrderAction
	}

	return &payment.CheckoutResult{
		Provider:    payment.ProviderWaffo,
		CheckoutURL: paymentURL,
		SessionID:   data.PaymentRequestID,
		Raw:         resp,
	}, nil
}

// VerifyWebhook verifies the X-SIGNATURE header using the Waffo public
// key and parses the JSON payload into a normalized WebhookEvent.
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

	sdk, err := a.sdk()
	if err != nil {
		return nil, err
	}
	wh := sdk.Webhook()

	if !wh.VerifySignature(string(req.RawBody), req.Signature) {
		return nil, payment.ErrInvalidSignature
	}

	var event core.WebhookEvent
	if err := json.Unmarshal(req.RawBody, &event); err != nil {
		return nil, fmt.Errorf("%w: decode: %v", payment.ErrInvalidRequest, err)
	}

	out := &payment.WebhookEvent{
		Provider: payment.ProviderWaffo,
		Raw:      event,
		RawBody:  req.RawBody,
	}

	switch event.EventType {
	case core.EventPayment:
		out.EventType = payment.EventPaymentNotification
		var payload struct {
			EventType string `json:"eventType"`
			Result    *core.PaymentNotificationResult `json:"result"`
		}
		if err := json.Unmarshal(req.RawBody, &payload); err != nil {
			return nil, fmt.Errorf("%w: decode payment: %v", payment.ErrInvalidRequest, err)
		}
		if payload.Result != nil {
			out.TradeNo = payload.Result.MerchantOrderID
			out.ProviderOrderID = payload.Result.AcquiringOrderID
			out.Currency = payment.Currency(strings.ToUpper(payload.Result.OrderCurrency))
			if payload.Result.OrderAmount != "" {
				var m float64
				if _, err := fmt.Sscanf(payload.Result.OrderAmount, "%f", &m); err == nil {
					out.MoneyPaid = payment.Money(m)
				}
			}
			switch payload.Result.OrderStatus {
			case core.OrderStatusPaySuccess:
				out.Status = payment.StatusSuccess
			case core.OrderStatusOrderClose:
				out.Status = payment.StatusFailed
			default:
				out.Status = payment.StatusPending
			}
		}
	case core.EventRefund:
		out.EventType = payment.EventRefund
		out.Status = payment.StatusRefunded
	default:
		out.EventType = payment.EventUnknown
		out.Status = payment.StatusPending
	}

	return out, nil
}

// BuildWebhookResponse returns a signed JSON response body as required by
// the Waffo webhook protocol. The X-SIGNATURE header is placed in
// response.Headers["X-SIGNATURE"].
func (a *Adapter) BuildWebhookResponse(ctx context.Context, success bool, msg string) (*payment.WebhookResponse, error) {
	if !a.Configured() {
		return nil, payment.ErrNotConfigured
	}
	sdk, err := a.sdk()
	if err != nil {
		return nil, err
	}
	wh := sdk.Webhook()

	var body, sig string
	if success {
		body, sig = wh.BuildSuccessResponse()
	} else {
		body, sig = wh.BuildFailedResponse(msg)
	}
	return &payment.WebhookResponse{
		StatusCode:  200,
		Body:        []byte(body),
		ContentType: "application/json",
		Headers:     map[string]string{"X-SIGNATURE": sig},
	}, nil
}

// QueryOrder queries the Waffo order detail API for the current status.
func (a *Adapter) QueryOrder(ctx context.Context, req *payment.OrderQuery) (*payment.OrderQueryResult, error) {
	if !a.Configured() {
		return nil, payment.ErrNotConfigured
	}
	if req == nil || (req.TradeNo == "" && req.ProviderOrderID == "") {
		return nil, fmt.Errorf("%w: missing trade_no and provider_order_id", payment.ErrInvalidRequest)
	}
	sdk, err := a.sdk()
	if err != nil {
		return nil, err
	}

	query := &order.InquiryOrderParams{}
	if req.ProviderOrderID != "" {
		query.AcquiringOrderID = req.ProviderOrderID
	} else {
		query.PaymentRequestID = req.TradeNo
	}

	resp, err := sdk.Order().Inquiry(ctx, query, nil)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", payment.ErrOrderNotFound, err)
	}
	if !resp.IsSuccess() {
		return nil, fmt.Errorf("%w: code=%s message=%q", payment.ErrProviderError, resp.Code, resp.Message)
	}

	data := resp.GetData()
	result := &payment.OrderQueryResult{
		TradeNo:        data.MerchantOrderID,
		ProviderOrderID: data.AcquiringOrderID,
		Raw:            resp,
	}
	if data.OrderCurrency != "" {
		result.Currency = payment.Currency(strings.ToUpper(data.OrderCurrency))
	}
	if data.OrderAmount != "" {
		var m float64
		if _, err := fmt.Sscanf(data.OrderAmount, "%f", &m); err == nil {
			result.MoneyPaid = payment.Money(m)
		}
	}
	switch data.OrderStatus {
	case core.OrderStatusPaySuccess:
		result.Status = payment.StatusSuccess
	case core.OrderStatusOrderClose:
		result.Status = payment.StatusFailed
	default:
		result.Status = payment.StatusPending
	}
	return result, nil
}
