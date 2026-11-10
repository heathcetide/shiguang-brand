// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package oauth2 provides a lightweight, dependency-free OAuth2 client
// implementation built on top of the Go standard library (`net/http` and
// `encoding/json`).
//
// It supports the standard authorization-code flow for multiple popular
// identity providers (Google, GitHub, WeChat, DingTalk and Feishu) and
// exposes a small, uniform API for generating authorization URLs, exchanging
// authorization codes for access tokens, refreshing tokens and fetching
// normalized user information.
//
// # Quick start
//
//	provider := oauth2.GoogleProvider("client-id", "client-secret", "https://example.com/callback")
//	client := oauth2.NewClient(provider)
//
//	state := oauth2.GenerateState()
//	url := client.AuthURL(state)
//	// redirect the user to `url` ...
//
//	tok, err := client.Exchange(ctx, code)
//	if err != nil {
//	    log.Fatal(err)
//	}
//
//	user, err := client.GetUser(ctx, tok)
//	if err != nil {
//	    log.Fatal(err)
//	}
//	fmt.Println(user.ID, user.Name, user.Email)
//
// The package intentionally avoids any third-party dependencies so it can be
// embedded in libraries without pulling in a heavy OAuth2 framework.
package oauth2

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// Provider describes an OAuth2 identity provider configuration.
type Provider struct {
	Name         string
	AuthURL      string
	TokenURL     string
	UserInfoURL  string
	Scopes       []string
	RedirectURL  string
	ClientID     string
	ClientSecret string
}

// Client is an OAuth2 client bound to a single Provider.
type Client struct {
	provider   *Provider
	httpClient *http.Client
}

// Token represents the credentials obtained from an OAuth2 token endpoint.
type Token struct {
	AccessToken  string
	RefreshToken string
	TokenType    string
	ExpiresIn    int64
	ExpiresAt    time.Time
	Scope        string
	Raw          map[string]any
}

// UserInfo is the normalized user information returned by GetUser.
type UserInfo struct {
	ID       string
	Name     string
	Email    string
	Avatar   string
	Provider string
	Raw      map[string]any
}

// NewClient creates a new OAuth2 client for the given provider.
//
// If provider is nil NewClient panics: a client without a provider is not
// usable. The returned client uses http.DefaultClient for outbound requests.
func NewClient(provider *Provider) *Client {
	if provider == nil {
		panic("oauth2: provider must not be nil")
	}
	return &Client{
		provider:   provider,
		httpClient: http.DefaultClient,
	}
}

// SetHTTPClient overrides the underlying *http.Client used for token and
// user-info requests. Passing nil resets the client to http.DefaultClient.
func (c *Client) SetHTTPClient(hc *http.Client) {
	if hc == nil {
		hc = http.DefaultClient
	}
	c.httpClient = hc
}

// AuthURL builds the authorization-endpoint URL for the authorization-code
// flow, embedding the configured scopes and the given state value.
func (c *Client) AuthURL(state string) string {
	return c.AuthURLWithParams(state, nil)
}

// AuthURLWithParams builds the authorization-endpoint URL with additional
// query parameters merged on top of the standard parameters. Values supplied
// in params take precedence over the derived defaults (except for response_type
// which is always "code").
func (c *Client) AuthURLWithParams(state string, params map[string]string) string {
	q := url.Values{}
	q.Set("response_type", "code")
	q.Set("client_id", c.provider.ClientID)
	q.Set("redirect_uri", c.provider.RedirectURL)
	q.Set("state", state)
	if len(c.provider.Scopes) > 0 {
		q.Set("scope", strings.Join(c.provider.Scopes, " "))
	}
	for k, v := range params {
		q.Set(k, v)
	}

	sep := "?"
	if strings.Contains(c.provider.AuthURL, "?") {
		sep = "&"
	}
	return c.provider.AuthURL + sep + q.Encode()
}

// Exchange trades an authorization code for an access token.
func (c *Client) Exchange(ctx context.Context, code string) (*Token, error) {
	return c.exchangeToken(ctx, url.Values{
		"grant_type":    {"authorization_code"},
		"code":          {code},
		"redirect_uri":  {c.provider.RedirectURL},
		"client_id":     {c.provider.ClientID},
		"client_secret": {c.provider.ClientSecret},
	})
}

// Refresh exchanges a refresh token for a new access token.
func (c *Client) Refresh(ctx context.Context, refreshToken string) (*Token, error) {
	return c.exchangeToken(ctx, url.Values{
		"grant_type":    {"refresh_token"},
		"refresh_token": {refreshToken},
		"client_id":     {c.provider.ClientID},
		"client_secret": {c.provider.ClientSecret},
	})
}

