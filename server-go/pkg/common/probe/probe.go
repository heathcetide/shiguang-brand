// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package probe provides a synthetic HTTP probe executor for active
// API monitoring. It sends configured HTTP requests to target endpoints,
// validates responses against configurable rules (status code, body
// contains/doesn't-contain, custom validator), and returns structured
// results suitable for logging, alerting, and metrics collection.
//
// # Quick start
//
//	p := probe.New()
//	result := p.Execute(ctx, probe.Request{
//	    URL:    "https://api.example.com/health",
//	    Method: http.MethodGet,
//	    Expect: probe.Expect{StatusCode: 200, BodyContains: "ok"},
//	    Timeout: 5 * time.Second,
//	})
//	if result.Success {
//	    fmt.Printf("OK: %dms\n", result.Duration.Milliseconds())
//	} else {
//	    fmt.Printf("FAIL: %s (%s)\n", result.Error, result.Duration)
//	}
//
// # Sequence probing
//
// For multi-step API flows (login → fetch → logout) with variable
// pass-through and cookie continuity, use [Sequence].
package probe

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// ──────────────────────────────────────────────
// Errors
// ──────────────────────────────────────────────

var (
	// ErrEmptyURL is returned when the probe URL is empty.
	ErrEmptyURL = fmt.Errorf("probe: url must not be empty")
	// ErrUnsupportedMethod is returned for unsupported HTTP methods.
	ErrUnsupportedMethod = fmt.Errorf("probe: unsupported HTTP method")
)

// ──────────────────────────────────────────────
// Request
// ──────────────────────────────────────────────

// Request describes a single HTTP probe.
type Request struct {
	// URL is the target URL. Required.
	URL string

	// Method is the HTTP method. Defaults to GET.
	Method string

	// Headers are optional request headers.
	Headers map[string]string

	// Params are optional URL query parameters.
	Params map[string]string

	// Body is the optional request body (for POST/PUT/PATCH).
	// If BodyJSON is also set, Body takes precedence.
	Body string

	// BodyJSON is an optional JSON-serializable body.
	BodyJSON any

	// ContentType overrides the Content-Type header.
	ContentType string

	// Timeout is the per-request timeout. Default 30s.
	Timeout time.Duration

	// Expect defines the response validation rules.
	Expect Expect

	// SkipTLSVerify disables TLS certificate verification.
	// Useful for self-signed certs in internal environments.
	SkipTLSVerify bool

	// Variables is an optional map for variable substitution.
	// Values in URL, headers, params, and body that match
	// "$${key}" will be replaced with the corresponding value.
	Variables map[string]string
}

// Expect defines response validation rules. All specified rules
// must pass for the probe to be considered successful.
type Expect struct {
	// StatusCode is the expected HTTP status code. 0 means any 2xx.
	StatusCode int

	// BodyContains requires the response body to contain this substring.
	BodyContains string

	// BodyNotContains requires the response body to NOT contain this.
	BodyNotContains string

	// BodyJSONPath extracts a value from JSON response body using
	// a simple dot-notation path (e.g. "status.code"). The extracted
	// value is stored in Result.Extracted under the path key.
	// This is a lightweight alternative to full JSONPath.
	BodyJSONPath string

	// Validator is a custom validation function. If non-nil, it is
	// called after the built-in checks. Returning an error marks
	// the probe as failed.
	Validator func(statusCode int, body []byte) error
}

// ──────────────────────────────────────────────
// Result
// ──────────────────────────────────────────────

// Result holds the outcome of a probe execution.
type Result struct {
	// Success is true if all validation rules passed.
	Success bool

	// StatusCode is the HTTP response status code (0 on transport error).
	StatusCode int

	// Body is the response body (may be truncated for large responses).
	Body string

	// Duration is the total request + validation time.
	Duration time.Duration

	// Error is the failure message (empty on success).
	Error string

	// Extracted holds values extracted from the response body
	// (e.g. via BodyJSONPath).
	Extracted map[string]string

	// Timestamp is when the probe was executed.
	Timestamp time.Time
}

// ──────────────────────────────────────────────
// Prober
// ──────────────────────────────────────────────

// Prober executes HTTP probes. The zero value is NOT ready to use;
// call [New] to create one.
type Prober struct {
	client    *http.Client
	maxBody   int64
	userAgent string
}

