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

const audioEndpoint = "/v3/audio/censor"
const audioJobPath = "/v3/jobs/audio"

type audioRequest struct {
	Data   audioData   `json:"data"`
	Params audioParams `json:"params"`
}

type audioData struct {
	URI string `json:"uri"`
	ID  string `json:"id,omitempty"`
}

type audioParams struct {
	Scenes  []string `json:"scenes"`
	HookURL string   `json:"hook_url,omitempty"`
}

type audioSubmitResponse struct {
	ID string `json:"id"`
}

type audioJobResponse struct {
	ID       string       `json:"id"`
	Status   string       `json:"status"`
	Response *audioResult `json:"response,omitempty"`
	Error    string       `json:"error,omitempty"`
}

type audioResult struct {
	Message string             `json:"message"`
	Result  *audioResultDetail `json:"result,omitempty"`
}

type audioResultDetail struct {
	Suggestion string                `json:"suggestion"`
	Scenes     map[string]audioScene `json:"scenes,omitempty"`
}

type audioScene struct {
	Cuts []audioCut `json:"cuts,omitempty"`
}

type audioCut struct {
	Details []audioDetail `json:"details,omitempty"`
}

type audioDetail struct {
	Label string  `json:"label"`
	Score float64 `json:"score"`
}

// AudioCensor performs asynchronous audio content moderation via Qiniu.
type AudioCensor struct {
	mac    *auth.Credentials
	host   string
	client *http.Client
}

// NewAudioCensor creates a Qiniu audio moderation client.
func NewAudioCensor(cfg Config) (*AudioCensor, error) {
	mac, err := newMAC(cfg)
	if err != nil {
		return nil, err
	}
	return &AudioCensor{
		mac:    mac,
		host:   defaultHost(cfg.Host),
		client: defaultClient(cfg.Client),
	}, nil
}

// SubmitCensorAudio submits an async audio moderation task and returns the task ID.
func (c *AudioCensor) SubmitCensorAudio(ctx context.Context, audioURL string) (string, error) {
	if audioURL == "" {
		return "", fmt.Errorf("audioURL cannot be empty")
	}

	reqBody := audioRequest{
		Data:   audioData{URI: audioURL},
		Params: audioParams{Scenes: []string{"antispam"}},
	}
	bodyJSON, err := json.Marshal(reqBody)
	if err != nil {
		return "", fmt.Errorf("failed to marshal request: %w", err)
	}

	url := fmt.Sprintf("https://%s%s", c.host, audioEndpoint)
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

	var submitResp audioSubmitResponse
	if err := json.Unmarshal(respBody, &submitResp); err != nil {
		return "", fmt.Errorf("failed to parse response: %w", err)
	}
	return submitResp.ID, nil
}

// GetCensorResult polls the audio moderation task status and returns a normalized snapshot.
func (c *AudioCensor) GetCensorResult(ctx context.Context, taskID string) (*censor.JobSnapshot, error) {
	if taskID == "" {
		return nil, fmt.Errorf("taskID cannot be empty")
	}

	jobPath := fmt.Sprintf("%s/%s", audioJobPath, taskID)
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

	var job audioJobResponse
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
			snap.Error = "qiniu audio job failed"
		}
	default:
		snap.Status = censor.JobDoing
		snap.Msg = job.Status
	}

	if snap.Status == censor.JobFinished && job.Response != nil && job.Response.Result != nil {
		snap.Suggestion = strings.ToLower(strings.TrimSpace(job.Response.Result.Suggestion))
		if scene, ok := job.Response.Result.Scenes["antispam"]; ok {
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
		}
		snap.Msg = job.Response.Message
	}
	return snap, nil
}
