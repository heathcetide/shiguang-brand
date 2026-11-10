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
	videoService        = "videoDetection"
	videoCodeOK         = 200
	videoCodeProcessing = 280
)

// VideoCensor performs asynchronous video content moderation via Aliyun Green.
type VideoCensor struct {
	client  *green.Client
	service string
}

// NewVideoCensor creates an Aliyun video moderation client.
func NewVideoCensor(cfg Config) (*VideoCensor, error) {
	c, err := newClient(cfg)
	if err != nil {
		return nil, err
	}
	return &VideoCensor{client: c, service: videoService}, nil
}

// SubmitCensorVideo submits an async video moderation task via Aliyun Green.
func (c *VideoCensor) SubmitCensorVideo(ctx context.Context, videoURL string) (string, error) {
	if videoURL == "" {
		return "", fmt.Errorf("videoURL cannot be empty")
	}

	params, err := json.Marshal(map[string]string{"url": videoURL})
	if err != nil {
		return "", fmt.Errorf("failed to marshal service parameters: %w", err)
	}

	req := &green.VideoModerationRequest{
		Service:           tea.String(c.service),
		ServiceParameters: tea.String(string(params)),
	}

	resp, err := c.client.VideoModeration(req)
	if err != nil {
		return "", fmt.Errorf("aliyun VideoModeration: %w", err)
	}
	if resp == nil || resp.Body == nil {
		return "", fmt.Errorf("aliyun VideoModeration: empty response")
	}

	code := tea.Int32Value(resp.Body.Code)
	if code != videoCodeOK && code != videoCodeProcessing {
		return "", fmt.Errorf("aliyun VideoModeration: code=%d message=%s", code, tea.StringValue(resp.Body.Message))
	}
	if resp.Body.Data == nil || tea.StringValue(resp.Body.Data.TaskId) == "" {
		return "", fmt.Errorf("aliyun VideoModeration: missing taskId")
	}
	return strings.TrimSpace(tea.StringValue(resp.Body.Data.TaskId)), nil
}

// GetCensorResult polls the video moderation task status via Aliyun Green.
func (c *VideoCensor) GetCensorResult(ctx context.Context, taskID string) (*censor.JobSnapshot, error) {
	if taskID == "" {
		return nil, fmt.Errorf("taskID cannot be empty")
	}

	params, err := json.Marshal(map[string]string{"taskId": taskID})
	if err != nil {
		return nil, fmt.Errorf("failed to marshal service parameters: %w", err)
	}

	req := &green.VideoModerationResultRequest{
		Service:           tea.String(c.service),
		ServiceParameters: tea.String(string(params)),
	}

	resp, err := c.client.VideoModerationResult(req)
	if err != nil {
		return nil, fmt.Errorf("aliyun VideoModerationResult: %w", err)
	}
	if resp == nil || resp.Body == nil {
		return nil, fmt.Errorf("aliyun VideoModerationResult: empty response")
	}

	code := tea.Int32Value(resp.Body.Code)
	snap := &censor.JobSnapshot{Raw: resp.Body}

	switch code {
	case videoCodeProcessing:
		snap.Status = censor.JobDoing
		return snap, nil
	case videoCodeOK:
		snap.Status = censor.JobFinished
	default:
		snap.Status = censor.JobFailed
		snap.Error = fmt.Sprintf("code=%d message=%s", code, tea.StringValue(resp.Body.Message))
		return snap, nil
	}

	if data := resp.Body.Data; data != nil {
		risk := strings.ToLower(strings.TrimSpace(tea.StringValue(data.RiskLevel)))
		switch risk {
		case "high":
			snap.Suggestion = censor.SuggestionBlock
		case "medium":
			snap.Suggestion = censor.SuggestionReview
		default:
			snap.Suggestion = censor.SuggestionPass
		}
		snap.Label = risk
	} else {
		snap.Suggestion = censor.SuggestionPass
		snap.Label = censor.LabelNormal
	}
	return snap, nil
}
