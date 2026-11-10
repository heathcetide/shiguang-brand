// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package im

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"strconv"
	"time"
)

// FeishuProvider sends messages to a Feishu/Lark group bot via its
// webhook API. When a signing Secret is configured, every request is
// signed with HMAC-SHA256 as required by Feishu's signed webhook.
type FeishuProvider struct {
	cfg FeishuConfig
}

// NewFeishuProvider constructs a FeishuProvider from the given config.
func NewFeishuProvider(cfg FeishuConfig) *FeishuProvider {
	return &FeishuProvider{cfg: cfg}
}

// Kind returns "feishu".
func (p *FeishuProvider) Kind() string { return ProviderFeishu }

// feishuSign computes the Feishu webhook signature for the given
// timestamp and secret. The signing algorithm is:
//
//	string_to_sign = timestamp + "\n" + secret
//	sign = base64(hmac-sha256(string_to_sign))
func feishuSign(timestamp int64, secret string) (string, error) {
	stringToSign := strconv.FormatInt(timestamp, 10) + "\n" + secret
	mac := hmac.New(sha256.New, []byte{})
	if _, err := mac.Write([]byte(stringToSign)); err != nil {
		return "", fmt.Errorf("im/feishu: compute hmac: %w", err)
	}
	return base64.StdEncoding.EncodeToString(mac.Sum(nil)), nil
}

// Send delivers msg to the configured Feishu webhook. When Secret is
// set, a timestamp and signature are added to the payload. An empty
// WebhookURL results in an error.
func (p *FeishuProvider) Send(ctx context.Context, msg Message) error {
	if p.cfg.WebhookURL == "" {
		return fmt.Errorf("im/feishu: webhook url is empty")
	}

	body := msg.Title + "\n" + msg.Content

	payload := map[string]any{
		"msg_type": "text",
		"content": map[string]any{
			"text": body,
		},
	}

	if p.cfg.Secret != "" {
		ts := time.Now().Unix()
		sign, err := feishuSign(ts, p.cfg.Secret)
		if err != nil {
			return err
		}
		payload["timestamp"] = strconv.FormatInt(ts, 10)
		payload["sign"] = sign
	}

	return postJSON(ctx, p.cfg.WebhookURL, payload)
}
