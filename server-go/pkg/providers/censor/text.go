// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package censor

import "context"

// TextCensor is the interface for synchronous text content moderation.
// Implementations live in provider-specific modules (censor/qiniu, etc.).
type TextCensor interface {
	CensorText(ctx context.Context, text string) (*CensorResult, error)
}
