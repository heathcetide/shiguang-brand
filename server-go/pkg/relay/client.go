// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package relay is the unified entry point for calling AI/LLM providers.
// It wraps the relay adaptor system with a clean, framework-agnostic API
// and integrates usage metering.
//
// Quick start:
//
//	import (
//		"github.com/LingByte/ling-base/relay"
//		"github.com/heathcetide/DietDigiDose/pkg/relay/meter"
//		"github.com/LingByte/ling-base/relay/channel/openai"
//	)
//
//	client := relay.New(
//		relay.WithProvider(openai.New("sk-xxx")),
//		relay.WithMeter(meter.NewMemoryMeter()),
//	)
//	resp, err := client.Chat(ctx, &relay.ChatRequest{
//		Model:    "gpt-4o",
//		Messages: []relay.Message{{Role: "user", Content: json.RawMessage(`"Hello"`)}},
//	})
package relay

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common/circuitbreaker"
	"github.com/heathcetide/DietDigiDose/pkg/common/logger"
	"github.com/heathcetide/DietDigiDose/pkg/common/netutil"
	"github.com/heathcetide/DietDigiDose/pkg/common/retry"
	"github.com/heathcetide/DietDigiDose/pkg/relay/constant"
	"github.com/heathcetide/DietDigiDose/pkg/relay/meter"
	common "github.com/heathcetide/DietDigiDose/pkg/relay/common"
	"github.com/heathcetide/DietDigiDose/pkg/relay/relaykit/dto"
	relaymode "github.com/heathcetide/DietDigiDose/pkg/relay/relaymode"
	"github.com/heathcetide/DietDigiDose/pkg/relay/relaykit/types"
	"go.uber.org/zap"
)

// ─── Message types (wrappers around relaykit DTOs) ──────────────

// Message is a chat message. Content is any to support both
// plain string content and multimodal content arrays.
type Message = dto.Message

// ToolCall represents a tool/function call request.
type ToolCall = dto.ToolCallRequest

// Tool represents a tool the model may call (alias to ToolCallRequest).
type Tool = dto.ToolCallRequest

// ─── Request types ───────────────────────────────────────────────

// ChatRequest is the unified chat completion request.
type ChatRequest struct {
	Model           string          `json:"model"`
	Messages        []Message       `json:"messages"`
	Temperature     *float64        `json:"temperature,omitempty"`
	TopP            *float64        `json:"top_p,omitempty"`
	MaxTokens       *int            `json:"max_tokens,omitempty"`
	Stream          bool            `json:"stream,omitempty"`
	Tools           []Tool          `json:"tools,omitempty"`
	ToolChoice      json.RawMessage `json:"tool_choice,omitempty"`
	Stop            json.RawMessage `json:"stop,omitempty"`
	N               *int            `json:"n,omitempty"`
	User            string          `json:"user,omitempty"`
	ReasoningEffort string          `json:"reasoning_effort,omitempty"` // low/medium/high for reasoning models

	// System is the top-level system prompt (Anthropic Messages API style).
	// For OpenAI-compatible providers, it is prepended as a system message.
	// Empty = no system prompt.
	System string `json:"system,omitempty"`

	// Betas are provider-specific beta feature flags (e.g. Anthropic beta headers).
	// Passed through to the Anthropic channel as anthropic-beta headers.
	Betas []string `json:"betas,omitempty"`
}

// EmbedRequest is the unified embedding request.
type EmbedRequest struct {
	Model string          `json:"model"`
	Input json.RawMessage `json:"input"`
	User  string          `json:"user,omitempty"`
}

// ImageRequest is the unified image generation request.
type ImageRequest struct {
	Model          string `json:"model"`
	Prompt         string `json:"prompt"`
	N              *int   `json:"n,omitempty"`
	Size           string `json:"size,omitempty"`
	Quality        string `json:"quality,omitempty"`
	ResponseFormat string `json:"response_format,omitempty"`
	Style          string `json:"style,omitempty"`
	User           string `json:"user,omitempty"`
}

// ─── Response types ──────────────────────────────────────────────

// ChatResponse is the unified chat completion response.
type ChatResponse struct {
	ID      string         `json:"id"`
	Model   string         `json:"model"`
	Choices []ChatChoice   `json:"choices"`
	Usage   meter.Usage    `json:"usage"`
	Provider string       `json:"provider"`
}

// ChatChoice is one choice in a chat completion response.
type ChatChoice struct {
	Index        int     `json:"index"`
	Message      Message `json:"message"`
	FinishReason string  `json:"finish_reason"`
}

// EmbedResponse is the unified embedding response.
type EmbedResponse struct {
	Model    string      `json:"model"`
	Data     []EmbedData `json:"data"`
	Usage    meter.Usage `json:"usage"`
	Provider string      `json:"provider"`
}

// EmbedData is one embedding vector.
type EmbedData struct {
	Index     int       `json:"index"`
	Embedding []float32 `json:"embedding"`
}

// ImageResponse is the unified image generation response.
type ImageResponse struct {
	Created  int64       `json:"created"`
	Data     []ImageData `json:"data"`
	Usage    meter.Usage `json:"usage"`
	Provider string      `json:"provider"`
}

// ImageData is one generated image.
type ImageData struct {
	URL           string `json:"url,omitempty"`
	B64JSON       string `json:"b64_json,omitempty"`
	RevisedPrompt string `json:"revised_prompt,omitempty"`
}

// ─── Provider interface ──────────────────────────────────────────

// Provider is the high-level interface for AI API providers.
// It wraps the low-level common.Adaptor with a simpler, type-safe API.
type Provider interface {
	Name() string
	ApiType() int
	Adaptor() common.Adaptor
}

// ConfiguredProvider is an optional interface implemented by providers
// that expose their API endpoint and key. The Client uses this to
// populate RelayInfo.ChannelBaseUrl and RelayInfo.ApiKey, which most
// adaptors rely on for URL construction and authentication.
type ConfiguredProvider interface {
	BaseURL() string
	APIKey() string
}

// GenericProvider wraps any common.Adaptor with a name, API type,
// base URL, and API key. It is the standard way to use non-OpenAI/Claude/
// Gemini providers with the Client.
type GenericProvider struct {
	name    string
	apiType int
	adaptor common.Adaptor
	baseURL string
	apiKey  string
}

// NewProvider creates a GenericProvider from the given adaptor and config.
// This is the primary constructor for providers that don't have their own
// Provider type (i.e. all providers except openai, claude, and gemini).
func NewProvider(name string, apiType int, adaptor common.Adaptor, baseURL string, apiKey string) *GenericProvider {
	return &GenericProvider{
		name:    name,
		apiType: apiType,
		adaptor: adaptor,
		baseURL: baseURL,
		apiKey:  apiKey,
	}
}

func (p *GenericProvider) Name() string             { return p.name }
func (p *GenericProvider) ApiType() int             { return p.apiType }
func (p *GenericProvider) Adaptor() common.Adaptor  { return p.adaptor }
func (p *GenericProvider) BaseURL() string          { return p.baseURL }
func (p *GenericProvider) APIKey() string           { return p.apiKey }

// ─── Client ──────────────────────────────────────────────────────

// Client is the unified entry point. It routes requests to the configured
// provider, records usage via the Meter, and returns results.
type Client struct {
	provider       Provider
	meter          meter.Meter
	httpClient     *http.Client
	retryOpts      []retry.Option       // retry options
	circuitBreaker retry.CircuitBreaker // optional circuit breaker
	requestHook    RequestHook          // optional observability hook
	fallback       *FallbackConfig      // optional model fallback
}

// RequestHook is called before each request. It returns a function that is
// called after the request completes (with the resulting error, which may be
// nil on success). This lets consumers add tracing/metrics/logging without
// the relay package depending on a specific observability SDK.
//
//	mode is one of the relaymode.RelayMode* constants.
type RequestHook func(ctx context.Context, provider, model string, mode int) func(err error)

// Option configures a Client.
type Option func(*Client)

// WithProvider sets the provider.
func WithProvider(p Provider) Option {
	return func(c *Client) { c.provider = p }
}

// WithMeter sets the usage meter.
func WithMeter(m meter.Meter) Option {
	return func(c *Client) { c.meter = m }
}

// WithHTTPClient sets a custom HTTP client.
func WithHTTPClient(hc *http.Client) Option {
	return func(c *Client) { c.httpClient = hc }
}

// FallbackConfig configures model fallback behavior. When configured, the
// Client retries a failed request with each fallback model in order. Fallback
// is opt-in: it is only active if WithFallback is used.
type FallbackConfig struct {
	// FallbackModels is a list of models to try if the primary model fails.
	// The Client will retry the request with each fallback model in order.
	FallbackModels []string
	// RetryOnErrors, if non-nil, determines which errors trigger a fallback.
	// If nil, all errors trigger fallback.
	RetryOnErrors func(err error) bool
}

// WithFallback configures model fallback.
func WithFallback(cfg FallbackConfig) Option {
	return func(c *Client) { c.fallback = &cfg }
}

// WithTimeout sets the HTTP client timeout.
func WithTimeout(d time.Duration) Option {
	return func(c *Client) {
		c.httpClient.Timeout = d
	}
}

// WithMaxIdleConns sets the max idle connections per host on the default
// transport. If a custom transport is in use that is not an *http.Transport,
// this option is a no-op.
func WithMaxIdleConns(n int) Option {
	return func(c *Client) {
		if t, ok := c.httpClient.Transport.(*http.Transport); ok {
			t.MaxIdleConnsPerHost = n
		}
	}
}

// WithRetry configures retry behaviour for HTTP requests. When set, the
// Client retries failed requests (network errors, 429, and 5xx responses)
// according to the supplied retry options. By default no retry is performed.
func WithRetry(opts ...retry.Option) Option {
	return func(c *Client) { c.retryOpts = opts }
}

// WithCircuitBreaker configures a circuit breaker for HTTP requests. When
// set, each (retried) attempt is wrapped in the breaker's Execute. By
// default no circuit breaker is used.
func WithCircuitBreaker(cb *circuitbreaker.CircuitBreaker) Option {
	return func(c *Client) { c.circuitBreaker = cb }
}

// WithRequestHook sets a hook called before each request. The returned
// function is called after the request completes with the resulting error.
// This enables tracing/metrics without the relay package depending on a
// specific observability SDK.
func WithRequestHook(h RequestHook) Option {
	return func(c *Client) { c.requestHook = h }
}

