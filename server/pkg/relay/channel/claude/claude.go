// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package claude provides an Anthropic Claude AI provider adaptor.
// It is adapted from LingRein's pkg/relay/channel/claude adaptor, with
// gin.Context, internal/service, and pkg/setting dependencies removed.
//
// Claude uses the Messages API (POST /v1/messages). When the caller sends
// an OpenAI-format request, it is converted to Claude format via relaykit's
// relayconvert system.
package claude

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/heathcetide/DietDigiDose/pkg/relay/constant"
	common "github.com/heathcetide/DietDigiDose/pkg/relay/common"
	"github.com/heathcetide/DietDigiDose/pkg/relay/relaykit/dto"
	"github.com/heathcetide/DietDigiDose/pkg/relay/relaykit/relayconvert"
	relaymode "github.com/heathcetide/DietDigiDose/pkg/relay/relaymode"
	"github.com/heathcetide/DietDigiDose/pkg/relay/relaykit/types"
)

// DefaultBaseURL is the default Anthropic API endpoint.
const DefaultBaseURL = "https://api.anthropic.com"

// Adaptor implements common.Adaptor for Anthropic Claude.
type Adaptor struct {
	APIKey      string
	BaseURL     string
	APIVersion  string // anthropic-version header, default "2023-06-01"
	// AuthToken is an OAuth bearer token. When set, it is sent as
	// "Authorization: Bearer <token>" instead of the x-api-key header.
	// This is used for Claude Code OAuth sessions.
	AuthToken string
}

// New creates a Claude adaptor.
func New(apiKey string, opts ...Option) *Adaptor {
	a := &Adaptor{
		APIKey:     apiKey,
		BaseURL:    DefaultBaseURL,
		APIVersion: "2023-06-01",
	}
	for _, opt := range opts {
		opt(a)
	}
	return a
}

// Option configures the Adaptor.
type Option func(*Adaptor)

// WithBaseURL sets a custom API endpoint.
func WithBaseURL(url string) Option {
	return func(a *Adaptor) { a.BaseURL = url }
}

// WithAPIVersion sets the anthropic-version header.
func WithAPIVersion(v string) Option {
	return func(a *Adaptor) { a.APIVersion = v }
}

// WithAuthToken sets an OAuth bearer token instead of an API key.
// When set, the adaptor sends "Authorization: Bearer <token>" rather than
// "x-api-key: <key>", and adds the "oauth-2025-04-20" beta header.
func WithAuthToken(token string) Option {
	return func(a *Adaptor) { a.AuthToken = token }
}

// ─── common.Adaptor implementation ───────────────────────────────

func (a *Adaptor) Init(info *common.RelayInfo) {
	if a.APIKey == "" {
		a.APIKey = info.ApiKey
	}
	if a.BaseURL == "" && info.ChannelBaseUrl != "" {
		a.BaseURL = info.ChannelBaseUrl
	}
}

func (a *Adaptor) GetRequestURL(info *common.RelayInfo) (string, error) {
	baseURL := a.BaseURL
	if info.ChannelBaseUrl != "" {
		baseURL = info.ChannelBaseUrl
	}
	return baseURL + "/v1/messages", nil
}

func (a *Adaptor) SetupRequestHeader(ctx context.Context, header *http.Header, info *common.RelayInfo) error {
	header.Set("Content-Type", "application/json")
	version := a.APIVersion
	if version == "" {
		version = "2023-06-01"
	}
	header.Set("anthropic-version", version)

	// OAuth bearer token takes precedence over API key.
	if a.AuthToken != "" {
		header.Set("Authorization", "Bearer "+a.AuthToken)
		// The oauth beta header is required for OAuth tokens to avoid
		// stricter rate limits (observed as immediate 429s without it).
		header.Add("anthropic-beta", "oauth-2025-04-20")
	} else {
		header.Set("x-api-key", a.APIKey)
	}
	return nil
}

func (a *Adaptor) ConvertOpenAIRequest(ctx context.Context, info *common.RelayInfo, request *dto.GeneralOpenAIRequest) (any, error) {
	if request == nil {
		return nil, fmt.Errorf("request is nil")
	}
	// Convert OpenAI → Claude via relaykit.
	result, err := relayconvert.ConvertRequest(ctx, info, types.RelayFormatClaude, request)
	if err != nil {
		return nil, fmt.Errorf("convert OpenAI to Claude: %w", err)
	}
	return result.Value, nil
}

func (a *Adaptor) ConvertClaudeRequest(ctx context.Context, info *common.RelayInfo, request *dto.ClaudeRequest) (any, error) {
	if request == nil {
		return nil, fmt.Errorf("request is nil")
	}
	return request, nil
}

func (a *Adaptor) ConvertGeminiRequest(ctx context.Context, info *common.RelayInfo, request *dto.GeminiChatRequest) (any, error) {
	return nil, fmt.Errorf("gemini format not supported by claude provider")
}

func (a *Adaptor) ConvertImageRequest(ctx context.Context, info *common.RelayInfo, request dto.ImageRequest) (any, error) {
	return nil, fmt.Errorf("image generation not supported by claude provider")
}

func (a *Adaptor) ConvertEmbeddingRequest(ctx context.Context, info *common.RelayInfo, request dto.EmbeddingRequest) (any, error) {
	return nil, fmt.Errorf("embedding not supported by claude provider")
}

