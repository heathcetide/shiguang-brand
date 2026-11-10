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

// TwilioConfig holds credentials for the Twilio SMS provider.
type TwilioConfig struct {
	AccountSID string // Twilio Account SID
	Token      string // Twilio auth token
	From       string // default sender phone number
	Endpoint   string // API base URL override
}

// TwilioProvider sends SMS via the Twilio REST API.
type TwilioProvider struct {
	cfg TwilioConfig
}

// NewTwilioProvider builds a TwilioProvider from a ProviderConfig.
// Recognised keys: account_sid, token, from, endpoint.
func NewTwilioProvider(cfg ProviderConfig) (Provider, error) {
	c := TwilioConfig{
		Endpoint: "https://api.twilio.com",
	}
	if cfg != nil {
		c.AccountSID = stringFromCfg(cfg, "account_sid")
		c.Token = stringFromCfg(cfg, "token")
		c.From = stringFromCfg(cfg, "from")
		if v := stringFromCfg(cfg, "endpoint"); v != "" {
			c.Endpoint = v
		}
	}
	if c.AccountSID == "" || c.Token == "" {
		return nil, fmt.Errorf("sms: twilio account_sid and token are required")
	}
	return &TwilioProvider{cfg: c}, nil
}

// Kind returns ProviderTwilio.
func (p *TwilioProvider) Kind() ProviderKind { return ProviderTwilio }

// twilioMessageResponse is the subset of the Twilio Message resource we
// care about.
type twilioMessageResponse struct {
	SID          string `json:"sid"`
	Status       string `json:"status"`
	ErrorCode    int    `json:"error_code"`
	ErrorMessage string `json:"error_message"`
	Body         string `json:"body"`
}

// Send delivers the request via the Twilio Messages API.
func (p *TwilioProvider) Send(ctx context.Context, req SendRequest) (*SendResult, error) {
	if err := ValidateBasic(req); err != nil {
		return nil, err
	}
	phone, err := FirstRecipient(req)
	if err != nil {
		return nil, err
	}
	from := p.cfg.From
	if v, ok := req.Extras["from"]; ok {
		if s, ok := v.(string); ok && s != "" {
			from = s
		}
	}
	if !strings.HasPrefix(phone, "+") {
		phone = "+" + phone
	}

	form := url.Values{}
	form.Set("To", phone)
	if from != "" {
		form.Set("From", from)
	}
	body := req.Message.Content
	if body == "" {
		// Twilio has no native template; fall back to a rendered body if
		// template data is provided, otherwise leave empty.
		body = strings.TrimSpace(req.Message.Template)
	}
	if body != "" {
		form.Set("Body", body)
	}

	endpoint := p.cfg.Endpoint
	if endpoint == "" {
		endpoint = "https://api.twilio.com"
	}
	urlStr := fmt.Sprintf("%s/2010-04-01/Accounts/%s/Messages.json", endpoint, p.cfg.AccountSID)

	raw, err := PostForm(ctx, urlStr, form, nil, p.cfg.AccountSID, p.cfg.Token)
	if err != nil {
		return &SendResult{
			Provider:   ProviderTwilio,
			Accepted:   false,
			Status:     "failed",
			Error:      err.Error(),
			Raw:        string(raw),
			SentAtUnix: time.Now().Unix(),
		}, err
	}

	var resp twilioMessageResponse
	if err := json.Unmarshal(raw, &resp); err != nil {
		return &SendResult{
			Provider:   ProviderTwilio,
			Accepted:   false,
			Status:     "failed",
			Error:      fmt.Sprintf("twilio: parse response: %v", err),
			Raw:        string(raw),
			SentAtUnix: time.Now().Unix(),
		}, fmt.Errorf("sms: twilio parse response: %w", err)
	}

	// Twilio "queued"/"sent"/"delivered" indicate acceptance.
	accepted := resp.ErrorCode == 0 && resp.Status != "failed" && resp.Status != "undelivered"
	status := resp.Status
	if !accepted {
		status = "failed"
	}
	errMsg := ""
	if !accepted {
		errMsg = resp.ErrorMessage
		if errMsg == "" {
			errMsg = fmt.Sprintf("twilio error_code=%d", resp.ErrorCode)
		}
	}
	return &SendResult{
		Provider:   ProviderTwilio,
		MessageID:  resp.SID,
		Accepted:   accepted,
		Status:     status,
		Error:      errMsg,
		Raw:        string(raw),
		SentAtUnix: time.Now().Unix(),
	}, nil
}
