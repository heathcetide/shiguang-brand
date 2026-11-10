// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package gemini provides a Google Gemini AI provider adaptor.
// It is adapted from LingRein's pkg/relay/channel/gemini adaptor, with
// gin.Context, internal/service, and pkg/setting dependencies removed.
//
// Gemini uses the generateContent API (POST /v1beta/models/{model}:generateContent).
// When the caller sends an OpenAI-format request, it is converted to Gemini
// format via relaykit's relayconvert system.
package gemini

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/relay/constant"
	common "github.com/heathcetide/DietDigiDose/pkg/relay/common"
	"github.com/heathcetide/DietDigiDose/pkg/relay/relaykit/dto"
	"github.com/heathcetide/DietDigiDose/pkg/relay/relaykit/relayconvert"
	relaymode "github.com/heathcetide/DietDigiDose/pkg/relay/relaymode"
	"github.com/heathcetide/DietDigiDose/pkg/relay/relaykit/types"
)

// DefaultBaseURL is the default Google Gemini API endpoint.
const DefaultBaseURL = "https://generativelanguage.googleapis.com"

// DefaultVersion is the default API version.
const DefaultVersion = "v1beta"

// Adaptor implements common.Adaptor for Google Gemini.
type Adaptor struct {
	APIKey  string
	BaseURL string
	Version string // API version: "v1beta", "v1", etc.
}

