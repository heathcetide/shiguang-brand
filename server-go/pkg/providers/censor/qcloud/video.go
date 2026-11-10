// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package qcloud

import (
	"context"
	"fmt"
	"strings"

	"github.com/heathcetide/DietDigiDose/pkg/providers/censor"
	"github.com/tencentcloud/tencentcloud-sdk-go/tencentcloud/common"
	vm "github.com/tencentcloud/tencentcloud-sdk-go/tencentcloud/vm/v20201229"
)

const videoEndpoint = "vm.tencentcloudapi.com"

// VideoCensor performs asynchronous video content moderation via Tencent Cloud VM.
type VideoCensor struct {
	secretID  string
	secretKey string
	region    string
	bizType   string
	client    *vm.Client
}

// NewVideoCensor creates a Tencent Cloud VM video moderation client.
func NewVideoCensor(cfg Config) (*VideoCensor, error) {
	cred, err := newCredential(cfg)
	if err != nil {
		return nil, err
	}
	client, err := vm.NewClient(cred, resolveRegion(cfg.Region), newProfile(videoEndpoint))
	if err != nil {
		return nil, fmt.Errorf("failed to create VM client: %w", err)
	}
	return &VideoCensor{
		secretID:  cfg.SecretID,
		secretKey: cfg.SecretKey,
		region:    resolveRegion(cfg.Region),
		bizType:   resolveBizType(cfg.BizType),
		client:    client,
	}, nil
}

// SubmitCensorVideo submits an async video moderation task via Tencent Cloud VM.
func (c *VideoCensor) SubmitCensorVideo(ctx context.Context, videoURL string) (string, error) {
	if videoURL == "" {
		return "", fmt.Errorf("videoURL cannot be empty")
	}

	req := vm.NewCreateVideoModerationTaskRequest()
	req.Type = common.StringPtr("VIDEO")
	req.BizType = common.StringPtr(c.bizType)
	req.Tasks = []*vm.TaskInput{{
		Input: &vm.StorageInfo{
			Type: common.StringPtr("URL"),
			Url:  common.StringPtr(videoURL),
		},
	}}

	resp, err := c.client.CreateVideoModerationTaskWithContext(ctx, req)
	if err != nil {
		return "", fmt.Errorf("qcloud CreateVideoModerationTask: %w", err)
	}
	if resp == nil || resp.Response == nil || len(resp.Response.Results) == 0 {
		return "", fmt.Errorf("qcloud CreateVideoModerationTask: empty results")
	}

	r0 := resp.Response.Results[0]
	if r0 == nil {
		return "", fmt.Errorf("qcloud CreateVideoModerationTask: nil result")
	}
	if r0.Code != nil && strings.ToUpper(strings.TrimSpace(*r0.Code)) != "OK" {
		msg := ""
		if r0.Message != nil {
			msg = *r0.Message
		}
		return "", fmt.Errorf("qcloud CreateVideoModerationTask: code=%s message=%s", *r0.Code, msg)
	}
	if r0.TaskId == nil || strings.TrimSpace(*r0.TaskId) == "" {
		return "", fmt.Errorf("qcloud CreateVideoModerationTask: missing TaskId")
	}
	return strings.TrimSpace(*r0.TaskId), nil
}

// GetCensorResult polls the video moderation task status via Tencent Cloud VM.
func (c *VideoCensor) GetCensorResult(ctx context.Context, taskID string) (*censor.JobSnapshot, error) {
	if taskID == "" {
		return nil, fmt.Errorf("taskID cannot be empty")
	}

	req := vm.NewDescribeTaskDetailRequest()
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
	return snap, nil
}
