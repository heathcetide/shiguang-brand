// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package sms

import (
	"context"
	"encoding/xml"
	"fmt"
	"net/url"
	"sort"
	"strings"
	"time"
)

// AliyunConfig holds the credentials and defaults for the Aliyun SMS
// provider.
type AliyunConfig struct {
	AccessKeyID     string // Aliyun AccessKey ID
	AccessKeySecret string // Aliyun AccessKey secret (used as HMAC key)
	SignName        string // default SMS signature
	Endpoint        string // API endpoint (defaults to the public endpoint)
	ContentTemplate string // optional default template code
	ContentParamKey string // key under which Content is placed in template params
}

// AliyunProvider sends SMS via the Aliyun Dysmsapi API.
type AliyunProvider struct {
	cfg AliyunConfig
}

// NewAliyunProvider builds an AliyunProvider from a ProviderConfig.
// Recognised keys: access_key_id, access_key_secret, sign_name, endpoint,
// content_template, content_param_key.
func NewAliyunProvider(cfg ProviderConfig) (Provider, error) {
	c := AliyunConfig{
		Endpoint:        "https://dysmsapi.aliyuncs.com",
		ContentParamKey: "content",
	}
	if cfg != nil {
		c.AccessKeyID = stringFromCfg(cfg, "access_key_id")
		c.AccessKeySecret = stringFromCfg(cfg, "access_key_secret")
		c.SignName = stringFromCfg(cfg, "sign_name")
		if v := stringFromCfg(cfg, "endpoint"); v != "" {
			c.Endpoint = v
		}
		c.ContentTemplate = stringFromCfg(cfg, "content_template")
		if v := stringFromCfg(cfg, "content_param_key"); v != "" {
			c.ContentParamKey = v
		}
	}
	if c.AccessKeyID == "" || c.AccessKeySecret == "" {
		return nil, fmt.Errorf("sms: aliyun access_key_id and access_key_secret are required")
	}
	return &AliyunProvider{cfg: c}, nil
}

// Kind returns ProviderAliyun.
func (p *AliyunProvider) Kind() ProviderKind { return ProviderAliyun }

// aliyunResponse is the XML response envelope from the SendSms API.
type aliyunResponse struct {
	XMLName   xml.Name `xml:"SendSmsResponse"`
	Code      string   `xml:"Code"`
	Message   string   `xml:"Message"`
	RequestId string   `xml:"RequestId"`
	BizId     string   `xml:"BizId"`
}

// Send delivers the request via the Aliyun SMS API.
func (p *AliyunProvider) Send(ctx context.Context, req SendRequest) (*SendResult, error) {
	if err := ValidateBasic(req); err != nil {
		return nil, err
	}
	phone, err := FirstRecipient(req)
	if err != nil {
		return nil, err
	}

	signName := req.Message.SignName
	if signName == "" {
		signName = p.cfg.SignName
	}
	templateCode := req.Message.Template
	if templateCode == "" {
		templateCode = p.cfg.ContentTemplate
	}

	// Build template parameters JSON-like string: {"k":"v",...}
	params := map[string]string{}
	for k, v := range req.Message.Data {
		params[k] = v
	}
	if req.Message.Content != "" && p.cfg.ContentParamKey != "" {
		params[p.cfg.ContentParamKey] = req.Message.Content
	}
	templateParam := jsonString(params)

	form := p.buildCommonParams()
	form.Set("PhoneNumbers", phone)
	form.Set("SignName", signName)
	if templateCode != "" {
		form.Set("TemplateCode", templateCode)
	}
	if templateParam != "" {
		form.Set("TemplateParam", templateParam)
	}
	form.Set("Signature", p.sign(form))

	endpoint := p.cfg.Endpoint
	if endpoint == "" {
		endpoint = "https://dysmsapi.aliyuncs.com"
	}
	raw, err := PostForm(ctx, endpoint, form, nil, "", "")
	if err != nil {
		return &SendResult{
			Provider:   ProviderAliyun,
			Accepted:   false,
			Status:     "failed",
			Error:      err.Error(),
			Raw:        string(raw),
			SentAtUnix: time.Now().Unix(),
		}, err
	}

	var resp aliyunResponse
	if err := xml.Unmarshal(raw, &resp); err != nil {
		return &SendResult{
			Provider:   ProviderAliyun,
			Accepted:   false,
			Status:     "failed",
			Error:      fmt.Sprintf("aliyun: parse response: %v", err),
			Raw:        string(raw),
			SentAtUnix: time.Now().Unix(),
		}, fmt.Errorf("sms: aliyun parse response: %w", err)
	}

	accepted := resp.Code == "OK"
	status := resp.Code
	if !accepted {
		status = "failed"
	}
	errMsg := ""
	if !accepted {
		errMsg = resp.Message
	}
	return &SendResult{
		Provider:   ProviderAliyun,
		MessageID:  resp.BizId,
		Accepted:   accepted,
		Status:     status,
		Error:      errMsg,
		Raw:        string(raw),
		SentAtUnix: time.Now().Unix(),
	}, nil
}

