// Package epay implements the [payment.PaymentProvider] interface for
// Epay (易支付) aggregated payment gateways, including the ZPay
// (zpayz.cn) enhanced variant.
//
// Epay is a self-hosted payment aggregation protocol commonly used to
// proxy Alipay (支付宝), WeChat Pay (微信支付), and QQ Pay behind a
// single MD5-signed endpoint. This adapter supports two checkout modes:
//
//   - Redirect mode: builds a signed form that redirects the payer's
//     browser to the gateway's /submit.php cashier page.
//   - API mode: POSTs to /mapi.php and receives a JSON response
//     containing a payment URL, QR code link, or QR code image.
//
// Beyond checkout, the adapter also implements [payment.Refunder] and
// [payment.BalanceQuerier] for gateways that expose the /api.php
// management endpoints (order query, balance query, refund).
//
// The adapter is stateless after construction and safe for concurrent use.
package epay

import (
	"context"
	"crypto/md5"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common/payment"
	"github.com/mitchellh/mapstructure"
)

// CheckoutMode selects the checkout flow.
type CheckoutMode string

const (
	// ModeRedirect builds a signed form and redirects the payer to
	// /submit.php. This is the default and works with all Epay gateways.
	ModeRedirect CheckoutMode = "redirect"

	// ModeAPI POSTs to /mapi.php and returns a JSON response with a
	// payment URL or QR code. Requires a gateway that supports the API
	// payment endpoint (e.g. ZPay).
	ModeAPI CheckoutMode = "api"
)

// Config holds the Epay gateway credentials.
type Config struct {
	// PartnerID is the merchant id issued by the Epay gateway (pid).
	PartnerID string

	// Key is the merchant signing key shared with the gateway.
	Key string

	// BaseURL is the gateway root URL (e.g. https://zpayz.cn).
	BaseURL string

	// CheckoutMode selects redirect vs API checkout flow. Defaults to
	// ModeRedirect when empty.
	CheckoutMode CheckoutMode

	// HTTPTimeout is the timeout for outbound API calls. Defaults to 15s.
	HTTPTimeout time.Duration
}

// Option mutates Config.
type Option func(*Config)

// WithHTTPTimeout sets the outbound HTTP timeout.
func WithHTTPTimeout(d time.Duration) Option {
	return func(c *Config) { c.HTTPTimeout = d }
}

// WithCheckoutMode sets the checkout flow mode.
func WithCheckoutMode(m CheckoutMode) Option {
	return func(c *Config) { c.CheckoutMode = m }
}

// New constructs an Epay adapter.
func New(cfg Config, opts ...Option) *Adapter {
	for _, o := range opts {
		if o != nil {
			o(&cfg)
		}
	}
	if cfg.HTTPTimeout <= 0 {
		cfg.HTTPTimeout = 15 * time.Second
	}
	if cfg.CheckoutMode == "" {
		cfg.CheckoutMode = ModeRedirect
	}
	return &Adapter{
		cfg: cfg,
		hc:  &http.Client{Timeout: cfg.HTTPTimeout},
	}
}

// Adapter implements payment.PaymentProvider for Epay.
type Adapter struct {
	cfg Config
	hc  *http.Client
}

// Configured reports whether the adapter has the minimum credentials.
func (a *Adapter) Configured() bool {
	return a.cfg.PartnerID != "" && a.cfg.Key != "" && a.cfg.BaseURL != ""
}

// Provider returns the gateway identifier.
func (a *Adapter) Provider() payment.Provider { return payment.ProviderEpay }

// CreateCheckout builds the Epay payment request. In ModeRedirect it
// returns a signed form URL + params for browser redirect. In ModeAPI it
// POSTs to /mapi.php and returns the JSON-derived payment URL or QR code.
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

	if a.cfg.CheckoutMode == ModeAPI {
		return a.createCheckoutAPI(ctx, req)
	}
	return a.createCheckoutRedirect(ctx, req)
}

