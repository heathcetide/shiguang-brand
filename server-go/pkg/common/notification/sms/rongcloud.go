// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package sms

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"strings"
	"time"
)

// RongcloudConfig holds credentials for the Rongcloud (融云) SMS provider.
type RongcloudConfig struct {
	AppKey    string // Rongcloud app key
	AppSecret string // Rongcloud app secret
	Endpoint  string // API endpoint override
}

// RongcloudProvider sends SMS via the Rongcloud API.
type RongcloudProvider struct {
	cfg RongcloudConfig
}

// NewRongcloudProvider builds a RongcloudProvider from a ProviderConfig.
// Recognised keys: app_key, app_secret, endpoint.
func NewRongcloudProvider(cfg ProviderConfig) (Provider, error) {
	c := RongcloudConfig{
		Endpoint: "https://api.rong-api.com",
	}
	if cfg != nil {
		c.AppKey = stringFromCfg(cfg, "app_key")
		c.AppSecret = stringFromCfg(cfg, "app_secret")
		if v := stringFromCfg(cfg, "endpoint"); v != "" {
			c.Endpoint = v
		}
	}
	if strings.TrimSpace(c.AppKey) == "" || strings.TrimSpace(c.AppSecret) == "" {
		return nil, fmt.Errorf("sms: rongcloud app_key and app_secret are required")
	}
	return &RongcloudProvider{cfg: c}, nil
}

// Kind returns ProviderRongcloud.
func (p *RongcloudProvider) Kind() ProviderKind { return ProviderRongcloud }

// rongcloudResponse is the Rongcloud API response.
type rongcloudResponse struct {
	Code         int    `json:"code"`
	Session      string `json:"sessionId"`
	ErrorMessage string `json:"errorMessage"`
}

// Send delivers the request via the Rongcloud API.
func (p *RongcloudProvider) Send(ctx context.Context, req SendRequest) (*SendResult, error) {
	ctx = CtxOrBackground(ctx)
	if err := ValidateBasic(req); err != nil {
		return nil, err
	}
	if strings.TrimSpace(req.Message.Template) == "" {
		return nil, fmt.Errorf("sms: rongcloud requires template")
	}

	to, err := FirstRecipientStr(req)
	if err != nil {
		return nil, err
	}

	endpoint := strings.TrimSpace(p.cfg.Endpoint)
	if endpoint == "" {
		endpoint = "https://api.rong-api.com"
	}

	nonce := RandHex(8)
	ts := fmt.Sprintf("%d", time.Now().Unix())
	sig := SHA1Hex(strings.TrimSpace(p.cfg.AppSecret) + nonce + ts)
	headers := map[string]string{
		"App-Key":   strings.TrimSpace(p.cfg.AppKey),
		"Nonce":     nonce,
		"Timestamp": ts,
		"Signature": sig,
	}

	form := url.Values{}
	form.Set("mobile", strings.TrimPrefix(to, "+"))
	form.Set("templateId", strings.TrimSpace(req.Message.Template))
	if req.Extras != nil {
		if v, ok := req.Extras["region"]; ok {
			form.Set("region", fmt.Sprint(v))
		}
	}

	status, body, err := PostFormRaw(ctx, endpoint+"/sms/sendCode.json", form, headers, "", "")
	raw := TruncateRaw(string(body), 4000)
	if err != nil {
		return &SendResult{Provider: p.Kind(), Accepted: false, Error: err.Error(), Raw: raw, SentAtUnix: NowUnix()}, err
	}

	var r rongcloudResponse
	_ = json.Unmarshal(body, &r)
	if !Is2xx(status) || r.Code != 200 {
		msg := strings.TrimSpace(r.ErrorMessage)
		if msg == "" {
			msg = "provider rejected"
		}
		return &SendResult{Provider: p.Kind(), MessageID: strings.TrimSpace(r.Session), Accepted: false, Status: fmt.Sprintf("%d", r.Code), Error: msg, Raw: raw, SentAtUnix: NowUnix()}, errProviderRejected
	}
	return &SendResult{Provider: p.Kind(), MessageID: strings.TrimSpace(r.Session), Accepted: true, Status: "ok", Raw: raw, SentAtUnix: NowUnix()}, nil
}
