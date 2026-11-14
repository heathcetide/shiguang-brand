// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package common

import (
	"context"
	"encoding/json"
	"fmt"
	"time"
)

// TaskSubmitReq is a stub for LingRein's task submission request type.
// In LingRein this is parsed from the HTTP request body by gin middleware.
// In library mode, callers populate this struct directly.
type TaskSubmitReq struct {
	Prompt         string        `json:"prompt"`
	Images         []string      `json:"images,omitempty"`
	Duration       int           `json:"duration,omitempty"`
	Seconds        string        `json:"seconds,omitempty"`
	Size           string        `json:"size,omitempty"`
	Metadata       map[string]any `json:"metadata,omitempty"`
	Model          string        `json:"model,omitempty"`
	Mode           string        `json:"mode,omitempty"`
	Image          string        `json:"image,omitempty"`
	InputReference string        `json:"input_reference,omitempty"`
}

// UnmarshalMetadata marshals the request's Metadata map and unmarshals it
// into the target struct, allowing callers to decode metadata into typed
// structs in library mode.
func (r *TaskSubmitReq) UnmarshalMetadata(target any) error {
	if r.Metadata == nil {
		return nil
	}
	data, err := json.Marshal(r.Metadata)
	if err != nil {
		return fmt.Errorf("task: marshal metadata: %w", err)
	}
	if err := json.Unmarshal(data, target); err != nil {
		return fmt.Errorf("task: unmarshal metadata: %w", err)
	}
	return nil
}

// HasImage reports whether the request has an image input.
func (r *TaskSubmitReq) HasImage() bool {
	return r.Image != "" || r.InputReference != "" || len(r.Images) > 0
}

// MaxTaskDurationSeconds is the upper bound for task duration billing.
const MaxTaskDurationSeconds = 600

// ValidateBasicTaskRequest is a stub for LingRein's request validation.
// In library mode it performs no validation.
func ValidateBasicTaskRequest(ctx context.Context, info *RelayInfo, action string) *TaskError {
	// Not supported in library mode
	return nil
}

// ValidateMultipartDirect is a stub for LingRein's multipart validation.
func ValidateMultipartDirect(ctx context.Context, info *RelayInfo) *TaskError {
	// Not supported in library mode
	return nil
}

// GetTaskRequest is a stub that retrieves the task request from context.
// In library mode there is no gin context, so it returns a zero value.
func GetTaskRequest(ctx context.Context) (TaskSubmitReq, error) {
	// Not supported in library mode
	return TaskSubmitReq{}, nil
}

// CtxGet is a stub for gin.Context.Get. It always returns nil, false.
func CtxGet(ctx context.Context, key string) (any, bool) {
	// Not supported in library mode
	return nil, false
}

// GetTimestamp returns the current Unix timestamp.
func GetTimestamp() int64 {
	return time.Now().Unix()
}

// QuotaFromFloat converts a float64 to an int quota value.
// In library mode this is a simple truncation.
func QuotaFromFloat(f float64) int {
	return int(f)
}
