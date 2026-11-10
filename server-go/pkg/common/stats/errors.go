// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package stats

import "errors"

// Common errors returned by stats primitives.
var (
	// ErrMergeIncompatible is returned when merging two HLLs of different types.
	ErrMergeIncompatible = errors.New("stats: merge incompatible HLL types")

	// ErrClosed is returned when operating on a closed collector.
	ErrClosed = errors.New("stats: collector closed")

	// ErrNotFound is returned when a key is not found.
	ErrNotFound = errors.New("stats: key not found")
)