// createCheckoutRedirect builds the /submit.php signed form.
func (a *Adapter) createCheckoutRedirect(ctx context.Context, req *payment.CheckoutRequest) (*payment.CheckoutResult, error) {
	base, err := url.Parse(a.cfg.BaseURL)
	if err != nil {
		return nil, fmt.Errorf("%w: invalid base url: %v", payment.ErrInvalidRequest, err)
	}
	base.Path = strings.TrimRight(base.Path, "/") + "/submit.php"

	params := a.buildSignedParams(req, false)

	return &payment.CheckoutResult{
		Provider:    payment.ProviderEpay,
		CheckoutURL: base.String(),
		Params:      params,
		Raw:         params,
	}, nil
}

// createCheckoutAPI POSTs to /mapi.php and parses the JSON response.
func (a *Adapter) createCheckoutAPI(ctx context.Context, req *payment.CheckoutRequest) (*payment.CheckoutResult, error) {
	if req.ClientIP == "" {
		return nil, fmt.Errorf("%w: api mode requires client_ip", payment.ErrInvalidRequest)
	}

	endpoint := strings.TrimRight(a.cfg.BaseURL, "/") + "/mapi.php"
	params := a.buildSignedParams(req, true)

	form := url.Values{}
	for k, v := range params {
		form.Set(k, v)
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(form.Encode()))
	if err != nil {
		return nil, fmt.Errorf("%w: %v", payment.ErrInvalidRequest, err)
	}
	httpReq.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := a.hc.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", payment.ErrProviderError, err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("%w: read body: %v", payment.ErrProviderError, err)
	}

	var apiResp apiCheckoutResponse
	if err := json.Unmarshal(body, &apiResp); err != nil {
		return nil, fmt.Errorf("%w: decode: %v (body=%q)", payment.ErrInvalidRequest, err, string(body))
	}
	if apiResp.Code != 1 {
		return nil, fmt.Errorf("%w: code=%d msg=%q", payment.ErrProviderError, apiResp.Code, apiResp.Msg)
	}

	result := &payment.CheckoutResult{
		Provider:    payment.ProviderEpay,
		SessionID:   apiResp.OID,
		Raw:         apiResp,
	}
	// Prefer payurl for redirect; fall back to qrcode/img for QR flows.
	if apiResp.PayURL != "" {
		result.CheckoutURL = apiResp.PayURL
	} else if apiResp.PayURL2 != "" {
		result.CheckoutURL = apiResp.PayURL2
	} else if apiResp.Qrcode != "" {
		result.CheckoutURL = apiResp.Qrcode
	} else if apiResp.Img != "" {
		result.CheckoutURL = apiResp.Img
	}
	if result.CheckoutURL == "" {
		return nil, fmt.Errorf("%w: no payment url in response (body=%q)", payment.ErrProviderError, string(body))
	}
	return result, nil
}

// apiCheckoutResponse is the JSON response from /mapi.php.
type apiCheckoutResponse struct {
	Code    int    `json:"code"`
	Msg     string `json:"msg"`
	OID     string `json:"O_id"`
	TradeNo string `json:"trade_no"`
	PayURL  string `json:"payurl"`
	PayURL2 string `json:"payurl2"`
	Qrcode  string `json:"qrcode"`
	Img     string `json:"img"`
}

