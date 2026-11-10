// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package videoutil

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os/exec"
	"strings"
)

// runWithStdin executes FFmpeg with the given args and stdin data.
func (t *FFmpegTool) runWithStdin(ctx context.Context, args []string, stdin []byte) error {
	if err := t.ensureReady(ctx); err != nil {
		return err
	}

	t.mu.Lock()
	bin := t.resolvedPath
	t.mu.Unlock()

	cmd := exec.CommandContext(ctx, bin, args...)
	cmd.Stdin = bytes.NewReader(stdin)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			return fmt.Errorf("videoutil: ffmpeg timed out; stderr=%s", trimErr(stderr.String()))
		}
		var ee *exec.ExitError
		if errors.As(err, &ee) {
			return fmt.Errorf("videoutil: ffmpeg failed (exit %d); stderr=%s",
				ee.ExitCode(), trimErr(stderr.String()))
		}
		return fmt.Errorf("videoutil: ffmpeg exec error: %w; stderr=%s", err, trimErr(stderr.String()))
	}
	return nil
}

// ──────────────────────────────────────────────
// Screenshot operations
// ──────────────────────────────────────────────

// ScreenshotOptions configures screenshot extraction.
type ScreenshotOptions struct {
	Width     int    // 0 = original width
	Height    int    // 0 = original height
	Format    string // "jpg" (default) or "png"
	Quality   int    // JPEG quality 2-31 (lower = better, default 2)
	ExactSeek bool   // if true, seeks after -i (accurate but slower)
}

// DefaultScreenshotOptions returns sensible defaults.
func DefaultScreenshotOptions() ScreenshotOptions {
	return ScreenshotOptions{
		Format:  "jpg",
		Quality: 2,
	}
}

// ScreenshotOption is a functional option for ScreenshotOptions.
type ScreenshotOption func(*ScreenshotOptions)

// WithScreenshotSize sets the screenshot dimensions.
func WithScreenshotSize(width, height int) ScreenshotOption {
	return func(o *ScreenshotOptions) { o.Width = width; o.Height = height }
}

// WithScreenshotFormat sets the output format ("jpg" or "png").
func WithScreenshotFormat(format string) ScreenshotOption {
	return func(o *ScreenshotOptions) { o.Format = format }
}

// WithScreenshotQuality sets the JPEG quality (2-31, lower = better).
func WithScreenshotQuality(q int) ScreenshotOption {
	return func(o *ScreenshotOptions) { o.Quality = q }
}

// WithExactSeek uses accurate seeking (slower but frame-accurate).
func WithExactSeek() ScreenshotOption {
	return func(o *ScreenshotOptions) { o.ExactSeek = true }
}

// Screenshot extracts a single frame from a video at the given timestamp.
func Screenshot(ctx context.Context, input, output string, atSeconds float64, opts ...ScreenshotOption) error {
	return DefaultFFmpeg.Screenshot(ctx, input, output, atSeconds, opts...)
}

// Screenshot extracts a single frame using this FFmpeg tool.
func (t *FFmpegTool) Screenshot(ctx context.Context, input, output string, atSeconds float64, opts ...ScreenshotOption) error {
	o := DefaultScreenshotOptions()
	for _, opt := range opts {
		opt(&o)
	}

	cmd := NewCommand().LogLevel("error")

	// Fast seek (before -i) is default; exact seek places -ss after -i.
	if !o.ExactSeek && atSeconds > 0 {
		cmd.SeekTo(atSeconds)
	}
	cmd.Input(input)
	if o.ExactSeek && atSeconds > 0 {
		cmd.SeekTo(atSeconds)
	}

	cmd.Frames(1)

	// Apply scaling if requested.
	if o.Width > 0 && o.Height > 0 {
		cmd.ScaleKeepAspect(o.Width, o.Height)
	}

	// Set format-specific options.
	switch strings.ToLower(o.Format) {
	case "png":
		cmd.VideoCodec("png")
		cmd.PixelFormat("rgba")
	default:
		cmd.VideoCodec("mjpeg")
		if o.Quality > 0 {
			cmd.Append("-q:v", fmt.Sprintf("%d", o.Quality))
		}
	}

	cmd.Output(output)
	return t.Run(ctx, cmd.Args(), nil)
}

// ──────────────────────────────────────────────
// Watermark operations
// ──────────────────────────────────────────────

// WatermarkOption is a functional option for watermark operations.
type WatermarkOption func(*WatermarkOptions)

// WithWatermarkPosition sets the watermark position.
func WithWatermarkPosition(pos Position) WatermarkOption {
	return func(o *WatermarkOptions) { o.Position = pos }
}

// WithWatermarkMargin sets the watermark margin in pixels.
func WithWatermarkMargin(margin int) WatermarkOption {
	return func(o *WatermarkOptions) { o.Margin = margin }
}

// WithWatermarkScale sets the watermark scale factor (relative to video width).
func WithWatermarkScale(scale float64) WatermarkOption {
	return func(o *WatermarkOptions) { o.Scale = scale }
}

// WithWatermarkOpacity sets the watermark opacity (0.0-1.0).
func WithWatermarkOpacity(opacity float64) WatermarkOption {
	return func(o *WatermarkOptions) { o.Opacity = opacity }
}

// AddImageWatermark overlays an image watermark onto a video.
func AddImageWatermark(ctx context.Context, input, watermark, output string, opts ...WatermarkOption) error {
	return DefaultFFmpeg.AddImageWatermark(ctx, input, watermark, output, opts...)
}

