// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package qcloud

import (
	"context"
	"fmt"
	"strings"

	"github.com/heathcetide/DietDigiDose/pkg/providers/censor"
	"github.com/tencentcloud/tencentcloud-sdk-go/tencentcloud/common"
	ims "github.com/tencentcloud/tencentcloud-sdk-go/tencentcloud/ims/v20201229"
)

const imageEndpoint = "ims.tencentcloudapi.com"

// ImageCensor performs image content moderation via Tencent Cloud IMS.
type ImageCensor struct {
	secretID  string
	secretKey string
	region    string
	client    *ims.Client
}

// NewImageCensor creates a Tencent Cloud IMS image moderation client.
func NewImageCensor(cfg Config) (*ImageCensor, error) {
	cred, err := newCredential(cfg)
	if err != nil {
		return nil, err
	}
	client, err := ims.NewClient(cred, resolveRegion(cfg.Region), newProfile(imageEndpoint))
	if err != nil {
		return nil, fmt.Errorf("failed to create IMS client: %w", err)
	}
	return &ImageCensor{
		secretID:  cfg.SecretID,
		secretKey: cfg.SecretKey,
		region:    resolveRegion(cfg.Region),
		client:    client,
	}, nil
}

// CensorImage performs image content moderation via Tencent Cloud IMS.
func (c *ImageCensor) CensorImage(ctx context.Context, imageURL string) (*censor.CensorResult, error) {
	if imageURL == "" {
		return nil, fmt.Errorf("imageURL cannot be empty")
	}

	req := ims.NewImageModerationRequest()
	req.FileUrl = common.StringPtr(imageURL)

	resp, err := c.client.ImageModerationWithContext(ctx, req)
	if err != nil {
		return nil, fmt.Errorf("qcloud ImageModeration: %w", err)
	}
	if resp == nil || resp.Response == nil {
		return nil, fmt.Errorf("qcloud ImageModeration: empty response")
	}

	result := &censor.CensorResult{}
	body := resp.Response

	suggestion := ""
	if body.Suggestion != nil {
		suggestion = strings.ToLower(strings.TrimSpace(*body.Suggestion))
	}
	switch suggestion {
	case "block":
		result.Suggestion = censor.SuggestionBlock
	case "review":
		result.Suggestion = censor.SuggestionReview
	default:
		result.Suggestion = censor.SuggestionPass
	}

	if body.Label != nil && strings.TrimSpace(*body.Label) != "" {
		result.Label = strings.ToLower(strings.TrimSpace(*body.Label))
	}
	result.Msg = censor.BuildCensorMsg(result.Label)
	return result, nil
}
