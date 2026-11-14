// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package videoutil

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"time"
)

// ──────────────────────────────────────────────
// FFprobe tool — media probing
// ──────────────────────────────────────────────

// FFprobeTool wraps the FFprobe binary, caching its resolved path and
// version. It is safe for concurrent use.
type FFprobeTool struct {
	BinaryPath string        // path to ffprobe; "" means auto-detect
	Timeout    time.Duration // default 15s

	mu           sync.Mutex
	checked      bool
	resolvedPath string
	version      string
	checkErr     error
}

// NewFFprobeTool creates a new FFprobe tool with default settings.
func NewFFprobeTool() *FFprobeTool {
	return &FFprobeTool{BinaryPath: "ffprobe", Timeout: 15 * time.Second}
}

// NewFFprobeToolWithPath creates a tool using an explicit binary path.
func NewFFprobeToolWithPath(path string) *FFprobeTool {
	return &FFprobeTool{BinaryPath: path, Timeout: 15 * time.Second}
}

func (t *FFprobeTool) ensureReady(ctx context.Context) error {
	t.mu.Lock()
	if t.checked {
		err := t.checkErr
		t.mu.Unlock()
		return err
	}
	t.mu.Unlock()

	path := t.BinaryPath
	if path == "" {
		path = "ffprobe"
	}

	resolved, err := exec.LookPath(path)
	if err != nil {
		t.mu.Lock()
		t.checked = true
		t.checkErr = fmt.Errorf("videoutil: ffprobe not found (path=%q): %w", path, err)
		t.mu.Unlock()
		return t.checkErr
	}

	timeout := t.Timeout
	if timeout <= 0 {
		timeout = 15 * time.Second
	}
	cctx, cancel := context.WithTimeout(ctx, minDur(timeout, 5*time.Second))
	defer cancel()

	cmd := exec.CommandContext(cctx, resolved, "-version")
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		var finalErr error
		if errors.Is(cctx.Err(), context.DeadlineExceeded) {
			finalErr = fmt.Errorf("videoutil: ffprobe check timed out (path=%q)", resolved)
		} else {
			finalErr = fmt.Errorf("videoutil: ffprobe exists but cannot run (path=%q): %w; stderr=%s",
				resolved, err, strings.TrimSpace(stderr.String()))
		}
		t.mu.Lock()
		t.checked = true
		t.resolvedPath = resolved
		t.checkErr = finalErr
		t.mu.Unlock()
		return finalErr
	}

	ver := parseVersion(stdout.String(), "ffprobe version")
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