// buildSignedParams constructs the signed parameter map for checkout
// requests. includeClientIP adds the clientip field required by API mode.
func (a *Adapter) buildSignedParams(req *payment.CheckoutRequest, includeClientIP bool) map[string]string {
	device := string(req.Device)
	if device == "" {
		device = string(payment.DevicePC)
	}

	name := req.Name
	if name == "" {
		name = fmt.Sprintf("Order %s", req.TradeNo)
	}

	params := map[string]string{
		"pid":          a.cfg.PartnerID,
		"out_trade_no": req.TradeNo,
		"notify_url":   req.NotifyURL,
		"return_url":   req.ReturnURL,
		"name":         name,
		"money":        fmt.Sprintf("%.2f", float64(req.Money)),
		"device":       device,
		"sign_type":    "MD5",
	}
	if req.ProductID != "" {
		params["type"] = req.ProductID // alipay / wxpay / qqpay
	}
	if includeClientIP && req.ClientIP != "" {
		params["clientip"] = req.ClientIP
	}
	// Forward the "param" metadata key as the Epay param field, which
	// gets echoed back verbatim in webhook callbacks.
	if p, ok := req.Metadata["param"]; ok && p != "" {
		params["param"] = p
	}
	// Forward "cid" (支付渠道ID) if present.
	if cid, ok := req.Metadata["cid"]; ok && cid != "" {
		params["cid"] = cid
	}

	params["sign"] = signParams(params, a.cfg.Key)
	return params
}

// VerifyWebhook verifies the Epay MD5 callback signature and parses the
// form parameters into a normalized WebhookEvent.
func (a *Adapter) VerifyWebhook(ctx context.Context, req *payment.WebhookVerifyRequest) (*payment.WebhookEvent, error) {
	if !a.Configured() {
		return nil, payment.ErrNotConfigured
	}
	if req == nil || len(req.FormParams) == 0 {
		return nil, fmt.Errorf("%w: empty form params", payment.ErrInvalidRequest)
	}

	provided := strings.TrimSpace(req.FormParams["sign"])
	if provided == "" {
		return nil, fmt.Errorf("%w: missing sign", payment.ErrInvalidSignature)
	}

	expected := signParams(filterSigned(req.FormParams), a.cfg.Key)
	if !strings.EqualFold(provided, expected) {
		return nil, payment.ErrInvalidSignature
	}

	var res struct {
		Type           string `mapstructure:"type"`
		TradeNo        string `mapstructure:"trade_no"`
		ServiceTradeNo string `mapstructure:"out_trade_no"`
		Name           string `mapstructure:"name"`
		Money          string `mapstructure:"money"`
		TradeStatus    string `mapstructure:"trade_status"`
		Param          string `mapstructure:"param"`
	}
	if err := mapstructure.Decode(req.FormParams, &res); err != nil {
		return nil, fmt.Errorf("%w: decode: %v", payment.ErrInvalidRequest, err)
	}

	event := &payment.WebhookEvent{
		Provider:       payment.ProviderEpay,
		TradeNo:        res.ServiceTradeNo,
		ProviderOrderID: res.TradeNo,
		OrderType:      res.Type,
		Raw:            req.FormParams,
		RawBody:        req.RawBody,
	}
	if res.Param != "" {
		if event.Raw == nil {
			event.Raw = map[string]string{}
		}
	}

	switch strings.ToUpper(res.TradeStatus) {
	case "TRADE_SUCCESS", "TRADE_FINISHED":
		event.EventType = payment.EventCheckoutCompleted
		event.Status = payment.StatusSuccess
		if res.Money != "" {
			var m float64
			_, _ = fmt.Sscanf(res.Money, "%f", &m)
			event.MoneyPaid = payment.Money(m)
		}
	default:
		event.EventType = payment.EventUnknown
		event.Status = payment.StatusPending
	}

	return event, nil
}

// BuildWebhookResponse returns the Epay ack body. Epay expects the literal
// string "success" on successful processing and "fail" on failure.
func (a *Adapter) BuildWebhookResponse(ctx context.Context, success bool, msg string) (*payment.WebhookResponse, error) {
	body := "fail"
	if success {
		body = "success"
	}
	return &payment.WebhookResponse{
		StatusCode:  200,
		Body:        []byte(body),
		ContentType: "text/plain; charset=utf-8",
	}, nil
}

