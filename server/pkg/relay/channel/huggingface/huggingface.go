// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package huggingface provides a HuggingFace Inference Router adaptor.
// The router exposes an OpenAI-compatible Chat Completions API at
// https://router.huggingface.co/v1/chat/completions.
package huggingface

import (
	"github.com/heathcetide/DietDigiDose/pkg/relay/channel/openai"
	common "github.com/heathcetide/DietDigiDose/pkg/relay/common"
	"github.com/heathcetide/DietDigiDose/pkg/relay/constant"
)

// DefaultBaseURL is the HuggingFace Inference Router endpoint.
const DefaultBaseURL = "https://router.huggingface.co"

// ChannelName is the provider display name.
const ChannelName = "huggingface"

// ModelList is intentionally empty: HuggingFace hosts thousands of models
// selected by full model id (e.g. "meta-llama/Meta-Llama-3-8B-Instruct").
var ModelList = []string{}

// Adaptor wraps openai.Adaptor for HuggingFace's OpenAI-compatible router.
type Adaptor struct {
	openai.Adaptor
}

// Option configures the adaptor.
type Option func(*Adaptor)

// WithBaseURL overrides the default HuggingFace router URL.
func WithBaseURL(url string) Option {
	return func(a *Adaptor) { a.BaseURL = url }
}

// New creates a HuggingFace adaptor.
func New(apiKey string, opts ...Option) *Adaptor {
	a := &Adaptor{}
	a.ChannelType = constant.ChannelTypeHuggingFace
	a.APIKey = apiKey
	a.BaseURL = DefaultBaseURL
	for _, opt := range opts {
		opt(a)
	}
	return a
}

func (a *Adaptor) Init(info *common.RelayInfo) {
	if info.ChannelType != 0 {
		a.ChannelType = info.ChannelType
	}
	a.Adaptor.Init(info)
}

func (a *Adaptor) GetChannelName() string { return ChannelName }

func (a *Adaptor) GetModelList() []string { return ModelList }

// Provider wraps the adaptor for relay.Client.
type Provider struct {
	adaptor *Adaptor
}

// NewProvider creates a relay.Provider for HuggingFace.
func NewProvider(apiKey string, opts ...Option) *Provider {
	return &Provider{adaptor: New(apiKey, opts...)}
}

func (p *Provider) Name() string           { return ChannelName }
func (p *Provider) ApiType() int           { return constant.APITypeHuggingFace }
func (p *Provider) Adaptor() common.Adaptor { return p.adaptor }
func (p *Provider) BaseURL() string        { return p.adaptor.BaseURL }
func (p *Provider) APIKey() string         { return p.adaptor.APIKey }
