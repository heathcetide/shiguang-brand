// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package videoutil

import (
	"context"
	"os"
	"os/exec"
)

// ──────────────────────────────────────────────
// Package-level defaults
// ──────────────────────────────────────────────

// DefaultFFmpeg is the default FFmpegTool used by package-level functions.
// Replace it with a custom tool if you need a specific binary path or timeout.
var DefaultFFmpeg = NewFFmpegTool()

// DefaultFFprobe is the default FFprobeTool used by package-level functions.
var DefaultFFprobe = NewFFprobeTool()

// Probe probes a media file and returns its metadata.
// It uses the default FFprobeTool.
func Probe(ctx context.Context, input string) (*MediaInfo, error) {
	return DefaultFFprobe.Probe(ctx, input)
}

// ProbeFile is a convenience wrapper that creates a background context.
func ProbeFile(input string) (*MediaInfo, error) {
	return Probe(context.Background(), input)
}

// ──────────────────────────────────────────────
// os helpers
// ──────────────────────────────────────────────

// osRemove wraps os.Remove to avoid importing "os" in multiple files.
func osRemove(path string) error {
	return os.Remove(path)
}

// osCreateTemp wraps os.CreateTemp for use in other files.
func osCreateTemp(dir, pattern string) (*os.File, error) {
	return os.CreateTemp(dir, pattern)
}

// execLookPath wraps exec.LookPath for testability.
func execLookPath(file string) (string, error) {
	return exec.LookPath(file)
}
