// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package relay provides the core relay types: a stripped-down RelayInfo
// (no user/token/billing/DB fields) and a clean Adaptor interface that uses
// context.Context instead of gin.Context.
//
// This is adapted from LingRein's pkg/relay/common and pkg/relay/channel,
// with all product-layer coupling (Gin, GORM, user management, billing,
// subscription) removed.
package common

import (
	"net/http"
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/relay/relaykit/dto"
	"github.com/heathcetide/DietDigiDose/pkg/relay/relaykit/relayconvert/convmeta"
	"github.com/heathcetide/DietDigiDose/pkg/relay/relaykit/types"
)

// ChannelMeta holds channel/provider configuration for a relay request.
// This is a stripped version of LingRein's ChannelMeta — no ChannelId,
// ChannelIsMultiKey, or ChannelSetting (which were DB-coupled).
type ChannelMeta struct {
	ChannelType       int               // constant.ChannelType*
	ApiType           int               // constant.APIType*
	ApiVersion        string            // Azure API version, Vertex region, etc.
	ApiKey            string            // upstream API key
	Organization      string            // OpenAI org ID, etc.
	ChannelBaseUrl    string            // override default endpoint
	ParamOverride     map[string]any    // parameter overrides
	HeadersOverride   map[string]any    // header overrides
	UpstreamModelName string            // model name after mapping
	IsModelMapped     bool
	SupportStreamOptions bool
}

// RelayInfo is the per-request context for a relay call.
// It is a stripped version of LingRein's RelayInfo — all user/token/billing/
// subscription/quota/WebSocket fields have been removed.
type RelayInfo struct {
	IsStream           bool
	RelayMode          int               // relaymode.RelayMode*
	OriginModelName    string            // original model name from client
	RequestURLPath     string            // e.g. "/v1/chat/completions"
	RequestHeaders     map[string]string
	ShouldIncludeUsage bool
	RelayFormat        types.RelayFormat  // input format (openai/claude/gemini)
	StartTime          time.Time

	// Channel/provider metadata.
	*ChannelMeta

	// The parsed request DTO (GeneralOpenAIRequest, ClaudeRequest, etc.)
	Request dto.Request

	// Request format conversion chain, e.g. ["openai", "claude"].
	RequestConversionChain []types.RelayFormat
	// Final request format sent to upstream.
	FinalRequestRelayFormat types.RelayFormat

	// API type for adaptor dispatch.
	ApiType int

	// Reasoning effort ("low", "medium", "high", "").
	ReasoningEffort string

	// Action is the task action type (e.g. constant.TaskActionGenerate).
	// Used by async task providers.
	Action string

	// PublicTaskID is the client-facing task ID.
	PublicTaskID string

	// OriginTaskID is the original task ID for remix operations.
	OriginTaskID string

	// SendResponseCount / ReceivedResponseCount for streaming.
	SendResponseCount     int
	ReceivedResponseCount int

	// convOptions is the cached conversion options snapshot.
	convOptions convmeta.Options
}

// NewRelayInfo creates a RelayInfo with sensible defaults.
func NewRelayInfo() *RelayInfo {
	return &RelayInfo{
		StartTime:   time.Now(),
		ChannelMeta: &ChannelMeta{},
	}
}

// HTTPClient returns the HTTP client to use for upstream calls.
// Can be overridden per-request.
type HTTPClient struct {
	Client  *http.Client
	Headers map[string]string
}
