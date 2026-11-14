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
	"strings"

	"github.com/heathcetide/DietDigiDose/pkg/providers/censor"
	"github.com/qiniu/go-sdk/v7/auth"
)

const videoEndpoint = "/v3/video/censor"
const videoJobPath = "/v3/jobs/video"

type videoRequest struct {
	Data   videoData   `json:"data"`
	Params videoParams `json:"params,omitempty"`
}

type videoData struct {
	URI string `json:"uri"`
	ID  string `json:"id,omitempty"`
}

type videoParams struct {
	Scenes []string `json:"scenes,omitempty"`
}

type videoSubmitResponse struct {
	Job string `json:"job"`
}

type videoJobResponse struct {
	ID     string       `json:"id"`
	Status string       `json:"status"`
	Result *videoResult `json:"result,omitempty"`
	Error  string       `json:"error,omitempty"`
}

type videoResult struct {
	Message string             `json:"message"`
	Result  *videoResultDetail `json:"result,omitempty"`
}

type videoResultDetail struct {
	Suggestion string                `json:"suggestion"`
	Scenes     map[string]videoScene `json:"scenes,omitempty"`
}

type videoScene struct {
	Cuts []videoCut `json:"cuts,omitempty"`
}

type videoCut struct {
	Details []videoDetail `json:"details,omitempty"`
}

type videoDetail struct {
	Label string  `json:"label"`
	Score float64 `json:"score"`
}

// VideoCensor performs asynchronous video content moderation via Qiniu.
type VideoCensor struct {
	mac    *auth.Credentials
	host   string
	client *http.Client
}

// NewVideoCensor creates a Qiniu video moderation client.
func NewVideoCensor(cfg Config) (*VideoCensor, error) {
	mac, err := newMAC(cfg)
	if err != nil {
		return nil, err
	}
	return &VideoCensor{
		mac:    mac,
		host:   defaultHost(cfg.Host),
		client: defaultClient(cfg.Client),
	}, nil
}

// SubmitCensorVideo submits an async video moderation task and returns the task ID.
func (c *VideoCensor) SubmitCensorVideo(ctx context.Context, videoURL string) (string, error) {
	if videoURL == "" {
		return "", fmt.Errorf("videoURL cannot be empty")
	}

	reqBody := videoRequest{
		Data:   videoData{URI: videoURL},
		Params: videoParams{Scenes: []string{"pulp", "terror", "politician"}},
	}
	bodyJSON, err := json.Marshal(reqBody)
	if err != nil {
		return "", fmt.Errorf("failed to marshal request: %w", err)
	}

	url := fmt.Sprintf("https://%s%s", c.host, videoEndpoint)
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(bodyJSON))
	if err != nil {
		return "", fmt.Errorf("failed to create request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")

	if err := c.mac.AddToken(auth.TokenQiniu, httpReq); err != nil {
		return "", fmt.Errorf("failed to sign request: %w", err)
	}

	resp, err := c.client.Do(httpReq)
	if err != nil {
		return "", fmt.Errorf("failed to send request: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("failed to read response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("HTTP %d: %s", resp.StatusCode, string(respBody))
	}

	var submitResp videoSubmitResponse
	if err := json.Unmarshal(respBody, &submitResp); err != nil {
		return "", fmt.Errorf("failed to parse response: %w", err)
	}
	return submitResp.Job, nil
}

// GetCensorResult polls the video moderation task status and returns a normalized snapshot.
func (c *VideoCensor) GetCensorResult(ctx context.Context, taskID string) (*censor.JobSnapshot, error) {
	if taskID == "" {
		return nil, fmt.Errorf("taskID cannot be empty")
	}

	jobPath := fmt.Sprintf("%s/%s", videoJobPath, taskID)
	url := fmt.Sprintf("https://%s%s", c.host, jobPath)
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

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

	var job videoJobResponse
	if err := json.Unmarshal(respBody, &job); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}

	snap := &censor.JobSnapshot{Raw: job, Error: job.Error}
	status := strings.ToUpper(strings.TrimSpace(job.Status))
	switch status {
	case "WAITING":
		snap.Status = censor.JobWaiting
	case "DOING":
		snap.Status = censor.JobDoing
	case "FINISHED":
		snap.Status = censor.JobFinished
	case "FAILED":
		snap.Status = censor.JobFailed
		if snap.Error == "" {
			snap.Error = "qiniu video job failed"
		}
	default:
		snap.Status = censor.JobDoing
		snap.Msg = job.Status
	}

	if snap.Status == censor.JobFinished && job.Result != nil && job.Result.Result != nil {
		snap.Suggestion = strings.ToLower(strings.TrimSpace(job.Result.Result.Suggestion))
		for _, scene := range job.Result.Result.Scenes {
			for _, cut := range scene.Cuts {
				for _, d := range cut.Details {
					if d.Label != "" {
						snap.Label = d.Label
						snap.Score = d.Score
						break
					}
				}
				if snap.Label != "" {
					break
				}
			}
			if snap.Label != "" {
				break
			}
		}
		snap.Msg = job.Result.Message
	}
	return snap, nil
}
