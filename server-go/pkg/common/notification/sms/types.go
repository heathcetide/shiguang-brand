// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package sms

import (
	"context"
	"fmt"
	"strings"
)

// ProviderKind identifies an SMS backend provider.
type ProviderKind string

// Known provider kinds.
const (
	ProviderAliyun      ProviderKind = "aliyun"
	ProviderTencent     ProviderKind = "tencent"
	ProviderTwilio      ProviderKind = "twilio"
	ProviderHuawei      ProviderKind = "huawei"
	ProviderYunpian     ProviderKind = "yunpian"
	ProviderSubmail     ProviderKind = "submail"
	ProviderLuosimao    ProviderKind = "luosimao"
	ProviderYuntongxun  ProviderKind = "yuntongxun" // 容联云通讯 / Cloopen
	ProviderHuyi        ProviderKind = "huyi"
	ProviderJuhe        ProviderKind = "juhe"
	ProviderBaidu       ProviderKind = "baidu"
	ProviderHuaxin      ProviderKind = "huaxin"
	ProviderChuanglan   ProviderKind = "chuanglan"
	ProviderRongcloud   ProviderKind = "rongcloud"
	ProviderTiniyo      ProviderKind = "tiniyo"
	ProviderUCloud      ProviderKind = "ucloud"
	ProviderNeteaseYunx ProviderKind = "netease" // 网易云信
	ProviderMock        ProviderKind = "mock"
)

// PhoneNumber is a single recipient phone number with its country code.
type PhoneNumber struct {
	Number      string // phone number without the leading country code
	CountryCode int    // country dialling code (e.g. 86 for China, 1 for US)
}

// String returns the E.164-ish representation (e.g. "+8613800138000").
func (p PhoneNumber) String() string {
	n := strings.TrimSpace(p.Number)
	if n == "" {
		return ""
	}
	if p.CountryCode > 0 {
		return fmt.Sprintf("+%d%s", p.CountryCode, n)
	}
	return n
}

// Message is the SMS payload. Either Content (raw text) or Template
// (provider template ID) must be set; when both are present providers
// may prefer the template.
type Message struct {
	Content  string            // raw message text
	Template string            // provider template ID
	Data     map[string]string // template variables
	SignName string            // SMS signature name
}

// SendRequest is the input to Provider.Send.
type SendRequest struct {
	To      []PhoneNumber  // one or more recipients
	Message Message        // message body / template
	Extras  map[string]any // provider-specific extras
}

// SendResult is the outcome of a single send attempt.
type SendResult struct {
	Provider   ProviderKind // provider that produced this result
	MessageID  string       // provider-assigned message ID
	Accepted   bool         // whether the provider accepted the request
	Status     string       // delivery status string (provider-specific)
	Error      string       // error message, empty on success
	Raw        string       // raw provider response (for debugging)
	SentAtUnix int64        // send timestamp in unix seconds
}

// Provider is the interface implemented by every SMS backend.
type Provider interface {
	// Kind returns the provider identifier.
	Kind() ProviderKind

	// Send delivers the request through this provider.
	Send(ctx context.Context, req SendRequest) (*SendResult, error)
}

// ValidateBasic performs lightweight validation of a SendRequest: it
// requires at least one recipient and either non-empty Content or a
// non-empty Template.
func ValidateBasic(req SendRequest) error {
	if len(req.To) == 0 {
		return fmt.Errorf("sms: recipients list is empty")
	}
	for i, p := range req.To {
		if strings.TrimSpace(p.Number) == "" {
			return fmt.Errorf("sms: recipient %d has empty number", i)
		}
	}
	if strings.TrimSpace(req.Message.Content) == "" && strings.TrimSpace(req.Message.Template) == "" {
		return fmt.Errorf("sms: message content or template is required")
	}
	return nil
}

// FirstRecipient returns the first recipient's phone number (with the
// country code prefixed when non-zero) or an error if there are none.
func FirstRecipient(req SendRequest) (string, error) {
	if len(req.To) == 0 {
		return "", fmt.Errorf("sms: no recipients")
	}
	p := req.To[0]
	if strings.TrimSpace(p.Number) == "" {
		return "", fmt.Errorf("sms: first recipient has empty number")
	}
	if p.CountryCode > 0 {
		return fmt.Sprintf("%d%s", p.CountryCode, p.Number), nil
	}
	return p.Number, nil
}

// NormalizeContent returns content with the signature appended when it
// is not already present. When fallbackSign is non-empty and the message
// has no SignName, fallbackSign is used. If the signature already appears
// in content the content is returned unchanged.
func NormalizeContent(content, fallbackSign string) string {
	content = strings.TrimSpace(content)
	if content == "" {
		return content
	}
	sign := strings.TrimSpace(fallbackSign)
	if sign == "" {
		return content
	}
	// Accept signatures with or without surrounding brackets, e.g.
	// "【LingByte】" or "LingByte".
	plain := strings.Trim(sign, "【】[]()<>")
	if plain == "" {
		return content
	}
	if strings.Contains(content, plain) {
		return content
	}
	return content + " " + sign
}
