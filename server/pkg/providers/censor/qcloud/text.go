// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package qcloud

import (
	"context"
	"encoding/base64"
	"fmt"
	"strings"

	"github.com/heathcetide/DietDigiDose/pkg/providers/censor"
	"github.com/tencentcloud/tencentcloud-sdk-go/tencentcloud/common"
	tms "github.com/tencentcloud/tencentcloud-sdk-go/tencentcloud/tms/v20201229"
)

const textEndpoint = "tms.tencentcloudapi.com"

// TextCensor performs text content moderation via Tencent Cloud TMS.
type TextCensor struct {
	secretID  string
	secretKey string
	region    string
	bizType   string
	client    *tms.Client
}

// NewTextCensor creates a Tencent Cloud TMS text moderation client.
func NewTextCensor(cfg Config) (*TextCensor, error) {
	cred, err := newCredential(cfg)
	if err != nil {
		return nil, err
	}
	client, err := tms.NewClient(cred, resolveRegion(cfg.Region), newProfile(textEndpoint))
	if err != nil {
		return nil, fmt.Errorf("failed to create TMS client: %w", err)
	}
	return &TextCensor{
		secretID:  cfg.SecretID,
		secretKey: cfg.SecretKey,
		region:    resolveRegion(cfg.Region),
		bizType:   resolveBizType(cfg.BizType),
		client:    client,
	}, nil
}

// CensorText performs text content moderation via Tencent Cloud TMS.
func (c *TextCensor) CensorText(ctx context.Context, text string) (*censor.CensorResult, error) {
	encoded := base64.StdEncoding.EncodeToString([]byte(text))
	req := tms.NewTextModerationRequest()
	req.Content = common.StringPtr(encoded)
	if c.bizType != "" {
		req.BizType = common.StringPtr(c.bizType)
	}

	resp, err := c.client.TextModerationWithContext(ctx, req)
	if err != nil {
		return nil, fmt.Errorf("qcloud TextModeration: %w", err)
	}
	if resp == nil || resp.Response == nil {
		return nil, fmt.Errorf("qcloud TextModeration: empty response")
	}

	result := &censor.CensorResult{}
	body := resp.Response

	suggestion := ""
	if body.Suggestion != nil {
		suggestion = strings.ToLower(strings.TrimSpace(*body.Suggestion))
	}
	switch suggestion {
	case "pass":
		result.Suggestion = censor.SuggestionPass
	case "review":
		result.Suggestion = censor.SuggestionReview
	case "block":
		result.Suggestion = censor.SuggestionBlock
	default:
		if body.Label != nil && *body.Label != "" {
			result.Suggestion = censor.SuggestionReview
		} else {
			result.Suggestion = censor.SuggestionPass
		}
	}

	if body.Label != nil {
		result.Label = strings.ToLower(strings.TrimSpace(*body.Label))
	}
	if body.Score != nil {
		result.Score = float64(*body.Score) / 100.0
	}
	if body.Keywords != nil && len(body.Keywords) > 0 {
		result.Details = fmt.Sprintf("Keywords: %v", body.Keywords)
	}
	result.Msg = censor.BuildCensorMsg(result.Label)
	return result, nil
}
