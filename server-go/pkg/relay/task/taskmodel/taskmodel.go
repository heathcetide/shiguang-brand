// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package taskmodel provides a minimal Task struct and status constants
// for async task providers. In LingRein, this is a GORM model backed by a
// database. In library mode, it's a plain struct.
package taskmodel

import (
	"encoding/json"

	"github.com/heathcetide/DietDigiDose/pkg/relay/relaykit/dto"
)

// Task status constants.
const (
	TaskStatusQueued     = "QUEUED"
	TaskStatusSubmitted  = "SUBMITTED"
	TaskStatusInProgress = "IN_PROGRESS"
	TaskStatusSuccess    = "SUCCESS"
	TaskStatusFailure    = "FAILURE"
)

// TaskStatus is the status of an async task.
type TaskStatus string

// ToVideoStatus converts a TaskStatus to an OpenAI video status string.
func (s TaskStatus) ToVideoStatus() string {
	switch s {
	case TaskStatusSuccess:
		return dto.VideoStatusCompleted
	case TaskStatusFailure:
		return dto.VideoStatusFailed
	case TaskStatusInProgress, TaskStatusSubmitted:
		return dto.VideoStatusInProgress
	case TaskStatusQueued:
		return dto.VideoStatusQueued
	default:
		return dto.VideoStatusUnknown
	}
}

// TaskProperties holds extra properties associated with a task.
// In LingRein this is a JSON column; in library mode it's a plain struct.
type TaskProperties struct {
	OriginModelName string
}

// Task represents an async AI generation task.
type Task struct {
	TaskID    string     `json:"task_id"`
	Status    TaskStatus `json:"status"`
	Model     string     `json:"model"`
	Progress  string     `json:"progress"`
	Result    string     `json:"result"`
	Reason    string     `json:"reason,omitempty"`
	Error     string     `json:"error,omitempty"`

	// Library-mode extensions (stubs for LingRein compatibility).
	Data      json.RawMessage   `json:"-"`
	CreatedAt int64             `json:"-"`
	UpdatedAt int64             `json:"-"`
	FinishTime int64            `json:"-"`
	Properties TaskProperties    `json:"-"`
}

// GetUpstreamTaskID returns the upstream provider's task ID.
// In library mode this is the same as TaskID.
func (t *Task) GetUpstreamTaskID() string {
	return t.TaskID
}

// GetResultURL returns the result URL for the task.
func (t *Task) GetResultURL() string {
	return t.Result
}

// ToOpenAIVideo converts the task to an OpenAIVideo response.
func (t *Task) ToOpenAIVideo() *dto.OpenAIVideo {
	v := dto.NewOpenAIVideo()
	v.ID = t.TaskID
	v.TaskID = t.TaskID
	v.Status = t.Status.ToVideoStatus()
	v.SetProgressStr(t.Progress)
	v.CreatedAt = t.CreatedAt
	v.CompletedAt = t.UpdatedAt
	return v
}
