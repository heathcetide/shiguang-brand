// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package censor

import "context"

// VideoCensor is the interface for asynchronous video content moderation.
// Submit a task, then poll for results using the returned task ID.
// Implementations live in provider-specific modules (censor/qiniu, etc.).
type VideoCensor interface {
	SubmitCensorVideo(ctx context.Context, videoURL string) (taskID string, err error)
	GetCensorResult(ctx context.Context, taskID string) (*JobSnapshot, error)
}
