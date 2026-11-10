// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package censor

import "context"

// ImageCensor is the interface for synchronous image content moderation.
// Implementations live in provider-specific modules (censor/qiniu, etc.).
type ImageCensor interface {
	CensorImage(ctx context.Context, imageURL string) (*CensorResult, error)
}
