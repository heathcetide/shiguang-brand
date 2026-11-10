// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package im

import (
	"context"
	"strings"
)

// Provider name constants. These are the canonical, lower-case
// identifiers used throughout the im package and by the registry.
const (
	ProviderWeCom    = "wecom"
	ProviderFeishu   = "feishu"
	ProviderDingTalk = "dingtalk"
	ProviderWeChat   = "wechat"
)

// Message is the unified payload delivered to an IM provider. Content
// may be plain text or markdown; providers decide how to render it
// based on the provider's capabilities and the content's format.
type Message struct {
	Title   string // short headline (may be rendered as the first line)
	Content string // message body, markdown or plain text
}

// Provider is the interface implemented by every IM backend (WeCom,
// Feishu, etc.). Each provider knows how to deliver a single Message
// to its target service.
type Provider interface {
	// Kind returns a short, lower-case identifier for the provider
	// (e.g. "wecom", "feishu").
	Kind() string

	// Send delivers msg to the provider's configured endpoint. The
	// context is respected for cancellation and deadlines.
	Send(ctx context.Context, msg Message) error
}

// WeComConfig holds the settings for a WeCom (企业微信) webhook bot.
// Only WebhookURL is required for the webhook bot flow; CorpID,
// AgentID and Secret are used by the application API flow (not
// implemented by the webhook provider but kept here for parity).
type WeComConfig struct {
	WebhookURL string // group robot webhook URL (https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=...)
	CorpID     string // corporation ID (application API only)
	AgentID    string // agent ID (application API only)
	Secret     string // application secret (application API only)
}

// FeishuConfig holds the settings for a Feishu/Lark webhook bot.
// Secret is the optional signing secret; when set, every request is
// signed with HMAC-SHA256. AppID/AppSecret are kept for the
// application API flow (not used by the webhook provider).
type FeishuConfig struct {
	WebhookURL string // group bot webhook URL
	Secret     string // optional signing secret
	AppID      string // application ID (application API only)
	AppSecret  string // application secret (application API only)
}

// DingTalkConfig holds the settings for a DingTalk (钉钉) group robot
// webhook bot. AccessToken is the access_token query parameter from
// the webhook URL; Secret is the optional signing secret (加签).
// When Secret is set, every request is signed with HMAC-SHA256 as
// required by DingTalk's signed webhook.
type DingTalkConfig struct {
	WebhookURL  string // full webhook URL (https://oapi.dingtalk.com/robot/send?access_token=...)
	AccessToken string // access token (extracted from the webhook URL)
	Secret      string // optional signing secret (加签)
}

// WeChatConfig holds the settings for a WeCom (企业微信) group robot
// webhook bot. This is a simpler config that only requires the
// WebhookURL.
type WeChatConfig struct {
	WebhookURL string // group robot webhook URL (https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=...)
}

// NormalizeProvider returns the canonical, lower-case form of a
// provider name. Surrounding whitespace is trimmed and the result is
// lower-cased. Unknown names are returned unchanged (lower-cased and
// trimmed) so callers can distinguish "unsupported" from "empty".
func NormalizeProvider(v string) string {
	return strings.ToLower(strings.TrimSpace(v))
}
