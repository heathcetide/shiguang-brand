// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package im

import (
	"context"
	"fmt"
)

// WeChatProvider sends messages to a WeCom (企业微信) group robot via
// its webhook API. This is a simpler text-only provider that always
// sends the "text" msgtype.
type WeChatProvider struct {
	cfg WeChatConfig
}

// NewWeChatProvider constructs a WeChatProvider from the given config.
func NewWeChatProvider(cfg WeChatConfig) *WeChatProvider {
	return &WeChatProvider{cfg: cfg}
}

// Kind returns "wechat".
func (p *WeChatProvider) Kind() string { return ProviderWeChat }

// Send delivers msg to the configured WeCom webhook as a "text" type
// message. An empty WebhookURL results in an error.
func (p *WeChatProvider) Send(ctx context.Context, msg Message) error {
	if p.cfg.WebhookURL == "" {
		return fmt.Errorf("im/wechat: webhook url is empty")
	}

	body := msg.Title + "\n" + msg.Content

	payload := map[string]any{
		"msgtype": "text",
		"text": map[string]any{
			"content": body,
		},
	}

	return postJSON(ctx, p.cfg.WebhookURL, payload)
}