// New creates a Gemini adaptor.
func New(apiKey string, opts ...Option) *Adaptor {
	a := &Adaptor{
		APIKey:  apiKey,
		BaseURL: DefaultBaseURL,
		Version: DefaultVersion,
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

// WithVersion sets the API version.
func WithVersion(v string) Option {
	return func(a *Adaptor) { a.Version = v }
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
	baseURL = strings.TrimSuffix(baseURL, "/")
	version := a.Version
	if version == "" {
		version = DefaultVersion
	}
	model := info.UpstreamModelName

	// Imagen models use :predict.
	if strings.HasPrefix(model, "imagen") {
		return fmt.Sprintf("%s/%s/models/%s:predict", baseURL, version, model), nil
	}

	// Embedding models use :embedContent or :batchEmbedContents.
	if strings.HasPrefix(model, "text-embedding") ||
		strings.HasPrefix(model, "embedding") ||
		strings.HasPrefix(model, "gemini-embedding") {
		return fmt.Sprintf("%s/%s/models/%s:embedContent", baseURL, version, model), nil
	}

	// Chat models use :generateContent or :streamGenerateContent.
	action := "generateContent"
	if info.IsStream {
		action = "streamGenerateContent?alt=sse"
	}
	return fmt.Sprintf("%s/%s/models/%s:%s", baseURL, version, model, action), nil
}

func (a *Adaptor) SetupRequestHeader(ctx context.Context, header *http.Header, info *common.RelayInfo) error {
	header.Set("Content-Type", "application/json")
	header.Set("x-goog-api-key", a.APIKey)
	return nil
}

func (a *Adaptor) ConvertOpenAIRequest(ctx context.Context, info *common.RelayInfo, request *dto.GeneralOpenAIRequest) (any, error) {
	if request == nil {
		return nil, fmt.Errorf("request is nil")
	}
	result, err := relayconvert.ConvertRequest(ctx, info, types.RelayFormatGemini, request)
	if err != nil {
		return nil, fmt.Errorf("convert OpenAI to Gemini: %w", err)
	}
	return result.Value, nil
}

func (a *Adaptor) ConvertClaudeRequest(ctx context.Context, info *common.RelayInfo, request *dto.ClaudeRequest) (any, error) {
	if request == nil {
		return nil, fmt.Errorf("request is nil")
	}
	result, err := relayconvert.ConvertRequest(ctx, info, types.RelayFormatGemini, request)
	if err != nil {
		return nil, fmt.Errorf("convert Claude to Gemini: %w", err)
	}
	return result.Value, nil
}

func (a *Adaptor) ConvertGeminiRequest(ctx context.Context, info *common.RelayInfo, request *dto.GeminiChatRequest) (any, error) {
	if request == nil {
		return nil, fmt.Errorf("request is nil")
	}
	return request, nil
}

func (a *Adaptor) ConvertImageRequest(ctx context.Context, info *common.RelayInfo, request dto.ImageRequest) (any, error) {
	return nil, fmt.Errorf("image generation not directly supported by gemini provider (use imagen models)")
}

func (a *Adaptor) ConvertEmbeddingRequest(ctx context.Context, info *common.RelayInfo, request dto.EmbeddingRequest) (any, error) {
	if request.Input == nil {
		return nil, fmt.Errorf("input is required")
	}
	// Convert to Gemini embedding format.
	return request, nil
}

func (a *Adaptor) ConvertAudioRequest(ctx context.Context, info *common.RelayInfo, request dto.AudioRequest) (io.Reader, error) {
	return nil, fmt.Errorf("audio not supported by gemini provider")
}

func (a *Adaptor) ConvertRerankRequest(ctx context.Context, relayMode int, request dto.RerankRequest) (any, error) {
	return nil, fmt.Errorf("rerank not supported by gemini provider")
}

func (a *Adaptor) ConvertOpenAIResponsesRequest(ctx context.Context, info *common.RelayInfo, request dto.OpenAIResponsesRequest) (any, error) {
	return nil, fmt.Errorf("OpenAI Responses format not supported by gemini provider")
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
	case relaymode.RelayModeEmbeddings:
		return a.handleEmbedResponse(body, w)
	default:
		if info.IsStream {
			return a.handleStreamChatResponse(info, body, w)
		}
		return a.handleChatResponse(info, body, w)
	}
}

// handleStreamChatResponse processes a Gemini SSE streaming response.
// Gemini streams chunks as JSON objects separated by newlines (not SSE data: lines).
// Each chunk is a GeminiChatResponse with candidates and optional usageMetadata.
func (a *Adaptor) handleStreamChatResponse(info *common.RelayInfo, body []byte, w http.ResponseWriter) (any, *types.NewAPIError) {
	// Write the raw SSE data to w.
	w.Write(body)

	// Parse SSE lines to find usage in the final chunk.
	usage := dto.GeminiUsageMetadata{}
	for _, line := range strings.Split(string(body), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || !strings.HasPrefix(line, "data: ") {
			// Gemini may also stream raw JSON lines without "data: " prefix.
			if line == "" || strings.HasPrefix(line, "{") {
				// Try parsing as raw JSON.
			} else {
				continue
			}
		}
		data := strings.TrimPrefix(line, "data: ")
		if data == "[DONE]" {
			continue
		}
		var chunk dto.GeminiChatResponse
		if err := json.Unmarshal([]byte(data), &chunk); err != nil {
			continue
		}
		if chunk.HasUsageMetadata {
			usage = chunk.UsageMetadata
		}
	}
	return usage, nil
}

// handleChatResponse parses a Gemini generateContent response.
func (a *Adaptor) handleChatResponse(info *common.RelayInfo, body []byte, w http.ResponseWriter) (any, *types.NewAPIError) {
	var geminiResp dto.GeminiChatResponse
	if err := json.Unmarshal(body, &geminiResp); err != nil {
		w.Write(body)
		return nil, nil
	}

	// Extract usage.
	usage := geminiResp.UsageMetadata
	if !geminiResp.HasUsageMetadata {
		usage = dto.GeminiUsageMetadata{}
	}

	// Convert to OpenAI format if the original request was OpenAI.
	var responseData []byte
	if info.RelayFormat == types.RelayFormatOpenAI {
		openaiResp := relayconvert.ResponseGeminiChat2OpenAI(
			fmt.Sprintf("gemini-%d", time.Now().UnixNano()),
			time.Now().Unix(),
			&geminiResp,
		)
		openaiResp.Model = info.UpstreamModelName
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
	return &usage, nil
}

// handleEmbedResponse parses a Gemini embedding response.
func (a *Adaptor) handleEmbedResponse(body []byte, w http.ResponseWriter) (any, *types.NewAPIError) {
	w.Write(body)
	var resp struct {
		UsageMetadata *dto.GeminiUsageMetadata `json:"usageMetadata,omitempty"`
	}
	_ = json.Unmarshal(body, &resp)
	if resp.UsageMetadata != nil {
		return resp.UsageMetadata, nil
	}
	return &dto.GeminiUsageMetadata{}, nil
}

func (a *Adaptor) GetModelList() []string {
	return ModelList
}

func (a *Adaptor) GetChannelName() string {
	return "gemini"
}

// ─── llm.Provider implementation ─────────────────────────────────

// Provider wraps the Adaptor to implement the llm.Provider interface.
type Provider struct {
	adaptor *Adaptor
}

// NewProvider creates an llm.Provider backed by a Gemini adaptor.
func NewProvider(apiKey string, opts ...Option) *Provider {
	return &Provider{adaptor: New(apiKey, opts...)}
}

func (p *Provider) Name() string         { return "gemini" }
func (p *Provider) ApiType() int         { return constant.APITypeGemini }
func (p *Provider) Adaptor() common.Adaptor { return p.adaptor }
func (p *Provider) BaseURL() string      { return p.adaptor.BaseURL }
func (p *Provider) APIKey() string       { return p.adaptor.APIKey }