// Version returns the detected FFprobe version string.
func (t *FFprobeTool) Version(ctx context.Context) (string, error) {
	if err := t.ensureReady(ctx); err != nil {
		return "", err
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.version, nil
}

// ffprobeJSON is the raw JSON output from ffprobe.
type ffprobeJSON struct {
	Streams []ffprobeStream `json:"streams"`
	Format  ffprobeFormat   `json:"format"`
}

type ffprobeFormat struct {
	Filename       string            `json:"filename"`
	FormatName     string            `json:"format_name"`
	FormatLongName string            `json:"format_long_name"`
	Duration       string            `json:"duration"`
	Size           string            `json:"size"`
	BitRate        string            `json:"bit_rate"`
	Tags           map[string]string `json:"tags"`
}

type ffprobeStream struct {
	Index         int               `json:"index"`
	CodecName     string            `json:"codec_name"`
	CodecLongName string            `json:"codec_long_name"`
	CodecType     string            `json:"codec_type"`
	Profile       string            `json:"profile"`
	Width         int               `json:"width"`
	Height        int               `json:"height"`
	PixFmt        string            `json:"pix_fmt"`
	RFrameRate    string            `json:"r_frame_rate"`
	AvgFrameRate  string            `json:"avg_frame_rate"`
	BitRate       string            `json:"bit_rate"`
	SampleRate    string            `json:"sample_rate"`
	Channels      int               `json:"channels"`
	ChannelLayout string            `json:"channel_layout"`
	Duration      string            `json:"duration"`
	Tags          map[string]string `json:"tags"`
}

// ProbeRaw executes ffprobe and returns the raw JSON output.
func (t *FFprobeTool) ProbeRaw(ctx context.Context, input string) (*ffprobeJSON, error) {
	if err := t.ensureReady(ctx); err != nil {
		return nil, err
	}

	timeout := t.Timeout
	if timeout <= 0 {
		timeout = 15 * time.Second
	}
	cctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	args := []string{
		"-v", "error",
		"-hide_banner",
		"-show_format",
		"-show_streams",
		"-of", "json",
		input,
	}

	t.mu.Lock()
	bin := t.resolvedPath
	t.mu.Unlock()

	cmd := exec.CommandContext(cctx, bin, args...)
	out, err := cmd.Output()
	if err != nil {
		var ee *exec.ExitError
		if errors.As(err, &ee) {
			return nil, fmt.Errorf("videoutil: ffprobe failed: %w; stderr=%s", err, string(ee.Stderr))
		}
		if errors.Is(cctx.Err(), context.DeadlineExceeded) {
			return nil, fmt.Errorf("videoutil: ffprobe timed out after %s", timeout)
		}
		return nil, fmt.Errorf("videoutil: ffprobe exec error: %w", err)
	}

	var parsed ffprobeJSON
	if err := json.Unmarshal(out, &parsed); err != nil {
		return nil, fmt.Errorf("videoutil: parse ffprobe json: %w", err)
	}
	return &parsed, nil
}

// Probe executes ffprobe and returns a high-level MediaInfo struct.
func (t *FFprobeTool) Probe(ctx context.Context, input string) (*MediaInfo, error) {
	raw, err := t.ProbeRaw(ctx, input)
	if err != nil {
		return nil, err
	}
	return convertProbeResult(raw), nil
}

func convertProbeResult(raw *ffprobeJSON) *MediaInfo {
	info := &MediaInfo{
		Filename: raw.Format.Filename,
		Format:   raw.Format.FormatName,
		Tags:     raw.Format.Tags,
	}

	if d, err := strconv.ParseFloat(raw.Format.Duration, 64); err == nil {
		info.Duration = time.Duration(d * float64(time.Second))
	}
	if s, err := strconv.ParseInt(raw.Format.Size, 10, 64); err == nil {
		info.Size = s
	}
	if br, err := strconv.ParseInt(raw.Format.BitRate, 10, 64); err == nil {
		info.BitRate = br
	}

	for _, s := range raw.Streams {
		si := StreamInfo{
			Index:     s.Index,
			Codec:     s.CodecName,
			CodecType: s.CodecType,
			CodecLong: s.CodecLongName,
			Width:     s.Width,
			Height:    s.Height,
			Channels:  s.Channels,
			Duration:  s.Duration,
			Tags:      s.Tags,
		}
		if sr, err := strconv.Atoi(s.SampleRate); err == nil {
			si.SampleRate = sr
		}
		info.Streams = append(info.Streams, si)

		switch s.CodecType {
		case "video":
			if info.Video == nil {
				vs := &VideoStream{
					Index:       s.Index,
					Codec:       s.CodecName,
					Profile:     s.Profile,
					Width:       s.Width,
					Height:      s.Height,
					PixelFormat: s.PixFmt,
					Tags:        s.Tags,
				}
				if fps, err := parseFrameRate(s.AvgFrameRate); err == nil && fps > 0 {
					vs.FPS = fps
				} else if fps, err := parseFrameRate(s.RFrameRate); err == nil && fps > 0 {
					vs.FPS = fps
				}
				if br, err := strconv.ParseInt(s.BitRate, 10, 64); err == nil {
					vs.BitRate = br
				}
				if d, err := strconv.ParseFloat(s.Duration, 64); err == nil {
					vs.Duration = time.Duration(d * float64(time.Second))
				}
				// HDR detection: common HDR pixel formats.
				switch strings.ToLower(s.PixFmt) {
				case "yuv420p10le", "yuv422p10le", "yuv444p10le",
					"yuv420p12le", "yuv422p12le", "yuv444p12le",
					"yuv420p16le", "yuv422p16le", "yuv444p16le":
					vs.IsHDR = true
				}
				info.Video = vs
			}
		case "audio":
			if info.Audio == nil {
				as := &AudioStream{
					Index:         s.Index,
					Codec:         s.CodecName,
					Profile:       s.Profile,
					Channels:      s.Channels,
					ChannelLayout: s.ChannelLayout,
					Tags:          s.Tags,
				}
				if sr, err := strconv.Atoi(s.SampleRate); err == nil {
					as.SampleRate = sr
				}
				if br, err := strconv.ParseInt(s.BitRate, 10, 64); err == nil {
					as.BitRate = br
				}
				if d, err := strconv.ParseFloat(s.Duration, 64); err == nil {
					as.Duration = time.Duration(d * float64(time.Second))
				}
				info.Audio = as
			}
		}
	}

	return info
}

// parseFrameRate parses an FFprobe frame rate string like "30000/1001"
// or "30" into a float64.
func parseFrameRate(s string) (float64, error) {
	if s == "" || s == "0/0" {
		return 0, nil
	}
	parts := strings.Split(s, "/")
	if len(parts) == 1 {
		return strconv.ParseFloat(parts[0], 64)
	}
	if len(parts) == 2 {
		num, err := strconv.ParseFloat(parts[0], 64)
		if err != nil {
			return 0, err
		}
		den, err := strconv.ParseFloat(parts[1], 64)
		if err != nil {
			return 0, err
		}
		if den == 0 {
			return 0, fmt.Errorf("invalid frame rate: zero denominator in %q", s)
		}
		return num / den, nil
	}
	return 0, fmt.Errorf("invalid frame rate: %q", s)
}

func minDur(a, b time.Duration) time.Duration {
	if a <= b {
		return a
	}
	return b
}
