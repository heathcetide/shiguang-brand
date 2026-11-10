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

// TiniyoConfig holds credentials for the Tiniyo SMS provider (Twilio-compatible API).
type TiniyoConfig struct {
	AccountSID string // Tiniyo account SID
	Token      string // Tiniyo auth token
	From       string // default sender number
	BaseURL    string // API base URL override
}

// TiniyoProvider sends SMS via the Tiniyo REST API.
type TiniyoProvider struct {
	cfg TiniyoConfig
}

// NewTiniyoProvider builds a TiniyoProvider from a ProviderConfig.
// Recognised keys: account_sid, token, from, base_url.
func NewTiniyoProvider(cfg ProviderConfig) (Provider, error) {
	c := TiniyoConfig{
		BaseURL: "https://api.tiniyo.com",
	}
	if cfg != nil {
		c.AccountSID = stringFromCfg(cfg, "account_sid")
		c.Token = stringFromCfg(cfg, "token")
		c.From = stringFromCfg(cfg, "from")
		if v := stringFromCfg(cfg, "base_url"); v != "" {
			c.BaseURL = v
		}
	}
	if strings.TrimSpace(c.AccountSID) == "" || strings.TrimSpace(c.Token) == "" || strings.TrimSpace(c.From) == "" {
		return nil, fmt.Errorf("sms: tiniyo account_sid, token and from are required")
	}
	return &TiniyoProvider{cfg: c}, nil
}

// Kind returns ProviderTiniyo.
func (p *TiniyoProvider) Kind() ProviderKind { return ProviderTiniyo }

// tiniyoResponse is the Tiniyo API response (Twilio-compatible).
type tiniyoResponse struct {
	Sid     string `json:"sid"`
	Status  string `json:"status"`
	Message string `json:"message"`
}

// Send delivers the request via the Tiniyo REST API.
func (p *TiniyoProvider) Send(ctx context.Context, req SendRequest) (*SendResult, error) {
	ctx = CtxOrBackground(ctx)
	if err := ValidateBasic(req); err != nil {
		return nil, err
	}
	if strings.TrimSpace(req.Message.Content) == "" {
		return nil, fmt.Errorf("sms: tiniyo requires content")
	}

	to, err := FirstRecipientStr(req)
	if err != nil {
		return nil, err
	}
	if !strings.HasPrefix(to, "+") {
		to = "+" + to
	}

	base := strings.TrimSpace(p.cfg.BaseURL)
	if base == "" {
		base = "https://api.tiniyo.com"
	}
	endpoint := fmt.Sprintf("%s/2010-04-01/Accounts/%s/Messages.json", strings.TrimRight(base, "/"), strings.TrimSpace(p.cfg.AccountSID))

	form := url.Values{}
	form.Set("To", to)
	form.Set("From", strings.TrimSpace(p.cfg.From))
	form.Set("Body", strings.TrimSpace(req.Message.Content))

	status, body, err := PostFormRaw(ctx, endpoint, form, nil, strings.TrimSpace(p.cfg.AccountSID), strings.TrimSpace(p.cfg.Token))
	raw := TruncateRaw(string(body), 4000)
	if err != nil {
		return &SendResult{Provider: p.Kind(), Accepted: false, Error: err.Error(), Raw: raw, SentAtUnix: NowUnix()}, err
	}

	var r tiniyoResponse
	_ = json.Unmarshal(body, &r)
	if !Is2xx(status) || strings.TrimSpace(r.Sid) == "" {
		msg := strings.TrimSpace(r.Message)
		if msg == "" {
			msg = fmt.Sprintf("http_%d", status)
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
		MessageID:  strings.TrimSpace(r.Sid),
		Accepted:   true,
		Status:     "queued",
		Raw:        raw,
		SentAtUnix: NowUnix(),
	}, nil
}
