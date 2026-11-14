// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package push

import (
	"context"
	"crypto/ecdsa"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

// APNsConfig holds the credentials and defaults for the Apple Push
// Notification service provider.
type APNsConfig struct {
	TeamID     string // Apple Developer team ID
	KeyID      string // APNs auth key ID
	AuthKey    string // PEM-encoded ES256 private key (contents or file path)
	BundleID   string // app bundle ID (used as apns-topic)
	Production bool   // use production endpoint (true) or sandbox (false)
	Endpoint   string // API endpoint override (for testing)
}

// APNsProvider sends push notifications via the Apple Push Notification
// service HTTP/2 API.
type APNsProvider struct {
	cfg APNsConfig
	key *ecdsaKeyHolder
}

// ecdsaKeyHolder wraps the parsed key so construction can be lazy.
type ecdsaKeyHolder struct {
	raw    string
	parsed *ecdsa.PrivateKey
}

// apnsPayload is the JSON body sent to APNs.
type apnsPayload struct {
	APS apsDict `json:"aps"`
}

// apsDict is the aps dictionary inside an APNs payload.
type apsDict struct {
	Alert            apsAlert `json:"alert"`
	Badge            int      `json:"badge,omitempty"`
	Sound            string   `json:"sound,omitempty"`
	ContentAvailable int      `json:"content-available,omitempty"`
}

// apsAlert is the alert sub-dictionary.
type apsAlert struct {
	Title        string   `json:"title,omitempty"`
	Body         string   `json:"body,omitempty"`
	LocKey       string   `json:"loc-key,omitempty"`
	LocArgs      []string `json:"loc-args,omitempty"`
	ActionLocKey string   `json:"action-loc-key,omitempty"`
}

// apnsResponse is the error body returned by APNs on failure.
type apnsResponse struct {
	Reason string `json:"reason"`
}

// NewAPNsProvider builds an APNsProvider from a ProviderConfig.
// Recognised keys: team_id, key_id, auth_key, bundle_id, production, endpoint.
func NewAPNsProvider(cfg ProviderConfig) (Provider, error) {
	c := APNsConfig{
		Endpoint:   "",
		Production: true,
	}
	if cfg != nil {
		c.TeamID = stringFromCfg(cfg, "team_id")
		c.KeyID = stringFromCfg(cfg, "key_id")
		c.AuthKey = stringFromCfg(cfg, "auth_key")
		c.BundleID = stringFromCfg(cfg, "bundle_id")
		if _, ok := cfg["production"]; ok {
			c.Production = boolFromCfg(cfg, "production")
		}
		if v := stringFromCfg(cfg, "endpoint"); v != "" {
			c.Endpoint = v
		}
	}
	if c.TeamID == "" || c.KeyID == "" || c.AuthKey == "" {
		return nil, fmt.Errorf("push: apns team_id, key_id and auth_key are required")
	}
	return &APNsProvider{
		cfg: c,
		key: &ecdsaKeyHolder{raw: c.AuthKey},
	}, nil
}

// Kind returns ProviderAPNs.
func (p *APNsProvider) Kind() ProviderKind { return ProviderAPNs }

// endpoint returns the base URL for APNs requests.
func (p *APNsProvider) endpoint() string {
	if p.cfg.Endpoint != "" {
		return strings.TrimRight(p.cfg.Endpoint, "/")
	}
	if p.cfg.Production {
		return "https://api.push.apple.com"
	}
	return "https://api.sandbox.push.apple.com"
}

// authToken returns a cached-or-freshly-minted ES256 JWT for APNs.
func (p *APNsProvider) authToken() (string, error) {
	key, err := p.loadKey()
	if err != nil {
		return "", err
	}
	return makeAPNsJWT(p.cfg.TeamID, p.cfg.KeyID, key)
}

// loadKey parses the EC private key (lazily, with caching).
func (p *APNsProvider) loadKey() (*ecdsa.PrivateKey, error) {
	if p.key.parsed != nil {
		return p.key.parsed, nil
	}
	k, err := parseECPrivateKey(p.key.raw)
	if err != nil {
		return nil, err
	}
	p.key.parsed = k
	return k, nil
}

// buildPayload constructs the APNs JSON payload for a notification.
func (p *APNsProvider) buildPayload(n Notification) ([]byte, error) {
	payload := apnsPayload{
		APS: apsDict{
			Alert: apsAlert{
				Title:   n.Title,
				Body:    n.Body,
				LocKey:  n.LocalizationKey,
				LocArgs: n.LocalizationArgs,
			},
		},
	}
	if n.Badge > 0 {
		payload.APS.Badge = n.Badge
	}
	if n.Sound != "" {
		payload.APS.Sound = n.Sound
	}
	// When there is no title/body but data is present, mark as
	// content-available (silent push).
	if n.Title == "" && n.Body == "" && len(n.Data) > 0 {
		payload.APS.ContentAvailable = 1
	}
	return json.Marshal(payload)
}

// Send delivers the request via the APNs HTTP/2 API.
func (p *APNsProvider) Send(ctx context.Context, req SendRequest) (*SendResult, error) {
	if err := ValidateBasic(req); err != nil {
		return nil, err
	}
	// APNs sends one request per device token.
	token, err := FirstDeviceToken(req)
	if err != nil {
		return nil, err
	}

	body, err := p.buildPayload(req.Notification)
	if err != nil {
		return &SendResult{
			Provider:   ProviderAPNs,
			Accepted:   false,
			Status:     "failed",
			Error:      fmt.Sprintf("apns: build payload: %v", err),
			SentAtUnix: time.Now().Unix(),
		}, fmt.Errorf("push: apns build payload: %w", err)
	}

	jwt, err := p.authToken()
	if err != nil {
		return &SendResult{
			Provider:   ProviderAPNs,
			Accepted:   false,
			Status:     "failed",
			Error:      err.Error(),
			SentAtUnix: time.Now().Unix(),
		}, err
	}

	endpoint := p.endpoint() + "/3/device/" + token.Token
	headers := map[string]string{
		"authorization":  "bearer " + jwt,
		"apns-topic":     p.cfg.BundleID,
		"apns-push-type": "alert",
	}
	priority := strings.TrimSpace(req.Priority)
	if priority == "high" || priority == "" {
		headers["apns-priority"] = "10"
	} else {
		headers["apns-priority"] = "5"
	}

	status, raw, err := PostJSONRaw(ctx, endpoint, body, headers, "", "")
	if err != nil {
		return &SendResult{
			Provider:   ProviderAPNs,
			Accepted:   false,
			Status:     "failed",
			Error:      err.Error(),
			Raw:        string(raw),
			SentAtUnix: time.Now().Unix(),
		}, err
	}

	accepted := Is2xx(status)
	result := &SendResult{
		Provider:   ProviderAPNs,
		Accepted:   accepted,
		Raw:        string(raw),
		SentAtUnix: time.Now().Unix(),
	}
	if accepted {
		result.Status = "sent"
		// APNs returns an empty body on success; use apns-id header when
		// available (not exposed via the raw helper, so leave MessageID empty).
		return result, nil
	}

	// Parse the error reason.
	var resp apnsResponse
	if jErr := json.Unmarshal(raw, &resp); jErr == nil && resp.Reason != "" {
		result.Status = "failed"
		result.Error = resp.Reason
	} else {
		result.Status = "failed"
		result.Error = fmt.Sprintf("apns: unexpected status %d", status)
	}
	return result, fmt.Errorf("push: apns rejected: %s", result.Error)
}
