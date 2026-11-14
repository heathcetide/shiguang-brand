// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package videoutil

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os/exec"
	"strings"
	"sync"
	"time"
)

// ──────────────────────────────────────────────
// FFmpeg tool — binary detection + execution
// ──────────────────────────────────────────────

// FFmpegTool wraps the FFmpeg binary, caching its resolved path and
// version. It is safe for concurrent use.
type FFmpegTool struct {
	BinaryPath string        // path to ffmpeg; "" means auto-detect via PATH
	Timeout    time.Duration // default 0 = no timeout (caller controls via ctx)

	mu           sync.Mutex
	checked      bool
	resolvedPath string
	version      string
	checkErr     error
}

// NewFFmpegTool creates a new FFmpeg tool with default settings.
// BinaryPath defaults to "ffmpeg" (auto-detected via PATH).
func NewFFmpegTool() *FFmpegTool {
	return &FFmpegTool{BinaryPath: "ffmpeg"}
}

// NewFFmpegToolWithPath creates a tool using an explicit binary path.
func NewFFmpegToolWithPath(path string) *FFmpegTool {
	return &FFmpegTool{BinaryPath: path}
}

// ensureReady verifies that the FFmpeg binary exists and is runnable.
// The check is cached — subsequent calls return immediately.
func (t *FFmpegTool) ensureReady(ctx context.Context) error {
	t.mu.Lock()
	if t.checked {
		err := t.checkErr
		t.mu.Unlock()
		return err
	}
	t.mu.Unlock()

	path := t.BinaryPath
	if path == "" {
		path = "ffmpeg"
	}

	resolved, err := exec.LookPath(path)
	if err != nil {
		t.mu.Lock()
		t.checked = true
		t.checkErr = fmt.Errorf("videoutil: ffmpeg not found (path=%q): %w", path, err)
		t.mu.Unlock()
		return t.checkErr
	}

	// Quick version check with a short timeout.
	cctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	cmd := exec.CommandContext(cctx, resolved, "-version")
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		var finalErr error
		if errors.Is(cctx.Err(), context.DeadlineExceeded) {
			finalErr = fmt.Errorf("videoutil: ffmpeg check timed out (path=%q)", resolved)
		} else {
			finalErr = fmt.Errorf("videoutil: ffmpeg exists but cannot run (path=%q): %w; stderr=%s",
				resolved, err, strings.TrimSpace(stderr.String()))
		}
		t.mu.Lock()
		t.checked = true
		t.resolvedPath = resolved
		t.checkErr = finalErr
		t.mu.Unlock()
		return finalErr
	}

	ver := parseVersion(stdout.String(), "ffmpeg version")
	if ver == "" {
		ver = "unknown"
	}

	t.mu.Lock()
	t.checked = true
	t.resolvedPath = resolved
	t.version = ver
	t.checkErr = nil
	t.mu.Unlock()
	return nil
}

// Version returns the detected FFmpeg version string.
func (t *FFmpegTool) Version(ctx context.Context) (string, error) {
	if err := t.ensureReady(ctx); err != nil {
		return "", err
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.version, nil
}

// ResolvedPath returns the absolute path to the FFmpeg binary after
// detection. Returns "" if ensureReady has not been called.
func (t *FFmpegTool) ResolvedPath() string {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.resolvedPath
}

// Run executes an FFmpeg command. If onProgress is non-nil, progress
// events are reported via the callback (the -progress pipe:1 flag is
// automatically appended).
func (t *FFmpegTool) Run(ctx context.Context, args []string, onProgress func(Progress)) error {
	_, err := t.RunWithProgress(ctx, args, onProgress)
	return err
}

// RunWithProgress is like Run but also returns the last progress event.
func (t *FFmpegTool) RunWithProgress(ctx context.Context, args []string, onProgress func(Progress)) (Progress, error) {
	var last Progress

	if err := t.ensureReady(ctx); err != nil {
		return last, err
	}

	t.mu.Lock()
	bin := t.resolvedPath
	t.mu.Unlock()

	// If progress is requested, append -progress pipe:1 -nostats so
	// FFmpeg emits machine-readable key=value lines on stdout.
	fullArgs := make([]string, len(args))
	copy(fullArgs, args)
	if onProgress != nil {
		fullArgs = append(fullArgs, "-progress", "pipe:1", "-nostats")
	}

	cmd := exec.CommandContext(ctx, bin, fullArgs...)

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return last, fmt.Errorf("videoutil: ffmpeg stdout pipe: %w", err)
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return last, fmt.Errorf("videoutil: ffmpeg stderr pipe: %w", err)
	}

	if err := cmd.Start(); err != nil {
		return last, fmt.Errorf("videoutil: ffmpeg start: %w", err)
	}

	var stderrBuf bytes.Buffer
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		_, _ = stderrBuf.ReadFrom(stderr)
	}()

	if onProgress != nil {
		wg.Add(1)
		go func() {
			defer wg.Done()
			scanProgress(stdout, &last, onProgress)
		}()
	} else {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, _ = io.Copy(io.Discard, stdout)
		}()
	}

	waitErr := cmd.Wait()
	wg.Wait()

	if waitErr != nil {
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			return last, fmt.Errorf("videoutil: ffmpeg timed out; stderr=%s", trimErr(stderrBuf.String()))
		}
		var ee *exec.ExitError
		if errors.As(waitErr, &ee) {
			return last, fmt.Errorf("videoutil: ffmpeg failed (exit %d); stderr=%s",
				ee.ExitCode(), trimErr(stderrBuf.String()))
		}
		return last, fmt.Errorf("videoutil: ffmpeg exec error: %w; stderr=%s", waitErr, trimErr(stderrBuf.String()))
	}

	return last, nil
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

func parseVersion(s, prefix string) string {
	lines := strings.Split(s, "\n")
	if len(lines) == 0 {
		return ""
	}
	first := strings.TrimSpace(lines[0])
	parts := strings.Fields(first)
	for i := 0; i < len(parts)-1; i++ {
		if strings.EqualFold(parts[i], "version") {
			return parts[i+1]
		}
	}
	return ""
}

func trimErr(s string) string {
	s = strings.TrimSpace(s)
	// Limit stderr to 4KB to avoid huge error messages.
	if len(s) > 4096 {
		s = s[len(s)-4096:]
	}
	return s
}