// AddImageWatermark overlays an image watermark using this FFmpeg tool.
func (t *FFmpegTool) AddImageWatermark(ctx context.Context, input, watermark, output string, opts ...WatermarkOption) error {
	o := DefaultWatermarkOptions()
	for _, opt := range opts {
		opt(&o)
	}

	filter := BuildImageWatermarkFilter(o)

	cmd := NewCommand().
		LogLevel("error").
		Input(input).
		Input(watermark).
		VideoFilterComplex(filter).
		Map("[out]").
		AudioCodec("copy").
		Output(output)

	return t.Run(ctx, cmd.Args(), nil)
}

// AddTextWatermark overlays text onto a video using the drawtext filter.
func AddTextWatermark(ctx context.Context, input, output, text string, fontFile string, opts ...WatermarkOption) error {
	return DefaultFFmpeg.AddTextWatermark(ctx, input, output, text, fontFile, opts...)
}

// AddTextWatermark overlays text using this FFmpeg tool.
func (t *FFmpegTool) AddTextWatermark(ctx context.Context, input, output, text, fontFile string, opts ...WatermarkOption) error {
	o := DefaultWatermarkOptions()
	for _, opt := range opts {
		opt(&o)
	}

	filter := BuildTextWatermarkFilter(text, fontFile, 24, "white", o)

	cmd := NewCommand().
		LogLevel("error").
		Input(input).
		VideoFilterComplex(filter).
		Map("[out]").
		AudioCodec("copy").
		Output(output)

	return t.Run(ctx, cmd.Args(), nil)
}

// ──────────────────────────────────────────────
// GIF creation
// ──────────────────────────────────────────────

// GIFOptions configures GIF creation from a video.
type GIFOptions struct {
	Start    float64 // start time in seconds (default: 0)
	Duration float64 // duration in seconds (default: 3)
	Width    int     // 0 = original width
	Height   int     // 0 = original height
	FPS      int     // frames per second (default: 10)
	Optimize bool    // if true, use palettegen + paletteuse for better quality
}

// DefaultGIFOptions returns sensible defaults.
func DefaultGIFOptions() GIFOptions {
	return GIFOptions{
		Duration: 3,
		FPS:      10,
	}
}

// GIFOption is a functional option for GIFOptions.
type GIFOption func(*GIFOptions)

// WithGIFStart sets the GIF start time.
func WithGIFStart(seconds float64) GIFOption { return func(o *GIFOptions) { o.Start = seconds } }

// WithGIFDuration sets the GIF duration.
func WithGIFDuration(seconds float64) GIFOption { return func(o *GIFOptions) { o.Duration = seconds } }

// WithGIFSize sets the GIF dimensions.
func WithGIFSize(width, height int) GIFOption {
	return func(o *GIFOptions) { o.Width = width; o.Height = height }
}

// WithGIFFPS sets the GIF frame rate.
func WithGIFFPS(fps int) GIFOption { return func(o *GIFOptions) { o.FPS = fps } }

// WithGIFOptimize enables palette optimization for better quality.
func WithGIFOptimize() GIFOption { return func(o *GIFOptions) { o.Optimize = true } }

// CreateGIF creates an animated GIF from a video segment.
func CreateGIF(ctx context.Context, input, output string, opts ...GIFOption) error {
	return DefaultFFmpeg.CreateGIF(ctx, input, output, opts...)
}

// CreateGIF creates an animated GIF using this FFmpeg tool.
func (t *FFmpegTool) CreateGIF(ctx context.Context, input, output string, opts ...GIFOption) error {
	o := DefaultGIFOptions()
	for _, opt := range opts {
		opt(&o)
	}
	if o.FPS <= 0 {
		o.FPS = 10
	}

	scaleFilter := ""
	if o.Width > 0 && o.Height > 0 {
		scaleFilter = fmt.Sprintf("scale=%d:%d:flags=lanczos,", o.Width, o.Height)
	}

	if o.Optimize {
		// Two-pass: palettegen + paletteuse for high-quality GIF.
		palette := output + ".palette.png"
		defer func() { _ = removeFile(palette) }()

		// Pass 1: generate palette.
		cmd1 := NewCommand().
			LogLevel("error").
			SeekTo(o.Start).
			Input(input).
			Duration(o.Duration).
			VideoFilter(fmt.Sprintf("%sfps=%d,palettegen", scaleFilter, o.FPS)).
			Output(palette)
		if err := t.Run(ctx, cmd1.Args(), nil); err != nil {
			return fmt.Errorf("videoutil: gif palette pass: %w", err)
		}

		// Pass 2: use palette.
		cmd2 := NewCommand().
			LogLevel("error").
			SeekTo(o.Start).
			Input(input).
			Input(palette).
			VideoFilterComplex(fmt.Sprintf("[0:v]%sfps=%d[base];[base][1:v]paletteuse[out]", scaleFilter, o.FPS)).
			Map("[out]").
			Output(output)
		return t.Run(ctx, cmd2.Args(), nil)
	}

	// Single-pass (lower quality, faster).
	cmd := NewCommand().
		LogLevel("error").
		SeekTo(o.Start).
		Input(input).
		Duration(o.Duration).
		VideoFilter(fmt.Sprintf("%sfps=%d", scaleFilter, o.FPS)).
		VideoCodec("gif").
		Output(output)
	return t.Run(ctx, cmd.Args(), nil)
}

// removeFile is a helper that ignores errors.
func removeFile(path string) error {
	// Use os.Remove via a separate import to avoid cluttering.
	return osRemove(path)
}