// Option configures a [Prober].
type Option func(*Prober)

// WithMaxBodySize sets the maximum response body size to read.
// Default: 1 MB. Bodies larger than this are truncated.
func WithMaxBodySize(n int64) Option {
	return func(p *Prober) { p.maxBody = n }
}

// WithUserAgent sets the User-Agent header for all probes.
func WithUserAgent(ua string) Option {
	return func(p *Prober) { p.userAgent = ua }
}

// WithHTTPClient sets a custom *http.Client.
func WithHTTPClient(c *http.Client) Option {
	return func(p *Prober) { p.client = c }
}

// New creates a Prober with sensible defaults.
func New(opts ...Option) *Prober {
	p := &Prober{
		maxBody:   1 << 20, // 1 MB
		userAgent: "ling-base/probe",
	}
	for _, opt := range opts {
		if opt != nil {
			opt(p)
		}
	}
	if p.client == nil {
		p.client = &http.Client{
			Timeout: 30 * time.Second,
			Transport: &http.Transport{
				TLSClientConfig: &tls.Config{
					InsecureSkipVerify: false,
				},
			},
		}
	}
	return p
}

// Execute runs a single HTTP probe and returns the result.
func (p *Prober) Execute(ctx context.Context, req Request) Result {
	result := Result{Timestamp: time.Now()}
	if req.URL == "" {
		result.Error = ErrEmptyURL.Error()
		return result
	}
	if req.Method == "" {
		req.Method = http.MethodGet
	}
	if req.Timeout == 0 {
		req.Timeout = 30 * time.Second
	}

	// Apply variable substitution.
	req.URL = substituteVars(req.URL, req.Variables)
	for k, v := range req.Headers {
		req.Headers[k] = substituteVars(v, req.Variables)
	}
	for k, v := range req.Params {
		req.Params[k] = substituteVars(v, req.Variables)
	}
	req.Body = substituteVars(req.Body, req.Variables)

	start := time.Now()
	defer func() {
		result.Duration = time.Since(start)
	}()

	// Build request with timeout context.
	probeCtx, cancel := context.WithTimeout(ctx, req.Timeout)
	defer cancel()

	httpReq, err := p.buildRequest(probeCtx, req)
	if err != nil {
		result.Error = fmt.Sprintf("build request: %v", err)
		return result
	}

	// Use a per-request client if SkipTLSVerify is set.
	client := p.client
	if req.SkipTLSVerify {
		client = &http.Client{
			Timeout:   req.Timeout,
			Transport: &http.Transport{TLSClientConfig: &tls.Config{InsecureSkipVerify: true}},
		}
	}

	resp, err := client.Do(httpReq)
	if err != nil {
		result.Error = fmt.Sprintf("send request: %v", err)
		return result
	}
	defer resp.Body.Close()

	result.StatusCode = resp.StatusCode

	// Read body (limited).
	body, err := io.ReadAll(io.LimitReader(resp.Body, p.maxBody))
	if err != nil {
		result.Error = fmt.Sprintf("read body: %v", err)
		return result
	}
	result.Body = string(body)

	// Validate.
	if err := p.validate(resp.StatusCode, body, req.Expect, &result); err != nil {
		result.Error = err.Error()
		return result
	}

	result.Success = true
	return result
}

// ──────────────────────────────────────────────
// Request building
// ──────────────────────────────────────────────

func (p *Prober) buildRequest(ctx context.Context, req Request) (*http.Request, error) {
	// Build URL with query params.
	parsedURL, err := url.Parse(req.URL)
	if err != nil {
		return nil, fmt.Errorf("parse url: %w", err)
	}
	if len(req.Params) > 0 {
		q := parsedURL.Query()
		for k, v := range req.Params {
			q.Set(k, v)
		}
		parsedURL.RawQuery = q.Encode()
	}

	var bodyReader io.Reader
	if req.Body != "" {
		bodyReader = strings.NewReader(req.Body)
	} else if req.BodyJSON != nil {
		b, err := json.Marshal(req.BodyJSON)
		if err != nil {
			return nil, fmt.Errorf("marshal body json: %w", err)
		}
		bodyReader = bytes.NewReader(b)
		if req.ContentType == "" {
			req.ContentType = "application/json"
		}
	}

	httpReq, err := http.NewRequestWithContext(ctx, req.Method, parsedURL.String(), bodyReader)
	if err != nil {
		return nil, fmt.Errorf("new request: %w", err)
	}

	// Set headers.
	for k, v := range req.Headers {
		httpReq.Header.Set(k, v)
	}
	if req.ContentType != "" {
		httpReq.Header.Set("Content-Type", req.ContentType)
	}
	if p.userAgent != "" && httpReq.Header.Get("User-Agent") == "" {
		httpReq.Header.Set("User-Agent", p.userAgent)
	}

	return httpReq, nil
}

