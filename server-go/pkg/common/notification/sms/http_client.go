// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package sms

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"strings"

	httpclient "github.com/heathcetide/DietDigiDose/pkg/common/notification/httpclient"
)

// defaultClient is the shared HTTP client used by all helpers in this
// package. It relies on the per-request context for timeouts and tags
// every error with the "sms:" prefix.
var defaultClient = httpclient.New("sms:")

// errProviderRejected is returned (wrapped) when a provider API rejects
// the request with a non-success code.
var errProviderRejected = errors.New("sms: provider rejected")

// PostForm sends an application/x-www-form-urlencoded POST request.
// When basicUser is non-empty HTTP Basic Auth is applied. The response
// body is returned in full.
func PostForm(ctx context.Context, endpoint string, form url.Values, headers map[string]string, basicUser, basicPass string) ([]byte, error) {
	return defaultClient.PostForm(ctx, endpoint, form, headers, basicUser, basicPass)
}

// PostJSON sends a JSON POST request. body may be nil for an empty body.
func PostJSON(ctx context.Context, endpoint string, body []byte, headers map[string]string, basicUser, basicPass string) ([]byte, error) {
	return defaultClient.PostJSON(ctx, endpoint, body, headers, basicUser, basicPass)
}

// GetURL sends a GET request and returns the response body.
func GetURL(ctx context.Context, endpoint string, headers map[string]string, basicUser, basicPass string) ([]byte, error) {
	return defaultClient.GetURL(ctx, endpoint, headers, basicUser, basicPass)
}

// truncate limits s to at most n characters for inclusion in error msgs.
// Kept as a thin wrapper around httpclient.Truncate for backwards
// compatibility with internal callers and tests.
func truncate(s string, n int) string {
	return httpclient.Truncate(s, n)
}

// ──────────────────────────────────────────────
// Raw HTTP helpers — return (statusCode, body, error)
// These are used by providers that need to inspect non-2xx response bodies
// to extract provider-specific error messages.
// ──────────────────────────────────────────────

// PostFormRaw sends a form POST and returns the HTTP status code, body, and
// transport error (nil for any HTTP status). The caller is responsible for
// checking the status code.
func PostFormRaw(ctx context.Context, endpoint string, form url.Values, headers map[string]string, basicUser, basicPass string) (int, []byte, error) {
	return defaultClient.PostFormRaw(ctx, endpoint, form, headers, basicUser, basicPass)
}

// PostJSONRaw sends a JSON POST and returns the HTTP status code, body, and
// transport error (nil for any HTTP status).
func PostJSONRaw(ctx context.Context, endpoint string, jsonBody []byte, headers map[string]string, basicUser, basicPass string) (int, []byte, error) {
	return defaultClient.PostJSONRaw(ctx, endpoint, jsonBody, headers, basicUser, basicPass)
}

// GetURLRaw sends a GET and returns the HTTP status code, body, and
// transport error (nil for any HTTP status).
func GetURLRaw(ctx context.Context, endpoint string, headers map[string]string, basicUser, basicPass string) (int, []byte, error) {
	return defaultClient.GetURLRaw(ctx, endpoint, headers, basicUser, basicPass)
}

// ──────────────────────────────────────────────
// Shared utility helpers
// ──────────────────────────────────────────────

// Is2xx reports whether code is in the 200–299 range.
func Is2xx(code int) bool { return httpclient.Is2xx(code) }

// NowUnix returns the current Unix timestamp.
func NowUnix() int64 { return httpclient.NowUnix() }

// TruncateRaw limits s to max characters, appending "…" when truncated.
func TruncateRaw(s string, max int) string {
	return httpclient.TruncateRaw(s, max)
}

// JSONStringAny marshals v to a JSON string, returning "" on error.
func JSONStringAny(v any) string {
	return httpclient.JSONStringAny(v)
}

// CtxOrBackground returns ctx when non-nil, otherwise context.Background.
func CtxOrBackground(ctx context.Context) context.Context {
	return httpclient.CtxOrBackground(ctx)
}

// FirstRecipientStr returns the first recipient's phone number string
// (without the "+" prefix). Returns an error when there are no recipients.
func FirstRecipientStr(req SendRequest) (string, error) {
	if len(req.To) == 0 {
		return "", fmt.Errorf("sms: no recipients")
	}
	n := strings.TrimSpace(req.To[0].Number)
	if n == "" {
		return "", fmt.Errorf("sms: first recipient has empty number")
	}
	return n, nil
}