// buildCommonParams returns the shared Aliyun API parameters.
func (p *AliyunProvider) buildCommonParams() url.Values {
	v := url.Values{}
	v.Set("AccessKeyId", p.cfg.AccessKeyID)
	v.Set("Timestamp", time.Now().UTC().Format("2006-01-02T15:04:05Z"))
	v.Set("SignatureNonce", RandHex(16))
	v.Set("SignatureVersion", "1.0")
	v.Set("SignatureMethod", "HMAC-SHA1")
	v.Set("Format", "XML")
	v.Set("Version", "2017-05-25")
	v.Set("Action", "SendSms")
	return v
}

// sign computes the Aliyun request signature. The string to sign is
// "GET&%2F&<urlencoded-special-canonical-query>" and the HMAC key is
// the secret suffixed with "&".
func (p *AliyunProvider) sign(form url.Values) string {
	keys := make([]string, 0, len(form))
	for k := range form {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	var b strings.Builder
	for i, k := range keys {
		if i > 0 {
			b.WriteByte('&')
		}
		b.WriteString(percentEncode(k))
		b.WriteByte('=')
		b.WriteString(percentEncode(form.Get(k)))
	}
	canonical := b.String()

	stringToSign := "GET&" + percentEncode("/") + "&" + percentEncode(canonical)
	key := p.cfg.AccessKeySecret + "&"
	return HMACSHA1Base64(key, stringToSign)
}

// percentEncode implements Aliyun's RFC 3986 percent-encoding variant.
func percentEncode(s string) string {
	s = url.QueryEscape(s)
	s = strings.ReplaceAll(s, "+", "%20")
	s = strings.ReplaceAll(s, "*", "%2A")
	s = strings.ReplaceAll(s, "%7E", "~")
	return s
}

// jsonString builds a minimal JSON object string from a string map.
// Keys/values are escaped via json.Marshal to stay correct.
func jsonString(m map[string]string) string {
	if len(m) == 0 {
		return ""
	}
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	var b strings.Builder
	b.WriteByte('{')
	for i, k := range keys {
		if i > 0 {
			b.WriteByte(',')
		}
		b.WriteString(jsonStringPart(k))
		b.WriteByte(':')
		b.WriteString(jsonStringPart(m[k]))
	}
	b.WriteByte('}')
	return b.String()
}

// jsonStringPart returns a JSON-quoted string for s.
func jsonStringPart(s string) string {
	var sb strings.Builder
	sb.WriteByte('"')
	for _, r := range s {
		switch r {
		case '"':
			sb.WriteString(`\"`)
		case '\\':
			sb.WriteString(`\\`)
		case '\n':
			sb.WriteString(`\n`)
		case '\r':
			sb.WriteString(`\r`)
		case '\t':
			sb.WriteString(`\t`)
		default:
			if r < 0x20 {
				sb.WriteString(fmt.Sprintf(`\u%04x`, r))
			} else {
				sb.WriteRune(r)
			}
		}
	}
	sb.WriteByte('"')
	return sb.String()
}

// stringFromCfg reads a string value from a ProviderConfig.
func stringFromCfg(cfg ProviderConfig, key string) string {
	if cfg == nil {
		return ""
	}
	v, ok := cfg[key]
	if !ok {
		return ""
	}
	return fmt.Sprintf("%v", v)
}
