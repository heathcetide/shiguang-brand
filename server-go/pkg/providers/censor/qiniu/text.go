// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package qiniu

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"

	"github.com/heathcetide/DietDigiDose/pkg/providers/censor"
	"github.com/qiniu/go-sdk/v7/auth"
)

const textEndpoint = "/v3/text/censor"
const textScenes = "antispam"

type textRequest struct {
	Data   textData   `json:"data"`
	Params textParams `json:"params"`
}

type textData struct {
	Text string `json:"text"`
}

type textParams struct {
	Scenes []string `json:"scenes"`
}

type textResponse struct {
	Code    int         `json:"code"`
	Message string      `json:"message"`
	Result  *textResult `json:"result,omitempty"`
}

type textResult struct {
	Suggestion string               `json:"suggestion"`
	Scenes     map[string]textScene `json:"scenes,omitempty"`
}

type textScene struct {
	Suggestion string       `json:"suggestion"`
	Details    []textDetail `json:"details,omitempty"`
}

type textDetail struct {
	Label       string  `json:"label"`
	Score       float64 `json:"score"`
	Description string  `json:"description"`
}

// TextCensor performs text content moderation via Qiniu.
type TextCensor struct {
	mac    *auth.Credentials
	host   string
	client *http.Client
}

// NewTextCensor creates a Qiniu text moderation client.
func NewTextCensor(cfg Config) (*TextCensor, error) {
	mac, err := newMAC(cfg)
	if err != nil {
		return nil, err
	}
	return &TextCensor{
		mac:    mac,
		host:   defaultHost(cfg.Host),
		client: defaultClient(cfg.Client),
	}, nil
}

// CensorText performs text content moderation via Qiniu.
func (c *TextCensor) CensorText(ctx context.Context, text string) (*censor.CensorResult, error) {
	reqBody := textRequest{
		Data:   textData{Text: text},
		Params: textParams{Scenes: []string{textScenes}},
	}
	bodyJSON, err := json.Marshal(reqBody)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal request: %w", err)
	}

	url := fmt.Sprintf("https://%s%s", c.host, textEndpoint)
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(bodyJSON))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")

	if err := c.mac.AddToken(auth.TokenQiniu, httpReq); err != nil {
		return nil, fmt.Errorf("failed to sign request: %w", err)
	}

	resp, err := c.client.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("failed to send request: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("HTTP %d: %s", resp.StatusCode, string(respBody))
	}

	var censorResp textResponse
	if err := json.Unmarshal(respBody, &censorResp); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}

	result := &censor.CensorResult{}
	if censorResp.Result != nil {
		result.Suggestion = censorResp.Result.Suggestion
		if scene, ok := censorResp.Result.Scenes[textScenes]; ok && len(scene.Details) > 0 {
			d := scene.Details[0]
			result.Label = d.Label
			result.Score = d.Score
			if d.Description != "" {
				result.Details = d.Description
			}
		}
	}
	result.Msg = censor.BuildCensorMsg(result.Label)
	return result, nil
}