// exchangeToken performs a POST to the provider token endpoint and parses the
// response into a Token. It supports both form-encoded and JSON responses.
func (c *Client) exchangeToken(ctx context.Context, form url.Values) (*Token, error) {
	body := form.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.provider.TokenURL, strings.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("oauth2: build token request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("oauth2: token request: %w", err)
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("oauth2: read token response: %w", err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("oauth2: token endpoint returned status %d: %s", resp.StatusCode, string(raw))
	}

	return parseToken(raw)
}

// parseToken parses a token response body. The body may be JSON or, for some
// providers (e.g. GitHub historically), form-encoded.
func parseToken(raw []byte) (*Token, error) {
	tok := &Token{Raw: map[string]any{}}

	// Try JSON first.
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err == nil && m != nil {
		tok.Raw = m
		if v, ok := m["access_token"].(string); ok {
			tok.AccessToken = v
		}
		if v, ok := m["refresh_token"].(string); ok {
			tok.RefreshToken = v
		}
		if v, ok := m["token_type"].(string); ok {
			tok.TokenType = v
		}
		if v, ok := m["scope"].(string); ok {
			tok.Scope = v
		}
		switch v := m["expires_in"].(type) {
		case float64:
			tok.ExpiresIn = int64(v)
		case string:
			if n, err := strconv.ParseInt(v, 10, 64); err == nil {
				tok.ExpiresIn = n
			}
		}
		if tok.ExpiresIn > 0 {
			tok.ExpiresAt = time.Now().Add(time.Duration(tok.ExpiresIn) * time.Second)
		}
		return tok, nil
	}

	// Fall back to form-encoded parsing.
	vals, err := url.ParseQuery(string(raw))
	if err != nil {
		return nil, fmt.Errorf("oauth2: parse token response: %w", err)
	}
	tok.AccessToken = vals.Get("access_token")
	tok.RefreshToken = vals.Get("refresh_token")
	tok.TokenType = vals.Get("token_type")
	tok.Scope = vals.Get("scope")
	if n, err := strconv.ParseInt(vals.Get("expires_in"), 10, 64); err == nil {
		tok.ExpiresIn = n
		tok.ExpiresAt = time.Now().Add(time.Duration(n) * time.Second)
	}
	for k := range vals {
		tok.Raw[k] = vals.Get(k)
	}
	return tok, nil
}

// GetUserInfo fetches the raw user-info payload from the provider's user-info
// endpoint as a generic map. The access token is sent as a bearer token. For
// providers that require the token as a query parameter (e.g. WeChat) the
// caller should instead use GetUser which performs provider-specific mapping.
func (c *Client) GetUserInfo(ctx context.Context, token *Token) (map[string]any, error) {
	if token == nil {
		return nil, fmt.Errorf("oauth2: token must not be nil")
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.provider.UserInfoURL, nil)
	if err != nil {
		return nil, fmt.Errorf("oauth2: build user-info request: %w", err)
	}
	if token.AccessToken != "" {
		scheme := "Bearer"
		if token.TokenType != "" {
			scheme = token.TokenType
		}
		req.Header.Set("Authorization", scheme+" "+token.AccessToken)
	}
	req.Header.Set("Accept", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("oauth2: user-info request: %w", err)
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("oauth2: read user-info response: %w", err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("oauth2: user-info endpoint returned status %d: %s", resp.StatusCode, string(raw))
	}

	var out map[string]any
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, fmt.Errorf("oauth2: parse user-info response: %w", err)
	}
	return out, nil
}

// GetUser fetches the raw user-info payload and maps it into a normalized
// UserInfo value using provider-specific field mapping rules.
func (c *Client) GetUser(ctx context.Context, token *Token) (*UserInfo, error) {
	raw, err := c.fetchUserInfoRaw(ctx, token)
	if err != nil {
		return nil, err
	}
	return c.mapUserInfo(raw), nil
}

// fetchUserInfoRaw fetches the user-info payload applying provider-specific
// transport quirks (e.g. WeChat expects openid and access_token as query
// parameters instead of a bearer header).
func (c *Client) fetchUserInfoRaw(ctx context.Context, token *Token) (map[string]any, error) {
	if token == nil {
		return nil, fmt.Errorf("oauth2: token must not be nil")
	}

	switch c.provider.Name {
	case providerWeChat:
		return c.fetchUserInfoWeChat(ctx, token)
	case providerDingTalk:
		return c.fetchUserInfoDingTalk(ctx, token)
	case providerFeishu:
		return c.fetchUserInfoFeishu(ctx, token)
	default:
		return c.GetUserInfo(ctx, token)
	}
}

// fetchUserInfoWeChat fetches WeChat user info using query parameters.
func (c *Client) fetchUserInfoWeChat(ctx context.Context, token *Token) (map[string]any, error) {
	openid := asString(token.Raw["openid"])
	u, err := url.Parse(c.provider.UserInfoURL)
	if err != nil {
		return nil, fmt.Errorf("oauth2: parse wechat user-info url: %w", err)
	}
	q := u.Query()
	q.Set("access_token", token.AccessToken)
	if openid != "" {
		q.Set("openid", openid)
	}
	u.RawQuery = q.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, fmt.Errorf("oauth2: build wechat user-info request: %w", err)
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("oauth2: wechat user-info request: %w", err)
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("oauth2: read wechat user-info response: %w", err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("oauth2: wechat user-info returned status %d: %s", resp.StatusCode, string(raw))
	}
	var out map[string]any
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, fmt.Errorf("oauth2: parse wechat user-info response: %w", err)
	}
	return out, nil
}

