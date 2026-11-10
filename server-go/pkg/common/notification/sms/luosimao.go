// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package sms

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"strings"
)

// LuosimaoConfig holds credentials for the Luosimao SMS provider.
type LuosimaoConfig struct {
	APIKey   string // Luosimao API key
	Endpoint string // API endpoint override
}

// LuosimaoProvider sends SMS via the Luosimao API.
type LuosimaoProvider struct {
	cfg LuosimaoConfig
}

// NewLuosimaoProvider builds a LuosimaoProvider from a ProviderConfig.
// Recognised keys: api_key, endpoint.
func NewLuosimaoProvider(cfg ProviderConfig) (Provider, error) {
	c := LuosimaoConfig{
		Endpoint: "https://sms-api.luosimao.com/v1/send.json",
	}
	if cfg != nil {
		c.APIKey = stringFromCfg(cfg, "api_key")
		if v := stringFromCfg(cfg, "endpoint"); v != "" {
			c.Endpoint = v
		}
	}
	if strings.TrimSpace(c.APIKey) == "" {
		return nil, fmt.Errorf("sms: luosimao api_key is required")
	}
	return &LuosimaoProvider{cfg: c}, nil
}

// Kind returns ProviderLuosimao.
func (p *LuosimaoProvider) Kind() ProviderKind { return ProviderLuosimao }

// luosimaoResponse is the Luosimao API response.
type luosimaoResponse struct {
	Error int    `json:"error"`
	Msg   string `json:"msg"`
}

// Send delivers the request via the Luosimao API. Luosimao uses HTTP
// Basic Auth with username "api" and the API key as password.
func (p *LuosimaoProvider) Send(ctx context.Context, req SendRequest) (*SendResult, error) {
	ctx = CtxOrBackground(ctx)
	if err := ValidateBasic(req); err != nil {
		return nil, err
	}
	if strings.TrimSpace(req.Message.Content) == "" {
		return nil, fmt.Errorf("sms: luosimao requires content")
	}

	to, err := FirstRecipientStr(req)
	if err != nil {
		return nil, err
	}

	form := url.Values{}
	form.Set("mobile", to)
	form.Set("message", strings.TrimSpace(req.Message.Content))

	endpoint := p.cfg.Endpoint
	if endpoint == "" {
		endpoint = "https://sms-api.luosimao.com/v1/send.json"
	}

	status, body, err := PostFormRaw(ctx, endpoint, form, nil, "api", strings.TrimSpace(p.cfg.APIKey))
	raw := TruncateRaw(string(body), 4000)
	if err != nil {
		return &SendResult{Provider: p.Kind(), Accepted: false, Error: err.Error(), Raw: raw, SentAtUnix: NowUnix()}, err
	}

	var r luosimaoResponse
	_ = json.Unmarshal(body, &r)
	if !Is2xx(status) || r.Error != 0 {
		msg := strings.TrimSpace(r.Msg)
		if msg == "" {
			msg = "provider rejected"
		}
		return &SendResult{
			Provider:   p.Kind(),
			Accepted:   false,
			Status:     fmt.Sprintf("http_%d", status),
			Error:      msg,
			Raw:        raw,
			SentAtUnix: NowUnix(),
		}, errProviderRejected
	}
	return &SendResult{
		Provider:   p.Kind(),
		Accepted:   true,
		Status:     "ok",
		Raw:        raw,
		SentAtUnix: NowUnix(),
	}, nil
}