func (a *Adaptor) ConvertAudioRequest(ctx context.Context, info *common.RelayInfo, request dto.AudioRequest) (io.Reader, error) {
	return nil, fmt.Errorf("audio not supported by claude provider")
}

func (a *Adaptor) ConvertRerankRequest(ctx context.Context, relayMode int, request dto.RerankRequest) (any, error) {
	return nil, fmt.Errorf("rerank not supported by claude provider")
}

func (a *Adaptor) ConvertOpenAIResponsesRequest(ctx context.Context, info *common.RelayInfo, request dto.OpenAIResponsesRequest) (any, error) {
	return nil, fmt.Errorf("OpenAI Responses format not supported by claude provider")
}

func (a *Adaptor) DoRequest(ctx context.Context, info *common.RelayInfo, requestBody io.Reader) (*http.Response, error) {
	return nil, nil
}

func (a *Adaptor) DoResponse(ctx context.Context, resp *http.Response, info *common.RelayInfo, w http.ResponseWriter) (usage any, err *types.NewAPIError) {
	body, readErr := io.ReadAll(resp.Body)
	if readErr != nil {
		return nil, types.NewError(readErr, types.ErrorCodeReadResponseBodyFailed)
	}

	switch info.RelayMode {
	case relaymode.RelayModeChatCompletions:
		if info.IsStream {
			return a.handleStreamChatResponse(ctx, info, body, w)
		}
		return a.handleChatResponse(ctx, info, body, w)
	default:
		if info.IsStream {
			return a.handleStreamChatResponse(ctx, info, body, w)
		}
		return a.handleChatResponse(ctx, info, body, w)
	}
}

// handleStreamChatResponse processes a Claude SSE streaming response.
// It writes SSE data to w and extracts usage from the final message_start/message_stop events.
func (a *Adaptor) handleStreamChatResponse(ctx context.Context, info *common.RelayInfo, body []byte, w http.ResponseWriter) (any, *types.NewAPIError) {
	// Write the raw SSE data to w.
	w.Write(body)

	// Parse SSE lines to find usage in message_delta events.
	usage := &dto.ClaudeUsage{}
	for _, line := range strings.Split(string(body), "\n") {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, "data: ") {
			continue
		}
		data := strings.TrimPrefix(line, "data: ")
		if data == "[DONE]" {
			continue
		}
		// Claude streams have event types. Look for message_delta with usage.
		var event struct {
			Type  string `json:"type"`
			Usage *dto.ClaudeUsage `json:"usage"`
			Message *struct {
				Usage *dto.ClaudeUsage `json:"usage"`
			} `json:"message"`
		}
		if err := json.Unmarshal([]byte(data), &event); err != nil {
			continue
		}
		if event.Usage != nil {
			usage = event.Usage
		}
		if event.Message != nil && event.Message.Usage != nil {
			usage = event.Message.Usage
		}
	}
	return usage, nil
}

// handleChatResponse parses a Claude Messages response.
// If the request was in OpenAI format, converts the response back to OpenAI.
func (a *Adaptor) handleChatResponse(ctx context.Context, info *common.RelayInfo, body []byte, w http.ResponseWriter) (any, *types.NewAPIError) {
	var claudeResp dto.ClaudeResponse
	if err := json.Unmarshal(body, &claudeResp); err != nil {
		// Write raw body as fallback.
		w.Write(body)
		return nil, nil
	}

	// Check for Claude error.
	if claudeErr := claudeResp.GetClaudeError(); claudeErr != nil && claudeErr.Type != "" {
		return nil, types.WithClaudeError(*claudeErr, http.StatusInternalServerError)
	}

	// Extract usage.
	usage := &dto.ClaudeUsage{}
	if claudeResp.Usage != nil {
		usage = claudeResp.Usage
	}

	// Convert to OpenAI format if the original request was OpenAI.
	var responseData []byte
	if info.RelayFormat == types.RelayFormatOpenAI {
		openaiResp := relayconvert.ResponseClaude2OpenAI(&claudeResp)
		jsonData, err := json.Marshal(openaiResp)
		if err != nil {
			w.Write(body)
			return usage, nil
		}
		responseData = jsonData
	} else {
		responseData = body
	}

	w.Write(responseData)
	return usage, nil
}

func (a *Adaptor) GetModelList() []string {
	return ModelList
}

func (a *Adaptor) GetChannelName() string {
	return "claude"
}

// ─── llm.Provider implementation ─────────────────────────────────

// Provider wraps the Adaptor to implement the llm.Provider interface.
type Provider struct {
	adaptor *Adaptor
}

// NewProvider creates an llm.Provider backed by a Claude adaptor.
func NewProvider(apiKey string, opts ...Option) *Provider {
	return &Provider{adaptor: New(apiKey, opts...)}
}

func (p *Provider) Name() string         { return "claude" }
func (p *Provider) ApiType() int         { return constant.APITypeAnthropic }
func (p *Provider) Adaptor() common.Adaptor { return p.adaptor }
func (p *Provider) BaseURL() string      { return p.adaptor.BaseURL }
func (p *Provider) APIKey() string       { return p.adaptor.APIKey }
