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

// NeteaseConfig holds credentials for the Netease Yunxin (网易云信) SMS provider.
type NeteaseConfig struct {
	AppKey    string // Netease app key
	AppSecret string // Netease app secret
	Endpoint  string // API endpoint override
}

// NeteaseProvider sends SMS via the Netease Yunxin API.
type NeteaseProvider struct {
	cfg NeteaseConfig
}

// NewNeteaseProvider builds a NeteaseProvider from a ProviderConfig.
// Recognised keys: app_key, app_secret, endpoint.
func NewNeteaseProvider(cfg ProviderConfig) (Provider, error) {
	c := NeteaseConfig{
		Endpoint: "https://api.netease.im",
	}
	if cfg != nil {
		c.AppKey = stringFromCfg(cfg, "app_key")
		c.AppSecret = stringFromCfg(cfg, "app_secret")
		if v := stringFromCfg(cfg, "endpoint"); v != "" {
			c.Endpoint = v
		}
	}
	if strings.TrimSpace(c.AppKey) == "" || strings.TrimSpace(c.AppSecret) == "" {
		return nil, fmt.Errorf("sms: netease app_key and app_secret are required")
	}
	return &NeteaseProvider{cfg: c}, nil
}

// Kind returns ProviderNeteaseYunx.
func (p *NeteaseProvider) Kind() ProviderKind { return ProviderNeteaseYunx }

// neteaseResponse is the Netease Yunxin API response.
type neteaseResponse struct {
	Code int    `json:"code"`
	Msg  string `json:"msg"`
	Obj  string `json:"obj"`
}

// Send delivers the request via the Netease Yunxin API.
func (p *NeteaseProvider) Send(ctx context.Context, req SendRequest) (*SendResult, error) {
	ctx = CtxOrBackground(ctx)
	if err := ValidateBasic(req); err != nil {
		return nil, err
	}
	if strings.TrimSpace(req.Message.Template) == "" {
		return nil, fmt.Errorf("sms: netease requires template")
	}

	endpoint := strings.TrimSpace(p.cfg.Endpoint)
	if endpoint == "" {
		endpoint = "https://api.netease.im"
	}

	nonce := RandHex(8)
	cur := fmt.Sprintf("%d", time.Now().Unix())
	checksum := SHA1Hex(strings.TrimSpace(p.cfg.AppSecret) + nonce + cur)
	headers := map[string]string{
		"AppKey":       strings.TrimSpace(p.cfg.AppKey),
		"Nonce":        nonce,
		"CurTime":      cur,
		"CheckSum":     checksum,
		"Content-Type": "application/x-www-form-urlencoded",
	}

	// sendtemplate.action: templateid + mobiles + params(JSON array)
	var mobiles []string
	for _, pn := range req.To {
		mobiles = append(mobiles, strings.TrimPrefix(pn.String(), "+"))
	}
	mobilesJSON, _ := json.Marshal(mobiles)

	var params []string
	if req.Extras != nil {
		if arr, ok := req.Extras["params"]; ok {
			b, _ := json.Marshal(arr)
			_ = json.Unmarshal(b, &params)
		}
	}
	if len(params) == 0 {
		for _, v := range req.Message.Data {
			params = append(params, v)
		}
	}
	paramsJSON, _ := json.Marshal(params)

	form := url.Values{}
	form.Set("templateid", strings.TrimSpace(req.Message.Template))
	form.Set("mobiles", string(mobilesJSON))
	form.Set("params", string(paramsJSON))

	status, body, err := PostFormRaw(ctx, endpoint+"/sms/sendtemplate.action", form, headers, "", "")
	raw := TruncateRaw(string(body), 4000)
	if err != nil {
		return &SendResult{Provider: p.Kind(), Accepted: false, Error: err.Error(), Raw: raw, SentAtUnix: NowUnix()}, err
	}

	var r neteaseResponse
	_ = json.Unmarshal(body, &r)
	if !Is2xx(status) || r.Code != 200 {
		msg := strings.TrimSpace(r.Msg)
		if msg == "" {
			msg = "provider rejected"
		}
		return &SendResult{Provider: p.Kind(), MessageID: strings.TrimSpace(r.Obj), Accepted: false, Status: fmt.Sprintf("%d", r.Code), Error: msg, Raw: raw, SentAtUnix: NowUnix()}, errProviderRejected
	}
	return &SendResult{Provider: p.Kind(), MessageID: strings.TrimSpace(r.Obj), Accepted: true, Status: "ok", Raw: raw, SentAtUnix: NowUnix()}, nil
}
