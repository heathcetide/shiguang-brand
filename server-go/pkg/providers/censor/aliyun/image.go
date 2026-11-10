// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package aliyun

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/heathcetide/DietDigiDose/pkg/providers/censor"
	green "github.com/alibabacloud-go/green-20220302/v2/client"
	"github.com/alibabacloud-go/tea/tea"
)

const (
	imageService = "baselineCheck"
	imageCodeOK  = 200
)

// ImageCensor performs image content moderation via Aliyun Green.
type ImageCensor struct {
	client *green.Client
}

// NewImageCensor creates an Aliyun image moderation client.
func NewImageCensor(cfg Config) (*ImageCensor, error) {
	c, err := newClient(cfg)
	if err != nil {
		return nil, err
	}
	return &ImageCensor{client: c}, nil
}

// CensorImage performs image content moderation via Aliyun Green.
func (c *ImageCensor) CensorImage(ctx context.Context, imageURL string) (*censor.CensorResult, error) {
	if imageURL == "" {
		return nil, fmt.Errorf("imageURL cannot be empty")
	}

	params, err := json.Marshal(map[string]string{"imageUrl": imageURL})
	if err != nil {
		return nil, fmt.Errorf("failed to marshal service parameters: %w", err)
	}

	req := &green.ImageModerationRequest{
		Service:           tea.String(imageService),
		ServiceParameters: tea.String(string(params)),
	}

	resp, err := c.client.ImageModeration(req)
	if err != nil {
		return nil, fmt.Errorf("aliyun ImageModeration: %w", err)
	}
	if resp == nil || resp.Body == nil {
		return nil, fmt.Errorf("aliyun ImageModeration: empty response")
	}

	code := tea.Int32Value(resp.Body.Code)
	if code != imageCodeOK {
		return nil, fmt.Errorf("aliyun ImageModeration: code=%d message=%s", code, tea.StringValue(resp.Body.Msg))
	}

	result := &censor.CensorResult{Label: censor.LabelNormal}
	if data := resp.Body.Data; data != nil {
		risk := strings.ToLower(strings.TrimSpace(tea.StringValue(data.RiskLevel)))
		switch risk {
		case "high":
			result.Suggestion = censor.SuggestionBlock
		case "medium":
			result.Suggestion = censor.SuggestionReview
		default:
			result.Suggestion = censor.SuggestionPass
		}
		if len(data.Result) > 0 && data.Result[0] != nil {
			label := strings.TrimSpace(tea.StringValue(data.Result[0].Label))
			if label != "" {
				result.Label = strings.ToLower(label)
			}
		}
	} else {
		result.Suggestion = censor.SuggestionPass
	}
	result.Msg = censor.BuildCensorMsg(result.Label)
	return result, nil
}