// fetchUserInfoDingTalk fetches DingTalk user info using a bearer token.
func (c *Client) fetchUserInfoDingTalk(ctx context.Context, token *Token) (map[string]any, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.provider.UserInfoURL, nil)
	if err != nil {
		return nil, fmt.Errorf("oauth2: build dingtalk user-info request: %w", err)
	}
	req.Header.Set("x-acs-dingtalk-access-token", token.AccessToken)
	req.Header.Set("Accept", "application/json")
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("oauth2: dingtalk user-info request: %w", err)
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("oauth2: read dingtalk user-info response: %w", err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("oauth2: dingtalk user-info returned status %d: %s", resp.StatusCode, string(raw))
	}
	var out map[string]any
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, fmt.Errorf("oauth2: parse dingtalk user-info response: %w", err)
	}
	return out, nil
}

// fetchUserInfoFeishu fetches Feishu user info using a bearer token.
func (c *Client) fetchUserInfoFeishu(ctx context.Context, token *Token) (map[string]any, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.provider.UserInfoURL, nil)
	if err != nil {
		return nil, fmt.Errorf("oauth2: build feishu user-info request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+token.AccessToken)
	req.Header.Set("Accept", "application/json")
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("oauth2: feishu user-info request: %w", err)
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("oauth2: read feishu user-info response: %w", err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("oauth2: feishu user-info returned status %d: %s", resp.StatusCode, string(raw))
	}
	var out map[string]any
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, fmt.Errorf("oauth2: parse feishu user-info response: %w", err)
	}
	return out, nil
}

// IsExpired reports whether the token has expired. A token with no ExpiresAt
// is treated as non-expiring (returns false).
func (c *Client) IsExpired(token *Token) bool {
	if token == nil {
		return true
	}
	if token.ExpiresAt.IsZero() {
		return false
	}
	return time.Now().After(token.ExpiresAt)
}

// mapUserInfo converts a provider-specific raw user-info map into a normalized
// UserInfo value.
func (c *Client) mapUserInfo(raw map[string]any) *UserInfo {
	ui := &UserInfo{
		Provider: c.provider.Name,
		Raw:      raw,
	}
	switch c.provider.Name {
	case providerGoogle:
		ui.ID = asString(raw["id"])
		ui.Name = asString(raw["name"])
		ui.Email = asString(raw["email"])
		ui.Avatar = asString(raw["picture"])
	case providerGitHub:
		ui.ID = strconv.FormatInt(asInt64(raw["id"]), 10)
		ui.Name = asString(raw["name"])
		if ui.Name == "" {
			ui.Name = asString(raw["login"])
		}
		ui.Email = asString(raw["email"])
		ui.Avatar = asString(raw["avatar_url"])
	case providerWeChat:
		ui.ID = asString(raw["openid"])
		ui.Name = asString(raw["nickname"])
		ui.Avatar = asString(raw["headimgurl"])
	case providerDingTalk:
		ui.ID = asString(raw["unionId"])
		if ui.ID == "" {
			ui.ID = asString(raw["openId"])
		}
		ui.Name = asString(raw["nick"])
		ui.Email = asString(raw["email"])
		ui.Avatar = asString(raw["avatarUrl"])
	case providerFeishu:
		ui.ID = asString(raw["open_id"])
		if ui.ID == "" {
			ui.ID = asString(raw["user_id"])
		}
		ui.Name = asString(raw["name"])
		ui.Email = asString(raw["email"])
		ui.Avatar = asString(raw["avatar_url"])
		if ui.Avatar == "" {
			ui.Avatar = asString(raw["avatar"])
		}
	default:
		ui.ID = asString(raw["id"])
		ui.Name = asString(raw["name"])
		ui.Email = asString(raw["email"])
		ui.Avatar = asString(raw["avatar"])
	}
	return ui
}

