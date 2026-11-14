// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package push

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"strings"
	"time"
)

// FCMConfig holds the credentials and defaults for the Firebase Cloud
// Messaging (HTTP v1) provider.
type FCMConfig struct {
	ProjectID         string // Firebase project ID
	ServiceAccountKey string // JSON service account key (contents or file path)
	Endpoint          string // FCM endpoint override (for testing)
	TokenURI          string // OAuth2 token URI override (for testing)
}

// FCMProvider sends push notifications via Firebase Cloud Messaging.
type FCMProvider struct {
	cfg   FCMConfig
	sa    *serviceAccount
	token *oauthToken
}

// serviceAccount holds the parsed service account key fields.
type serviceAccount struct {
	ClientEmail string `json:"client_email"`
	PrivateKey  string `json:"private_key"`
	TokenURI    string `json:"token_uri"`
}

// oauthToken is a cached OAuth2 access token.
type oauthToken struct {
	AccessToken string
	ExpiresAt   time.Time
}

// fcmMessage is the FCM HTTP v1 message body.
type fcmMessage struct {
	Message fcmMessageBody `json:"message"`
}

// fcmMessageBody is the inner message object.
type fcmMessageBody struct {
	Token        string            `json:"token,omitempty"`
	Topic        string            `json:"topic,omitempty"`
	Condition    string            `json:"condition,omitempty"`
	Notification *fcmNotification  `json:"notification,omitempty"`
	Android      *fcmAndroid       `json:"android,omitempty"`
	APNs         *fcmAPNs          `json:"apns,omitempty"`
	Data         map[string]string `json:"data,omitempty"`
}

// fcmNotification is the cross-platform notification block.
type fcmNotification struct {
	Title string `json:"title,omitempty"`
	Body  string `json:"body,omitempty"`
}

// fcmAndroid is the Android-specific options.
type fcmAndroid struct {
	Notification *fcmAndroidNotification `json:"notification,omitempty"`
	Priority     string                  `json:"priority,omitempty"`
	CollapseKey  string                  `json:"collapse_key,omitempty"`
	TTL          string                  `json:"ttl,omitempty"`
}

// fcmAndroidNotification is the Android notification options.
type fcmAndroidNotification struct {
	Icon        string `json:"icon,omitempty"`
	Color       string `json:"color,omitempty"`
	Tag         string `json:"tag,omitempty"`
	ClickAction string `json:"click_action,omitempty"`
}

// fcmAPNs is the APNs-specific options.
type fcmAPNs struct {
	Headers map[string]string `json:"headers,omitempty"`
	Payload map[string]any    `json:"payload,omitempty"`
}

// fcmSendResponse is the FCM API response.
type fcmSendResponse struct {
	Name string `json:"name"`
}

// fcmErrorResponse is the FCM API error body.
type fcmErrorResponse struct {
	Error struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
		Status  string `json:"status"`
	} `json:"error"`
}

// NewFCMProvider builds an FCMProvider from a ProviderConfig.
// Recognised keys: project_id, service_account_key, endpoint, token_uri.
func NewFCMProvider(cfg ProviderConfig) (Provider, error) {
	c := FCMConfig{}
	if cfg != nil {
		c.ProjectID = stringFromCfg(cfg, "project_id")
		c.ServiceAccountKey = stringFromCfg(cfg, "service_account_key")
		c.Endpoint = stringFromCfg(cfg, "endpoint")
		c.TokenURI = stringFromCfg(cfg, "token_uri")
	}
	if c.ProjectID == "" || c.ServiceAccountKey == "" {
		return nil, fmt.Errorf("push: fcm project_id and service_account_key are required")
	}
	sa, err := parseServiceAccount(c.ServiceAccountKey, c.TokenURI)
	if err != nil {
		return nil, fmt.Errorf("push: fcm parse service account: %w", err)
	}
	return &FCMProvider{cfg: c, sa: sa}, nil
}

// Kind returns ProviderFCM.
func (p *FCMProvider) Kind() ProviderKind { return ProviderFCM }

// endpoint returns the FCM messages:send URL.
func (p *FCMProvider) endpoint() string {
	if p.cfg.Endpoint != "" {
		return p.cfg.Endpoint
	}
	return fmt.Sprintf("https://fcm.googleapis.com/v1/projects/%s/messages:send", p.cfg.ProjectID)
}

// tokenURI returns the OAuth2 token endpoint.
func (p *FCMProvider) tokenURI() string {
	if p.cfg.TokenURI != "" {
		return p.cfg.TokenURI
	}
	if p.sa.TokenURI != "" {
		return p.sa.TokenURI
	}
	return "https://oauth2.googleapis.com/token"
}

// accessToken returns a cached OAuth2 access token, minting a new one
// when expired.
func (p *FCMProvider) accessToken(ctx context.Context) (string, error) {
	if p.token != nil && time.Now().Before(p.token.ExpiresAt.Add(-time.Minute)) {
		return p.token.AccessToken, nil
	}
	key, err := parseRSAPrivateKey([]byte(p.sa.PrivateKey))
	if err != nil {
		return "", err
	}
	assertion, err := makeFCMJWT(p.sa.ClientEmail, p.tokenURI(), key)
	if err != nil {
		return "", err
	}
	form := url.Values{}
	form.Set("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer")
	form.Set("assertion", assertion)
	resp, err := PostForm(ctx, p.tokenURI(), form, nil, "", "")
	if err != nil {
		return "", fmt.Errorf("push: fcm token exchange: %w", err)
	}
	var tr struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   int    `json:"expires_in"`
	}
	if err := json.Unmarshal(resp, &tr); err != nil {
		return "", fmt.Errorf("push: fcm parse token response: %w", err)
	}
	if tr.AccessToken == "" {
		return "", fmt.Errorf("push: fcm empty access token")
	}
	p.token = &oauthToken{
		AccessToken: tr.AccessToken,
		ExpiresAt:   time.Now().Add(time.Duration(tr.ExpiresIn) * time.Second),
	}
	return p.token.AccessToken, nil
}

