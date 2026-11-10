// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package aliyun

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/heathcetide/DietDigiDose/pkg/providers/censor"
	green "github.com/alibabacloud-go/green-20220302/v2/client"
	"github.com/alibabacloud-go/tea/tea"
)

const (
	textService = "chat_detection"
	textCodeOK  = 200
)

var highRiskLabels = map[string]bool{
	"terrorism":  true,
	"porn":       true,
	"contraband": true,
}

// TextCensor performs text content moderation via Aliyun Green.
type TextCensor struct {
	client  *green.Client
	service string
}

// NewTextCensor creates an Aliyun text moderation client.
func NewTextCensor(cfg Config) (*TextCensor, error) {
	c, err := newClient(cfg)
	if err != nil {
		return nil, err
	}
	return &TextCensor{client: c, service: textService}, nil
}

// CensorText performs text content moderation via Aliyun Green.
func (c *TextCensor) CensorText(ctx context.Context, text string) (*censor.CensorResult, error) {
	params, err := json.Marshal(map[string]string{"content": text})
	if err != nil {
		return nil, fmt.Errorf("failed to marshal service parameters: %w", err)
	}

	req := &green.TextModerationRequest{
		Service:           tea.String(c.service),
		ServiceParameters: tea.String(string(params)),
	}

	resp, err := c.client.TextModeration(req)
	if err != nil {
		return nil, fmt.Errorf("aliyun TextModeration: %w", err)
	}
	if resp == nil || resp.Body == nil {
		return nil, fmt.Errorf("aliyun TextModeration: empty response")
	}

	code := tea.Int32Value(resp.Body.Code)
	if code != textCodeOK {
		return nil, fmt.Errorf("aliyun TextModeration: code=%d message=%s", code, tea.StringValue(resp.Body.Message))
	}

	result := &censor.CensorResult{}
	data := resp.Body.Data
	if data == nil {
		result.Suggestion = censor.SuggestionPass
		result.Label = censor.LabelNormal
		result.Msg = censor.BuildCensorMsg(censor.LabelNormal)
		return result, nil
	}

	labels := tea.StringValue(data.Labels)
	result.Label = labels
	if labels == "" || labels == censor.LabelNormal {
		result.Suggestion = censor.SuggestionPass
		if labels == "" {
			result.Label = censor.LabelNormal
		}
		result.Msg = censor.BuildCensorMsg(result.Label)
		return result, nil
	}

	if highRiskLabels[labels] {
		result.Suggestion = censor.SuggestionBlock
	} else {
		result.Suggestion = censor.SuggestionReview
	}
	if reason := tea.StringValue(data.Reason); reason != "" {
		result.Details = reason
	}
	result.Msg = censor.BuildCensorMsg(result.Label)
	return result, nil
}
