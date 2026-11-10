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

// SubmailConfig holds credentials for the Submail SMS provider.
type SubmailConfig struct {
	AppID   string // Submail app ID
	AppKey  string // Submail app key
	Project string // default project/template
}

// SubmailProvider sends SMS via the Submail API.
type SubmailProvider struct {
	cfg SubmailConfig
}

// NewSubmailProvider builds a SubmailProvider from a ProviderConfig.
// Recognised keys: app_id, app_key, project.
func NewSubmailProvider(cfg ProviderConfig) (Provider, error) {
	c := SubmailConfig{}
	if cfg != nil {
		c.AppID = stringFromCfg(cfg, "app_id")
		c.AppKey = stringFromCfg(cfg, "app_key")
		c.Project = stringFromCfg(cfg, "project")
	}
	if strings.TrimSpace(c.AppID) == "" || strings.TrimSpace(c.AppKey) == "" {
		return nil, fmt.Errorf("sms: submail app_id and app_key are required")
	}
	return &SubmailProvider{cfg: c}, nil
}

// Kind returns ProviderSubmail.
func (p *SubmailProvider) Kind() ProviderKind { return ProviderSubmail }

// submailResponse is the Submail API response.
type submailResponse struct {
	Status string `json:"status"`
	SendID string `json:"send_id"`
	Msg    string `json:"msg"`
}

// Send delivers the request via the Submail API. It supports both
// template mode (XSend) and content mode (send).
func (p *SubmailProvider) Send(ctx context.Context, req SendRequest) (*SendResult, error) {
	ctx = CtxOrBackground(ctx)
	if err := ValidateBasic(req); err != nil {
		return nil, err
	}
	if strings.TrimSpace(req.Message.Template) == "" && strings.TrimSpace(req.Message.Content) == "" {
		return nil, fmt.Errorf("sms: submail requires template or content")
	}

	to, err := FirstRecipientStr(req)
	if err != nil {
		return nil, err
	}

	project := strings.TrimSpace(req.Message.Template)
	if project == "" {
		project = strings.TrimSpace(p.cfg.Project)
	}

	form := url.Values{}
	form.Set("appid", strings.TrimSpace(p.cfg.AppID))
	form.Set("signature", strings.TrimSpace(p.cfg.AppKey))
	form.Set("to", to)

	if project != "" {
		// XSend (template mode).
		form.Set("project", project)
		if len(req.Message.Data) > 0 {
			form.Set("vars", JSONStringAny(req.Message.Data))
		}
		status, body, err := PostFormRaw(ctx, "https://api.mysubmail.com/message/xsend.json", form, nil, "", "")
		raw := TruncateRaw(string(body), 4000)
		if err != nil {
			return &SendResult{Provider: p.Kind(), Accepted: false, Error: err.Error(), Raw: raw, SentAtUnix: NowUnix()}, err
		}
		var r submailResponse
		_ = json.Unmarshal(body, &r)
		if !Is2xx(status) || strings.ToLower(strings.TrimSpace(r.Status)) != "success" {
			msg := strings.TrimSpace(r.Msg)
			if msg == "" {
				msg = "provider rejected"
			}
			return &SendResult{Provider: p.Kind(), Accepted: false, Status: fmt.Sprintf("http_%d", status), Error: msg, Raw: raw, SentAtUnix: NowUnix()}, errProviderRejected
		}
		return &SendResult{Provider: p.Kind(), MessageID: strings.TrimSpace(r.SendID), Accepted: true, Status: "ok", Raw: raw, SentAtUnix: NowUnix()}, nil
	}

	// Content mode fallback.
	form.Set("content", strings.TrimSpace(req.Message.Content))
	status, body, err := PostFormRaw(ctx, "https://api.mysubmail.com/message/send.json", form, nil, "", "")
	raw := TruncateRaw(string(body), 4000)
	if err != nil {
		return &SendResult{Provider: p.Kind(), Accepted: false, Error: err.Error(), Raw: raw, SentAtUnix: NowUnix()}, err
	}
	var r submailResponse
	_ = json.Unmarshal(body, &r)
	if !Is2xx(status) || strings.ToLower(strings.TrimSpace(r.Status)) != "success" {
		msg := strings.TrimSpace(r.Msg)
		if msg == "" {
			msg = "provider rejected"
		}
		return &SendResult{Provider: p.Kind(), Accepted: false, Status: fmt.Sprintf("http_%d", status), Error: msg, Raw: raw, SentAtUnix: NowUnix()}, errProviderRejected
	}
	return &SendResult{Provider: p.Kind(), MessageID: strings.TrimSpace(r.SendID), Accepted: true, Status: "ok", Raw: raw, SentAtUnix: NowUnix()}, nil
}
