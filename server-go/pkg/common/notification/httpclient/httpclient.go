// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package httpclient provides a small, reusable HTTP helper layer shared by
// the notification push and sms provider packages. It centralises the
// boilerplate of building requests, applying headers / basic auth, executing
// them with a shared *http.Client and normalising error messages behind a
// configurable prefix (e.g. "push:" or "sms:").
//
// The Client type is safe for concurrent use: the underlying *http.Client is
// not mutated after construction.
package httpclient

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// defaultTimeout is the overall timeout applied to a request when the caller
// has not configured a custom *http.Client or Timeout.
const defaultTimeout = 30 * time.Second

// Client executes HTTP requests on behalf of a notification provider package.
// Prefix is prepended to every error message (e.g. "push:" or "sms:") so that
// callers can tell which provider produced a given error.
type Client struct {
	// Prefix is prepended to error messages, e.g. "push:" or "sms:".
	// It should include the trailing colon when non-empty.
	Prefix string

	// HTTPClient is used to execute requests. When nil a default client with
	// a 30s timeout is used. Per-request deadlines are still honoured via the
	// request context.
	HTTPClient *http.Client
}

// Option configures a Client at construction time.
type Option func(*Client)

// WithHTTPClient sets the underlying *http.Client.
func WithHTTPClient(h *http.Client) Option {
	return func(c *Client) { c.HTTPClient = h }
}

// WithTimeout sets the timeout on the default *http.Client. It has no effect
// when WithHTTPClient is also supplied.
func WithTimeout(d time.Duration) Option {
	return func(c *Client) {
		if d > 0 {
			c.HTTPClient = &http.Client{Timeout: d}
		}
	}
}

// New returns a Client configured with prefix and the given options.
func New(prefix string, opts ...Option) *Client {
	c := &Client{Prefix: prefix}
	for _, opt := range opts {
		opt(c)
	}
	return c
}

// client returns the *http.Client to use, falling back to a default.
func (c *Client) client() *http.Client {
	if c.HTTPClient != nil {
		return c.HTTPClient
	}
	return &http.Client{Timeout: defaultTimeout}
}

// errf formats an error message with the configured prefix. When the prefix
// is empty the message is returned verbatim (no leading space).
func (c *Client) errf(format string, args ...any) error {
	if c.Prefix == "" {
		return fmt.Errorf(format, args...)
	}
	return fmt.Errorf("%s "+format, append([]any{c.Prefix}, args...)...)
}

// PostForm sends an application/x-www-form-urlencoded POST request.
// When basicUser is non-empty HTTP Basic Auth is applied. The response
// body is returned in full.
func (c *Client) PostForm(ctx context.Context, endpoint string, form url.Values, headers map[string]string, basicUser, basicPass string) ([]byte, error) {
	if endpoint == "" {
		return nil, c.errf("empty endpoint")
	}
	var body io.Reader
	if form != nil {
		body = strings.NewReader(form.Encode())
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, body)
	if err != nil {
		return nil, c.errf("build request: %w", err)
	}
	if form != nil {
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	}
	applyHeaders(req, headers)
	applyBasicAuth(req, basicUser, basicPass)
	return c.doRequest(req)
}