// DefaultHTTPClient returns a production-ready HTTP client with sensible
// timeouts and connection pooling. The underlying *http.Client is
// created via common/netutil so that transport tuning stays centralised.
func DefaultHTTPClient() *http.Client {
	transport := &http.Transport{
		MaxIdleConns:          100,
		MaxIdleConnsPerHost:   10,
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:   10 * time.Second,
		ResponseHeaderTimeout: 30 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
	}
	return netutil.NewStandardHTTPClient(netutil.HTTPClientConfig{
		Timeout:   120 * time.Second,
		Transport: transport,
	})
}

// New creates a new Client.
func New(opts ...Option) *Client {
	c := &Client{
		httpClient: DefaultHTTPClient(),
	}
	for _, opt := range opts {
		opt(c)
	}
	return c
}

// SetProvider replaces the provider at runtime.
func (c *Client) SetProvider(p Provider) { c.provider = p }

// SetMeter replaces the meter at runtime.
func (c *Client) SetMeter(m meter.Meter) { c.meter = m }

// Provider returns the current provider.
func (c *Client) Provider() Provider { return c.provider }

// Meter returns the current meter.
func (c *Client) Meter() meter.Meter { return c.meter }

func (c *Client) ensureProvider() error {
	if c.provider == nil {
		return fmt.Errorf("relay: no provider configured")
	}
	return nil
}

// buildRelayInfo creates a RelayInfo for the given request.
func (c *Client) buildRelayInfo(mode int, model string, stream bool) *common.RelayInfo {
	info := common.NewRelayInfo()
	info.RelayMode = mode
	info.OriginModelName = model
	info.UpstreamModelName = model
	info.IsStream = stream
	info.ApiType = c.provider.ApiType()

	// Populate channel config from the provider if it implements ConfiguredProvider.
	var baseURL, apiKey string
	if cp, ok := c.provider.(ConfiguredProvider); ok {
		baseURL = cp.BaseURL()
		apiKey = cp.APIKey()
	}

	info.ChannelBaseUrl = baseURL
	info.ApiKey = apiKey
	info.ChannelMeta = &common.ChannelMeta{
		ApiType:           c.provider.ApiType(),
		UpstreamModelName: model,
		ApiKey:            apiKey,
		ChannelBaseUrl:    baseURL,
	}
	return info
}

func (c *Client) record(ctx context.Context, model string, usage meter.Usage) {
	if c.meter == nil {
		return
	}
	_ = c.meter.Record(ctx, &meter.UsageRecord{
		Provider: c.provider.Name(),
		Model:    model,
		Usage:    usage,
	})
}

// ─── Chat ────────────────────────────────────────────────────────

// Chat sends a chat completion request. If model fallback is configured via
// WithFallback, the Client retries the request with each fallback model in
// order until one succeeds or all are exhausted.
func (c *Client) Chat(ctx context.Context, req *ChatRequest) (*ChatResponse, error) {
	if err := c.ensureProvider(); err != nil {
		return nil, err
	}

	models := []string{req.Model}
	if c.fallback != nil {
		models = append(models, c.fallback.FallbackModels...)
	}

	var lastErr error
	for i, model := range models {
		r := *req
		r.Model = model

		resp, err := c.chatOnce(ctx, &r)
		if err == nil {
			return resp, nil
		}

		lastErr = err
		logger.Debug("relay chat fallback",
			zap.String("model", model),
			zap.String("error", err.Error()),
			zap.Int("attempt", i+1))

		// If a RetryOnErrors filter is configured and this error does not
		// qualify, stop trying further fallbacks.
		if c.fallback != nil && c.fallback.RetryOnErrors != nil && !c.fallback.RetryOnErrors(err) {
			break
		}
	}
	return nil, lastErr
}

