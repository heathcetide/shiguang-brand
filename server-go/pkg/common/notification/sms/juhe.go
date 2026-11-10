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

// JuheConfig holds credentials for the Juhe (聚合数据) SMS provider.
type JuheConfig struct {
	AppKey   string // Juhe app key
	Endpoint string // API endpoint override
}

// JuheProvider sends SMS via the Juhe API.
type JuheProvider struct {
	cfg JuheConfig
}

// NewJuheProvider builds a JuheProvider from a ProviderConfig.
// Recognised keys: app_key, endpoint.
func NewJuheProvider(cfg ProviderConfig) (Provider, error) {
	c := JuheConfig{
		Endpoint: "http://v.juhe.cn/sms/send",
	}
	if cfg != nil {
		c.AppKey = stringFromCfg(cfg, "app_key")
		if v := stringFromCfg(cfg, "endpoint"); v != "" {
			c.Endpoint = v
		}
	}
	if strings.TrimSpace(c.AppKey) == "" {
		return nil, fmt.Errorf("sms: juhe app_key is required")
	}
	return &JuheProvider{cfg: c}, nil
}

// Kind returns ProviderJuhe.
func (p *JuheProvider) Kind() ProviderKind { return ProviderJuhe }

// juheResponse is the Juhe API response.
type juheResponse struct {
	ErrorCode int    `json:"error_code"`
	Reason    string `json:"reason"`
	Result    any    `json:"result"`
}

// Send delivers the request via the Juhe API.
func (p *JuheProvider) Send(ctx context.Context, req SendRequest) (*SendResult, error) {
	ctx = CtxOrBackground(ctx)
	if err := ValidateBasic(req); err != nil {
		return nil, err
	}

	tpl := strings.TrimSpace(req.Message.Template)
	if tpl == "" {
		if v, ok := req.Extras["tpl_id"]; ok {
			tpl = fmt.Sprint(v)
		}
	}
	if strings.TrimSpace(tpl) == "" {
		return nil, fmt.Errorf("sms: juhe requires template id")
	}

	to, err := FirstRecipientStr(req)
	if err != nil {
		return nil, err
	}

	// tpl_value format: #key#=value&#key2#=value2
	var parts []string
	for k, v := range req.Message.Data {
		parts = append(parts, "#"+strings.TrimSpace(k)+"#="+strings.TrimSpace(v))
	}

	form := url.Values{}
	form.Set("key", strings.TrimSpace(p.cfg.AppKey))
	form.Set("mobile", to)
	form.Set("tpl_id", tpl)
	if len(parts) > 0 {
		form.Set("tpl_value", strings.Join(parts, "&"))
	}

	endpoint := p.cfg.Endpoint
	if endpoint == "" {
		endpoint = "http://v.juhe.cn/sms/send"
	}

	status, body, err := PostFormRaw(ctx, endpoint, form, nil, "", "")
	raw := TruncateRaw(string(body), 4000)
	if err != nil {
		return &SendResult{Provider: p.Kind(), Accepted: false, Error: err.Error(), Raw: raw, SentAtUnix: NowUnix()}, err
	}

	var r juheResponse
	_ = json.Unmarshal(body, &r)
	if !Is2xx(status) || r.ErrorCode != 0 {
		msg := strings.TrimSpace(r.Reason)
		if msg == "" {
			msg = "provider rejected"
		}
		return &SendResult{Provider: p.Kind(), Accepted: false, Status: fmt.Sprintf("http_%d", status), Error: msg, Raw: raw, SentAtUnix: NowUnix()}, errProviderRejected
	}
	return &SendResult{Provider: p.Kind(), Accepted: true, Status: "ok", Raw: raw, SentAtUnix: NowUnix()}, nil
}
