// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package null provides a no-op limiter implementation. It is useful
// for testing, feature-flag disabling, or as a default when limiting
// is not required.
package null

import (
	"context"

	"github.com/heathcetide/DietDigiDose/pkg/common/limiter"
)

type nullLimiter struct{}

// New creates a no-op limiter that never rejects any Acquire call.
func New() limiter.Limiter {
	return &nullLimiter{}
}

func (l *nullLimiter) Running() int                                  { return -1 }
func (l *nullLimiter) Acquire(ctx context.Context, key []byte) error { return nil }
func (l *nullLimiter) Release(key []byte)                            {}

type nullStringLimiter struct{}

// NewString creates a no-op string-keyed limiter.
func NewString() limiter.StringLimiter {
	return &nullStringLimiter{}
}

func (l *nullStringLimiter) Running() int                                  { return -1 }
func (l *nullStringLimiter) Acquire(ctx context.Context, key string) error { return nil }
func (l *nullStringLimiter) Release(key string)                            {}

type nullSizeLimiter struct{}

// NewSize creates a no-op size limiter.
func NewSize() limiter.SizeLimiter {
	return &nullSizeLimiter{}
}

func (l *nullSizeLimiter) Running() int64                                            { return -1 }
func (l *nullSizeLimiter) Acquire(ctx context.Context, key []byte, size int64) error { return nil }
func (l *nullSizeLimiter) Release(key []byte, size int64)                            {}
func (l *nullSizeLimiter) Remaining(key []byte) int64                                { return -1 }
