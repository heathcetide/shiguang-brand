// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package taskcommon provides shared utilities for task providers.
package taskcommon

import (
	"encoding/json"
	"fmt"
)

// UnmarshalMetadata converts a map[string]any metadata to a typed struct via JSON round-trip.
func UnmarshalMetadata(metadata map[string]any, target any) error {
	if metadata == nil {
		return nil
	}
	// Prevent metadata from overriding model fields.
	delete(metadata, "model")
	metaBytes, err := json.Marshal(metadata)
	if err != nil {
		return fmt.Errorf("marshal metadata failed: %w", err)
	}
	if err := json.Unmarshal(metaBytes, target); err != nil {
		return fmt.Errorf("unmarshal metadata failed: %w", err)
	}
	return nil
}

// DefaultString returns val if non-empty, otherwise fallback.
func DefaultString(val, fallback string) string {
	if val == "" {
		return fallback
	}
	return val
}

// DefaultInt returns val if non-zero, otherwise fallback.
func DefaultInt(val, fallback int) int {
	if val == 0 {
		return fallback
	}
	return val
}

// BaseBilling is a stub for LingRein's billing base struct.
// In library mode, billing is not supported; embed this to satisfy
// adaptor struct layouts without pulling in billing logic.
type BaseBilling struct{}

// EncodeLocalTaskID encodes an upstream task ID into a local task ID.
// In library mode this is an identity function.
func EncodeLocalTaskID(upstreamID string) string {
	return upstreamID
}

// DecodeLocalTaskID decodes a local task ID back into the upstream task ID.
// In library mode this is an identity function.
func DecodeLocalTaskID(localID string) (string, error) {
	return localID, nil
}
