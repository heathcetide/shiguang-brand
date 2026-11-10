// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package sms

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

// TencentConfig holds credentials for the Tencent Cloud SMS provider.
type TencentConfig struct {
	SdkAppID  string // SmsSdkAppId
	SecretID  string // TencentCloud SecretId
	SecretKey string // TencentCloud SecretKey
	SignName  string // default SMS signature
	Region    string // API region (e.g. ap-guangzhou)
	Endpoint  string // API endpoint override
}

// TencentProvider sends SMS via the Tencent Cloud SMS v3 API.
type TencentProvider struct {
	cfg TencentConfig
}

// NewTencentProvider builds a TencentProvider from a ProviderConfig.
// Recognised keys: sdk_app_id, secret_id, secret_key, sign_name, region, endpoint.
func NewTencentProvider(cfg ProviderConfig) (Provider, error) {
	c := TencentConfig{
		Region:   "ap-guangzhou",
		Endpoint: "sms.tencentcloudapi.com",
	}
	if cfg != nil {
		c.SdkAppID = stringFromCfg(cfg, "sdk_app_id")
		c.SecretID = stringFromCfg(cfg, "secret_id")
		c.SecretKey = stringFromCfg(cfg, "secret_key")
		c.SignName = stringFromCfg(cfg, "sign_name")
		if v := stringFromCfg(cfg, "region"); v != "" {
			c.Region = v
		}
		if v := stringFromCfg(cfg, "endpoint"); v != "" {
			c.Endpoint = v
		}
	}
	if c.SdkAppID == "" || c.SecretID == "" || c.SecretKey == "" {
		return nil, fmt.Errorf("sms: tencent sdk_app_id, secret_id and secret_key are required")
	}
	return &TencentProvider{cfg: c}, nil
}

// Kind returns ProviderTencent.
func (p *TencentProvider) Kind() ProviderKind { return ProviderTencent }

// tencentSendSmsResponse is the Tencent Cloud SendSms response.
type tencentSendSmsResponse struct {
	Response struct {
		SendStatusSet []struct {
			SerialNo       string `json:"SerialNo"`
			PhoneNumber    string `json:"PhoneNumber"`
			Fee            int    `json:"Fee"`
			SessionContext string `json:"SessionContext"`
			Code           string `json:"Code"`
			Message        string `json:"Message"`
			IsoCode        string `json:"IsoCode"`
		} `json:"SendStatusSet"`
		RequestId string `json:"RequestId"`
		Error     *struct {
			Code    string `json:"Code"`
			Message string `json:"Message"`
		} `json:"Error,omitempty"`
	} `json:"Response"`
}

// Send delivers the request via the Tencent Cloud SMS API v3.
func (p *TencentProvider) Send(ctx context.Context, req SendRequest) (*SendResult, error) {
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

	// Build the request payload.
	phoneNumbers := []string{"+" + phone}
	templateParams := make([]string, 0, len(req.Message.Data))
	// Tencent expects ordered template params; we use sorted keys for
	// deterministic ordering.
	keys := make([]string, 0, len(req.Message.Data))
	for k := range req.Message.Data {
		keys = append(keys, k)
	}
	// simple sort
	for i := 0; i < len(keys); i++ {
		for j := i + 1; j < len(keys); j++ {
			if keys[i] > keys[j] {
				keys[i], keys[j] = keys[j], keys[i]
			}
		}
	}
	for _, k := range keys {
		templateParams = append(templateParams, req.Message.Data[k])
	}
	if req.Message.Content != "" && len(templateParams) == 0 {
		templateParams = append(templateParams, req.Message.Content)
	}

	payload := map[string]any{
		"SmsSdkAppId":    p.cfg.SdkAppID,
		"SignName":       signName,
		"PhoneNumberSet": phoneNumbers,
	}
	if req.Message.Template != "" {
		payload["TemplateId"] = req.Message.Template
	}
	if len(templateParams) > 0 {
		payload["TemplateParamSet"] = templateParams
	}
	body, _ := json.Marshal(payload)

	endpoint := p.cfg.Endpoint
	if endpoint == "" {
		endpoint = "sms.tencentcloudapi.com"
	}
	urlStr := endpointURL(endpoint)

	timestamp := time.Now().Unix()
	date := time.Unix(timestamp, 0).UTC().Format("2006-01-02")
	service := "sms"

	// Build the canonical request and signature (TC3-HMAC-SHA256).
	headers := p.buildSignature(body, timestamp, date, service)

	raw, err := PostJSON(ctx, urlStr, body, headers, "", "")
	if err != nil {
		return &SendResult{
			Provider:   ProviderTencent,
			Accepted:   false,
			Status:     "failed",
			Error:      err.Error(),
			Raw:        string(raw),
			SentAtUnix: time.Now().Unix(),
		}, err
	}

	var resp tencentSendSmsResponse
	if err := json.Unmarshal(raw, &resp); err != nil {
		return &SendResult{
			Provider:   ProviderTencent,
			Accepted:   false,
			Status:     "failed",
			Error:      fmt.Sprintf("tencent: parse response: %v", err),
			Raw:        string(raw),
			SentAtUnix: time.Now().Unix(),
		}, fmt.Errorf("sms: tencent parse response: %w", err)
	}

	if resp.Response.Error != nil {
		return &SendResult{
			Provider:   ProviderTencent,
			Accepted:   false,
			Status:     "failed",
			Error:      resp.Response.Error.Message,
			Raw:        string(raw),
			SentAtUnix: time.Now().Unix(),
		}, fmt.Errorf("sms: tencent error %s: %s", resp.Response.Error.Code, resp.Response.Error.Message)
	}

	if len(resp.Response.SendStatusSet) == 0 {
		return &SendResult{
			Provider:   ProviderTencent,
			Accepted:   false,
			Status:     "failed",
			Error:      "tencent: empty SendStatusSet",
			Raw:        string(raw),
			SentAtUnix: time.Now().Unix(),
		}, fmt.Errorf("sms: tencent empty SendStatusSet")
	}

	status := resp.Response.SendStatusSet[0]
	accepted := status.Code == "Ok"
	resultStatus := status.Code
	if !accepted {
		resultStatus = "failed"
	}
	errMsg := ""
	if !accepted {
		errMsg = status.Message
	}
	return &SendResult{
		Provider:   ProviderTencent,
		MessageID:  status.SerialNo,
		Accepted:   accepted,
		Status:     resultStatus,
		Error:      errMsg,
		Raw:        string(raw),
		SentAtUnix: time.Now().Unix(),
	}, nil
}

