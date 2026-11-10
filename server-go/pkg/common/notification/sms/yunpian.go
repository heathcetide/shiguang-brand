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

// YunpianConfig holds credentials for the Yunpian SMS provider.
type YunpianConfig struct {
	APIKey    string // Yunpian API key
	Signature string // fallback signature when content has none
	Endpoint  string // API endpoint override
}

// YunpianProvider sends SMS via the Yunpian API.
type YunpianProvider struct {
	cfg YunpianConfig
}

// NewYunpianProvider builds a YunpianProvider from a ProviderConfig.
// Recognised keys: api_key, signature, endpoint.
func NewYunpianProvider(cfg ProviderConfig) (Provider, error) {
	c := YunpianConfig{
		Endpoint: "https://sms.yunpian.com/v2/sms/single_send.json",
	}
	if cfg != nil {
		c.APIKey = stringFromCfg(cfg, "api_key")
		c.Signature = stringFromCfg(cfg, "signature")
		if v := stringFromCfg(cfg, "endpoint"); v != "" {
			c.Endpoint = v
		}
	}
	if strings.TrimSpace(c.APIKey) == "" {
		return nil, fmt.Errorf("sms: yunpian api_key is required")
	}
	return &YunpianProvider{cfg: c}, nil
}

// Kind returns ProviderYunpian.
func (p *YunpianProvider) Kind() ProviderKind { return ProviderYunpian }

// yunpianResponse is the Yunpian API response.
type yunpianResponse struct {
	Code int    `json:"code"`
	Msg  string `json:"msg"`
	Sid  int64  `json:"sid"`
}

// Send delivers the request via the Yunpian API.
func (p *YunpianProvider) Send(ctx context.Context, req SendRequest) (*SendResult, error) {
	ctx = CtxOrBackground(ctx)
	if err := ValidateBasic(req); err != nil {
		return nil, err
	}
	if strings.TrimSpace(req.Message.Content) == "" {
		return nil, fmt.Errorf("sms: yunpian requires content")
	}

	to, err := FirstRecipientStr(req)
	if err != nil {
		return nil, err
	}

	text := NormalizeContent(req.Message.Content, p.cfg.Signature)
	form := url.Values{}
	form.Set("apikey", strings.TrimSpace(p.cfg.APIKey))
	form.Set("mobile", to)
	form.Set("text", text)

	endpoint := p.cfg.Endpoint
	if endpoint == "" {
		endpoint = "https://sms.yunpian.com/v2/sms/single_send.json"
	}

	status, body, err := PostFormRaw(ctx, endpoint, form, nil, "", "")
	raw := TruncateRaw(string(body), 4000)
	if err != nil {
		return &SendResult{Provider: p.Kind(), Accepted: false, Error: err.Error(), Raw: raw, SentAtUnix: NowUnix()}, err
	}

	var r yunpianResponse
	_ = json.Unmarshal(body, &r)
	if !Is2xx(status) || r.Code != 0 {
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
		MessageID:  fmt.Sprintf("%d", r.Sid),
		Accepted:   true,
		Status:     "ok",
		Raw:        raw,
		SentAtUnix: NowUnix(),
	}, nil
}
