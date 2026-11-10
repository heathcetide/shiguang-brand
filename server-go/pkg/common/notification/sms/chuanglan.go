// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package sms

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
)

// ChuanglanConfig holds credentials for the Chuanglan (创蓝) SMS provider.
type ChuanglanConfig struct {
	Account     string // Chuanglan account
	Password    string // Chuanglan password
	Channel     string // channel (optional, marketing)
	Sign        string // signature (optional)
	Unsubscribe string // unsubscribe text (optional)
	Endpoint    string // API endpoint override
}

// ChuanglanProvider sends SMS via the Chuanglan JSON API.
type ChuanglanProvider struct {
	cfg ChuanglanConfig
}

// NewChuanglanProvider builds a ChuanglanProvider from a ProviderConfig.
// Recognised keys: account, password, channel, sign, unsubscribe, endpoint.
func NewChuanglanProvider(cfg ProviderConfig) (Provider, error) {
	c := ChuanglanConfig{
		Endpoint: "https://smssh1.253.com/msg/send/json",
	}
	if cfg != nil {
		c.Account = stringFromCfg(cfg, "account")
		c.Password = stringFromCfg(cfg, "password")
		c.Channel = stringFromCfg(cfg, "channel")
		c.Sign = stringFromCfg(cfg, "sign")
		c.Unsubscribe = stringFromCfg(cfg, "unsubscribe")
		if v := stringFromCfg(cfg, "endpoint"); v != "" {
			c.Endpoint = v
		}
	}
	if strings.TrimSpace(c.Account) == "" || strings.TrimSpace(c.Password) == "" {
		return nil, fmt.Errorf("sms: chuanglan account and password are required")
	}
	return &ChuanglanProvider{cfg: c}, nil
}

// Kind returns ProviderChuanglan.
func (p *ChuanglanProvider) Kind() ProviderKind { return ProviderChuanglan }

// chuanglanResponse is the Chuanglan API response.
type chuanglanResponse struct {
	Code  string `json:"code"`
	Msg   string `json:"msg"`
	Error string `json:"error"`
}

// Send delivers the request via the Chuanglan JSON API.
func (p *ChuanglanProvider) Send(ctx context.Context, req SendRequest) (*SendResult, error) {
	ctx = CtxOrBackground(ctx)
	if err := ValidateBasic(req); err != nil {
		return nil, err
	}
	if strings.TrimSpace(req.Message.Content) == "" {
		if strings.TrimSpace(req.Message.Template) == "" {
			return nil, fmt.Errorf("sms: chuanglan requires content")
		}
	}

	to, err := FirstRecipientStr(req)
	if err != nil {
		return nil, err
	}

	content := strings.TrimSpace(req.Message.Content)
	if content == "" {
		content = strings.TrimSpace(req.Message.Template)
		for k, v := range req.Message.Data {
			content = strings.ReplaceAll(content, "${"+k+"}", v)
		}
	}
	content = NormalizeContent(content, p.cfg.Sign)

	type payload struct {
		Account     string `json:"account"`
		Password    string `json:"password"`
		Phone       string `json:"phone"`
		Msg         string `json:"msg"`
		Report      string `json:"report,omitempty"`
		Channel     string `json:"channel,omitempty"`
		Unsubscribe string `json:"unsub,omitempty"`
	}
	pl := payload{
		Account:     strings.TrimSpace(p.cfg.Account),
		Password:    strings.TrimSpace(p.cfg.Password),
		Phone:       to,
		Msg:         content,
		Report:      "true",
		Channel:     strings.TrimSpace(p.cfg.Channel),
		Unsubscribe: strings.TrimSpace(p.cfg.Unsubscribe),
	}
	bj, _ := json.Marshal(pl)

	endpoint := p.cfg.Endpoint
	if endpoint == "" {
		endpoint = "https://smssh1.253.com/msg/send/json"
	}

	status, body, err := PostJSONRaw(ctx, endpoint, bj, nil, "", "")
	raw := TruncateRaw(string(body), 4000)
	if err != nil {
		return &SendResult{Provider: p.Kind(), Accepted: false, Error: err.Error(), Raw: raw, SentAtUnix: NowUnix()}, err
	}

	var r chuanglanResponse
	_ = json.Unmarshal(body, &r)
	if !Is2xx(status) || strings.TrimSpace(r.Code) != "0" {
		msg := strings.TrimSpace(r.Msg)
		if msg == "" {
			msg = strings.TrimSpace(r.Error)
		}
		if msg == "" {
			msg = "provider rejected"
		}
		return &SendResult{Provider: p.Kind(), Accepted: false, Status: fmt.Sprintf("http_%d", status), Error: msg, Raw: raw, SentAtUnix: NowUnix()}, errProviderRejected
	}
	return &SendResult{Provider: p.Kind(), Accepted: true, Status: "ok", Raw: raw, SentAtUnix: NowUnix()}, nil
}