// chatOnce performs a single chat completion request against the configured
// provider without fallback handling.
func (c *Client) chatOnce(ctx context.Context, req *ChatRequest) (*ChatResponse, error) {
	var afterHook func(err error)
	if c.requestHook != nil {
		afterHook = c.requestHook(ctx, c.provider.Name(), req.Model, relaymode.RelayModeChatCompletions)
	}

	adaptor := c.provider.Adaptor()
	info := c.buildRelayInfo(relaymode.RelayModeChatCompletions, req.Model, req.Stream)
	adaptor.Init(info)

	// Convert to relaykit DTO.
	openaiReq := c.toOpenAIRequest(req)

	// Convert request to provider's native format.
	converted, err := adaptor.ConvertOpenAIRequest(ctx, info, openaiReq)
	if err != nil {
		if afterHook != nil {
			afterHook(err)
		}
		return nil, fmt.Errorf("relay: convert request: %w", err)
	}

	// Marshal request body.
	var body io.Reader
	switch v := converted.(type) {
	case io.Reader:
		body = v
	default:
		jsonData, err := json.Marshal(converted)
		if err != nil {
			if afterHook != nil {
				afterHook(err)
			}
			return nil, fmt.Errorf("relay: marshal request: %w", err)
		}
		body = strings.NewReader(string(jsonData))
	}

	// Build URL and send request.
	url, err := adaptor.GetRequestURL(info)
	if err != nil {
		if afterHook != nil {
			afterHook(err)
		}
		return nil, fmt.Errorf("relay: build URL: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, "POST", url, body)
	if err != nil {
		if afterHook != nil {
			afterHook(err)
		}
		return nil, fmt.Errorf("relay: create request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	if err := adaptor.SetupRequestHeader(ctx, &httpReq.Header, info); err != nil {
		if afterHook != nil {
			afterHook(err)
		}
		return nil, fmt.Errorf("relay: setup headers: %w", err)
	}

	resp, err := c.doRequest(ctx, adaptor, info, httpReq)
	if err != nil {
		if afterHook != nil {
			afterHook(err)
		}
		return nil, fmt.Errorf("relay: request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		pErr := parseError(resp, c.provider.Name())
		if afterHook != nil {
			afterHook(pErr)
		}
		return nil, pErr
	}

	// Parse response using a dummy ResponseWriter (we don't stream).
	var dummyW dummyResponseWriter
	usageRaw, apiErr := adaptor.DoResponse(ctx, resp, info, &dummyW)
	if apiErr != nil {
		if afterHook != nil {
			afterHook(apiErr)
		}
		return nil, fmt.Errorf("relay: parse response: %w", apiErr)
	}

	usage := extractUsage(usageRaw)
	c.record(ctx, req.Model, usage)

	// Parse the response body that the adaptor wrote to dummyW.
	chatResp, err := parseChatResponse(dummyW.Bytes(), req.Model, c.provider.Name(), usage)
	if err != nil {
		if afterHook != nil {
			afterHook(err)
		}
		return nil, fmt.Errorf("relay: parse chat response: %w", err)
	}
	if afterHook != nil {
		afterHook(nil)
	}
	return chatResp, nil
}

// ─── Chat Stream ────────────────────────────────────────────────

// ChatStreamChunk is one chunk in a streaming chat response.
type ChatStreamChunk struct {
	Delta        string                   // content delta (text)
	Reasoning    string                   // reasoning_content delta (DeepSeek/o1-style)
	ToolCalls    []dto.ToolCallResponse   // tool_call delta (OpenAI streaming format)
	FinishReason string                   // "stop" | "tool_calls" | "length" | ...
	Err          error
	Done         bool
	Usage        *meter.Usage // present on final chunk if provider reports it
}

// ChatStreamResult holds the stream channel and final usage.
type ChatStreamResult struct {
	Ch    chan ChatStreamChunk
	Usage meter.Usage // filled after channel closes
}

// ChatStream sends a streaming chat completion request.
// It returns a channel of chunks. The channel closes when the stream ends.
// After the channel closes, ChatStreamResult.Usage contains the final usage.
//
// If model fallback is configured via WithFallback, the Client retries the
// request setup with each fallback model in order until one successfully
// establishes the stream. Fallback only applies to setup-time errors; once a
// stream has started it is not retried on mid-stream failures.
func (c *Client) ChatStream(ctx context.Context, req *ChatRequest) (*ChatStreamResult, error) {
	if err := c.ensureProvider(); err != nil {
		return nil, err
	}

	var afterHook func(err error)
	if c.requestHook != nil {
		afterHook = c.requestHook(ctx, c.provider.Name(), req.Model, relaymode.RelayModeChatCompletions)
	}

	models := []string{req.Model}
	if c.fallback != nil {
		models = append(models, c.fallback.FallbackModels...)
	}

	var lastErr error
	for i, model := range models {
		r := *req
		r.Model = model
		r.Stream = true

		result, err := c.chatStreamOnce(ctx, &r)
		if err == nil {
			if afterHook != nil {
				afterHook(nil)
			}
			return result, nil
		}

		lastErr = err
		logger.Debug("relay chat stream fallback",
			zap.String("model", model),
			zap.String("error", err.Error()),
			zap.Int("attempt", i+1))

		// If a RetryOnErrors filter is configured and this error does not
		// qualify, stop trying further fallbacks.
		if c.fallback != nil && c.fallback.RetryOnErrors != nil && !c.fallback.RetryOnErrors(err) {
			break
		}
	}
	if afterHook != nil {
		afterHook(lastErr)
	}
	return nil, lastErr
}

// chatStreamOnce performs a single streaming chat completion request against
// the configured provider without fallback handling.
func (c *Client) chatStreamOnce(ctx context.Context, req *ChatRequest) (*ChatStreamResult, error) {
	adaptor := c.provider.Adaptor()
	info := c.buildRelayInfo(relaymode.RelayModeChatCompletions, req.Model, true)
	adaptor.Init(info)

	openaiReq := c.toOpenAIRequest(req)

	converted, err := adaptor.ConvertOpenAIRequest(ctx, info, openaiReq)
	if err != nil {
		return nil, fmt.Errorf("relay: convert request: %w", err)
	}

	jsonData, err := json.Marshal(converted)
	if err != nil {
		return nil, fmt.Errorf("relay: marshal request: %w", err)
	}

	url, err := adaptor.GetRequestURL(info)
	if err != nil {
		return nil, fmt.Errorf("relay: build URL: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, "POST", url, strings.NewReader(string(jsonData)))
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "text/event-stream")
	if err := adaptor.SetupRequestHeader(ctx, &httpReq.Header, info); err != nil {
		return nil, fmt.Errorf("relay: setup headers: %w", err)
	}

	resp, err := c.doRequest(ctx, adaptor, info, httpReq)
	if err != nil {
		return nil, fmt.Errorf("relay: request failed: %w", err)
	}

	result := &ChatStreamResult{
		Ch: make(chan ChatStreamChunk, 100),
	}

	go func() {
		defer resp.Body.Close()
		defer close(result.Ch)

		// Check context cancellation before processing the stream.
		select {
		case <-ctx.Done():
			result.Ch <- ChatStreamChunk{Err: ctx.Err()}
			return
		default:
		}

		// Use a pipe-based ResponseWriter to capture SSE chunks.
		pw := &streamResponseWriter{ch: result.Ch}
		usageRaw, apiErr := adaptor.DoResponse(ctx, resp, info, pw)
		if apiErr != nil {
			result.Ch <- ChatStreamChunk{Err: apiErr}
			return
		}

		usage := extractUsage(usageRaw)
		result.Usage = usage
		c.record(ctx, req.Model, usage)

		// Send final chunk with usage.
		result.Ch <- ChatStreamChunk{Done: true, Usage: &usage}
	}()

	return result, nil
}

// streamResponseWriter implements http.ResponseWriter by forwarding
// SSE data chunks to a channel.
type streamResponseWriter struct {
	ch       chan ChatStreamChunk
	header   http.Header
}

func (w *streamResponseWriter) Header() http.Header {
	if w.header == nil {
		w.header = make(http.Header)
	}
	return w.header
}

func (w *streamResponseWriter) Write(data []byte) (int, error) {
	// Parse SSE data lines and forward as chunks.
	text := string(data)
	for _, line := range splitSSELines(text) {
		if line == "[DONE]" {
			continue
		}
		// Extract content delta, tool_calls, finish_reason from the SSE JSON.
		chunk, ok := extractSSEChunk(line)
		if !ok {
			continue
		}
		w.ch <- chunk
	}
	return len(data), nil
}

func (w *streamResponseWriter) WriteHeader(statusCode int) {}

func splitSSELines(text string) []string {
	var lines []string
	for _, line := range splitLines(text) {
		line = trimSpace(line)
		if hasPrefix(line, "data: ") {
			lines = append(lines, trimPrefix(line, "data: "))
		}
	}
	return lines
}

func splitLines(s string) []string {
	var result []string
	start := 0
	for i := 0; i < len(s); i++ {
		if s[i] == '\n' {
			result = append(result, s[start:i])
			start = i + 1
		}
	}
	if start < len(s) {
		result = append(result, s[start:])
	}
	return result
}

func trimSpace(s string) string {
	start, end := 0, len(s)
	for start < end && (s[start] == ' ' || s[start] == '\t' || s[start] == '\r') {
		start++
	}
	for end > start && (s[end-1] == ' ' || s[end-1] == '\t' || s[end-1] == '\r') {
		end--
	}
	return s[start:end]
}

func hasPrefix(s, prefix string) bool {
	return len(s) >= len(prefix) && s[:len(prefix)] == prefix
}

func trimPrefix(s, prefix string) string {
	if hasPrefix(s, prefix) {
		return s[len(prefix):]
	}
	return s
}

// extractSSEChunk parses one SSE data line into a ChatStreamChunk,
// extracting content delta, reasoning delta, tool_call deltas, and
// finish_reason. Returns ok=false if the line has no useful payload.
func extractSSEChunk(data string) (ChatStreamChunk, bool) {
	var chunk struct {
		Choices []struct {
			Delta struct {
				Content          *string                  `json:"content,omitempty"`
				ReasoningContent *string                  `json:"reasoning_content,omitempty"`
				Reasoning        *string                  `json:"reasoning,omitempty"`
				Role             string                   `json:"role,omitempty"`
				ToolCalls        []dto.ToolCallResponse   `json:"tool_calls,omitempty"`
			} `json:"delta"`
			FinishReason *string `json:"finish_reason"`
		} `json:"choices"`
	}
	if err := json.Unmarshal([]byte(data), &chunk); err != nil {
		return ChatStreamChunk{}, false
	}
	if len(chunk.Choices) == 0 {
		return ChatStreamChunk{}, false
	}
	c := chunk.Choices[0]
	result := ChatStreamChunk{}
	hasPayload := false

	if c.Delta.Content != nil && *c.Delta.Content != "" {
		result.Delta = *c.Delta.Content
		hasPayload = true
	}
	// reasoning_content (DeepSeek) or reasoning (some providers)
	if c.Delta.ReasoningContent != nil && *c.Delta.ReasoningContent != "" {
		result.Reasoning = *c.Delta.ReasoningContent
		hasPayload = true
	} else if c.Delta.Reasoning != nil && *c.Delta.Reasoning != "" {
		result.Reasoning = *c.Delta.Reasoning
		hasPayload = true
	}
	if len(c.Delta.ToolCalls) > 0 {
		result.ToolCalls = c.Delta.ToolCalls
		hasPayload = true
	}
	if c.FinishReason != nil && *c.FinishReason != "" {
		result.FinishReason = *c.FinishReason
		hasPayload = true
	}
	return result, hasPayload
}

// ─── Embed ───────────────────────────────────────────────────────

// Embed sends an embedding request.
func (c *Client) Embed(ctx context.Context, req *EmbedRequest) (*EmbedResponse, error) {
	if err := c.ensureProvider(); err != nil {
		return nil, err
	}

	var afterHook func(err error)
	if c.requestHook != nil {
		afterHook = c.requestHook(ctx, c.provider.Name(), req.Model, relaymode.RelayModeEmbeddings)
	}

	adaptor := c.provider.Adaptor()
	info := c.buildRelayInfo(relaymode.RelayModeEmbeddings, req.Model, false)
	adaptor.Init(info)

	embedReq := dto.EmbeddingRequest{
		Model: req.Model,
		Input: req.Input,
		User:  req.User,
	}

	converted, err := adaptor.ConvertEmbeddingRequest(ctx, info, embedReq)
	if err != nil {
		if afterHook != nil {
			afterHook(err)
		}
		return nil, fmt.Errorf("relay: convert embed request: %w", err)
	}

	jsonData, err := json.Marshal(converted)
	if err != nil {
		if afterHook != nil {
			afterHook(err)
		}
		return nil, fmt.Errorf("relay: marshal embed request: %w", err)
	}

	url, err := adaptor.GetRequestURL(info)
	if err != nil {
		if afterHook != nil {
			afterHook(err)
		}
		return nil, fmt.Errorf("relay: build URL: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, "POST", url, strings.NewReader(string(jsonData)))
	if err != nil {
		if afterHook != nil {
			afterHook(err)
		}
		return nil, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	_ = adaptor.SetupRequestHeader(ctx, &httpReq.Header, info)

	resp, err := c.doRequest(ctx, adaptor, info, httpReq)
	if err != nil {
		if afterHook != nil {
			afterHook(err)
		}
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		pErr := parseError(resp, c.provider.Name())
		if afterHook != nil {
			afterHook(pErr)
		}
		return nil, pErr
	}

	var dummyW dummyResponseWriter
	usageRaw, apiErr := adaptor.DoResponse(ctx, resp, info, &dummyW)
	if apiErr != nil {
		if afterHook != nil {
			afterHook(apiErr)
		}
		return nil, fmt.Errorf("relay: parse embed response: %w", apiErr)
	}

	usage := extractUsage(usageRaw)
	c.record(ctx, req.Model, usage)

	embedResp, err := parseEmbedResponse(dummyW.Bytes(), req.Model, c.provider.Name(), usage)
	if err != nil {
		if afterHook != nil {
			afterHook(err)
		}
		return nil, err
	}
	if afterHook != nil {
		afterHook(nil)
	}
	return embedResp, nil
}

// ─── Image ───────────────────────────────────────────────────────

// Image sends an image generation request.
func (c *Client) Image(ctx context.Context, req *ImageRequest) (*ImageResponse, error) {
	if err := c.ensureProvider(); err != nil {
		return nil, err
	}

	var afterHook func(err error)
	if c.requestHook != nil {
		afterHook = c.requestHook(ctx, c.provider.Name(), req.Model, relaymode.RelayModeImagesGenerations)
	}

	adaptor := c.provider.Adaptor()
	info := c.buildRelayInfo(relaymode.RelayModeImagesGenerations, req.Model, false)
	adaptor.Init(info)

	imageReq := dto.ImageRequest{
		Model:          req.Model,
		Prompt:         req.Prompt,
		Size:           req.Size,
		Quality:        req.Quality,
		ResponseFormat: req.ResponseFormat,
		Style:          json.RawMessage(marshalString(req.Style)),
		User:           json.RawMessage(marshalString(req.User)),
	}
	if req.N != nil {
		imageReq.N = ptrUint(uint(*req.N))
	}

	converted, err := adaptor.ConvertImageRequest(ctx, info, imageReq)
	if err != nil {
		if afterHook != nil {
			afterHook(err)
		}
		return nil, fmt.Errorf("relay: convert image request: %w", err)
	}

	jsonData, err := json.Marshal(converted)
	if err != nil {
		if afterHook != nil {
			afterHook(err)
		}
		return nil, fmt.Errorf("relay: marshal image request: %w", err)
	}

	url, err := adaptor.GetRequestURL(info)
	if err != nil {
		if afterHook != nil {
			afterHook(err)
		}
		return nil, err
	}

	httpReq, err := http.NewRequestWithContext(ctx, "POST", url, strings.NewReader(string(jsonData)))
	if err != nil {
		if afterHook != nil {
			afterHook(err)
		}
		return nil, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	_ = adaptor.SetupRequestHeader(ctx, &httpReq.Header, info)

	resp, err := c.doRequest(ctx, adaptor, info, httpReq)
	if err != nil {
		if afterHook != nil {
			afterHook(err)
		}
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		pErr := parseError(resp, c.provider.Name())
		if afterHook != nil {
			afterHook(pErr)
		}
		return nil, pErr
	}

	var dummyW dummyResponseWriter
	usageRaw, apiErr := adaptor.DoResponse(ctx, resp, info, &dummyW)
	if apiErr != nil {
		if afterHook != nil {
			afterHook(apiErr)
		}
		return nil, fmt.Errorf("relay: parse image response: %w", apiErr)
	}

	usage := extractUsage(usageRaw)
	if usage.ImageCount == 0 && req.N != nil {
		usage.ImageCount = *req.N
	} else if usage.ImageCount == 0 {
		usage.ImageCount = 1
	}
	c.record(ctx, req.Model, usage)

	imageResp, err := parseImageResponse(dummyW.Bytes(), req.Model, c.provider.Name(), usage)
	if err != nil {
		if afterHook != nil {
			afterHook(err)
		}
		return nil, err
	}
	if afterHook != nil {
		afterHook(nil)
	}
	return imageResp, nil
}

// ─── Audio (TTS / ASR) ──────────────────────────────────────────

// AudioRequest is the unified audio request for TTS and ASR.
type AudioRequest struct {
	Model          string
	Input          json.RawMessage // text for TTS, file data for ASR
	Voice          string
	ResponseFormat string
	Speed          *float64
	Language       string
}

// Audio sends an audio request (TTS or ASR) to the provider.
// The response body is returned as raw bytes (audio data for TTS, transcript JSON for ASR).
func (c *Client) Audio(ctx context.Context, req *AudioRequest, isTranscription bool) (*AudioResponse, error) {
	return c.audioWithMode(ctx, req, isTranscription, false)
}

// AudioTranslation sends an audio translation request (ASR translation) to the provider.
// Similar to transcription but translates the audio to English.
func (c *Client) AudioTranslation(ctx context.Context, req *AudioRequest) (*AudioResponse, error) {
	return c.audioWithMode(ctx, req, false, true)
}

func (c *Client) audioWithMode(ctx context.Context, req *AudioRequest, isTranscription, isTranslation bool) (*AudioResponse, error) {
	if err := c.ensureProvider(); err != nil {
		return nil, err
	}

	var afterHook func(err error)

	adaptor := c.provider.Adaptor()
	mode := relaymode.RelayModeAudioSpeech
	switch {
	case isTranslation:
		mode = relaymode.RelayModeAudioTranslation
	case isTranscription:
		mode = relaymode.RelayModeAudioTranscription
	}
	if c.requestHook != nil {
		afterHook = c.requestHook(ctx, c.provider.Name(), req.Model, mode)
	}
	info := c.buildRelayInfo(mode, req.Model, false)
	adaptor.Init(info)

	audioReq := dto.AudioRequest{
		Model:          req.Model,
		Input:          string(req.Input),
		Voice:          req.Voice,
		ResponseFormat: req.ResponseFormat,
		Language:       json.RawMessage(marshalString(req.Language)),
	}
	if req.Speed != nil {
		audioReq.Speed = req.Speed
	}

	body, err := adaptor.ConvertAudioRequest(ctx, info, audioReq)
	if err != nil {
		if afterHook != nil {
			afterHook(err)
		}
		return nil, fmt.Errorf("relay: convert audio request: %w", err)
	}

	url, err := adaptor.GetRequestURL(info)
	if err != nil {
		if afterHook != nil {
			afterHook(err)
		}
		return nil, err
	}

	var httpReq *http.Request
	if body != nil {
		httpReq, err = http.NewRequestWithContext(ctx, "POST", url, body)
	} else {
		httpReq, err = http.NewRequestWithContext(ctx, "POST", url, nil)
	}
	if err != nil {
		if afterHook != nil {
			afterHook(err)
		}
		return nil, err
	}
	_ = adaptor.SetupRequestHeader(ctx, &httpReq.Header, info)

	resp, err := c.doRequest(ctx, adaptor, info, httpReq)
	if err != nil {
		if afterHook != nil {
			afterHook(err)
		}
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		pErr := parseError(resp, c.provider.Name())
		if afterHook != nil {
			afterHook(pErr)
		}
		return nil, pErr
	}

	var dummyW dummyResponseWriter
	usageRaw, apiErr := adaptor.DoResponse(ctx, resp, info, &dummyW)
	if apiErr != nil {
		if afterHook != nil {
			afterHook(apiErr)
		}
		return nil, fmt.Errorf("relay: parse audio response: %w", apiErr)
	}

	usage := extractUsage(usageRaw)
	c.record(ctx, req.Model, usage)

	if afterHook != nil {
		afterHook(nil)
	}
	return &AudioResponse{
		Data:    dummyW.Bytes(),
		Usage:   usage,
		Headers: resp.Header,
	}, nil
}

// AudioResponse holds the audio response data.
type AudioResponse struct {
	Data    []byte
	Usage   meter.Usage
	Headers http.Header
}

// ─── Rerank ──────────────────────────────────────────────────────

// RerankRequest is the unified rerank request.
type RerankRequest struct {
	Model     string
	Query     string
	Documents []string
	TopN      *int
}

// Rerank sends a rerank request to the provider.
func (c *Client) Rerank(ctx context.Context, req *RerankRequest) (*RerankResponse, error) {
	if err := c.ensureProvider(); err != nil {
		return nil, err
	}

	adaptor := c.provider.Adaptor()
	info := c.buildRelayInfo(relaymode.RelayModeRerank, req.Model, false)
	adaptor.Init(info)

	docs := make([]any, len(req.Documents))
	for i, d := range req.Documents {
		docs[i] = d
	}
	rerankReq := dto.RerankRequest{
		Model:     req.Model,
		Query:     req.Query,
		Documents: docs,
	}
	if req.TopN != nil {
		rerankReq.TopN = req.TopN
	}

	converted, err := adaptor.ConvertRerankRequest(ctx, relaymode.RelayModeRerank, rerankReq)
	if err != nil {
		return nil, fmt.Errorf("relay: convert rerank request: %w", err)
	}

	jsonData, err := json.Marshal(converted)
	if err != nil {
		return nil, fmt.Errorf("relay: marshal rerank request: %w", err)
	}

	url, err := adaptor.GetRequestURL(info)
	if err != nil {
		return nil, err
	}

	httpReq, err := http.NewRequestWithContext(ctx, "POST", url, strings.NewReader(string(jsonData)))
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	_ = adaptor.SetupRequestHeader(ctx, &httpReq.Header, info)

	resp, err := c.doRequest(ctx, adaptor, info, httpReq)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, parseError(resp, c.provider.Name())
	}

	var dummyW dummyResponseWriter
	usageRaw, apiErr := adaptor.DoResponse(ctx, resp, info, &dummyW)
	if apiErr != nil {
		return nil, fmt.Errorf("relay: parse rerank response: %w", apiErr)
	}

	usage := extractUsage(usageRaw)
	c.record(ctx, req.Model, usage)

	var rerankResp dto.RerankResponse
	if err := json.Unmarshal(dummyW.Bytes(), &rerankResp); err != nil {
		return nil, fmt.Errorf("relay: unmarshal rerank response: %w", err)
	}

	return &RerankResponse{
		Results: rerankResp.Results,
		Usage:   usage,
	}, nil
}

// RerankResponse holds the rerank response.
type RerankResponse struct {
	Results []dto.RerankResponseResult
	Usage   meter.Usage
}

// ─── Responses (OpenAI Responses API) ───────────────────────────

// ResponsesRequest is the unified OpenAI Responses API request.
type ResponsesRequest struct {
	Model   string
	Input   json.RawMessage
	Stream  bool
	Tools   json.RawMessage
	Options json.RawMessage
}

// Responses sends an OpenAI Responses API request.
func (c *Client) Responses(ctx context.Context, req *ResponsesRequest) (*ResponsesResponse, error) {
	if err := c.ensureProvider(); err != nil {
		return nil, err
	}

	var afterHook func(err error)
	if c.requestHook != nil {
		afterHook = c.requestHook(ctx, c.provider.Name(), req.Model, relaymode.RelayModeResponses)
	}

	adaptor := c.provider.Adaptor()
	info := c.buildRelayInfo(relaymode.RelayModeResponses, req.Model, req.Stream)
	adaptor.Init(info)

	stream := req.Stream
	responsesReq := dto.OpenAIResponsesRequest{
		Model:  req.Model,
		Input:  req.Input,
		Stream: &stream,
		Tools:  req.Tools,
	}

	converted, err := adaptor.ConvertOpenAIResponsesRequest(ctx, info, responsesReq)
	if err != nil {
		if afterHook != nil {
			afterHook(err)
		}
		return nil, fmt.Errorf("relay: convert responses request: %w", err)
	}

	jsonData, err := json.Marshal(converted)
	if err != nil {
		if afterHook != nil {
			afterHook(err)
		}
		return nil, fmt.Errorf("relay: marshal responses request: %w", err)
	}

	url, err := adaptor.GetRequestURL(info)
	if err != nil {
		if afterHook != nil {
			afterHook(err)
		}
		return nil, err
	}

	httpReq, err := http.NewRequestWithContext(ctx, "POST", url, strings.NewReader(string(jsonData)))
	if err != nil {
		if afterHook != nil {
			afterHook(err)
		}
		return nil, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	if req.Stream {
		httpReq.Header.Set("Accept", "text/event-stream")
	}
	_ = adaptor.SetupRequestHeader(ctx, &httpReq.Header, info)

	resp, err := c.doRequest(ctx, adaptor, info, httpReq)
	if err != nil {
		if afterHook != nil {
			afterHook(err)
		}
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		pErr := parseError(resp, c.provider.Name())
		if afterHook != nil {
			afterHook(pErr)
		}
		return nil, pErr
	}

	var dummyW dummyResponseWriter
	usageRaw, apiErr := adaptor.DoResponse(ctx, resp, info, &dummyW)
	if apiErr != nil {
		if afterHook != nil {
			afterHook(apiErr)
		}
		return nil, fmt.Errorf("relay: parse responses response: %w", apiErr)
	}

	usage := extractUsage(usageRaw)
	c.record(ctx, req.Model, usage)

	if afterHook != nil {
		afterHook(nil)
	}
	return &ResponsesResponse{
		Data:  dummyW.Bytes(),
		Usage: usage,
	}, nil
}

// ResponsesResponse holds the Responses API response.
type ResponsesResponse struct {
	Data  []byte
	Usage meter.Usage
}

// ─── Task (async video/music) ────────────────────────────────────

// TaskProvider is the interface for async task providers.
type TaskProvider interface {
	Name() string
	ApiType() int
	TaskAdaptor() common.TaskAdaptor
}

// SubmitTask submits an async task (video/music generation).
func (c *Client) SubmitTask(ctx context.Context, tp TaskProvider, body io.Reader) (*TaskSubmitResult, error) {
	adaptor := tp.TaskAdaptor()
	info := common.NewRelayInfo()
	info.RelayMode = relaymode.RelayModeVideoSubmit
	info.ChannelType = tp.ApiType()
	if cp, ok := c.provider.(ConfiguredProvider); ok {
		info.ApiKey = cp.APIKey()
		info.ChannelBaseUrl = cp.BaseURL()
	}
	adaptor.Init(info)

	if taskErr := adaptor.ValidateRequestAndSetAction(ctx, info); taskErr != nil {
		return nil, fmt.Errorf("relay: validate task: %w", taskErr)
	}

	url, err := adaptor.BuildRequestURL(info)
	if err != nil {
		return nil, err
	}

	if body == nil {
		body, err = adaptor.BuildRequestBody(ctx, info)
		if err != nil {
			return nil, fmt.Errorf("relay: build task body: %w", err)
		}
	}

	httpReq, err := http.NewRequestWithContext(ctx, "POST", url, body)
	if err != nil {
		return nil, err
	}
	_ = adaptor.BuildRequestHeader(ctx, httpReq, info)

	resp, err := c.doTaskRequest(ctx, adaptor, info, httpReq)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	taskID, taskData, taskErr := adaptor.DoResponse(ctx, resp, info)
	if taskErr != nil {
		return nil, fmt.Errorf("relay: task submit: %w", taskErr)
	}

	// Record usage for task submission (request count).
	c.record(ctx, info.UpstreamModelName, meter.Usage{
		RequestCount: 1,
	})

	return &TaskSubmitResult{
		TaskID:   taskID,
		TaskData: taskData,
	}, nil
}

// FetchTask polls the status of an async task.
func (c *Client) FetchTask(ctx context.Context, tp TaskProvider, baseURL, key string, body map[string]any, proxy string) (*common.TaskInfo, error) {
	adaptor := tp.TaskAdaptor()
	resp, err := adaptor.FetchTask(baseURL, key, body, proxy)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	taskInfo, err := adaptor.ParseTaskResult(respBody)
	if err != nil {
		return nil, err
	}

	// Record usage when task completes (video/audio seconds if available).
	if taskInfo != nil && taskInfo.Status == "SUCCESS" {
		usage := meter.Usage{
			RequestCount: 1,
		}
		c.record(ctx, "", usage)
	}

	return taskInfo, nil
}

// TaskSubmitResult holds the result of submitting an async task.
type TaskSubmitResult struct {
	TaskID   string
	TaskData []byte
}

func (c *Client) doTaskRequest(ctx context.Context, adaptor common.TaskAdaptor, info *common.RelayInfo, httpReq *http.Request) (*http.Response, error) {
	if c.httpClient != nil {
		return c.httpClient.Do(httpReq)
	}
	return http.DefaultClient.Do(httpReq)
}

// ─── Midjourney ──────────────────────────────────────────────────

// MidjourneyRequest represents a Midjourney task submission request.
type MidjourneyRequest struct {
	Prompt      string   `json:"prompt,omitempty"`
	CustomId    string   `json:"customId,omitempty"`
	BotType     string   `json:"bot_type,omitempty"`
	NotifyHook  string   `json:"notifyHook,omitempty"`
	Action      string   `json:"action,omitempty"`
	Index       int      `json:"index,omitempty"`
	State       string   `json:"state,omitempty"`
	TaskId      string   `json:"taskId,omitempty"`
	Base64Array []string `json:"base64Array,omitempty"`
	Content     string   `json:"content,omitempty"`
	MaskBase64  string   `json:"maskBase64,omitempty"`
}

// MidjourneyResponse represents the Midjourney API response.
type MidjourneyResponse struct {
	Code        int            `json:"code"`
	Description string         `json:"description,omitempty"`
	Properties  map[string]any `json:"properties,omitempty"`
	Result      string         `json:"result,omitempty"`
}

// MidjourneyTask represents a fetched Midjourney task state.
type MidjourneyTask struct {
	ID          string         `json:"id"`
	Action      string         `json:"action,omitempty"`
	Status      string         `json:"status,omitempty"`
	Progress    string         `json:"progress,omitempty"`
	Prompt      string         `json:"prompt,omitempty"`
	PromptEn    string         `json:"promptEn,omitempty"`
	ImageUrl    string         `json:"imageUrl,omitempty"`
	VideoUrl    string         `json:"videoUrl,omitempty"`
	FailReason  string         `json:"failReason,omitempty"`
	Buttons     []map[string]any `json:"buttons,omitempty"`
	Properties  map[string]any `json:"properties,omitempty"`
	SubmitTime  int64          `json:"submitTime,omitempty"`
	StartTime   int64          `json:"startTime,omitempty"`
	FinishTime  int64          `json:"finishTime,omitempty"`
}

// MidjourneySubmit submits a Midjourney task.
// The mode should be one of the relaymode.RelayModeMidjourney* constants.
func (c *Client) MidjourneySubmit(ctx context.Context, baseURL, apiKey string, mode int, req *MidjourneyRequest) (*MidjourneyResponse, error) {
	var path string
	switch mode {
	case relaymode.RelayModeMidjourneyImagine:
		path = "/mj/submit/imagine"
	case relaymode.RelayModeMidjourneyDescribe:
		path = "/mj/submit/describe"
	case relaymode.RelayModeMidjourneyBlend:
		path = "/mj/submit/blend"
	case relaymode.RelayModeMidjourneyChange:
		path = "/mj/submit/change"
	case relaymode.RelayModeMidjourneySimpleChange:
		path = "/mj/submit/simple-change"
	case relaymode.RelayModeMidjourneyAction:
		path = "/mj/submit/action"
	case relaymode.RelayModeMidjourneyShorten:
		path = "/mj/submit/shorten"
	case relaymode.RelayModeMidjourneyModal:
		path = "/mj/submit/modal"
	case relaymode.RelayModeMidjourneyVideo:
		path = "/mj/submit/video"
	case relaymode.RelayModeMidjourneyEdits:
		path = "/mj/submit/edits"
	case relaymode.RelayModeMidjourneyUpload:
		path = "/mj/submit/upload-discord-images"
	case relaymode.RelayModeSwapFace:
		path = "/mj/insight-face/swap"
	default:
		return nil, fmt.Errorf("relay: unsupported midjourney mode: %d", mode)
	}

	url := strings.TrimSuffix(baseURL, "/") + path

	jsonData, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("relay: marshal midjourney request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, "POST", url, strings.NewReader(string(jsonData)))
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("mj-api-secret", apiKey)

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("relay: midjourney request failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	var mjResp MidjourneyResponse
	if err := json.Unmarshal(body, &mjResp); err != nil {
		return nil, fmt.Errorf("relay: parse midjourney response: %w", err)
	}

	c.record(ctx, "midjourney", meter.Usage{RequestCount: 1})

	return &mjResp, nil
}

// MidjourneyFetch fetches a Midjourney task by ID.
func (c *Client) MidjourneyFetch(ctx context.Context, baseURL, apiKey, taskID string) (*MidjourneyTask, error) {
	url := strings.TrimSuffix(baseURL, "/") + "/mj/task/" + taskID + "/fetch"

	httpReq, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("mj-api-secret", apiKey)

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("relay: midjourney fetch failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	var task MidjourneyTask
	if err := json.Unmarshal(body, &task); err != nil {
		return nil, fmt.Errorf("relay: parse midjourney task: %w", err)
	}

	return &task, nil
}

// MidjourneyFetchByCondition fetches Midjourney tasks by condition (e.g. user_id, status).
func (c *Client) MidjourneyFetchByCondition(ctx context.Context, baseURL, apiKey string, condition map[string]any) ([]MidjourneyTask, error) {
	url := strings.TrimSuffix(baseURL, "/") + "/mj/task/list-by-condition"

	jsonData, err := json.Marshal(condition)
	if err != nil {
		return nil, fmt.Errorf("relay: marshal condition: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, "POST", url, strings.NewReader(string(jsonData)))
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("mj-api-secret", apiKey)

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("relay: midjourney fetch-by-condition failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	var tasks []MidjourneyTask
	if err := json.Unmarshal(body, &tasks); err != nil {
		return nil, fmt.Errorf("relay: parse midjourney tasks: %w", err)
	}

	return tasks, nil
}

// ─── Suno ────────────────────────────────────────────────────────

// SunoSubmitRequest is the request body for Suno music/lyrics generation.
type SunoSubmitRequest struct {
	GptDescriptionPrompt string  `json:"gpt_description_prompt,omitempty"`
	Prompt               string  `json:"prompt,omitempty"`
	Mv                   string  `json:"mv,omitempty"`
	Title                string  `json:"title,omitempty"`
	Tags                 string  `json:"tags,omitempty"`
	ContinueAt           float64 `json:"continue_at,omitempty"`
	TaskID               string  `json:"task_id,omitempty"`
	ContinueClipId       string  `json:"continue_clip_id,omitempty"`
	MakeInstrumental     bool    `json:"make_instrumental"`
}

// SunoSubmitResponse is the response from a Suno submit request.
type SunoSubmitResponse struct {
	Code    int    `json:"code"`
	Message string `json:"message,omitempty"`
	Data    string `json:"data,omitempty"`
}

// SunoTaskData represents one Suno task entry returned by the fetch endpoint.
type SunoTaskData struct {
	TaskID     string          `json:"task_id,omitempty"`
	Action     string          `json:"action,omitempty"`
	Status     string          `json:"status,omitempty"`
	FailReason string          `json:"fail_reason,omitempty"`
	SubmitTime int64           `json:"submit_time,omitempty"`
	StartTime  int64           `json:"start_time,omitempty"`
	FinishTime int64           `json:"finish_time,omitempty"`
	Data       json.RawMessage `json:"data,omitempty"`
}

// SunoActionMusic and SunoActionLyrics are the supported Suno actions.
const (
	SunoActionMusic  = "MUSIC"
	SunoActionLyrics = "LYRICS"
)

// SubmitSunoTask submits a Suno music or lyrics generation task.
// action must be SunoActionMusic or SunoActionLyrics.
func (c *Client) SubmitSunoTask(ctx context.Context, baseURL, apiKey, action string, req *SunoSubmitRequest) (*SunoSubmitResponse, error) {
	switch action {
	case SunoActionMusic, SunoActionLyrics:
	default:
		return nil, fmt.Errorf("relay: invalid suno action: %s", action)
	}

	if action == SunoActionMusic && req.Mv == "" {
		req.Mv = "chirp-v3-0"
	}
	if action == SunoActionLyrics && req.Prompt == "" {
		return nil, fmt.Errorf("relay: suno lyrics requires prompt")
	}

	url := strings.TrimSuffix(baseURL, "/") + "/suno/submit/" + strings.ToLower(action)

	jsonData, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("relay: marshal suno request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, "POST", url, strings.NewReader(string(jsonData)))
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+apiKey)

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("relay: suno submit failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	var sunoResp SunoSubmitResponse
	if err := json.Unmarshal(body, &sunoResp); err != nil {
		return nil, fmt.Errorf("relay: parse suno response: %w", err)
	}

	c.record(ctx, "suno", meter.Usage{RequestCount: 1})

	return &sunoResp, nil
}

// FetchSunoTask fetches Suno task status by task IDs (batch supported).
func (c *Client) FetchSunoTask(ctx context.Context, baseURL, apiKey string, taskIDs []string) ([]SunoTaskData, error) {
	url := strings.TrimSuffix(baseURL, "/") + "/suno/fetch"

	payload := map[string]any{"ids": taskIDs}
	jsonData, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("relay: marshal suno fetch payload: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, "POST", url, strings.NewReader(string(jsonData)))
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+apiKey)

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("relay: suno fetch failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	var tasks []SunoTaskData
	if err := json.Unmarshal(body, &tasks); err != nil {
		return nil, fmt.Errorf("relay: parse suno tasks: %w", err)
	}

	return tasks, nil
}

// ─── Helpers ─────────────────────────────────────────────────────

func (c *Client) doRequest(ctx context.Context, adaptor common.Adaptor, info *common.RelayInfo, httpReq *http.Request) (*http.Response, error) {
	// Use the adaptor's DoRequest if it handles the full request;
	// otherwise fall back to our HTTP client.
	resp, err := adaptor.DoRequest(ctx, info, httpReq.Body)
	if err != nil {
		return nil, err
	}
	if resp != nil {
		return resp, nil
	}

	// If no retry/circuit breaker configured, just do the request.
	if len(c.retryOpts) == 0 && c.circuitBreaker == nil {
		return c.httpClient.Do(httpReq)
	}

	// With retry/circuit breaker.
	var lastResp *http.Response
	var lastErr error
	retryOpts := append([]retry.Option{}, c.retryOpts...)
	if c.circuitBreaker != nil {
		retryOpts = append(retryOpts, retry.WithCircuitBreaker(c.circuitBreaker))
	}
	retryOpts = append(retryOpts, retry.WithOnRetry(func(attempt int, err error) {
		logger.Debug("relay retry", zap.Int("attempt", attempt), zap.String("error", err.Error()))
	}))

	err = retry.Do(ctx, func(ctx context.Context) error {
		// Clone the request body if needed (request body may be consumed).
		var bodyReader io.Reader
		if httpReq.Body != nil {
			bodyBytes, readErr := io.ReadAll(httpReq.Body)
			if readErr != nil {
				return readErr
			}
			httpReq.Body.Close()
			bodyReader = bytes.NewReader(bodyBytes)
			httpReq.Body = io.NopCloser(bodyReader)
		}

		resp, doErr := c.httpClient.Do(httpReq)
		if doErr != nil {
			lastErr = doErr
			return doErr
		}

		// Retry on 429 and 5xx.
		if resp.StatusCode == 429 || resp.StatusCode >= 500 {
			body, _ := io.ReadAll(resp.Body)
			resp.Body.Close()
			lastErr = fmt.Errorf("relay: HTTP %d: %s", resp.StatusCode, string(body))
			return lastErr
		}

		lastResp = resp
		lastErr = nil
		return nil
	}, retryOpts...)

	if err != nil {
		if lastResp != nil {
			lastResp.Body.Close()
		}
		return nil, err
	}
	return lastResp, nil
}

func (c *Client) toOpenAIRequest(req *ChatRequest) *dto.GeneralOpenAIRequest {
	r := &dto.GeneralOpenAIRequest{
		Model:           req.Model,
		Messages:        req.Messages,
		Temperature:     req.Temperature,
		TopP:            req.TopP,
		Stream:          &req.Stream,
		Tools:           req.Tools,
		Stop:            req.Stop,
		N:               req.N,
		User:            json.RawMessage(marshalString(req.User)),
		ReasoningEffort: req.ReasoningEffort,
	}
	if req.MaxTokens != nil {
		r.MaxTokens = ptrUint(uint(*req.MaxTokens))
	}
	if len(req.ToolChoice) > 0 {
		r.ToolChoice = json.RawMessage(req.ToolChoice)
	}
	// For streaming requests, request usage in the final chunk.
	if req.Stream {
		r.StreamOptions = &dto.StreamOptions{IncludeUsage: true}
	}
	return r
}

func ptrUint(v uint) *uint { return &v }

func extractUsage(usageRaw any) meter.Usage {
	if usageRaw == nil {
		return meter.Usage{}
	}
	// Try different usage types.
	switch u := usageRaw.(type) {
	case meter.Usage:
		return u
	case *meter.Usage:
		return *u
	case dto.Usage:
		input := u.InputTokens
		if input == 0 {
			input = u.PromptTokens
		}
		output := u.OutputTokens
		if output == 0 {
			output = u.CompletionTokens
		}
		total := u.TotalTokens
		if total == 0 {
			total = input + output
		}
		return meter.Usage{
			InputTokens:  input,
			OutputTokens: output,
			TotalTokens:  total,
			CachedTokens: u.PromptCacheHitTokens,
		}
	case *dto.Usage:
		if u == nil {
			return meter.Usage{}
		}
		input := u.InputTokens
		if input == 0 {
			input = u.PromptTokens
		}
		output := u.OutputTokens
		if output == 0 {
			output = u.CompletionTokens
		}
		total := u.TotalTokens
		if total == 0 {
			total = input + output
		}
		return meter.Usage{
			InputTokens:  input,
			OutputTokens: output,
			TotalTokens:  total,
			CachedTokens: u.PromptCacheHitTokens,
		}
	case dto.ClaudeUsage:
		return meter.Usage{
			InputTokens:  u.InputTokens,
			OutputTokens: u.OutputTokens,
			TotalTokens:  u.InputTokens + u.OutputTokens,
			CachedTokens: u.CacheReadInputTokens,
		}
	case *dto.ClaudeUsage:
		if u == nil {
			return meter.Usage{}
		}
		return meter.Usage{
			InputTokens:  u.InputTokens,
			OutputTokens: u.OutputTokens,
			TotalTokens:  u.InputTokens + u.OutputTokens,
			CachedTokens: u.CacheReadInputTokens,
		}
	case dto.GeminiUsageMetadata:
		return meter.Usage{
			InputTokens:  u.PromptTokenCount,
			OutputTokens: u.CandidatesTokenCount,
			TotalTokens:  u.TotalTokenCount,
			CachedTokens: u.CachedContentTokenCount,
		}
	case *dto.GeminiUsageMetadata:
		if u == nil {
			return meter.Usage{}
		}
		return meter.Usage{
			InputTokens:  u.PromptTokenCount,
			OutputTokens: u.CandidatesTokenCount,
			TotalTokens:  u.TotalTokenCount,
			CachedTokens: u.CachedContentTokenCount,
		}
	}
	return meter.Usage{}
}

// dummyResponseWriter captures response body written by adaptor.DoResponse.
type dummyResponseWriter struct {
	buf []byte
	hdr http.Header
}

func (w *dummyResponseWriter) Header() http.Header {
	if w.hdr == nil {
		w.hdr = make(http.Header)
	}
	return w.hdr
}

func (w *dummyResponseWriter) Write(data []byte) (int, error) {
	w.buf = append(w.buf, data...)
	return len(data), nil
}

func (w *dummyResponseWriter) WriteHeader(statusCode int) {}

func (w *dummyResponseWriter) Bytes() []byte { return w.buf }

// parseChatResponse parses the JSON response body into a ChatResponse.
func parseChatResponse(body []byte, model, provider string, usage meter.Usage) (*ChatResponse, error) {
	var raw struct {
		ID      string         `json:"id"`
		Model   string         `json:"model"`
		Choices []ChatChoice   `json:"choices"`
		Usage   *dto.Usage     `json:"usage"`
	}
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil, fmt.Errorf("parse chat response: %w", err)
	}
	if raw.Model == "" {
		raw.Model = model
	}
	resp := &ChatResponse{
		ID:       raw.ID,
		Model:    raw.Model,
		Choices:  raw.Choices,
		Usage:    usage,
		Provider: provider,
	}
	return resp, nil
}

// parseEmbedResponse parses the JSON response body into an EmbedResponse.
func parseEmbedResponse(body []byte, model, provider string, usage meter.Usage) (*EmbedResponse, error) {
	var raw struct {
		Model string      `json:"model"`
		Data  []EmbedData `json:"data"`
		Usage *dto.Usage  `json:"usage"`
	}
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil, fmt.Errorf("parse embed response: %w", err)
	}
	if raw.Model == "" {
		raw.Model = model
	}
	return &EmbedResponse{
		Model:    raw.Model,
		Data:     raw.Data,
		Usage:    usage,
		Provider: provider,
	}, nil
}

// parseImageResponse parses the JSON response body into an ImageResponse.
func parseImageResponse(body []byte, model, provider string, usage meter.Usage) (*ImageResponse, error) {
	var raw struct {
		Created int64       `json:"created"`
		Data    []ImageData `json:"data"`
	}
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil, fmt.Errorf("parse image response: %w", err)
	}
	return &ImageResponse{
		Created:  raw.Created,
		Data:     raw.Data,
		Usage:    usage,
		Provider: provider,
	}, nil
}

// RelayError is a unified error type for relay operations. It captures the
// provider and model involved, the HTTP status code, the provider-specific
// error code (when available), and a human-readable message. The underlying
// error (if any) is wrapped and accessible via Unwrap.
type RelayError struct {
	Provider   string
	Model      string
	StatusCode int
	Code       string // error code from provider
	Message    string
	Err        error  // wrapped error
}

// Error implements the error interface.
func (e *RelayError) Error() string {
	if e.Err != nil {
		return fmt.Sprintf("relay: provider=%s model=%s: %v", e.Provider, e.Model, e.Err)
	}
	return fmt.Sprintf("relay: provider=%s model=%s: %s", e.Provider, e.Model, e.Message)
}

// Unwrap returns the wrapped error, if any.
func (e *RelayError) Unwrap() error { return e.Err }

// IsRetryable returns true if the error is likely transient (429, 500, 502,
// 503, 504). Such errors are good candidates for retry or model fallback.
func (e *RelayError) IsRetryable() bool {
	return e.StatusCode == 429 || e.StatusCode == 500 || e.StatusCode == 502 || e.StatusCode == 503 || e.StatusCode == 504
}

// parseError reads an error response body and returns a *RelayError capturing
// the provider, HTTP status code, and response body.
func parseError(resp *http.Response, provider string) error {
	body, _ := io.ReadAll(resp.Body)
	return &RelayError{
		Provider:   provider,
		StatusCode: resp.StatusCode,
		Message:    fmt.Sprintf("HTTP %d: %s", resp.StatusCode, string(body)),
	}
}

// ─── Completions (legacy text completions) ──────────────────────

// CompletionsRequest is the legacy OpenAI /v1/completions request.
type CompletionsRequest struct {
	Model       string          `json:"model"`
	Prompt      json.RawMessage `json:"prompt"` // string or []string
	MaxTokens   *int            `json:"max_tokens,omitempty"`
	Temperature *float64        `json:"temperature,omitempty"`
	TopP        *float64        `json:"top_p,omitempty"`
	Stream      bool            `json:"stream,omitempty"`
	Stop        json.RawMessage `json:"stop,omitempty"`
	N           *int            `json:"n,omitempty"`
	User        string          `json:"user,omitempty"`
}

// CompletionsResponse is the legacy completions response.
type CompletionsResponse struct {
	ID      string          `json:"id"`
	Model   string          `json:"model"`
	Choices []json.RawMessage `json:"choices"`
	Usage   meter.Usage     `json:"usage"`
	Provider string         `json:"provider"`
}

// Completions sends a legacy text completion request (/v1/completions).
func (c *Client) Completions(ctx context.Context, req *CompletionsRequest) (*CompletionsResponse, error) {
	if err := c.ensureProvider(); err != nil {
		return nil, err
	}

	adaptor := c.provider.Adaptor()
	info := c.buildRelayInfo(relaymode.RelayModeCompletions, req.Model, req.Stream)
	adaptor.Init(info)

	openaiReq := &dto.GeneralOpenAIRequest{
		Model:       req.Model,
		Prompt:      req.Prompt,
	}
	if req.Stream {
		streamVal := true
		openaiReq.Stream = &streamVal
	}
	if req.User != "" {
		openaiReq.User = json.RawMessage(marshalString(req.User))
	}
	if req.MaxTokens != nil {
		maxTokens := uint(*req.MaxTokens)
		openaiReq.MaxTokens = &maxTokens
	}
	if req.Temperature != nil {
		openaiReq.Temperature = req.Temperature
	}
	if req.TopP != nil {
		openaiReq.TopP = req.TopP
	}
	if req.N != nil {
		openaiReq.N = req.N
	}
	openaiReq.Stop = req.Stop

	converted, err := adaptor.ConvertOpenAIRequest(ctx, info, openaiReq)
	if err != nil {
		return nil, fmt.Errorf("relay: convert completions request: %w", err)
	}

	jsonData, err := json.Marshal(converted)
	if err != nil {
		return nil, fmt.Errorf("relay: marshal completions request: %w", err)
	}

	url, err := adaptor.GetRequestURL(info)
	if err != nil {
		return nil, err
	}

	httpReq, err := http.NewRequestWithContext(ctx, "POST", url, strings.NewReader(string(jsonData)))
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	if req.Stream {
		httpReq.Header.Set("Accept", "text/event-stream")
	}
	_ = adaptor.SetupRequestHeader(ctx, &httpReq.Header, info)

	resp, err := c.doRequest(ctx, adaptor, info, httpReq)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, parseError(resp, c.provider.Name())
	}

	var dummyW dummyResponseWriter
	usageRaw, apiErr := adaptor.DoResponse(ctx, resp, info, &dummyW)
	if apiErr != nil {
		return nil, fmt.Errorf("relay: parse completions response: %w", apiErr)
	}

	usage := extractUsage(usageRaw)
	c.record(ctx, req.Model, usage)

	return &CompletionsResponse{
		Model:    req.Model,
		Choices:  []json.RawMessage{json.RawMessage(dummyW.Bytes())},
		Usage:    usage,
		Provider: c.provider.Name(),
	}, nil
}

// ─── Moderations ────────────────────────────────────────────────

// ModerationsRequest is the /v1/moderations request.
type ModerationsRequest struct {
	Model string `json:"model,omitempty"`
	Input any    `json:"input"` // string or []string
}

// Moderations sends a content moderation request.
func (c *Client) Moderations(ctx context.Context, req *ModerationsRequest) (*dto.ModerationResponse, error) {
	if err := c.ensureProvider(); err != nil {
		return nil, err
	}

	adaptor := c.provider.Adaptor()
	info := c.buildRelayInfo(relaymode.RelayModeModerations, req.Model, false)
	adaptor.Init(info)

	// Moderations uses the OpenAI request format with Prompt field carrying input.
	openaiReq := &dto.GeneralOpenAIRequest{
		Model:  req.Model,
		Prompt: req.Input,
	}

	converted, err := adaptor.ConvertOpenAIRequest(ctx, info, openaiReq)
	if err != nil {
		return nil, fmt.Errorf("relay: convert moderations request: %w", err)
	}

	jsonData, err := json.Marshal(converted)
	if err != nil {
		return nil, fmt.Errorf("relay: marshal moderations request: %w", err)
	}

	url, err := adaptor.GetRequestURL(info)
	if err != nil {
		return nil, err
	}

	httpReq, err := http.NewRequestWithContext(ctx, "POST", url, strings.NewReader(string(jsonData)))
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	_ = adaptor.SetupRequestHeader(ctx, &httpReq.Header, info)

	resp, err := c.doRequest(ctx, adaptor, info, httpReq)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, parseError(resp, c.provider.Name())
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	var modResp dto.ModerationResponse
	if err := json.Unmarshal(body, &modResp); err != nil {
		return nil, fmt.Errorf("relay: parse moderations response: %w", err)
	}

	c.record(ctx, req.Model, meter.Usage{RequestCount: 1})

	return &modResp, nil
}

// ─── Images Edits ───────────────────────────────────────────────

// ImageEditRequest is the /v1/images/edits request (multipart form).
type ImageEditRequest struct {
	Model  string
	Prompt string
	Image  []byte    // original image bytes
	Mask   []byte    // optional mask bytes
	N      *int
	Size   string
	User   string
}

// ImageEdit sends an image edit request (/v1/images/edits).
// The response body is returned as raw bytes.
func (c *Client) ImageEdit(ctx context.Context, req *ImageEditRequest) (*ImageResponse, error) {
	if err := c.ensureProvider(); err != nil {
		return nil, err
	}

	adaptor := c.provider.Adaptor()
	info := c.buildRelayInfo(relaymode.RelayModeImagesEdits, req.Model, false)
	adaptor.Init(info)

	// Build multipart form.
	var buf bytes.Buffer
	writer := multipart.NewWriter(&buf)

	_ = writer.WriteField("model", req.Model)
	_ = writer.WriteField("prompt", req.Prompt)
	if req.Size != "" {
		_ = writer.WriteField("size", req.Size)
	}
	if req.User != "" {
		_ = writer.WriteField("user", req.User)
	}
	if req.N != nil {
		_ = writer.WriteField("n", strconv.Itoa(*req.N))
	}

	if len(req.Image) > 0 {
		part, err := writer.CreateFormFile("image", "image.png")
		if err != nil {
			return nil, fmt.Errorf("relay: create image form field: %w", err)
		}
		if _, err := part.Write(req.Image); err != nil {
			return nil, fmt.Errorf("relay: write image data: %w", err)
		}
	}
	if len(req.Mask) > 0 {
		part, err := writer.CreateFormFile("mask", "mask.png")
		if err != nil {
			return nil, fmt.Errorf("relay: create mask form field: %w", err)
		}
		if _, err := part.Write(req.Mask); err != nil {
			return nil, fmt.Errorf("relay: write mask data: %w", err)
		}
	}
	_ = writer.Close()

	url, err := adaptor.GetRequestURL(info)
	if err != nil {
		return nil, err
	}

	httpReq, err := http.NewRequestWithContext(ctx, "POST", url, &buf)
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Content-Type", writer.FormDataContentType())
	_ = adaptor.SetupRequestHeader(ctx, &httpReq.Header, info)

	resp, err := c.doRequest(ctx, adaptor, info, httpReq)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, parseError(resp, c.provider.Name())
	}

	var dummyW dummyResponseWriter
	usageRaw, apiErr := adaptor.DoResponse(ctx, resp, info, &dummyW)
	if apiErr != nil {
		return nil, fmt.Errorf("relay: parse image edit response: %w", apiErr)
	}

	usage := extractUsage(usageRaw)
	c.record(ctx, req.Model, usage)

	return parseImageResponse(dummyW.Bytes(), req.Model, c.provider.Name(), usage)
}

// ─── Edits (legacy text edits) ──────────────────────────────────

// EditRequest is the legacy /v1/edits request.
type EditRequest struct {
	Model      string `json:"model"`
	Input      string `json:"input"`
	Instruction string `json:"instruction"`
	N          *int   `json:"n,omitempty"`
	Temperature *float64 `json:"temperature,omitempty"`
	TopP       *float64 `json:"top_p,omitempty"`
}

// Edit sends a legacy text edit request (/v1/edits).
func (c *Client) Edit(ctx context.Context, req *EditRequest) (*CompletionsResponse, error) {
	if err := c.ensureProvider(); err != nil {
		return nil, err
	}

	adaptor := c.provider.Adaptor()
	info := c.buildRelayInfo(relaymode.RelayModeEdits, req.Model, false)
	adaptor.Init(info)

	openaiReq := &dto.GeneralOpenAIRequest{
		Model:       req.Model,
		Input:       req.Input,
		Instruction: req.Instruction,
	}
	if req.N != nil {
		openaiReq.N = req.N
	}
	if req.Temperature != nil {
		openaiReq.Temperature = req.Temperature
	}
	if req.TopP != nil {
		openaiReq.TopP = req.TopP
	}

	converted, err := adaptor.ConvertOpenAIRequest(ctx, info, openaiReq)
	if err != nil {
		return nil, fmt.Errorf("relay: convert edit request: %w", err)
	}

	jsonData, err := json.Marshal(converted)
	if err != nil {
		return nil, fmt.Errorf("relay: marshal edit request: %w", err)
	}

	url, err := adaptor.GetRequestURL(info)
	if err != nil {
		return nil, err
	}

	httpReq, err := http.NewRequestWithContext(ctx, "POST", url, strings.NewReader(string(jsonData)))
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	_ = adaptor.SetupRequestHeader(ctx, &httpReq.Header, info)

	resp, err := c.doRequest(ctx, adaptor, info, httpReq)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, parseError(resp, c.provider.Name())
	}

	var dummyW dummyResponseWriter
	usageRaw, apiErr := adaptor.DoResponse(ctx, resp, info, &dummyW)
	if apiErr != nil {
		return nil, fmt.Errorf("relay: parse edit response: %w", apiErr)
	}

	usage := extractUsage(usageRaw)
	c.record(ctx, req.Model, usage)

	return &CompletionsResponse{
		Model:    req.Model,
		Choices:  []json.RawMessage{json.RawMessage(dummyW.Bytes())},
		Usage:    usage,
		Provider: c.provider.Name(),
	}, nil
}

// ─── Gemini native format ───────────────────────────────────────

// GeminiChatRequest is the native Gemini generateContent request.
type GeminiChatRequest = dto.GeminiChatRequest

// GeminiChatResponse is the native Gemini generateContent response.
type GeminiChatResponse = dto.GeminiChatResponse

// GeminiChat sends a native Gemini generateContent request.
func (c *Client) GeminiChat(ctx context.Context, req *GeminiChatRequest, model string) (*GeminiChatResponse, error) {
	if err := c.ensureProvider(); err != nil {
		return nil, err
	}

	adaptor := c.provider.Adaptor()
	info := c.buildRelayInfo(relaymode.RelayModeGemini, model, false)
	adaptor.Init(info)

	converted, err := adaptor.ConvertGeminiRequest(ctx, info, req)
	if err != nil {
		return nil, fmt.Errorf("relay: convert gemini request: %w", err)
	}

	jsonData, err := json.Marshal(converted)
	if err != nil {
		return nil, fmt.Errorf("relay: marshal gemini request: %w", err)
	}

	url, err := adaptor.GetRequestURL(info)
	if err != nil {
		return nil, err
	}

	httpReq, err := http.NewRequestWithContext(ctx, "POST", url, strings.NewReader(string(jsonData)))
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	_ = adaptor.SetupRequestHeader(ctx, &httpReq.Header, info)

	resp, err := c.doRequest(ctx, adaptor, info, httpReq)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, parseError(resp, c.provider.Name())
	}

	var dummyW dummyResponseWriter
	usageRaw, apiErr := adaptor.DoResponse(ctx, resp, info, &dummyW)
	if apiErr != nil {
		return nil, fmt.Errorf("relay: parse gemini response: %w", apiErr)
	}

	usage := extractUsage(usageRaw)
	c.record(ctx, model, usage)

	var geminiResp GeminiChatResponse
	if err := json.Unmarshal(dummyW.Bytes(), &geminiResp); err != nil {
		return nil, fmt.Errorf("relay: unmarshal gemini response: %w", err)
	}

	return &geminiResp, nil
}

// GeminiChatStream sends a native Gemini streamGenerateContent request.
// It returns a channel of chunks. The channel closes when the stream ends.
func (c *Client) GeminiChatStream(ctx context.Context, req *GeminiChatRequest, model string) (*ChatStreamResult, error) {
	if err := c.ensureProvider(); err != nil {
		return nil, err
	}

	adaptor := c.provider.Adaptor()
	info := c.buildRelayInfo(relaymode.RelayModeGemini, model, true)
	adaptor.Init(info)

	converted, err := adaptor.ConvertGeminiRequest(ctx, info, req)
	if err != nil {
		return nil, fmt.Errorf("relay: convert gemini request: %w", err)
	}

	jsonData, err := json.Marshal(converted)
	if err != nil {
		return nil, fmt.Errorf("relay: marshal gemini request: %w", err)
	}

	url, err := adaptor.GetRequestURL(info)
	if err != nil {
		return nil, err
	}

	httpReq, err := http.NewRequestWithContext(ctx, "POST", url, strings.NewReader(string(jsonData)))
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "text/event-stream")
	_ = adaptor.SetupRequestHeader(ctx, &httpReq.Header, info)

	resp, err := c.doRequest(ctx, adaptor, info, httpReq)
	if err != nil {
		return nil, err
	}

	result := &ChatStreamResult{
		Ch: make(chan ChatStreamChunk, 100),
	}

	go func() {
		defer resp.Body.Close()
		defer close(result.Ch)

		pw := &streamResponseWriter{ch: result.Ch}
		usageRaw, apiErr := adaptor.DoResponse(ctx, resp, info, pw)
		if apiErr != nil {
			result.Ch <- ChatStreamChunk{Err: apiErr}
			return
		}

		usage := extractUsage(usageRaw)
		result.Usage = usage
		c.record(ctx, model, usage)
		result.Ch <- ChatStreamChunk{Done: true, Usage: &usage}
	}()

	return result, nil
}

// ─── Responses Compact ──────────────────────────────────────────

// ResponsesCompact sends a compact OpenAI Responses API request (/v1/responses/compact).
// Only a subset of fields (model, input, instructions, previous_response_id, prompt_cache_*) are forwarded.
func (c *Client) ResponsesCompact(ctx context.Context, req *ResponsesRequest) (*ResponsesResponse, error) {
	if err := c.ensureProvider(); err != nil {
		return nil, err
	}

	adaptor := c.provider.Adaptor()
	info := c.buildRelayInfo(relaymode.RelayModeResponsesCompact, req.Model, req.Stream)
	adaptor.Init(info)

	stream := req.Stream
	responsesReq := dto.OpenAIResponsesRequest{
		Model:              req.Model,
		Input:              req.Input,
		Instructions:       req.Options,
		Stream:             &stream,
		PreviousResponseID: string(req.Options),
	}

	converted, err := adaptor.ConvertOpenAIResponsesRequest(ctx, info, responsesReq)
	if err != nil {
		return nil, fmt.Errorf("relay: convert responses compact request: %w", err)
	}

	jsonData, err := json.Marshal(converted)
	if err != nil {
		return nil, fmt.Errorf("relay: marshal responses compact request: %w", err)
	}

	url, err := adaptor.GetRequestURL(info)
	if err != nil {
		return nil, err
	}

	httpReq, err := http.NewRequestWithContext(ctx, "POST", url, strings.NewReader(string(jsonData)))
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	if req.Stream {
		httpReq.Header.Set("Accept", "text/event-stream")
	}
	_ = adaptor.SetupRequestHeader(ctx, &httpReq.Header, info)

	resp, err := c.doRequest(ctx, adaptor, info, httpReq)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, parseError(resp, c.provider.Name())
	}

	var dummyW dummyResponseWriter
	usageRaw, apiErr := adaptor.DoResponse(ctx, resp, info, &dummyW)
	if apiErr != nil {
		return nil, fmt.Errorf("relay: parse responses compact response: %w", apiErr)
	}

	usage := extractUsage(usageRaw)
	c.record(ctx, req.Model, usage)

	return &ResponsesResponse{
		Data:  dummyW.Bytes(),
		Usage: usage,
	}, nil
}

// ─── Alpha Search ───────────────────────────────────────────────

// AlphaSearchRequest is the /v1/alpha/search request body.
type AlphaSearchRequest struct {
	Model string          `json:"model"`
	Query json.RawMessage `json:"query"`
}

// AlphaSearch sends a web search request (/v1/alpha/search).
// The response body is returned as raw bytes.
func (c *Client) AlphaSearch(ctx context.Context, req *AlphaSearchRequest) (*ResponsesResponse, error) {
	if err := c.ensureProvider(); err != nil {
		return nil, err
	}

	adaptor := c.provider.Adaptor()
	info := c.buildRelayInfo(relaymode.RelayModeAlphaSearch, req.Model, false)
	adaptor.Init(info)

	// Alpha search passes the request body through, only rewriting model.
	payload := map[string]any{
		"model": req.Model,
		"query": req.Query,
	}

	jsonData, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("relay: marshal alpha search request: %w", err)
	}

	url, err := adaptor.GetRequestURL(info)
	if err != nil {
		return nil, err
	}

	httpReq, err := http.NewRequestWithContext(ctx, "POST", url, strings.NewReader(string(jsonData)))
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	_ = adaptor.SetupRequestHeader(ctx, &httpReq.Header, info)

	resp, err := c.doRequest(ctx, adaptor, info, httpReq)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, parseError(resp, c.provider.Name())
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	// Alpha search upstream doesn't return usage; record a request count.
	c.record(ctx, req.Model, meter.Usage{RequestCount: 1})

	return &ResponsesResponse{
		Data: body,
		Usage: meter.Usage{RequestCount: 1},
	}, nil
}

// ─── Midjourney Image Seed & Notify ─────────────────────────────

// MidjourneyImageSeed fetches the image seed for a completed Midjourney task.
func (c *Client) MidjourneyImageSeed(ctx context.Context, baseURL, apiKey, taskID string) (json.RawMessage, error) {
	url := strings.TrimSuffix(baseURL, "/") + "/mj/task/" + taskID + "/image-seed"

	httpReq, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("mj-api-secret", apiKey)

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("relay: midjourney image-seed failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	return json.RawMessage(body), nil
}

// MidjourneyNotifyRequest is the body of a Midjourney webhook callback.
type MidjourneyNotifyRequest struct {
	MjId        string `json:"mjId"`
	Status      string `json:"status"`
	Progress    string `json:"progress"`
	PromptEn    string `json:"promptEn"`
	ImageUrl    string `json:"imageUrl"`
	State       string `json:"state"`
}

// MidjourneyNotify handles a Midjourney webhook callback.
// It parses the notification and returns it for the caller to persist.
// Unlike new-api-main which updates a database, this library-level method
// simply returns the parsed notification.
func (c *Client) MidjourneyNotify(ctx context.Context, body io.Reader) (*MidjourneyNotifyRequest, error) {
	data, err := io.ReadAll(body)
	if err != nil {
		return nil, fmt.Errorf("relay: read midjourney notify body: %w", err)
	}

	var notify MidjourneyNotifyRequest
	if err := json.Unmarshal(data, &notify); err != nil {
		return nil, fmt.Errorf("relay: parse midjourney notify: %w", err)
	}

	return &notify, nil
}

// ─── Suno Fetch By ID ───────────────────────────────────────────

// FetchSunoTaskByID fetches a single Suno task by its ID.
func (c *Client) FetchSunoTaskByID(ctx context.Context, baseURL, apiKey, taskID string) (*SunoTaskData, error) {
	url := strings.TrimSuffix(baseURL, "/") + "/suno/fetch/" + taskID

	httpReq, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Authorization", "Bearer "+apiKey)

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("relay: suno fetch-by-id failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	var task SunoTaskData
	if err := json.Unmarshal(body, &task); err != nil {
		return nil, fmt.Errorf("relay: parse suno task: %w", err)
	}

	return &task, nil
}

// marshalString wraps a string as a JSON string.
func marshalString(s string) string {
	if s == "" {
		return ""
	}
	b, _ := json.Marshal(s)
	return string(b)
}

// Ensure imports are used.
var _ = constant.APITypeOpenAI
var _ = types.RelayFormatOpenAI
