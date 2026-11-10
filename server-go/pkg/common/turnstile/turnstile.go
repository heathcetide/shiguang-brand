// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package turnstile provides a client for verifying Cloudflare Turnstile
// tokens on the server side and rendering the Turnstile widget HTML.
//
// It uses only the Go standard library (net/http + encoding/json).
//
// # Quick start
//
//	client := turnstile.NewClient("0xsecret", "0xsitekey")
//	resp, err := client.VerifyRequest(r, "cf-turnstile-response")
//	if err != nil { ... }
//	if !resp.Success { /* challenge failed */ }
package turnstile

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// TurnstileEndpoint is the Cloudflare siteverify API endpoint.
const TurnstileEndpoint = "https://challenges.cloudflare.com/turnstile/v0/siteverify"

// ScriptURL is the URL of the Turnstile client-side JavaScript.
const ScriptURL = "https://challenges.cloudflare.com/turnstile/v0/api.js"

// ──────────────────────────────────────────────
// Response
// ──────────────────────────────────────────────

// Response represents the response from the Turnstile siteverify endpoint.
type Response struct {
	// Success indicates whether the challenge was passed.
	Success bool `json:"success"`
	// ErrorCodes is the list of error codes if the challenge failed.
	ErrorCodes []string `json:"error-codes"`
	// Action is the action name configured in the widget.
	Action string `json:"action,omitempty"`
	// ChallengeTS is the ISO timestamp of the challenge.
	ChallengeTS string `json:"challenge_ts,omitempty"`
	// Hostname is the hostname of the site where the challenge was solved.
	Hostname string `json:"hostname,omitempty"`
	// Metadata contains additional information about the challenge.
	Metadata map[string]any `json:"metadata,omitempty"`
}

// ──────────────────────────────────────────────
// Client
// ──────────────────────────────────────────────

// Client verifies Turnstile tokens and renders widget HTML.
type Client struct {
	secretKey   string
	siteKey     string
	httpClient  *http.Client
	endpoint    string
}

// NewClient creates a new Turnstile client.
func NewClient(secretKey, siteKey string) *Client {
	return &Client{
		secretKey:  secretKey,
		siteKey:    siteKey,
		httpClient: &http.Client{Timeout: 30 * time.Second},
		endpoint:   TurnstileEndpoint,
	}
}

// WithHTTPClient sets a custom HTTP client.
func (c *Client) WithHTTPClient(hc *http.Client) *Client {
	c.httpClient = hc
	return c
}

// WithEndpoint sets a custom siteverify endpoint (useful for testing).
func (c *Client) WithEndpoint(endpoint string) *Client {
	c.endpoint = endpoint
	return c
}

// Verify verifies a Turnstile token with the Cloudflare API.
func (c *Client) Verify(ctx context.Context, token string, remoteIP string) (*Response, error) {
	if !IsTokenValid(token) {
		return nil, fmt.Errorf("turnstile: invalid token")
	}

	form := url.Values{}
	form.Set("secret", c.secretKey)
	form.Set("response", token)
	if remoteIP != "" {
		form.Set("remoteip", remoteIP)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.endpoint, strings.NewReader(form.Encode()))
	if err != nil {
		return nil, fmt.Errorf("turnstile: create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("turnstile: verify request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("turnstile: unexpected status %d", resp.StatusCode)
	}

	var result Response
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("turnstile: decode response: %w", err)
	}
	return &result, nil
}

// VerifyRequest extracts the token from an HTTP request and verifies it.
func (c *Client) VerifyRequest(ctx context.Context, r *http.Request, fieldName string) (*Response, error) {
	token := r.FormValue(fieldName)
	if token == "" {
		token = r.Header.Get("cf-turnstile-response")
	}
	remoteIP := r.RemoteAddr
	// Strip port if present (handles both IPv4 and IPv6 [::1]:port).
	if host, _, err := net.SplitHostPort(remoteIP); err == nil {
		remoteIP = host
	}
	return c.Verify(ctx, token, remoteIP)
}

// RenderHTML generates the Turnstile widget HTML.
func (c *Client) RenderHTML() string {
	return fmt.Sprintf(`<script src="%s" async defer></script>`+"\n"+
		`<div class="cf-turnstile" data-sitekey="%s"></div>`, ScriptURL, c.siteKey)
}

// RenderHTMLWithCallback generates the Turnstile widget HTML with a
// JavaScript callback function name.
func (c *Client) RenderHTMLWithCallback(callback string) string {
	return fmt.Sprintf(`<script src="%s" async defer></script>`+"\n"+
		`<div class="cf-turnstile" data-sitekey="%s" data-callback="%s"></div>`,
		ScriptURL, c.siteKey, callback)
}

// IsTokenValid performs a basic format check on the token (non-empty and
// reasonable length).
func IsTokenValid(token string) bool {
	if token == "" {
		return false
	}
	// Turnstile tokens are typically long (hundreds of characters).
	if len(token) < 10 {
		return false
	}
	if len(token) > 4096 {
		return false
	}
	return true
}