// ──────────────────────────────────────────────
// Validation
// ──────────────────────────────────────────────

func (p *Prober) validate(statusCode int, body []byte, expect Expect, result *Result) error {
	// Status code check.
	if expect.StatusCode != 0 {
		if statusCode != expect.StatusCode {
			return fmt.Errorf("status code %d, expected %d", statusCode, expect.StatusCode)
		}
	} else if statusCode < 200 || statusCode >= 300 {
		return fmt.Errorf("status code %d is not 2xx", statusCode)
	}

	// Body contains check.
	if expect.BodyContains != "" {
		if !bytes.Contains(body, []byte(expect.BodyContains)) {
			return fmt.Errorf("body does not contain %q", expect.BodyContains)
		}
	}

	// Body not-contains check.
	if expect.BodyNotContains != "" {
		if bytes.Contains(body, []byte(expect.BodyNotContains)) {
			return fmt.Errorf("body contains %q (expected not to)", expect.BodyNotContains)
		}
	}

	// JSON path extraction.
	if expect.BodyJSONPath != "" {
		val, err := extractJSONPath(body, expect.BodyJSONPath)
		if err != nil {
			return fmt.Errorf("json path %q: %w", expect.BodyJSONPath, err)
		}
		if result.Extracted == nil {
			result.Extracted = make(map[string]string)
		}
		result.Extracted[expect.BodyJSONPath] = val
	}

	// Custom validator.
	if expect.Validator != nil {
		if err := expect.Validator(statusCode, body); err != nil {
			return fmt.Errorf("validator: %w", err)
		}
	}

	return nil
}

// ──────────────────────────────────────────────
// Variable substitution
// ──────────────────────────────────────────────

// substituteVars replaces "$${key}" patterns in s with values from vars.
func substituteVars(s string, vars map[string]string) string {
	if vars == nil || !strings.Contains(s, "$$") {
		return s
	}
	for k, v := range vars {
		s = strings.ReplaceAll(s, "$${"+k+"}", v)
	}
	return s
}

// ──────────────────────────────────────────────
// JSON path extraction (lightweight)
// ──────────────────────────────────────────────

// extractJSONPath extracts a value from a JSON body using dot-notation
// (e.g. "status.code", "data.0.name"). This is a lightweight alternative
// to full JSONPath; it does not support filters or wildcards.
func extractJSONPath(body []byte, path string) (string, error) {
	var data any
	if err := json.Unmarshal(body, &data); err != nil {
		return "", fmt.Errorf("unmarshal json: %w", err)
	}

	parts := strings.Split(path, ".")
	current := data
	for _, part := range parts {
		switch v := current.(type) {
		case map[string]any:
			next, ok := v[part]
			if !ok {
				return "", fmt.Errorf("key %q not found", part)
			}
			current = next
		case []any:
			// Numeric index.
			var idx int
			if _, err := fmt.Sscanf(part, "%d", &idx); err != nil {
				return "", fmt.Errorf("expected numeric index, got %q", part)
			}
			if idx < 0 || idx >= len(v) {
				return "", fmt.Errorf("index %d out of range", idx)
			}
			current = v[idx]
		default:
			return "", fmt.Errorf("cannot traverse %q on non-container", part)
		}
	}

	switch v := current.(type) {
	case string:
		return v, nil
	case float64:
		return fmt.Sprintf("%v", v), nil
	case bool:
		return fmt.Sprintf("%v", v), nil
	case nil:
		return "", nil
	default:
		b, _ := json.Marshal(v)
		return string(b), nil
	}
}