// buildMessage constructs the FCM HTTP v1 message body.
func (p *FCMProvider) buildMessage(req SendRequest) ([]byte, error) {
	token, err := FirstDeviceToken(req)
	if err != nil {
		return nil, err
	}
	n := req.Notification
	msg := fcmMessageBody{
		Token: token.Token,
		Notification: &fcmNotification{
			Title: n.Title,
			Body:  n.Body,
		},
		Data: n.Data,
	}

	// Android-specific options.
	android := &fcmAndroid{}
	if n.Icon != "" || n.Color != "" || n.Tag != "" || n.ClickAction != "" {
		android.Notification = &fcmAndroidNotification{
			Icon:        n.Icon,
			Color:       n.Color,
			Tag:         n.Tag,
			ClickAction: n.ClickAction,
		}
	}
	if req.Priority != "" {
		android.Priority = req.Priority
	}
	if req.CollapseKey != "" {
		android.CollapseKey = req.CollapseKey
	}
	if req.TimeToLive > 0 {
		android.TTL = fmt.Sprintf("%ds", req.TimeToLive)
	}
	if android.Notification != nil || android.Priority != "" || android.CollapseKey != "" || android.TTL != "" {
		msg.Android = android
	}

	// APNs-specific options (badge, sound, localization).
	if token.Platform == PlatformIOS || n.Badge > 0 || n.Sound != "" || n.LocalizationKey != "" {
		apns := &fcmAPNs{
			Headers: map[string]string{
				"apns-push-type": "alert",
			},
		}
		aps := map[string]any{}
		if n.Badge > 0 {
			aps["badge"] = n.Badge
		}
		if n.Sound != "" {
			aps["sound"] = n.Sound
		}
		alert := map[string]any{}
		if n.Title != "" {
			alert["title"] = n.Title
		}
		if n.Body != "" {
			alert["body"] = n.Body
		}
		if n.LocalizationKey != "" {
			alert["loc-key"] = n.LocalizationKey
			if len(n.LocalizationArgs) > 0 {
				alert["loc-args"] = n.LocalizationArgs
			}
		}
		if len(alert) > 0 {
			aps["alert"] = alert
		}
		apns.Payload = map[string]any{"aps": aps}
		msg.APNs = apns
	}

	return json.Marshal(fcmMessage{Message: msg})
}

// Send delivers the request via the FCM HTTP v1 API.
func (p *FCMProvider) Send(ctx context.Context, req SendRequest) (*SendResult, error) {
	if err := ValidateBasic(req); err != nil {
		return nil, err
	}

	body, err := p.buildMessage(req)
	if err != nil {
		return &SendResult{
			Provider:   ProviderFCM,
			Accepted:   false,
			Status:     "failed",
			Error:      fmt.Sprintf("fcm: build message: %v", err),
			SentAtUnix: time.Now().Unix(),
		}, fmt.Errorf("push: fcm build message: %w", err)
	}

	token, err := p.accessToken(ctx)
	if err != nil {
		return &SendResult{
			Provider:   ProviderFCM,
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
			Provider:   ProviderFCM,
			Accepted:   false,
			Status:     "failed",
			Error:      err.Error(),
			Raw:        string(raw),
			SentAtUnix: time.Now().Unix(),
		}, err
	}

	accepted := Is2xx(status)
	result := &SendResult{
		Provider:   ProviderFCM,
		Accepted:   accepted,
		Raw:        string(raw),
		SentAtUnix: time.Now().Unix(),
	}
	if accepted {
		var resp fcmSendResponse
		if jErr := json.Unmarshal(raw, &resp); jErr == nil {
			result.MessageID = resp.Name
		}
		result.Status = "sent"
		return result, nil
	}

	var errResp fcmErrorResponse
	if jErr := json.Unmarshal(raw, &errResp); jErr == nil && errResp.Error.Message != "" {
		result.Status = "failed"
		result.Error = errResp.Error.Message
	} else {
		result.Status = "failed"
		result.Error = fmt.Sprintf("fcm: unexpected status %d", status)
	}
	return result, fmt.Errorf("push: fcm rejected: %s", result.Error)
}

// parseServiceAccount parses the JSON service account key. If raw looks
// like a file path it is read from disk. tokenURIOverride replaces the
// token_uri in the key when non-empty.
func parseServiceAccount(raw, tokenURIOverride string) (*serviceAccount, error) {
	var bytes []byte
	var err error
	if strings.Contains(raw, "{") {
		bytes = []byte(raw)
	} else {
		bytes, err = readFileBytes(raw)
		if err != nil {
			return nil, fmt.Errorf("read service account file: %w", err)
		}
	}
	var sa serviceAccount
	if err := json.Unmarshal(bytes, &sa); err != nil {
		return nil, fmt.Errorf("parse service account json: %w", err)
	}
	if sa.ClientEmail == "" || sa.PrivateKey == "" {
		return nil, fmt.Errorf("service account missing client_email or private_key")
	}
	if tokenURIOverride != "" {
		sa.TokenURI = tokenURIOverride
	}
	return &sa, nil
}
