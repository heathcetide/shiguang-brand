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

const imageEndpoint = "/v3/image/censor"

var imageDefaultScenes = []string{"pulp", "terror", "politician", "ads", "behavior"}

type imageRequest struct {
	Data   imageData   `json:"data"`
	Params imageParams `json:"params,omitempty"`
}

type imageData struct {
	URI string `json:"uri"`
}

type imageParams struct {
	Scenes []string `json:"scenes"`
}

type imageResponse struct {
	Code    int          `json:"code"`
	Message string       `json:"message,omitempty"`
	Result  *imageResult `json:"result,omitempty"`
}

type imageResult struct {
	Suggestion string                `json:"suggestion"`
	Scenes     map[string]imageScene `json:"scenes,omitempty"`
}

type imageScene struct {
	Suggestion string  `json:"suggestion"`
	Label      string  `json:"label"`
	Score      float64 `json:"score"`
}

// ImageCensor performs image content moderation via Qiniu.
type ImageCensor struct {
	mac    *auth.Credentials
	host   string
	client *http.Client
}

// NewImageCensor creates a Qiniu image moderation client.
func NewImageCensor(cfg Config) (*ImageCensor, error) {
	mac, err := newMAC(cfg)
	if err != nil {
		return nil, err
	}
	return &ImageCensor{
		mac:    mac,
		host:   defaultHost(cfg.Host),
		client: defaultClient(cfg.Client),
	}, nil
}

// CensorImage performs image content moderation via Qiniu.
func (c *ImageCensor) CensorImage(ctx context.Context, imageURL string) (*censor.CensorResult, error) {
	if imageURL == "" {
		return nil, fmt.Errorf("imageURL cannot be empty")
	}

	reqBody := imageRequest{
		Data:   imageData{URI: imageURL},
		Params: imageParams{Scenes: imageDefaultScenes},
	}
	bodyJSON, err := json.Marshal(reqBody)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal request: %w", err)
	}

	url := fmt.Sprintf("https://%s%s", c.host, imageEndpoint)
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

	var censorResp imageResponse
	if err := json.Unmarshal(respBody, &censorResp); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}

	result := &censor.CensorResult{}
	if censorResp.Result != nil {
		result.Suggestion = censorResp.Result.Suggestion
		for _, scene := range censorResp.Result.Scenes {
			if scene.Label != "" {
				result.Label = scene.Label
				result.Score = scene.Score
				break
			}
		}
	}
	result.Msg = censor.BuildCensorMsg(result.Label)
	return result, nil
}