// QueryOrder queries the gateway's /api.php?act=order endpoint for the
// current status of an order. Either TradeNo or ProviderOrderID may be
// used; TradeNo (out_trade_no) is preferred.
func (a *Adapter) QueryOrder(ctx context.Context, req *payment.OrderQuery) (*payment.OrderQueryResult, error) {
	if !a.Configured() {
		return nil, payment.ErrNotConfigured
	}
	if req == nil || (req.TradeNo == "" && req.ProviderOrderID == "") {
		return nil, fmt.Errorf("%w: missing trade_no and provider_order_id", payment.ErrInvalidRequest)
	}

	params := url.Values{}
	params.Set("act", "order")
	params.Set("pid", a.cfg.PartnerID)
	params.Set("key", a.cfg.Key)
	if req.TradeNo != "" {
		params.Set("out_trade_no", req.TradeNo)
	} else {
		params.Set("trade_no", req.ProviderOrderID)
	}

	var resp orderQueryResponse
	if err := a.callAPI(ctx, params, &resp); err != nil {
		return nil, err
	}

	result := &payment.OrderQueryResult{
		TradeNo:        resp.OutTradeNo,
		ProviderOrderID: resp.TradeNo,
		Raw:            resp,
	}
	if resp.Money != "" {
		var m float64
		if _, err := fmt.Sscanf(resp.Money, "%f", &m); err == nil {
			result.MoneyPaid = payment.Money(m)
		}
	}
	if resp.Status == 1 {
		result.Status = payment.StatusSuccess
		if resp.Endtime != "" {
			if t, err := time.ParseInLocation("2006-01-02 15:04:05", resp.Endtime, time.Local); err == nil {
				result.PaidAt = &t
			}
		}
	} else {
		result.Status = payment.StatusPending
	}
	return result, nil
}

// orderQueryResponse is the JSON response from /api.php?act=order.
type orderQueryResponse struct {
	Code        int    `json:"code"`
	Msg         string `json:"msg"`
	TradeNo     string `json:"trade_no"`
	OutTradeNo  string `json:"out_trade_no"`
	Type        string `json:"type"`
	PID         string `json:"pid"`
	Addtime     string `json:"addtime"`
	Endtime     string `json:"endtime"`
	Name        string `json:"name"`
	Money       string `json:"money"`
	Status      int    `json:"status"`
	Param       string `json:"param"`
	Buyer       string `json:"buyer"`
}

// QueryBalance queries the gateway's /api.php?act=balance endpoint.
func (a *Adapter) QueryBalance(ctx context.Context) (*payment.BalanceResult, error) {
	if !a.Configured() {
		return nil, payment.ErrNotConfigured
	}

	params := url.Values{}
	params.Set("act", "balance")
	params.Set("pid", a.cfg.PartnerID)
	params.Set("key", a.cfg.Key)

	var resp balanceResponse
	if err := a.callAPI(ctx, params, &resp); err != nil {
		return nil, err
	}

	var bal float64
	if _, err := fmt.Sscanf(resp.Balance, "%f", &bal); err != nil {
		return nil, fmt.Errorf("%w: parse balance: %v", payment.ErrProviderError, err)
	}

	return &payment.BalanceResult{
		Balance: payment.Money(bal),
		Raw:     resp,
	}, nil
}

// balanceResponse is the JSON response from /api.php?act=balance.
type balanceResponse struct {
	Code    int    `json:"code"`
	Msg     string `json:"msg"`
	Balance string `json:"balance"`
}

