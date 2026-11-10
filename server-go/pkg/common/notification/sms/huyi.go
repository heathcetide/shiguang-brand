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

// HuyiConfig holds credentials for the Huyi (互亿无线) SMS provider.
type HuyiConfig struct {
	APIID     string // Huyi API ID
	APIKey    string // Huyi API key
	Signature string // fallback signature
	Endpoint  string // API endpoint override
}

// HuyiProvider sends SMS via the Huyi API.
type HuyiProvider struct {
	cfg HuyiConfig
}

// NewHuyiProvider builds a HuyiProvider from a ProviderConfig.
// Recognised keys: api_id, api_key, signature, endpoint.
func NewHuyiProvider(cfg ProviderConfig) (Provider, error) {
	c := HuyiConfig{
		Endpoint: "http://106.ihuyi.com/webservice/sms.php?method=Submit",
	}
	if cfg != nil {
		c.APIID = stringFromCfg(cfg, "api_id")
		c.APIKey = stringFromCfg(cfg, "api_key")
		c.Signature = stringFromCfg(cfg, "signature")
		if v := stringFromCfg(cfg, "endpoint"); v != "" {
			c.Endpoint = v
		}
	}
	if strings.TrimSpace(c.APIID) == "" || strings.TrimSpace(c.APIKey) == "" {
		return nil, fmt.Errorf("sms: huyi api_id and api_key are required")
	}
	return &HuyiProvider{cfg: c}, nil
}

// Kind returns ProviderHuyi.
func (p *HuyiProvider) Kind() ProviderKind { return ProviderHuyi }

// huyiResponse is the Huyi API response.
type huyiResponse struct {
	SubmitResult struct {
		Smsid string `json:"smsid"`
		Code  int    `json:"code"`
		Msg   string `json:"msg"`
	} `json:"SubmitResult"`
}

// Send delivers the request via the Huyi API.
func (p *HuyiProvider) Send(ctx context.Context, req SendRequest) (*SendResult, error) {
	ctx = CtxOrBackground(ctx)
	if err := ValidateBasic(req); err != nil {
		return nil, err
	}

	content := strings.TrimSpace(req.Message.Content)
	if content == "" && strings.TrimSpace(req.Message.Template) != "" {
		content = strings.TrimSpace(req.Message.Template)
		for k, v := range req.Message.Data {
			content = strings.ReplaceAll(content, "${"+k+"}", v)
		}
	}
	if strings.TrimSpace(content) == "" {
		return nil, fmt.Errorf("sms: huyi requires content or template")
	}

	to, err := FirstRecipientStr(req)
	if err != nil {
		return nil, err
	}

	text := NormalizeContent(content, p.cfg.Signature)
	form := url.Values{}
	form.Set("account", strings.TrimSpace(p.cfg.APIID))
	form.Set("password", strings.TrimSpace(p.cfg.APIKey))
	form.Set("mobile", to)
	form.Set("content", text)
	form.Set("format", "json")

	endpoint := p.cfg.Endpoint
	if endpoint == "" {
		endpoint = "http://106.ihuyi.com/webservice/sms.php?method=Submit"
	}

	status, body, err := PostFormRaw(ctx, endpoint, form, nil, "", "")
	raw := TruncateRaw(string(body), 4000)
	if err != nil {
		return &SendResult{Provider: p.Kind(), Accepted: false, Error: err.Error(), Raw: raw, SentAtUnix: NowUnix()}, err
	}

	var r huyiResponse
	_ = json.Unmarshal(body, &r)
	if !Is2xx(status) || r.SubmitResult.Code != 2 {
		msg := strings.TrimSpace(r.SubmitResult.Msg)
		if msg == "" {
			msg = "provider rejected"
		}
		return &SendResult{Provider: p.Kind(), Accepted: false, Status: fmt.Sprintf("http_%d", status), Error: msg, Raw: raw, SentAtUnix: NowUnix()}, errProviderRejected
	}
	return &SendResult{Provider: p.Kind(), MessageID: strings.TrimSpace(r.SubmitResult.Smsid), Accepted: true, Status: "ok", Raw: raw, SentAtUnix: NowUnix()}, nil
}
