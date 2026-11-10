// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package qcloud

import (
	"context"
	"fmt"
	"strings"

	"github.com/heathcetide/DietDigiDose/pkg/providers/censor"
	ams "github.com/tencentcloud/tencentcloud-sdk-go/tencentcloud/ams/v20201229"
	"github.com/tencentcloud/tencentcloud-sdk-go/tencentcloud/common"
)

const audioEndpoint = "ams.tencentcloudapi.com"

// AudioCensor performs asynchronous audio content moderation via Tencent Cloud AMS.
type AudioCensor struct {
	secretID  string
	secretKey string
	region    string
	bizType   string
	client    *ams.Client
}

// NewAudioCensor creates a Tencent Cloud AMS audio moderation client.
func NewAudioCensor(cfg Config) (*AudioCensor, error) {
	cred, err := newCredential(cfg)
	if err != nil {
		return nil, err
	}
	client, err := ams.NewClient(cred, resolveRegion(cfg.Region), newProfile(audioEndpoint))
	if err != nil {
		return nil, fmt.Errorf("failed to create AMS client: %w", err)
	}
	return &AudioCensor{
		secretID:  cfg.SecretID,
		secretKey: cfg.SecretKey,
		region:    resolveRegion(cfg.Region),
		bizType:   resolveBizType(cfg.BizType),
		client:    client,
	}, nil
}

// SubmitCensorAudio submits an async audio moderation task via Tencent Cloud AMS.
func (c *AudioCensor) SubmitCensorAudio(ctx context.Context, audioURL string) (string, error) {
	if audioURL == "" {
		return "", fmt.Errorf("audioURL cannot be empty")
	}

	req := ams.NewCreateAudioModerationTaskRequest()
	req.BizType = common.StringPtr(c.bizType)
	req.Type = common.StringPtr("AUDIO")
	req.Tasks = []*ams.TaskInput{{
		Input: &ams.StorageInfo{
			Type: common.StringPtr("URL"),
			Url:  common.StringPtr(audioURL),
		},
	}}

	resp, err := c.client.CreateAudioModerationTaskWithContext(ctx, req)
	if err != nil {
		return "", fmt.Errorf("qcloud CreateAudioModerationTask: %w", err)
	}
	if resp == nil || resp.Response == nil || len(resp.Response.Results) == 0 {
		return "", fmt.Errorf("qcloud CreateAudioModerationTask: empty results")
	}

	r0 := resp.Response.Results[0]
	if r0 == nil {
		return "", fmt.Errorf("qcloud CreateAudioModerationTask: nil result")
	}
	if r0.Code != nil && strings.ToUpper(strings.TrimSpace(*r0.Code)) != "OK" {
		msg := ""
		if r0.Message != nil {
			msg = *r0.Message
		}
		return "", fmt.Errorf("qcloud CreateAudioModerationTask: code=%s message=%s", *r0.Code, msg)
	}
	if r0.TaskId == nil || strings.TrimSpace(*r0.TaskId) == "" {
		return "", fmt.Errorf("qcloud CreateAudioModerationTask: missing TaskId")
	}
	return strings.TrimSpace(*r0.TaskId), nil
}

// GetCensorResult polls the audio moderation task status via Tencent Cloud AMS.
func (c *AudioCensor) GetCensorResult(ctx context.Context, taskID string) (*censor.JobSnapshot, error) {
	if taskID == "" {
		return nil, fmt.Errorf("taskID cannot be empty")
	}

	req := ams.NewDescribeTaskDetailRequest()
	req.TaskId = common.StringPtr(taskID)
	req.ShowAllSegments = common.BoolPtr(false)

	resp, err := c.client.DescribeTaskDetailWithContext(ctx, req)
	if err != nil {
		return nil, fmt.Errorf("qcloud DescribeTaskDetail: %w", err)
	}
	if resp == nil || resp.Response == nil {
		return nil, fmt.Errorf("qcloud DescribeTaskDetail: empty response")
	}

	body := resp.Response
	snap := &censor.JobSnapshot{Raw: body}

	status := ""
	if body.Status != nil {
		status = strings.ToUpper(strings.TrimSpace(*body.Status))
	}
	switch status {
	case "PENDING":
		snap.Status = censor.JobWaiting
	case "RUNNING":
		snap.Status = censor.JobDoing
	case "FINISH":
		snap.Status = censor.JobFinished
	case "ERROR", "CANCELLED":
		snap.Status = censor.JobFailed
		snap.Error = status
	default:
		snap.Status = censor.JobDoing
		if status != "" {
			snap.Msg = status
		}
	}

	if snap.Status != censor.JobFinished {
		return snap, nil
	}

	sug := ""
	if body.Suggestion != nil {
		sug = strings.ToLower(strings.TrimSpace(*body.Suggestion))
	}
	switch sug {
	case "pass":
		snap.Suggestion = censor.SuggestionPass
	case "review":
		snap.Suggestion = censor.SuggestionReview
	case "block":
		snap.Suggestion = censor.SuggestionBlock
	default:
		snap.Suggestion = censor.SuggestionPass
	}

	if len(body.Labels) > 0 && body.Labels[0] != nil {
		if body.Labels[0].Label != nil {
			snap.Label = strings.ToLower(strings.TrimSpace(*body.Labels[0].Label))
		}
		if body.Labels[0].Score != nil {
			snap.Score = float64(*body.Labels[0].Score) / 100.0
		}
	}
	if snap.Label == "" {
		snap.Label = censor.LabelNormal
	}
	if body.AudioText != nil {
		snap.Msg = strings.TrimSpace(*body.AudioText)
		if len(snap.Msg) > 200 {
			snap.Msg = snap.Msg[:200]
		}
	}
	return snap, nil
}