// Refund submits a refund request to /api.php?act=refund. Either TradeNo
// or ProviderOrderID must be set. Money is the refund amount; most
// channels require it to match the original charge.
func (a *Adapter) Refund(ctx context.Context, req *payment.RefundRequest) (*payment.RefundResult, error) {
	if !a.Configured() {
		return nil, payment.ErrNotConfigured
	}
	if req == nil {
		return nil, fmt.Errorf("%w: nil refund request", payment.ErrInvalidRequest)
	}
	if req.TradeNo == "" && req.ProviderOrderID == "" {
		return nil, fmt.Errorf("%w: missing trade_no and provider_order_id", payment.ErrInvalidRequest)
	}
	if req.Money <= 0 {
		return nil, fmt.Errorf("%w: refund money must be > 0", payment.ErrInvalidRequest)
	}

	form := url.Values{}
	form.Set("act", "refund")
	form.Set("pid", a.cfg.PartnerID)
	form.Set("key", a.cfg.Key)
	form.Set("money", fmt.Sprintf("%.2f", float64(req.Money)))
	if req.TradeNo != "" {
		form.Set("out_trade_no", req.TradeNo)
	} else {
		form.Set("trade_no", req.ProviderOrderID)
	}

	endpoint := strings.TrimRight(a.cfg.BaseURL, "/") + "/api.php"
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(form.Encode()))
	if err != nil {
		return nil, fmt.Errorf("%w: %v", payment.ErrInvalidRequest, err)
	}
	httpReq.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := a.hc.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", payment.ErrProviderError, err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("%w: read body: %v", payment.ErrProviderError, err)
	}

	var apiResp struct {
		Code int    `json:"code"`
		Msg  string `json:"msg"`
	}
	if err := json.Unmarshal(body, &apiResp); err != nil {
		return nil, fmt.Errorf("%w: decode: %v (body=%q)", payment.ErrInvalidRequest, err, string(body))
	}
	if apiResp.Code != 1 {
		return nil, fmt.Errorf("%w: code=%d msg=%q", payment.ErrRefundFailed, apiResp.Code, apiResp.Msg)
	}

	return &payment.RefundResult{
		TradeNo:        req.TradeNo,
		ProviderOrderID: req.ProviderOrderID,
		Status:         payment.StatusRefunded,
		Raw:            apiResp,
	}, nil
}

// callAPI performs a GET request to /api.php with the given query params
// and decodes the JSON response into target.
func (a *Adapter) callAPI(ctx context.Context, params url.Values, target any) error {
	endpoint := strings.TrimRight(a.cfg.BaseURL, "/") + "/api.php?" + params.Encode()

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return fmt.Errorf("%w: %v", payment.ErrInvalidRequest, err)
	}

	resp, err := a.hc.Do(httpReq)
	if err != nil {
		return fmt.Errorf("%w: %v", payment.ErrProviderError, err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("%w: read body: %v", payment.ErrProviderError, err)
	}

	if err := json.Unmarshal(body, target); err != nil {
		return fmt.Errorf("%w: decode: %v (body=%q)", payment.ErrInvalidRequest, err, string(body))
	}

	// Use reflection-free check: all API responses embed a Code field.
	type codeCarrier struct {
		Code int    `json:"code"`
		Msg  string `json:"msg"`
	}
	var cc codeCarrier
	_ = json.Unmarshal(body, &cc)
	if cc.Code != 1 {
		if cc.Code == -1 && strings.Contains(cc.Msg, "不存在") {
			return fmt.Errorf("%w: %s", payment.ErrOrderNotFound, cc.Msg)
		}
		return fmt.Errorf("%w: code=%d msg=%q", payment.ErrProviderError, cc.Code, cc.Msg)
	}
	return nil
}

// signParams computes the Epay MD5 signature over the sorted, non-empty
// key=value pairs (excluding sign and sign_type), appended with the
// merchant key.
func signParams(params map[string]string, key string) string {
	filtered := filterSigned(params)
	keys := make([]string, 0, len(filtered))
	for k := range filtered {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	var b strings.Builder
	for i, k := range keys {
		if i > 0 {
			b.WriteByte('&')
		}
		b.WriteString(k)
		b.WriteByte('=')
		b.WriteString(filtered[k])
	}
	b.WriteString(key)
	sum := md5.Sum([]byte(b.String()))
	return fmt.Sprintf("%x", sum)
}

// filterSigned removes sign, sign_type, and empty-valued entries.
func filterSigned(params map[string]string) map[string]string {
	out := make(map[string]string, len(params))
	for k, v := range params {
		if k == "sign" || k == "sign_type" || v == "" {
			continue
		}
		out[k] = v
	}
	return out
}

// ErrMissingConfig is returned when required configuration is absent.
var ErrMissingConfig = errors.New("epay: missing configuration")
