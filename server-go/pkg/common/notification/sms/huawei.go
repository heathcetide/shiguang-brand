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

// HuaweiConfig holds credentials for the Huawei Cloud SMS provider.
type HuaweiConfig struct {
	AppKey    string // Huawei app key
	AppSecret string // Huawei app secret
	Sender    string // sender signature/channel
	Signature string // default SMS signature (optional)
	Endpoint  string // API endpoint override
}

// HuaweiProvider sends SMS via the Huawei Cloud SMS API.
type HuaweiProvider struct {
	cfg HuaweiConfig
}

// NewHuaweiProvider builds a HuaweiProvider from a ProviderConfig.
// Recognised keys: app_key, app_secret, sender, signature, endpoint.
func NewHuaweiProvider(cfg ProviderConfig) (Provider, error) {
	c := HuaweiConfig{
		Endpoint: "https://smsapi.cn-north-4.myhuaweicloud.com:443",
	}
	if cfg != nil {
		c.AppKey = stringFromCfg(cfg, "app_key")
		c.AppSecret = stringFromCfg(cfg, "app_secret")
		c.Sender = stringFromCfg(cfg, "sender")
		c.Signature = stringFromCfg(cfg, "signature")
		if v := stringFromCfg(cfg, "endpoint"); v != "" {
			c.Endpoint = v
		}
	}
	if strings.TrimSpace(c.AppKey) == "" || strings.TrimSpace(c.AppSecret) == "" {
		return nil, fmt.Errorf("sms: huawei app_key and app_secret are required")
	}
	if strings.TrimSpace(c.Sender) == "" {
		return nil, fmt.Errorf("sms: huawei sender is required")
	}
	return &HuaweiProvider{cfg: c}, nil
}

// Kind returns ProviderHuawei.
func (p *HuaweiProvider) Kind() ProviderKind { return ProviderHuawei }

// huaweiSendResponse is the Huawei SMS API response.
type huaweiSendResponse struct {
	Code        string `json:"code"`
	Description string `json:"description"`
	Result      []struct {
		Status   string `json:"status"`
		SmsMsgID string `json:"smsMsgId"`
	} `json:"result"`
}

// Send delivers the request via the Huawei Cloud SMS API.
func (p *HuaweiProvider) Send(ctx context.Context, req SendRequest) (*SendResult, error) {
	ctx = CtxOrBackground(ctx)
	if err := ValidateBasic(req); err != nil {
		return nil, err
	}
	if strings.TrimSpace(req.Message.Template) == "" {
		return nil, fmt.Errorf("sms: huawei requires template")
	}

	to, err := FirstRecipientStr(req)
	if err != nil {
		return nil, err
	}

	endpoint := strings.TrimSpace(p.cfg.Endpoint)
	if endpoint == "" {
		endpoint = "https://smsapi.cn-north-4.myhuaweicloud.com:443"
	}

	// Build WSSE authentication.
	created := time.Now().UTC().Format("2006-01-02T15:04:05Z")
	nonce := RandHex(16)
	digest := SHA256Base64(nonce + created + strings.TrimSpace(p.cfg.AppSecret))
	xwsse := fmt.Sprintf(`UsernameToken Username="%s",PasswordDigest="%s",Nonce="%s",Created="%s"`,
		strings.TrimSpace(p.cfg.AppKey), digest, nonce, created)
	auth := `WSSE realm="SDP",profile="UsernameToken",type="Appkey"`

	// Build template parameters.
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
	paras := "[]"
	if b, err := json.Marshal(params); err == nil {
		paras = string(b)
	}

	form := url.Values{}
	form.Set("from", strings.TrimSpace(p.cfg.Sender))
	form.Set("to", to)
	form.Set("templateId", strings.TrimSpace(req.Message.Template))
	form.Set("templateParas", paras)
	sig := strings.TrimSpace(req.Message.SignName)
	if sig == "" {
		sig = strings.TrimSpace(p.cfg.Signature)
	}
	if sig != "" {
		form.Set("signature", sig)
	}

	headers := map[string]string{
		"Authorization": auth,
		"X-WSSE":        xwsse,
	}

	status, body, err := PostFormRaw(ctx, endpoint+"/sms/batchSendSms/v1", form, headers, "", "")
	raw := TruncateRaw(string(body), 4000)
	if err != nil {
		return &SendResult{Provider: p.Kind(), Accepted: false, Error: err.Error(), Raw: raw, SentAtUnix: NowUnix()}, err
	}

	var r huaweiSendResponse
	_ = json.Unmarshal(body, &r)
	if !Is2xx(status) || strings.TrimSpace(r.Code) != "000000" {
		msg := strings.TrimSpace(r.Description)
		if msg == "" {
			msg = "provider rejected"
		}
		return &SendResult{Provider: p.Kind(), Accepted: false, Status: r.Code, Error: msg, Raw: raw, SentAtUnix: NowUnix()}, errProviderRejected
	}
	msgID := ""
	if len(r.Result) > 0 {
		msgID = strings.TrimSpace(r.Result[0].SmsMsgID)
	}
	return &SendResult{Provider: p.Kind(), MessageID: msgID, Accepted: true, Status: r.Code, Raw: raw, SentAtUnix: NowUnix()}, nil
}
