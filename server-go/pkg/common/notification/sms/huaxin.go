// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package sms

import (
	"context"
	"encoding/xml"
	"fmt"
	"net/url"
	"strings"
)

// HuaxinConfig holds credentials for the Huaxin (华信/短信通) SMS provider.
type HuaxinConfig struct {
	UserID   string // user ID
	Password string // password
	Account  string // account name (defaults to UserID)
	BaseURL  string // gateway base URL (e.g. http://sms.example.com:8080)
	ExtNo    string // extension number (optional)
}

// HuaxinProvider sends SMS via the Huaxin HTTP gateway (sms.aspx).
type HuaxinProvider struct {
	cfg HuaxinConfig
}

// NewHuaxinProvider builds a HuaxinProvider from a ProviderConfig.
// Recognised keys: user_id, password, account, base_url, ext_no.
func NewHuaxinProvider(cfg ProviderConfig) (Provider, error) {
	c := HuaxinConfig{}
	if cfg != nil {
		c.UserID = stringFromCfg(cfg, "user_id")
		c.Password = stringFromCfg(cfg, "password")
		c.Account = stringFromCfg(cfg, "account")
		c.BaseURL = stringFromCfg(cfg, "base_url")
		c.ExtNo = stringFromCfg(cfg, "ext_no")
	}
	if strings.TrimSpace(c.UserID) == "" || strings.TrimSpace(c.Password) == "" {
		return nil, fmt.Errorf("sms: huaxin user_id and password are required")
	}
	if strings.TrimSpace(c.Account) == "" {
		c.Account = strings.TrimSpace(c.UserID)
	}
	return &HuaxinProvider{cfg: c}, nil
}

// Kind returns ProviderHuaxin.
func (p *HuaxinProvider) Kind() ProviderKind { return ProviderHuaxin }

// huaxinResponse is the XML response from the Huaxin gateway.
type huaxinResponse struct {
	XMLName       xml.Name `xml:"returnsms"`
	ReturnStatus  string   `xml:"returnstatus"`
	Message       string   `xml:"message"`
	TaskID        string   `xml:"taskID"`
	SuccessCounts string   `xml:"successCounts"`
}

// Send delivers the request via the Huaxin HTTP gateway.
func (p *HuaxinProvider) Send(ctx context.Context, req SendRequest) (*SendResult, error) {
	ctx = CtxOrBackground(ctx)
	if err := ValidateBasic(req); err != nil {
		return nil, err
	}

	content := strings.TrimSpace(req.Message.Content)
	if content == "" {
		if strings.TrimSpace(req.Message.Template) == "" {
			return nil, fmt.Errorf("sms: huaxin requires content")
		}
		content = strings.TrimSpace(req.Message.Template)
		for k, v := range req.Message.Data {
			content = strings.ReplaceAll(content, "${"+k+"}", v)
			content = strings.ReplaceAll(content, "{"+k+"}", v)
		}
	}

	to, err := FirstRecipientStr(req)
	if err != nil {
		return nil, err
	}

	endpoint := strings.TrimSpace(p.cfg.BaseURL)
	if endpoint == "" {
		return nil, fmt.Errorf("sms: huaxin base_url is required")
	}
	endpoint = strings.TrimRight(endpoint, "/")
	if !strings.HasSuffix(strings.ToLower(endpoint), "/sms.aspx") {
		endpoint += "/sms.aspx"
	}

	form := url.Values{}
	form.Set("action", "send")
	form.Set("userid", strings.TrimSpace(p.cfg.UserID))
	form.Set("account", strings.TrimSpace(p.cfg.Account))
	form.Set("password", strings.TrimSpace(p.cfg.Password))
	form.Set("mobile", to)
	form.Set("content", content)
	form.Set("sendTime", "")
	form.Set("extno", strings.TrimSpace(p.cfg.ExtNo))

	status, body, err := PostFormRaw(ctx, endpoint, form, nil, "", "")
	raw := TruncateRaw(string(body), 4000)
	if err != nil {
		return &SendResult{Provider: p.Kind(), Accepted: false, Error: err.Error(), Raw: raw, SentAtUnix: NowUnix()}, err
	}

	var xr huaxinResponse
	_ = xml.Unmarshal(body, &xr)
	st := strings.ToLower(strings.TrimSpace(xr.ReturnStatus))
	ok := st == "success" || st == "ok"
	if !Is2xx(status) || !ok {
		msg := strings.TrimSpace(xr.Message)
		if msg == "" {
			msg = "provider rejected"
		}
		return &SendResult{Provider: p.Kind(), Accepted: false, Status: xr.ReturnStatus, Error: msg, Raw: raw, SentAtUnix: NowUnix()}, errProviderRejected
	}
	return &SendResult{
		Provider:   p.Kind(),
		MessageID:  strings.TrimSpace(xr.TaskID),
		Accepted:   true,
		Status:     xr.ReturnStatus,
		Raw:        raw,
		SentAtUnix: NowUnix(),
	}, nil
}
