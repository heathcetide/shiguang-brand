// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package sms

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

// YuntongxunConfig holds credentials for the Yuntongxun (容联云通讯/Cloopen) SMS provider.
type YuntongxunConfig struct {
	AppID        string // Cloopen app ID
	AccountSID   string // Cloopen account SID
	AccountToken string // Cloopen account token
	Endpoint     string // API endpoint override
}

// YuntongxunProvider sends SMS via the Yuntongxun/Cloopen API.
type YuntongxunProvider struct {
	cfg YuntongxunConfig
}

// NewYuntongxunProvider builds a YuntongxunProvider from a ProviderConfig.
// Recognised keys: app_id, account_sid, account_token, endpoint.
func NewYuntongxunProvider(cfg ProviderConfig) (Provider, error) {
	c := YuntongxunConfig{
		Endpoint: "https://app.cloopen.com:8883",
	}
	if cfg != nil {
		c.AppID = stringFromCfg(cfg, "app_id")
		c.AccountSID = stringFromCfg(cfg, "account_sid")
		c.AccountToken = stringFromCfg(cfg, "account_token")
		if v := stringFromCfg(cfg, "endpoint"); v != "" {
			c.Endpoint = v
		}
	}
	if strings.TrimSpace(c.AppID) == "" || strings.TrimSpace(c.AccountSID) == "" || strings.TrimSpace(c.AccountToken) == "" {
		return nil, fmt.Errorf("sms: yuntongxun app_id, account_sid and account_token are required")
	}
	return &YuntongxunProvider{cfg: c}, nil
}

// Kind returns ProviderYuntongxun.
func (p *YuntongxunProvider) Kind() ProviderKind { return ProviderYuntongxun }

// yuntongxunResponse is the Cloopen API response.
type yuntongxunResponse struct {
	StatusCode  string `json:"statusCode"`
	StatusMsg   string `json:"statusMsg"`
	TemplateSMS struct {
		SmsMessageSid string `json:"smsMessageSid"`
		DateCreated   string `json:"dateCreated"`
	} `json:"templateSMS"`
}

// Send delivers the request via the Yuntongxun/Cloopen API.
func (p *YuntongxunProvider) Send(ctx context.Context, req SendRequest) (*SendResult, error) {
	ctx = CtxOrBackground(ctx)
	if err := ValidateBasic(req); err != nil {
		return nil, err
	}
	if strings.TrimSpace(req.Message.Template) == "" {
		return nil, fmt.Errorf("sms: yuntongxun requires template")
	}

	endpoint := strings.TrimSpace(p.cfg.Endpoint)
	if endpoint == "" {
		endpoint = "https://app.cloopen.com:8883"
	}
	ts := time.Now().Format("20060102150405")
	sigRaw := strings.ToUpper(MD5Hex(strings.TrimSpace(p.cfg.AccountSID) + strings.TrimSpace(p.cfg.AccountToken) + ts))
	auth := base64.StdEncoding.EncodeToString([]byte(strings.TrimSpace(p.cfg.AccountSID) + ":" + ts))

	// Build ordered datas.
	var datas []string
	if req.Extras != nil {
		if arr, ok := req.Extras["params"]; ok {
			b, _ := json.Marshal(arr)
			_ = json.Unmarshal(b, &datas)
		}
	}
	if len(datas) == 0 {
		for _, v := range req.Message.Data {
			datas = append(datas, v)
		}
	}

	to, err := FirstRecipientStr(req)
	if err != nil {
		return nil, err
	}

	payload := map[string]any{
		"to":         strings.TrimPrefix(to, "+"),
		"appId":      strings.TrimSpace(p.cfg.AppID),
		"templateId": strings.TrimSpace(req.Message.Template),
		"datas":      datas,
	}
	bj, _ := json.Marshal(payload)
	headers := map[string]string{
		"Accept":        "application/json",
		"Content-Type":  "application/json;charset=utf-8",
		"Authorization": auth,
	}
	urlStr := fmt.Sprintf("%s/2013-12-26/Accounts/%s/SMS/TemplateSMS?sig=%s", endpoint, strings.TrimSpace(p.cfg.AccountSID), sigRaw)

	status, body, err := PostJSONRaw(ctx, urlStr, bj, headers, "", "")
	raw := TruncateRaw(string(body), 4000)
	if err != nil {
		return &SendResult{Provider: p.Kind(), Accepted: false, Error: err.Error(), Raw: raw, SentAtUnix: NowUnix()}, err
	}

	var r yuntongxunResponse
	_ = json.Unmarshal(body, &r)
	if !Is2xx(status) || strings.TrimSpace(r.StatusCode) != "000000" {
		msg := strings.TrimSpace(r.StatusMsg)
		if msg == "" {
			msg = "provider rejected"
		}
		return &SendResult{Provider: p.Kind(), MessageID: strings.TrimSpace(r.TemplateSMS.SmsMessageSid), Accepted: false, Status: r.StatusCode, Error: msg, Raw: raw, SentAtUnix: NowUnix()}, errProviderRejected
	}
	return &SendResult{Provider: p.Kind(), MessageID: strings.TrimSpace(r.TemplateSMS.SmsMessageSid), Accepted: true, Status: "ok", Raw: raw, SentAtUnix: NowUnix()}, nil
}