// asString returns v as a string when it is a string, otherwise the empty
// string.
func asString(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}

// asInt64 returns v as an int64 when it is a number, otherwise 0.
func asInt64(v any) int64 {
	if f, ok := v.(float64); ok {
		return int64(f)
	}
	if i, ok := v.(int64); ok {
		return i
	}
	if f, ok := v.(float32); ok {
		return int64(f)
	}
	return 0
}

// Provider name constants used for provider-specific behavior.
const (
	providerGoogle   = "google"
	providerGitHub   = "github"
	providerWeChat   = "wechat"
	providerDingTalk = "dingtalk"
	providerFeishu   = "feishu"
)

// GoogleProvider returns a Provider preconfigured for Google OAuth2.
func GoogleProvider(clientID, clientSecret, redirectURL string) *Provider {
	return &Provider{
		Name:         providerGoogle,
		AuthURL:      "https://accounts.google.com/o/oauth2/v2/auth",
		TokenURL:     "https://oauth2.googleapis.com/token",
		UserInfoURL:  "https://www.googleapis.com/oauth2/v2/userinfo",
		Scopes:       []string{"openid", "email", "profile"},
		RedirectURL:  redirectURL,
		ClientID:     clientID,
		ClientSecret: clientSecret,
	}
}

// GitHubProvider returns a Provider preconfigured for GitHub OAuth2.
func GitHubProvider(clientID, clientSecret, redirectURL string) *Provider {
	return &Provider{
		Name:         providerGitHub,
		AuthURL:      "https://github.com/login/oauth/authorize",
		TokenURL:     "https://github.com/login/oauth/access_token",
		UserInfoURL:  "https://api.github.com/user",
		Scopes:       []string{"read:user", "user:email"},
		RedirectURL:  redirectURL,
		ClientID:     clientID,
		ClientSecret: clientSecret,
	}
}

// WeChatProvider returns a Provider preconfigured for the WeChat Open Platform
// (QR-connect / 网站应用).
func WeChatProvider(clientID, clientSecret, redirectURL string) *Provider {
	return &Provider{
		Name:         providerWeChat,
		AuthURL:      "https://open.weixin.qq.com/connect/qrconnect",
		TokenURL:     "https://api.weixin.qq.com/sns/oauth2/access_token",
		UserInfoURL:  "https://api.weixin.qq.com/sns/userinfo",
		Scopes:       []string{"snsapi_login"},
		RedirectURL:  redirectURL,
		ClientID:     clientID,
		ClientSecret: clientSecret,
	}
}

// DingTalkProvider returns a Provider preconfigured for DingTalk OAuth2.
func DingTalkProvider(clientID, clientSecret, redirectURL string) *Provider {
	return &Provider{
		Name:         providerDingTalk,
		AuthURL:      "https://login.dingtalk.com/oauth2/auth",
		TokenURL:     "https://api.dingtalk.com/v1.0/oauth2/userAccessToken",
		UserInfoURL:  "https://api.dingtalk.com/v1.0/contact/users/me",
		Scopes:       []string{"openid"},
		RedirectURL:  redirectURL,
		ClientID:     clientID,
		ClientSecret: clientSecret,
	}
}

// FeishuProvider returns a Provider preconfigured for Feishu (Lark) OAuth2.
func FeishuProvider(clientID, clientSecret, redirectURL string) *Provider {
	return &Provider{
		Name:         providerFeishu,
		AuthURL:      "https://open.feishu.cn/open-apis/authen/v1/index",
		TokenURL:     "https://open.feishu.cn/open-apis/authen/v1/access_token",
		UserInfoURL:  "https://open.feishu.cn/open-apis/authen/v1/user_info",
		Scopes:       []string{"contact:user.base:readonly"},
		RedirectURL:  redirectURL,
		ClientID:     clientID,
		ClientSecret: clientSecret,
	}
}

// stateBytes is the number of random bytes used to generate a state token.
const stateBytes = 16

// GenerateState returns a cryptographically random hex-encoded state string
// suitable for use as the OAuth2 `state` parameter in CSRF protection.
func GenerateState() string {
	b := make([]byte, stateBytes)
	if _, err := rand.Read(b); err != nil {
		// rand.Read should never fail on supported platforms; fall back to
		// a time-based value to guarantee a non-empty result.
		return hex.EncodeToString([]byte(time.Now().UTC().Format("20060102150405.000000000")))
	}
	return hex.EncodeToString(b)
}

// ValidateState reports whether the state returned by the provider matches the
// expected value. Both arguments must be non-empty and exactly equal.
func ValidateState(state, expected string) bool {
	if state == "" || expected == "" {
		return false
	}
	return state == expected
}
