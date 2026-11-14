// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package common

import (
	"context"
	"io"
	"net/http"

	"github.com/heathcetide/DietDigiDose/pkg/relay/relaykit/dto"
	"github.com/heathcetide/DietDigiDose/pkg/relay/relaykit/types"
)

// Adaptor is the provider adapter interface, adapted from LingRein's
// channel.Adaptor with gin.Context removed. Each provider (OpenAI, Claude,
// Gemini, ...) implements this interface.
//
// The flow for a relay request is:
//  1. Init(info) — initialize adaptor with request context
//  2. ConvertXxxRequest(ctx, info, request) — convert unified request to
//     provider's native format
//  3. GetRequestURL(info) — build upstream URL
//  4. SetupRequestHeader(ctx, header, info) — set auth/content-type headers
//  5. DoRequest(ctx, info, body) — send HTTP request to upstream
//  6. DoResponse(ctx, resp, info) — parse upstream response, return usage
type Adaptor interface {
	// Init initializes the adaptor with the relay info.
	Init(info *RelayInfo)

	// GetRequestURL returns the upstream URL for this request.
	GetRequestURL(info *RelayInfo) (string, error)

	// SetupRequestHeader sets auth and content-type headers on the request.
	SetupRequestHeader(ctx context.Context, header *http.Header, info *RelayInfo) error

	// ConvertOpenAIRequest converts an OpenAI-format chat request to the
	// provider's native format.
	ConvertOpenAIRequest(ctx context.Context, info *RelayInfo, request *dto.GeneralOpenAIRequest) (any, error)

	// ConvertClaudeRequest converts a Claude Messages request to the
	// provider's native format.
	ConvertClaudeRequest(ctx context.Context, info *RelayInfo, request *dto.ClaudeRequest) (any, error)

	// ConvertGeminiRequest converts a Gemini generateContent request to the
	// provider's native format.
	ConvertGeminiRequest(ctx context.Context, info *RelayInfo, request *dto.GeminiChatRequest) (any, error)

	// ConvertImageRequest converts an image generation request.
	ConvertImageRequest(ctx context.Context, info *RelayInfo, request dto.ImageRequest) (any, error)

	// ConvertEmbeddingRequest converts an embedding request.
	ConvertEmbeddingRequest(ctx context.Context, info *RelayInfo, request dto.EmbeddingRequest) (any, error)

	// ConvertAudioRequest converts an audio (TTS/ASR) request.
	ConvertAudioRequest(ctx context.Context, info *RelayInfo, request dto.AudioRequest) (io.Reader, error)

	// ConvertRerankRequest converts a rerank request.
	ConvertRerankRequest(ctx context.Context, relayMode int, request dto.RerankRequest) (any, error)

	// ConvertOpenAIResponsesRequest converts an OpenAI Responses request.
	ConvertOpenAIResponsesRequest(ctx context.Context, info *RelayInfo, request dto.OpenAIResponsesRequest) (any, error)

	// DoRequest sends the HTTP request to the upstream provider.
	DoRequest(ctx context.Context, info *RelayInfo, requestBody io.Reader) (*http.Response, error)

	// DoResponse parses the upstream response and returns usage info.
	// For streaming responses, this writes to the provided http.ResponseWriter.
	DoResponse(ctx context.Context, resp *http.Response, info *RelayInfo, w http.ResponseWriter) (usage any, err *types.NewAPIError)

	// GetModelList returns the models supported by this provider.
	GetModelList() []string

	// GetChannelName returns the provider name.
	GetChannelName() string
}

// AdaptorRegistry maps API types to adaptor factories.
type AdaptorRegistry struct {
	entries map[int]func() Adaptor
}

// NewAdaptorRegistry creates an empty registry.
func NewAdaptorRegistry() *AdaptorRegistry {
	return &AdaptorRegistry{entries: make(map[int]func() Adaptor)}
}

// Register associates an API type with an adaptor factory.
func (r *AdaptorRegistry) Register(apiType int, factory func() Adaptor) {
	r.entries[apiType] = factory
}

// Get returns a new adaptor instance for the given API type.
func (r *AdaptorRegistry) Get(apiType int) Adaptor {
	if f, ok := r.entries[apiType]; ok {
		return f()
	}
	return nil
}

// DefaultRegistry is the global adaptor registry.
var DefaultRegistry = NewAdaptorRegistry()

// GetAdaptor returns an adaptor for the given API type from the default registry.
func GetAdaptor(apiType int) Adaptor {
	return DefaultRegistry.Get(apiType)
}
