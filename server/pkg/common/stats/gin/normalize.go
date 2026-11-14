// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package gin

import (
	"strings"
)

// NormalizePath converts dynamic route paths to parameterized patterns
// to prevent key explosion in stats.
//
// Examples:
//
//	/users/123              → /users/:id
//	/users/abc              → /users/:id
//	/api/v1/posts/789       → /api/v1/posts/:id
//	/api/v1/posts/789/edit  → /api/v1/posts/:id/edit
//	/files/550e8400-e29b... → /files/:id
//	/static/css/main.a1b2.css → /static/css/main.css (hash stripped)
//	/health                 → /health (unchanged)
//	/                       → / (unchanged)
//
// Rules:
//  1. Numeric segments → :id
//  2. UUID-like segments (8-4-4-4-12 hex) → :id
//  3. Long alphanumeric segments (>10 chars, mixed) → :id
//  4. File hashes (name.hash.ext) → name.ext
//  5. Query strings are ignored (Gin already strips them from path)
func NormalizePath(path string) string {
	if path == "" || path == "/" {
		return path
	}

	// Strip query string if present.
	if idx := strings.Index(path, "?"); idx >= 0 {
		path = path[:idx]
	}

	segments := strings.Split(path, "/")
	for i, seg := range segments {
		if seg == "" {
			continue
		}
		segments[i] = normalizeSegment(seg)
	}
	return strings.Join(segments, "/")
}

// normalizeSegment normalizes a single path segment.
func normalizeSegment(seg string) string {
	// Rule 4: File hash pattern (name.hash.ext) → name.ext
	if dotIdx := strings.LastIndex(seg, "."); dotIdx > 0 {
		nameWithHash := seg[:dotIdx]
		ext := seg[dotIdx:]
		if innerDot := strings.LastIndex(nameWithHash, "."); innerDot > 0 {
			name := nameWithHash[:innerDot]
			hash := nameWithHash[innerDot+1:]
			// If the part after the inner dot looks like a hash (long, alphanumeric).
			if len(hash) >= 8 && isAlphanumeric(hash) {
				return name + ext
			}
		}
	}

	// Rule 1: Pure numeric → :id
	if isNumeric(seg) {
		return ":id"
	}

	// Rule 2: UUID pattern → :id
	if isUUID(seg) {
		return ":id"
	}

	// Rule 3: Long alphanumeric (likely an ID) → :id
	if len(seg) > 10 && isAlphanumeric(seg) && hasDigit(seg) {
		return ":id"
	}

	return seg
}

func isNumeric(s string) bool {
	if s == "" {
		return false
	}
	for _, c := range s {
		if c < '0' || c > '9' {
			return false
		}
	}
	return true
}

func isAlphanumeric(s string) bool {
	if s == "" {
		return false
	}
	for _, c := range s {
		if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')) {
			return false
		}
	}
	return true
}

func hasDigit(s string) bool {
	for _, c := range s {
		if c >= '0' && c <= '9' {
			return true
		}
	}
	return false
}

// isUUID checks if the string looks like a UUID.
// Format: 8-4-4-4-12 hexadecimal digits separated by hyphens.
func isUUID(s string) bool {
	if len(s) != 36 {
		return false
	}
	// Check hyphen positions: 8, 13, 18, 23
	if s[8] != '-' || s[13] != '-' || s[18] != '-' || s[23] != '-' {
		return false
	}
	// Check all other characters are hex.
	for i, c := range s {
		if i == 8 || i == 13 || i == 18 || i == 23 {
			continue
		}
		if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')) {
			return false
		}
	}
	return true
}