// buildSignature computes the TC3-HMAC-SHA256 authorization header for
// the Tencent Cloud API v3 and returns the full set of headers to attach.
func (p *TencentProvider) buildSignature(body []byte, timestamp int64, date, service string) map[string]string {
	credential := p.cfg.SecretID
	secret := p.cfg.SecretKey

	// 1. Canonical request
	canonicalURI := "/"
	canonicalQueryString := ""
	canonicalHeaders := "content-type:application/json; charset=utf-8\nhost:" + hostOf(p.cfg.Endpoint) + "\nx-tc-action:sendsms\n"
	signedHeaders := "content-type;host;x-tc-action"
	hashedPayload := SHA256Hex(string(body))
	canonicalRequest := "POST\n" + canonicalURI + "\n" + canonicalQueryString + "\n" + canonicalHeaders + "\n" + signedHeaders + "\n" + hashedPayload

	// 2. String to sign
	algorithm := "TC3-HMAC-SHA256"
	credentialScope := date + "/" + service + "/tc3_request"
	stringToSign := algorithm + "\n" + fmt.Sprintf("%d", timestamp) + "\n" + credentialScope + "\n" + SHA256Hex(canonicalRequest)

	// 3. Signature (chained HMAC-SHA256)
	secretDate := hmacSHA256Bytes([]byte("TC3"+secret), date)
	secretService := hmacSHA256Bytes(secretDate, service)
	secretSigning := hmacSHA256Bytes(secretService, "tc3_request")
	signature := hexEncode(hmacSHA256Bytes(secretSigning, stringToSign))

	authorization := algorithm + " Credential:" + credential + "/" + credentialScope + ", SignedHeaders:" + signedHeaders + ", Signature:" + signature

	headers := map[string]string{
		"Authorization":  authorization,
		"Content-Type":   "application/json; charset=utf-8",
		"Host":           hostOf(p.cfg.Endpoint),
		"X-TC-Action":    "SendSms",
		"X-TC-Version":   "2021-01-11",
		"X-TC-Timestamp": fmt.Sprintf("%d", timestamp),
		"X-TC-Region":    p.cfg.Region,
	}
	return headers
}

// endpointURL returns the full request URL for the given endpoint. When
// endpoint already includes a scheme it is used as-is; otherwise https://
// is prepended.
func endpointURL(endpoint string) string {
	if strings.HasPrefix(endpoint, "http://") || strings.HasPrefix(endpoint, "https://") {
		return endpoint
	}
	return "https://" + endpoint
}

// hostOf returns the host:port portion of an endpoint that may include a
// scheme. Used for the Host header in the Tencent signature.
func hostOf(endpoint string) string {
	for _, scheme := range []string{"https://", "http://"} {
		if strings.HasPrefix(endpoint, scheme) {
			return strings.TrimPrefix(endpoint, scheme)
		}
	}
	return endpoint
}

// hmacSHA256Bytes returns the raw HMAC-SHA256 of message under key.
func hmacSHA256Bytes(key []byte, message string) []byte {
	return hmacSHA256Raw(key, []byte(message))
}

// hexEncode returns the lowercase hex string of b.
func hexEncode(b []byte) string {
	const hexChars = "0123456789abcdef"
	out := make([]byte, len(b)*2)
	for i, v := range b {
		out[i*2] = hexChars[v>>4]
		out[i*2+1] = hexChars[v&0x0f]
	}
	return string(out)
}
