// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package push

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

// UniPushConfig holds the credentials and defaults for the Unified Push
// provider (a Huawei HMS Push aggregator for Chinese Android vendors).
type UniPushConfig struct {
	AppID     string // Huawei app ID
	AppKey    string // Huawei app key
	AppSecret string // Huawei app secret
	Endpoint  string // push endpoint override (for testing)
	TokenURI  string // OAuth2 token endpoint override (for testing)
}

// UniPushProvider sends push notifications via Huawei HMS Push (and can
// be extended to other Chinese Android vendors).
type UniPushProvider struct {
	cfg   UniPushConfig
	token *uniPushToken
}

// uniPushToken is a cached OAuth2 access token.
type uniPushToken struct {
	AccessToken string
	ExpiresAt   time.Time
}

// uniPushMessage is the HMS Push message body.
type uniPushMessage struct {
	Message uniPushMessageBody `json:"message"`
}

// uniPushMessageBody is the inner HMS message object.
type uniPushMessageBody struct {
	Token        []string            `json:"token"`
	Notification uniPushNotification `json:"notification"`
	Android      uniPushAndroid      `json:"android,omitempty"`
	Data         string              `json:"data,omitempty"`
}

// uniPushNotification is the HMS notification block.
type uniPushNotification struct {
	Title       string             `json:"title"`
	Body        string             `json:"body"`
	Icon        string             `json:"icon,omitempty"`
	Color       string             `json:"color,omitempty"`
	Tag         string             `json:"tag,omitempty"`
	ClickAction uniPushClickAction `json:"click_action,omitempty"`
}

// uniPushClickAction is the HMS click action.
type uniPushClickAction struct {
	Type int    `json:"type"`
	URL  string `json:"url,omitempty"`
}

// uniPushAndroid is the HMS android options.
type uniPushAndroid struct {
	CollapseKey int    `json:"collapse_key,omitempty"`
	TTL         string `json:"ttl,omitempty"`
	Priority    string `json:"importance,omitempty"`
}

// uniPushSendResponse is the HMS Push API response.
type uniPushSendResponse struct {
	Code      string `json:"code"`
	Msg       string `json:"msg"`
	RequestID string `json:"requestId"`
}

// uniPushTokenResponse is the HMS OAuth2 token response.
type uniPushTokenResponse struct {
	AccessToken string `json:"access_token"`
	ExpiresIn   int    `json:"expires_in"`
}

// NewUniPushProvider builds a UniPushProvider from a ProviderConfig.
// Recognised keys: app_id, app_key, app_secret, endpoint, token_uri.
func NewUniPushProvider(cfg ProviderConfig) (Provider, error) {
	c := UniPushConfig{}
	if cfg != nil {
		c.AppID = stringFromCfg(cfg, "app_id")
		c.AppKey = stringFromCfg(cfg, "app_key")
		c.AppSecret = stringFromCfg(cfg, "app_secret")
		c.Endpoint = stringFromCfg(cfg, "endpoint")
		c.TokenURI = stringFromCfg(cfg, "token_uri")
	}
	if c.AppID == "" || c.AppSecret == "" {
		return nil, fmt.Errorf("push: unipush app_id and app_secret are required")
	}
	return &UniPushProvider{cfg: c}, nil
}

// Kind returns ProviderUniPush.
func (p *UniPushProvider) Kind() ProviderKind { return ProviderUniPush }

// endpoint returns the HMS Push messages:send URL.
func (p *UniPushProvider) endpoint() string {
	if p.cfg.Endpoint != "" {
		return p.cfg.Endpoint
	}
	return fmt.Sprintf("https://push-api.cloud.huawei.com/v1/%s/messages:send", p.cfg.AppID)
}

// tokenURI returns the HMS OAuth2 token endpoint.
func (p *UniPushProvider) tokenURI() string {
	if p.cfg.TokenURI != "" {
		return p.cfg.TokenURI
	}
	return "https://oauth-api.cloud.huawei.com/oauth2/v3/token"
}

// accessToken returns a cached OAuth2 access token, minting a new one
// when expired. Uses the client_credentials grant with app_id/app_secret.
func (p *UniPushProvider) accessToken(ctx context.Context) (string, error) {
	if p.token != nil && time.Now().Before(p.token.ExpiresAt.Add(-time.Minute)) {
		return p.token.AccessToken, nil
	}
	body := fmt.Sprintf(`{"grant_type":"client_credentials","client_secret":"%s","client_id":"%s"}`,
		p.cfg.AppSecret, p.cfg.AppID)
	resp, err := PostJSON(ctx, p.tokenURI(), []byte(body), nil, "", "")
	if err != nil {
		return "", fmt.Errorf("push: unipush token exchange: %w", err)
	}
	var tr uniPushTokenResponse
	if err := json.Unmarshal(resp, &tr); err != nil {
		return "", fmt.Errorf("push: unipush parse token response: %w", err)
	}
	if tr.AccessToken == "" {
		return "", fmt.Errorf("push: unipush empty access token")
	}
	p.token = &uniPushToken{
		AccessToken: tr.AccessToken,
		ExpiresAt:   time.Now().Add(time.Duration(tr.ExpiresIn) * time.Second),
	}
	return p.token.AccessToken, nil
}

