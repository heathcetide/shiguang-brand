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
	audioService        = "audio_media_detection"
	audioCodeOK         = 200
	audioCodeProcessing = 280
)

// AudioCensor performs asynchronous audio content moderation via Aliyun Green.
type AudioCensor struct {
	client  *green.Client
	service string
}

// NewAudioCensor creates an Aliyun audio moderation client.
func NewAudioCensor(cfg Config) (*AudioCensor, error) {
	c, err := newClient(cfg)
	if err != nil {
		return nil, err
	}
	return &AudioCensor{client: c, service: audioService}, nil
}

// SubmitCensorAudio submits an async voice moderation task and returns the task ID.
func (c *AudioCensor) SubmitCensorAudio(ctx context.Context, audioURL string) (string, error) {
	if audioURL == "" {
		return "", fmt.Errorf("audioURL cannot be empty")
	}

	params, err := json.Marshal(map[string]string{"url": audioURL})
	if err != nil {
		return "", fmt.Errorf("failed to marshal service parameters: %w", err)
	}

	req := &green.VoiceModerationRequest{
		Service:           tea.String(c.service),
		ServiceParameters: tea.String(string(params)),
	}

	resp, err := c.client.VoiceModeration(req)
	if err != nil {
		return "", fmt.Errorf("aliyun VoiceModeration: %w", err)
	}
	if resp == nil || resp.Body == nil {
		return "", fmt.Errorf("aliyun VoiceModeration: empty response")
	}

	code := tea.Int32Value(resp.Body.Code)
	if code != audioCodeOK {
		return "", fmt.Errorf("aliyun VoiceModeration: code=%d message=%s", code, tea.StringValue(resp.Body.Message))
	}
	if resp.Body.Data == nil || tea.StringValue(resp.Body.Data.TaskId) == "" {
		return "", fmt.Errorf("aliyun VoiceModeration: missing taskId")
	}
	return tea.StringValue(resp.Body.Data.TaskId), nil
}

// GetCensorResult polls the voice moderation task status via Aliyun Green.
func (c *AudioCensor) GetCensorResult(ctx context.Context, taskID string) (*censor.JobSnapshot, error) {
	if taskID == "" {
		return nil, fmt.Errorf("taskID cannot be empty")
	}

	params, err := json.Marshal(map[string]string{"taskId": taskID})
	if err != nil {
		return nil, fmt.Errorf("failed to marshal service parameters: %w", err)
	}

	req := &green.VoiceModerationResultRequest{
		Service:           tea.String(c.service),
		ServiceParameters: tea.String(string(params)),
	}

	resp, err := c.client.VoiceModerationResult(req)
	if err != nil {
		return nil, fmt.Errorf("aliyun VoiceModerationResult: %w", err)
	}
	if resp == nil || resp.Body == nil {
		return nil, fmt.Errorf("aliyun VoiceModerationResult: empty response")
	}

	code := tea.Int32Value(resp.Body.Code)
	msg := tea.StringValue(resp.Body.Message)
	snap := &censor.JobSnapshot{Raw: resp.Body, Msg: msg}

	switch code {
	case audioCodeProcessing:
		snap.Status = censor.JobDoing
		return snap, nil
	case audioCodeOK:
		snap.Status = censor.JobFinished
	default:
		snap.Status = censor.JobFailed
		snap.Error = fmt.Sprintf("code=%d message=%s", code, msg)
		return snap, nil
	}

	data := resp.Body.Data
	if data == nil {
		snap.Suggestion = censor.SuggestionPass
		snap.Label = censor.LabelNormal
		return snap, nil
	}

	risk := strings.ToLower(strings.TrimSpace(tea.StringValue(data.RiskLevel)))
	switch risk {
	case "high":
		snap.Suggestion = censor.SuggestionBlock
	case "medium":
		snap.Suggestion = censor.SuggestionReview
	case "low", "none", "":
		snap.Suggestion = censor.SuggestionPass
	default:
		snap.Suggestion = censor.SuggestionReview
	}

	for _, slice := range data.SliceDetails {
		if slice == nil {
			continue
		}
		if lbl := strings.TrimSpace(tea.StringValue(slice.Labels)); lbl != "" {
			snap.Label = strings.Split(lbl, ",")[0]
		}
		if slice.Score != nil {
			snap.Score = float64(*slice.Score)
			if snap.Score > 1 {
				snap.Score = snap.Score / 100.0
			}
		}
		if snap.Label != "" {
			break
		}
	}

	if snap.Label == "" {
		if risk == "" || risk == "none" {
			snap.Label = censor.LabelNormal
		} else {
			snap.Label = risk
		}
	}
	return snap, nil
}