// PostJSON sends a JSON POST request. body may be nil for an empty body.
func (c *Client) PostJSON(ctx context.Context, endpoint string, body []byte, headers map[string]string, basicUser, basicPass string) ([]byte, error) {
	if endpoint == "" {
		return nil, c.errf("empty endpoint")
	}
	var r io.Reader
	if body != nil {
		r = bytes.NewReader(body)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, r)
	if err != nil {
		return nil, c.errf("build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	applyHeaders(req, headers)
	applyBasicAuth(req, basicUser, basicPass)
	return c.doRequest(req)
}

// GetURL sends a GET request and returns the response body.
func (c *Client) GetURL(ctx context.Context, endpoint string, headers map[string]string, basicUser, basicPass string) ([]byte, error) {
	if endpoint == "" {
		return nil, c.errf("empty endpoint")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, c.errf("build request: %w", err)
	}
	applyHeaders(req, headers)
	applyBasicAuth(req, basicUser, basicPass)
	return c.doRequest(req)
}

// applyHeaders copies the given headers onto the request.
func applyHeaders(req *http.Request, headers map[string]string) {
	for k, v := range headers {
		req.Header.Set(k, v)
	}
}

// applyBasicAuth sets Basic Auth when a username is provided.
func applyBasicAuth(req *http.Request, basicUser, basicPass string) {
	if basicUser != "" {
		req.SetBasicAuth(basicUser, basicPass)
	}
}

// doRequest executes the request using the shared client (which honours
// the request context deadline) and returns the full response body. A
// non-2xx status produces an error containing the status and body.
func (c *Client) doRequest(req *http.Request) ([]byte, error) {
	if err := req.Context().Err(); err != nil {
		return nil, err
	}
	resp, err := c.client().Do(req)
	if err != nil {
		return nil, c.errf("http request: %w", err)
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, c.errf("read response: %w", err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return data, c.errf("unexpected status %d: %s", resp.StatusCode, Truncate(string(data), 200))
	}
	return data, nil
}

// ──────────────────────────────────────────────
// Raw HTTP helpers — return (statusCode, body, error)
// These are used by providers that need to inspect non-2xx response bodies
// to extract provider-specific error messages.
// ──────────────────────────────────────────────

// PostFormRaw sends a form POST and returns the HTTP status code, body, and
// transport error (nil for any HTTP status). The caller is responsible for
// checking the status code.
func (c *Client) PostFormRaw(ctx context.Context, endpoint string, form url.Values, headers map[string]string, basicUser, basicPass string) (int, []byte, error) {
	if endpoint == "" {
		return 0, nil, c.errf("empty endpoint")
	}
	var body io.Reader
	if form != nil {
		body = strings.NewReader(form.Encode())
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, body)
	if err != nil {
		return 0, nil, c.errf("build request: %w", err)
	}
	if form != nil {
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	}
	applyHeaders(req, headers)
	applyBasicAuth(req, basicUser, basicPass)
	return c.doRequestRaw(req)
}

// PostJSONRaw sends a JSON POST and returns the HTTP status code, body, and
// transport error (nil for any HTTP status).
func (c *Client) PostJSONRaw(ctx context.Context, endpoint string, jsonBody []byte, headers map[string]string, basicUser, basicPass string) (int, []byte, error) {
	if endpoint == "" {
		return 0, nil, c.errf("empty endpoint")
	}
	var r io.Reader
	if jsonBody != nil {
		r = bytes.NewReader(jsonBody)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, r)
	if err != nil {
		return 0, nil, c.errf("build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	applyHeaders(req, headers)
	applyBasicAuth(req, basicUser, basicPass)
	return c.doRequestRaw(req)
}

// GetURLRaw sends a GET and returns the HTTP status code, body, and
// transport error (nil for any HTTP status).
func (c *Client) GetURLRaw(ctx context.Context, endpoint string, headers map[string]string, basicUser, basicPass string) (int, []byte, error) {
	if endpoint == "" {
		return 0, nil, c.errf("empty endpoint")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return 0, nil, c.errf("build request: %w", err)
	}
	applyHeaders(req, headers)
	applyBasicAuth(req, basicUser, basicPass)
	return c.doRequestRaw(req)
}

// doRequestRaw executes the request and returns (statusCode, body, error).
// The error is only for transport-level failures, not HTTP error codes.
func (c *Client) doRequestRaw(req *http.Request) (int, []byte, error) {
	if err := req.Context().Err(); err != nil {
		return 0, nil, err
	}
	resp, err := c.client().Do(req)
	if err != nil {
		return 0, nil, c.errf("http request: %w", err)
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return resp.StatusCode, nil, c.errf("read response: %w", err)
	}
	return resp.StatusCode, data, nil
}

// ──────────────────────────────────────────────
// Shared utility helpers
// ──────────────────────────────────────────────

// Truncate limits s to at most n characters for inclusion in error msgs.
func Truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "..."
}

// Is2xx reports whether code is in the 200–299 range.
func Is2xx(code int) bool { return code >= 200 && code < 300 }

// NowUnix returns the current Unix timestamp.
func NowUnix() int64 { return time.Now().Unix() }

// TruncateRaw limits s to max characters, appending "…" when truncated.
func TruncateRaw(s string, max int) string {
	s = strings.TrimSpace(s)
	if max <= 0 || len(s) <= max {
		return s
	}
	return s[:max] + "…"
}

// JSONStringAny marshals v to a JSON string, returning "" on error.
func JSONStringAny(v any) string {
	b, err := json.Marshal(v)
	if err != nil {
		return ""
	}
	return string(b)
}

// CtxOrBackground returns ctx when non-nil, otherwise context.Background.
func CtxOrBackground(ctx context.Context) context.Context {
	if ctx == nil {
		return context.Background()
	}
	return ctx
}
