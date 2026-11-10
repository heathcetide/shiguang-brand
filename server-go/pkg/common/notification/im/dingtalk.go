// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package im

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"net/url"
	"strconv"
	"time"
)

// DingTalkProvider sends messages to a DingTalk (钉钉) group robot via
// its webhook API. When a signing Secret is configured, every request
// is signed with HMAC-SHA256 as required by DingTalk's signed webhook.
type DingTalkProvider struct {
	cfg DingTalkConfig
}

// NewDingTalkProvider constructs a DingTalkProvider from the given
// config. If WebhookURL is empty but AccessToken is set, the URL is
// built automatically.
func NewDingTalkProvider(cfg DingTalkConfig) *DingTalkProvider {
	if cfg.WebhookURL == "" && cfg.AccessToken != "" {
		cfg.WebhookURL = "https://oapi.dingtalk.com/robot/send?access_token=" + cfg.AccessToken
	}
	return &DingTalkProvider{cfg: cfg}
}

// Kind returns "dingtalk".
func (p *DingTalkProvider) Kind() string { return ProviderDingTalk }

// dingTalkSign computes the DingTalk webhook signature for the given
// timestamp and secret. The signing algorithm is:
//
//	string_to_sign = timestamp + "\n" + secret
//	sign = base64(hmac-sha256(key=secret, msg=string_to_sign))
func dingTalkSign(timestamp int64, secret string) (string, error) {
	stringToSign := strconv.FormatInt(timestamp, 10) + "\n" + secret
	mac := hmac.New(sha256.New, []byte(secret))
	if _, err := mac.Write([]byte(stringToSign)); err != nil {
		return "", fmt.Errorf("im/dingtalk: compute hmac: %w", err)
	}
	return base64.StdEncoding.EncodeToString(mac.Sum(nil)), nil
}

// buildSignedURL appends the timestamp and sign query parameters to
// the webhook URL as required by DingTalk's signed webhook mode.
func (p *DingTalkProvider) buildSignedURL() (string, error) {
	ts := time.Now().UnixMilli()
	sign, err := dingTalkSign(ts, p.cfg.Secret)
	if err != nil {
		return "", err
	}

	u, err := url.Parse(p.cfg.WebhookURL)
	if err != nil {
		return "", fmt.Errorf("im/dingtalk: parse webhook url: %w", err)
	}
	q := u.Query()
	q.Set("timestamp", strconv.FormatInt(ts, 10))
	q.Set("sign", sign)
	u.RawQuery = q.Encode()
	return u.String(), nil
}

// Send delivers msg to the configured DingTalk webhook. The message is
// sent as a "text" type message. When Secret is set, the request URL
// is augmented with timestamp and sign parameters. An empty WebhookURL
// results in an error.
func (p *DingTalkProvider) Send(ctx context.Context, msg Message) error {
	if p.cfg.WebhookURL == "" {
		return fmt.Errorf("im/dingtalk: webhook url is empty")
	}

	body := msg.Title + "\n" + msg.Content

	payload := map[string]any{
		"msgtype": "text",
		"text": map[string]any{
			"content": body,
		},
	}

	targetURL := p.cfg.WebhookURL
	if p.cfg.Secret != "" {
		var err error
		targetURL, err = p.buildSignedURL()
		if err != nil {
			return err
		}
	}

	return postJSON(ctx, targetURL, payload)
}
