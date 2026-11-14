// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package common

import (
	"context"
	"io"
	"net/http"
)

// TaskInfo holds the result of polling an async task.
type TaskInfo struct {
	Code             int    `json:"code"`
	TaskID           string `json:"task_id"`
	Status           string `json:"status"` // "PENDING", "RUNNING", "SUCCESS", "FAILURE"
	Reason           string `json:"reason,omitempty"`
	Url              string `json:"url,omitempty"`
	RemoteUrl        string `json:"remote_url,omitempty"`
	Progress         string `json:"progress,omitempty"`
	CompletionTokens int    `json:"completion_tokens,omitempty"`
	TotalTokens      int    `json:"total_tokens,omitempty"`
}

// FailTaskInfo creates a failed TaskInfo.
func FailTaskInfo(reason string) *TaskInfo {
	return &TaskInfo{
		Status: "FAILURE",
		Reason: reason,
	}
}

// TaskError represents an error from a task provider.
type TaskError struct {
	Code       string `json:"code"`
	Message    string `json:"message"`
	Data       any    `json:"data"`
	StatusCode int    `json:"-"`
	LocalError bool   `json:"-"`
	Err        error  `json:"-"`
}

// Error implements error.
func (e *TaskError) Error() string {
	if e.Err != nil {
		return e.Err.Error()
	}
	return e.Message
}

// TaskAdaptor is the interface for async task providers (video/music generation).
// It is a simplified version of LingRein's TaskAdaptor with billing methods removed.
//
// The flow for an async task is:
//  1. Init(info) — initialize adaptor
//  2. ValidateRequestAndSetAction(ctx, info) — validate request and set action type
//  3. BuildRequestURL(info) — build upstream URL
//  4. BuildRequestHeader(ctx, req, info) — set headers
//  5. BuildRequestBody(ctx, info) — build request body
//  6. DoRequest(ctx, info, body) — submit task to upstream
//  7. DoResponse(ctx, resp, info) — parse submit response, return taskID
//  8. FetchTask(baseURL, key, body, proxy) — poll task status
//  9. ParseTaskResult(respBody) — parse poll response into TaskInfo
type TaskAdaptor interface {
	Init(info *RelayInfo)

	// ValidateRequestAndSetAction validates the request and sets the action type.
	ValidateRequestAndSetAction(ctx context.Context, info *RelayInfo) *TaskError

	// ── Request / Response ───────────────────────────────────────────

	BuildRequestURL(info *RelayInfo) (string, error)
	BuildRequestHeader(ctx context.Context, req *http.Request, info *RelayInfo) error
	BuildRequestBody(ctx context.Context, info *RelayInfo) (io.Reader, error)

	DoRequest(ctx context.Context, info *RelayInfo, requestBody io.Reader) (*http.Response, error)
	DoResponse(ctx context.Context, resp *http.Response, info *RelayInfo) (taskID string, taskData []byte, err *TaskError)

	GetModelList() []string
	GetChannelName() string

	// ── Polling ──────────────────────────────────────────────────────

	FetchTask(baseURL, key string, body map[string]any, proxy string) (*http.Response, error)
	ParseTaskResult(respBody []byte) (*TaskInfo, error)
}

// TaskAdaptorRegistry maps API types to task adaptor factories.
type TaskAdaptorRegistry struct {
	entries map[int]func() TaskAdaptor
}

// NewTaskAdaptorRegistry creates an empty registry.
func NewTaskAdaptorRegistry() *TaskAdaptorRegistry {
	return &TaskAdaptorRegistry{entries: make(map[int]func() TaskAdaptor)}
}

// Register associates an API type with a task adaptor factory.
func (r *TaskAdaptorRegistry) Register(apiType int, factory func() TaskAdaptor) {
	r.entries[apiType] = factory
}

// Get returns a new task adaptor instance for the given API type.
func (r *TaskAdaptorRegistry) Get(apiType int) TaskAdaptor {
	if f, ok := r.entries[apiType]; ok {
		return f()
	}
	return nil
}

// DefaultTaskRegistry is the global task adaptor registry.
var DefaultTaskRegistry = NewTaskAdaptorRegistry()

// GetTaskAdaptor returns a task adaptor for the given API type.
func GetTaskAdaptor(apiType int) TaskAdaptor {
	return DefaultTaskRegistry.Get(apiType)
}
