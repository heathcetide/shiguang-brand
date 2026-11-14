// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package im

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

// WeComProvider sends messages to a WeCom (企业微信) group robot via
// its webhook API. It supports both "text" and "markdown" message
// types; the type is chosen automatically from the content's format.
type WeComProvider struct {
	cfg WeComConfig
}

// NewWeComProvider constructs a WeComProvider from the given config.
func NewWeComProvider(cfg WeComConfig) *WeComProvider {
	return &WeComProvider{cfg: cfg}
}

// Kind returns "wecom".
func (p *WeComProvider) Kind() string { return ProviderWeCom }

// isMarkdown reports whether content looks like markdown. We treat
// content that starts with a heading marker ("#") or contains common
// markdown constructs as markdown.
func isMarkdown(content string) bool {
	trimmed := strings.TrimSpace(content)
	if trimmed == "" {
		return false
	}
	if strings.HasPrefix(trimmed, "#") {
		return true
	}
	markers := []string{"**", "`", "- ", "* ", "1. ", "\n- ", "\n* ", "![", "[", "]("}
	for _, m := range markers {
		if strings.Contains(content, m) {
			return true
		}
	}
	return false
}

// Send delivers msg to the configured WeCom webhook. If the content
// looks like markdown the "markdown" msgtype is used, otherwise
// "text". An empty WebhookURL results in an error.
func (p *WeComProvider) Send(ctx context.Context, msg Message) error {
	if p.cfg.WebhookURL == "" {
		return fmt.Errorf("im/wecom: webhook url is empty")
	}

	body := msg.Title + "\n" + msg.Content

	var payload map[string]any
	if isMarkdown(msg.Content) {
		payload = map[string]any{
			"msgtype": "markdown",
			"markdown": map[string]any{
				"content": body,
			},
		}
	} else {
		payload = map[string]any{
			"msgtype": "text",
			"text": map[string]any{
				"content": body,
			},
		}
	}

	return postJSON(ctx, p.cfg.WebhookURL, payload)
}

// postJSON encodes payload as JSON and POSTs it to url, returning any
// error. The response body is read and discarded; a non-2xx status
// produces an error containing the status code.
func postJSON(ctx context.Context, url string, payload any) error {
	data, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("im: marshal payload: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(data))
	if err != nil {
		return fmt.Errorf("im: new request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("im: send request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("im: unexpected status %d: %s", resp.StatusCode, strings.TrimSpace(string(respBody)))
	}
	return nil
}
