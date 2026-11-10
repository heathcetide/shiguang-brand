// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package openai provides an OpenAI-compatible AI provider adaptor.
// It is adapted from LingRein's pkg/relay/channel/openai adaptor, with
// gin.Context, internal/service, and pkg/setting dependencies removed.
//
// This adaptor works with any OpenAI-compatible API endpoint (OpenAI,
// Azure, OpenRouter, AI360, LingYiWanWu, Xinference, etc.) by setting
// the appropriate BaseURL and ChannelType.
package openai

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
	relaymode "github.com/heathcetide/DietDigiDose/pkg/relay/relaymode"
	"github.com/heathcetide/DietDigiDose/pkg/relay/relaykit/types"
)

// DefaultBaseURL is the default OpenAI API endpoint.
const DefaultBaseURL = "https://api.openai.com"

// Adaptor implements common.Adaptor for OpenAI-compatible APIs.
type Adaptor struct {
	ChannelType int
	APIKey      string
	BaseURL     string
	OrgID       string
	APIVersion  string // for Azure
}

// New creates an OpenAI adaptor.
func New(apiKey string, opts ...Option) *Adaptor {
	a := &Adaptor{
		ChannelType: constant.ChannelTypeOpenAI,
		APIKey:      apiKey,
		BaseURL:     DefaultBaseURL,
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

// WithOrgID sets the OpenAI organization ID.
func WithOrgID(orgID string) Option {
	return func(a *Adaptor) { a.OrgID = orgID }
}

// WithChannelType sets the channel type (for Azure, OpenRouter, etc.).
func WithChannelType(ct int) Option {
	return func(a *Adaptor) { a.ChannelType = ct }
}

// WithAPIVersion sets the Azure API version.
func WithAPIVersion(v string) Option {
	return func(a *Adaptor) { a.APIVersion = v }
}

// ─── common.Adaptor implementation ───────────────────────────────

func (a *Adaptor) Init(info *common.RelayInfo) {
	if info.ChannelType != 0 {
		a.ChannelType = info.ChannelType
	}
	if a.APIKey == "" {
		a.APIKey = info.ApiKey
	}
	if a.BaseURL == "" && info.ChannelBaseUrl != "" {
		a.BaseURL = info.ChannelBaseUrl
	}
	if a.OrgID == "" {
		a.OrgID = info.Organization
	}
	if a.APIVersion == "" {
		a.APIVersion = info.ApiVersion
	}
}

func (a *Adaptor) GetRequestURL(info *common.RelayInfo) (string, error) {
	baseURL := a.BaseURL
	if info.ChannelBaseUrl != "" {
		baseURL = info.ChannelBaseUrl
	}
	baseURL = strings.TrimSuffix(baseURL, "/")

	switch a.ChannelType {
	case constant.ChannelTypeAzure:
		apiVersion := a.APIVersion
		if apiVersion == "" {
			apiVersion = constant.AzureDefaultAPIVersion
		}
		task := strings.TrimPrefix(info.RequestURLPath, "/v1/")
		model_ := info.UpstreamModelName
		requestURL := fmt.Sprintf("/openai/deployments/%s/%s?api-version=%s", model_, task, apiVersion)
		return baseURL + requestURL, nil

	case constant.ChannelTypeCustom:
		url := baseURL
		url = strings.Replace(url, "{model}", info.UpstreamModelName, -1)
		return url, nil

	default:
		// Standard OpenAI-compatible endpoint.
		if info.RequestURLPath != "" {
			return baseURL + info.RequestURLPath, nil
		}
		switch info.RelayMode {
		case relaymode.RelayModeChatCompletions:
			return baseURL + "/v1/chat/completions", nil
		case relaymode.RelayModeEmbeddings:
			return baseURL + "/v1/embeddings", nil
		case relaymode.RelayModeImagesGenerations:
			return baseURL + "/v1/images/generations", nil
		case relaymode.RelayModeAudioSpeech:
			return baseURL + "/v1/audio/speech", nil
		case relaymode.RelayModeAudioTranscription:
			return baseURL + "/v1/audio/transcriptions", nil
		case relaymode.RelayModeRerank:
			return baseURL + "/v1/rerank", nil
		case relaymode.RelayModeResponses, relaymode.RelayModeResponsesCompact:
			return baseURL + "/v1/responses", nil
		default:
			return baseURL + "/v1/chat/completions", nil
		}
	}
}

func (a *Adaptor) SetupRequestHeader(ctx context.Context, header *http.Header, info *common.RelayInfo) error {
	header.Set("Content-Type", "application/json")
	if a.ChannelType == constant.ChannelTypeAzure {
		header.Set("api-key", a.APIKey)
		return nil
	}
	if a.OrgID != "" {
		header.Set("OpenAI-Organization", a.OrgID)
	}
	header.Set("Authorization", "Bearer "+a.APIKey)
	return nil
}

func (a *Adaptor) ConvertOpenAIRequest(ctx context.Context, info *common.RelayInfo, request *dto.GeneralOpenAIRequest) (any, error) {
	if request == nil {
		return nil, fmt.Errorf("request is nil")
	}
	// For non-OpenAI channels, clear StreamOptions.
	if a.ChannelType != constant.ChannelTypeOpenAI && a.ChannelType != constant.ChannelTypeAzure {
		request.StreamOptions = nil
	}
	return request, nil
}

func (a *Adaptor) ConvertClaudeRequest(ctx context.Context, info *common.RelayInfo, request *dto.ClaudeRequest) (any, error) {
	// Convert Claude → OpenAI format using relaykit.
	// This requires the relayconvert system; for now, return as-is.
	return request, nil
}

func (a *Adaptor) ConvertGeminiRequest(ctx context.Context, info *common.RelayInfo, request *dto.GeminiChatRequest) (any, error) {
	return request, nil
}

func (a *Adaptor) ConvertImageRequest(ctx context.Context, info *common.RelayInfo, request dto.ImageRequest) (any, error) {
	return request, nil
}

func (a *Adaptor) ConvertEmbeddingRequest(ctx context.Context, info *common.RelayInfo, request dto.EmbeddingRequest) (any, error) {
	return request, nil
}

func (a *Adaptor) ConvertAudioRequest(ctx context.Context, info *common.RelayInfo, request dto.AudioRequest) (io.Reader, error) {
	return nil, fmt.Errorf("audio request not implemented in library mode")
}

func (a *Adaptor) ConvertRerankRequest(ctx context.Context, relayMode int, request dto.RerankRequest) (any, error) {
	return request, nil
}

func (a *Adaptor) ConvertOpenAIResponsesRequest(ctx context.Context, info *common.RelayInfo, request dto.OpenAIResponsesRequest) (any, error) {
	return request, nil
}

func (a *Adaptor) DoRequest(ctx context.Context, info *common.RelayInfo, requestBody io.Reader) (*http.Response, error) {
	// In library mode, the Client handles the HTTP request.
	// Return nil to signal the Client to use its own HTTP client.
	return nil, nil
}

func (a *Adaptor) DoResponse(ctx context.Context, resp *http.Response, info *common.RelayInfo, w http.ResponseWriter) (usage any, err *types.NewAPIError) {
	body, readErr := io.ReadAll(resp.Body)
	if readErr != nil {
		return nil, types.NewError(readErr, types.ErrorCodeReadResponseBodyFailed)
	}

	switch info.RelayMode {
	case relaymode.RelayModeImagesGenerations, relaymode.RelayModeImagesEdits:
		return a.handleImageResponse(body, w)
	case relaymode.RelayModeEmbeddings:
		return a.handleEmbedResponse(body, w)
	case relaymode.RelayModeRerank:
		return a.handleRerankResponse(body, w)
	case relaymode.RelayModeResponses, relaymode.RelayModeResponsesCompact:
		return a.handleResponsesResponse(body, w, info)
	default:
		if info.IsStream {
			return a.handleStreamChatResponse(body, w)
		}
		return a.handleChatResponse(body, w)
	}
}

// handleStreamChatResponse processes an SSE streaming chat response.
// It writes SSE data to w and extracts usage from the final chunk.
func (a *Adaptor) handleStreamChatResponse(body []byte, w http.ResponseWriter) (any, *types.NewAPIError) {
	// Write the raw SSE data to w (the caller handles chunk parsing).
	w.Write(body)

	// Parse SSE lines to find usage in the final chunk.
	usage := dto.Usage{}
	for _, line := range strings.Split(string(body), "\n") {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, "data: ") {
			continue
		}
		data := strings.TrimPrefix(line, "data: ")
		if data == "[DONE]" {
			continue
		}
		var chunk struct {
			Usage *dto.Usage `json:"usage"`
		}
		if err := json.Unmarshal([]byte(data), &chunk); err != nil {
			continue
		}
		if chunk.Usage != nil {
			usage = *chunk.Usage
		}
	}
	return &usage, nil
}

// handleChatResponse parses a chat completion response and writes it to w.
func (a *Adaptor) handleChatResponse(body []byte, w http.ResponseWriter) (any, *types.NewAPIError) {
	var resp dto.OpenAITextResponse
	if err := json.Unmarshal(body, &resp); err != nil {
		// Write raw body as fallback.
		w.Write(body)
		return nil, nil
	}
	// Re-marshal and write to w.
	jsonData, _ := json.Marshal(resp)
	w.Write(jsonData)

	// Usage is an embedded struct, not a pointer.
	usage := resp.Usage
	return &usage, nil
}

// handleImageResponse parses an image generation response.
func (a *Adaptor) handleImageResponse(body []byte, w http.ResponseWriter) (any, *types.NewAPIError) {
	w.Write(body)
	// Image responses don't have token usage; return nil.
	return nil, nil
}

// handleEmbedResponse parses an embedding response.
func (a *Adaptor) handleEmbedResponse(body []byte, w http.ResponseWriter) (any, *types.NewAPIError) {
	w.Write(body)
	var resp struct {
		Usage dto.Usage `json:"usage"`
	}
	_ = json.Unmarshal(body, &resp)
	usage := resp.Usage
	return &usage, nil
}

// handleRerankResponse parses a rerank response.
func (a *Adaptor) handleRerankResponse(body []byte, w http.ResponseWriter) (any, *types.NewAPIError) {
	w.Write(body)
	usage := dto.Usage{}
	return &usage, nil
}

// handleResponsesResponse parses an OpenAI Responses API response.
// For non-streaming, it extracts usage from the response body.
// For streaming (SSE), it writes the raw SSE data and parses usage from the final chunk.
func (a *Adaptor) handleResponsesResponse(body []byte, w http.ResponseWriter, info *common.RelayInfo) (any, *types.NewAPIError) {
	w.Write(body)

	if info.IsStream {
		// Streaming: parse SSE lines to find usage in the final response.completed event.
		usage := dto.Usage{}
		for _, line := range strings.Split(string(body), "\n") {
			line = strings.TrimSpace(line)
			if !strings.HasPrefix(line, "data: ") {
				continue
			}
			data := strings.TrimPrefix(line, "data: ")
			if data == "[DONE]" {
				continue
			}
			var streamResp dto.ResponsesStreamResponse
			if err := json.Unmarshal([]byte(data), &streamResp); err != nil {
				continue
			}
			if streamResp.Response != nil && streamResp.Response.Usage != nil {
				usage = *streamResp.Response.Usage
			}
		}
		return &usage, nil
	}

	// Non-streaming: parse the response body for usage.
	var resp dto.OpenAIResponsesResponse
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, types.NewError(err, types.ErrorCodeReadResponseBodyFailed)
	}
	if resp.Usage != nil {
		return resp.Usage, nil
	}
	usage := dto.Usage{}
	return &usage, nil
}

func (a *Adaptor) GetModelList() []string {
	return ModelList
}

func (a *Adaptor) GetChannelName() string {
	return "openai"
}

// ─── llm.Provider implementation ─────────────────────────────────

// Provider wraps the Adaptor to implement the llm.Provider interface.
type Provider struct {
	adaptor *Adaptor
}

// NewProvider creates an llm.Provider backed by an OpenAI adaptor.
func NewProvider(apiKey string, opts ...Option) *Provider {
	return &Provider{adaptor: New(apiKey, opts...)}
}

func (p *Provider) Name() string    { return "openai" }
func (p *Provider) ApiType() int    { return constant.APITypeOpenAI }
func (p *Provider) Adaptor() common.Adaptor { return p.adaptor }
func (p *Provider) BaseURL() string  { return p.adaptor.BaseURL }
func (p *Provider) APIKey() string   { return p.adaptor.APIKey }