// buildMessage constructs the HMS Push message body.
func (p *UniPushProvider) buildMessage(req SendRequest) ([]byte, error) {
	tokens := make([]string, 0, len(req.To))
	for _, t := range req.To {
		if strings.TrimSpace(t.Token) != "" {
			tokens = append(tokens, t.Token)
		}
	}
	if len(tokens) == 0 {
		return nil, fmt.Errorf("unipush: no valid tokens")
	}
	n := req.Notification
	msg := uniPushMessageBody{
		Token: tokens,
		Notification: uniPushNotification{
			Title: n.Title,
			Body:  n.Body,
			Icon:  n.Icon,
			Color: n.Color,
			Tag:   n.Tag,
		},
	}
	if n.ClickAction != "" {
		msg.Notification.ClickAction = uniPushClickAction{
			Type: 3, // 3 = open URL
			URL:  n.ClickAction,
		}
	}
	if req.TimeToLive > 0 {
		msg.Android.TTL = fmt.Sprintf("%ds", req.TimeToLive)
	}
	if req.Priority != "" {
		msg.Android.Priority = req.Priority
	}
	if len(n.Data) > 0 {
		msg.Data = JSONStringAny(n.Data)
	}
	return json.Marshal(uniPushMessage{Message: msg})
}

// Send delivers the request via the HMS Push API. iOS tokens are rejected
// with a clear error (use APNs directly for iOS).
func (p *UniPushProvider) Send(ctx context.Context, req SendRequest) (*SendResult, error) {
	if err := ValidateBasic(req); err != nil {
		return nil, err
	}
	// Route based on platform. UniPush targets Android vendors.
	for _, t := range req.To {
		if t.Platform == PlatformIOS {
			return &SendResult{
				Provider:   ProviderUniPush,
				Accepted:   false,
				Status:     "failed",
				Error:      "unipush: iOS tokens must use APNs directly",
				SentAtUnix: time.Now().Unix(),
			}, fmt.Errorf("push: unipush does not support iOS tokens")
		}
	}

	body, err := p.buildMessage(req)
	if err != nil {
		return &SendResult{
			Provider:   ProviderUniPush,
			Accepted:   false,
			Status:     "failed",
			Error:      fmt.Sprintf("unipush: build message: %v", err),
			SentAtUnix: time.Now().Unix(),
		}, fmt.Errorf("push: unipush build message: %w", err)
	}

	token, err := p.accessToken(ctx)
	if err != nil {
		return &SendResult{
			Provider:   ProviderUniPush,
			Accepted:   false,
			Status:     "failed",
			Error:      err.Error(),
			SentAtUnix: time.Now().Unix(),
		}, err
	}

	headers := map[string]string{
		"authorization": "Bearer " + token,
	}
	status, raw, err := PostJSONRaw(ctx, p.endpoint(), body, headers, "", "")
	if err != nil {
		return &SendResult{
			Provider:   ProviderUniPush,
			Accepted:   false,
			Status:     "failed",
			Error:      err.Error(),
			Raw:        string(raw),
			SentAtUnix: time.Now().Unix(),
		}, err
	}

	accepted := Is2xx(status)
	result := &SendResult{
		Provider:   ProviderUniPush,
		Accepted:   accepted,
		Raw:        string(raw),
		SentAtUnix: time.Now().Unix(),
	}
	if accepted {
		var resp uniPushSendResponse
		if jErr := json.Unmarshal(raw, &resp); jErr == nil {
			result.MessageID = resp.RequestID
			if resp.Code != "" && resp.Code != "80000000" {
				result.Accepted = false
				result.Status = "failed"
				result.Error = resp.Msg
				return result, fmt.Errorf("push: unipush rejected: %s", resp.Msg)
			}
		}
		result.Status = "sent"
		return result, nil
	}

	var errResp uniPushSendResponse
	if jErr := json.Unmarshal(raw, &errResp); jErr == nil && errResp.Msg != "" {
		result.Status = "failed"
		result.Error = errResp.Msg
	} else {
		result.Status = "failed"
		result.Error = fmt.Sprintf("unipush: unexpected status %d", status)
	}
	return result, fmt.Errorf("push: unipush rejected: %s", result.Error)
}
