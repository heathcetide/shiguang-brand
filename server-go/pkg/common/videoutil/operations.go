// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package videoutil

import (
	"context"
	"fmt"
	"strings"
	"time"
)

// ──────────────────────────────────────────────
// Transcode options
// ──────────────────────────────────────────────

// TranscodeOptions configures a transcoding operation.
type TranscodeOptions struct {
	VideoCodec    string // default "libx264"
	AudioCodec    string // default "aac"
	CRF           int    // 0 = use default (23)
	Preset        string // default "medium"
	Tune          string // e.g. "film", "animation"; "" = none
	ScaleWidth    int    // 0 = no scaling
	ScaleHeight   int    // 0 = keep aspect
	PadToSize     bool   // if true, pad with black bars to exact ScaleWidth x ScaleHeight
	FrameRate     string // e.g. "30"; "" = keep original
	PixelFormat   string // default "yuv420p"
	VideoBitRate  string // e.g. "2M"; "" = use CRF
	AudioBitRate  string // e.g. "128k"; "" = default
	SampleRate    int    // 0 = keep original
	AudioChannels int    // 0 = keep original
	FastStart     bool   // default true (for MP4)
	NoAudio       bool   // drop audio
	NoVideo       bool   // drop video (audio only)
}

// DefaultTranscodeOptions returns sensible defaults for H.264/AAC MP4.
func DefaultTranscodeOptions() TranscodeOptions {
	return TranscodeOptions{
		VideoCodec:  "libx264",
		AudioCodec:  "aac",
		CRF:         23,
		Preset:      "medium",
		PixelFormat: "yuv420p",
		FastStart:   true,
	}
}

// TranscodeOption is a functional option for TranscodeOptions.
type TranscodeOption func(*TranscodeOptions)

// WithCRF sets the CRF (quality) value.
func WithCRF(crf int) TranscodeOption { return func(o *TranscodeOptions) { o.CRF = crf } }

// WithPreset sets the encoding preset.
func WithPreset(preset string) TranscodeOption {
	return func(o *TranscodeOptions) { o.Preset = preset }
}

// WithTune sets the encoding tune.
func WithTune(tune string) TranscodeOption { return func(o *TranscodeOptions) { o.Tune = tune } }

// WithVideoCodec sets the video codec.
func WithVideoCodec(codec string) TranscodeOption {
	return func(o *TranscodeOptions) { o.VideoCodec = codec }
}

// WithAudioCodec sets the audio codec.
func WithAudioCodec(codec string) TranscodeOption {
	return func(o *TranscodeOptions) { o.AudioCodec = codec }
}

// WithScale sets the output resolution.
func WithScale(width, height int) TranscodeOption {
	return func(o *TranscodeOptions) { o.ScaleWidth = width; o.ScaleHeight = height }
}

// WithPad sets the output resolution with padding.
func WithPad(width, height int) TranscodeOption {
	return func(o *TranscodeOptions) {
		o.ScaleWidth = width
		o.ScaleHeight = height
		o.PadToSize = true
	}
}

// WithFrameRate sets the output frame rate.
func WithFrameRate(fps string) TranscodeOption {
	return func(o *TranscodeOptions) { o.FrameRate = fps }
}

// WithPixelFormat sets the output pixel format.
func WithPixelFormat(pf string) TranscodeOption {
	return func(o *TranscodeOptions) { o.PixelFormat = pf }
}

// WithVideoBitRate sets the video bitrate (overrides CRF).
func WithVideoBitRate(br string) TranscodeOption {
	return func(o *TranscodeOptions) { o.VideoBitRate = br }
}

// WithAudioBitRate sets the audio bitrate.
func WithAudioBitRate(br string) TranscodeOption {
	return func(o *TranscodeOptions) { o.AudioBitRate = br }
}

// WithSampleRate sets the audio sample rate.
func WithSampleRate(hz int) TranscodeOption { return func(o *TranscodeOptions) { o.SampleRate = hz } }

// WithAudioChannels sets the number of audio channels.
func WithAudioChannels(n int) TranscodeOption {
	return func(o *TranscodeOptions) { o.AudioChannels = n }
}

// WithFastStart enables MP4 faststart.
func WithFastStart() TranscodeOption { return func(o *TranscodeOptions) { o.FastStart = true } }

// WithNoAudio drops the audio stream.
func WithNoAudio() TranscodeOption { return func(o *TranscodeOptions) { o.NoAudio = true } }

// WithNoVideo drops the video stream (audio-only output).
func WithNoVideo() TranscodeOption { return func(o *TranscodeOptions) { o.NoVideo = true } }

// ──────────────────────────────────────────────
// Transcode operations
// ──────────────────────────────────────────────

// Transcode transcodes a video file with the given options.
// It uses a default FFmpegTool; pass nil for opts to use defaults.
func Transcode(ctx context.Context, input, output string, opts ...TranscodeOption) error {
	return DefaultFFmpeg.Transcode(ctx, input, output, opts...)
}

// TranscodeMP4 is a convenience wrapper that transcodes to MP4 (H.264 + AAC).
func TranscodeMP4(input, output string, opts ...TranscodeOption) error {
	return Transcode(context.Background(), input, output, opts...)
}

// Transcode transcodes a video file using this FFmpeg tool instance.
func (t *FFmpegTool) Transcode(ctx context.Context, input, output string, opts ...TranscodeOption) error {
	o := DefaultTranscodeOptions()
	for _, opt := range opts {
		opt(&o)
	}

	cmd := NewCommand().
		LogLevel("error").
		Input(input)

	if o.NoVideo {
		cmd.NoVideo()
	} else {
		if o.VideoCodec != "" {
			cmd.VideoCodec(o.VideoCodec)
		}
		if o.VideoBitRate != "" {
			cmd.VideoBitRate(o.VideoBitRate)
		} else if o.CRF > 0 {
			cmd.CRF(o.CRF)
		}
		if o.Preset != "" {
			cmd.Preset(o.Preset)
		}
		if o.Tune != "" {
			cmd.Tune(o.Tune)
		}
		if o.PixelFormat != "" {
			cmd.PixelFormat(o.PixelFormat)
		}
		if o.FrameRate != "" {
			cmd.VideoFrameRate(o.FrameRate)
		}
		if o.ScaleWidth > 0 && o.ScaleHeight > 0 {
			if o.PadToSize {
				cmd.ScalePad(o.ScaleWidth, o.ScaleHeight)
			} else {
				cmd.ScaleKeepAspect(o.ScaleWidth, o.ScaleHeight)
			}
		}
	}

	if o.NoAudio {
		cmd.NoAudio()
	} else {
		if o.AudioCodec != "" {
			cmd.AudioCodec(o.AudioCodec)
		}
		if o.AudioBitRate != "" {
			cmd.AudioBitRate(o.AudioBitRate)
		}
		if o.SampleRate > 0 {
			cmd.AudioSampleRate(o.SampleRate)
		}
		if o.AudioChannels > 0 {
			cmd.AudioChannels(o.AudioChannels)
		}
	}

	if o.FastStart {
		cmd.MovFlagsFastStart()
	}

	cmd.Output(output)

	return t.Run(ctx, cmd.Args(), nil)
}

// TranscodeWithProgress is like Transcode but reports progress.
// The total duration is probed automatically to compute Percent.
func TranscodeWithProgress(ctx context.Context, input, output string, onProgress func(Progress), opts ...TranscodeOption) error {
	return DefaultFFmpeg.TranscodeWithProgress(ctx, input, output, onProgress, opts...)
}

// TranscodeWithProgress transcodes with progress reporting.
func (t *FFmpegTool) TranscodeWithProgress(ctx context.Context, input, output string, onProgress func(Progress), opts ...TranscodeOption) error {
	// Probe total duration for percent calculation.
	total := time.Duration(0)
	if info, err := DefaultFFprobe.Probe(ctx, input); err == nil {
		total = info.Duration
	}

	wrapped := func(p Progress) {
		if total > 0 {
			p.Percent = computePercent(p.OutTime, total)
		}
		if onProgress != nil {
			onProgress(p)
		}
	}

	o := DefaultTranscodeOptions()
	for _, opt := range opts {
		opt(&o)
	}

	cmd := NewCommand().LogLevel("error").Input(input)

	if o.NoVideo {
		cmd.NoVideo()
	} else {
		if o.VideoCodec != "" {
			cmd.VideoCodec(o.VideoCodec)
		}
		if o.VideoBitRate != "" {
			cmd.VideoBitRate(o.VideoBitRate)
		} else if o.CRF > 0 {
			cmd.CRF(o.CRF)
		}
		if o.Preset != "" {
			cmd.Preset(o.Preset)
		}
		if o.Tune != "" {
			cmd.Tune(o.Tune)
		}
		if o.PixelFormat != "" {
			cmd.PixelFormat(o.PixelFormat)
		}
		if o.FrameRate != "" {
			cmd.VideoFrameRate(o.FrameRate)
		}
		if o.ScaleWidth > 0 && o.ScaleHeight > 0 {
			if o.PadToSize {
				cmd.ScalePad(o.ScaleWidth, o.ScaleHeight)
			} else {
				cmd.ScaleKeepAspect(o.ScaleWidth, o.ScaleHeight)
			}
		}
	}

	if o.NoAudio {
		cmd.NoAudio()
	} else {
		if o.AudioCodec != "" {
			cmd.AudioCodec(o.AudioCodec)
		}
		if o.AudioBitRate != "" {
			cmd.AudioBitRate(o.AudioBitRate)
		}
		if o.SampleRate > 0 {
			cmd.AudioSampleRate(o.SampleRate)
		}
		if o.AudioChannels > 0 {
			cmd.AudioChannels(o.AudioChannels)
		}
	}

	if o.FastStart {
		cmd.MovFlagsFastStart()
	}
	cmd.Output(output)

	return t.Run(ctx, cmd.Args(), wrapped)
}

// ──────────────────────────────────────────────
// Remux (container change, no re-encoding)
// ──────────────────────────────────────────────

// Remux changes the container format without re-encoding (stream copy).
func Remux(ctx context.Context, input, output string) error {
	return DefaultFFmpeg.Remux(ctx, input, output)
}

// Remux changes the container format using this FFmpeg tool.
func (t *FFmpegTool) Remux(ctx context.Context, input, output string) error {
	cmd := NewCommand().
		LogLevel("error").
		Input(input).
		CopyVideo().
		CopyAudio().
		Output(output)
	return t.Run(ctx, cmd.Args(), nil)
}

// ──────────────────────────────────────────────
// Extract audio
// ──────────────────────────────────────────────

// ExtractAudio extracts the audio track from a video file.
func ExtractAudio(ctx context.Context, input, output string, codec string, bitrate string) error {
	return DefaultFFmpeg.ExtractAudio(ctx, input, output, codec, bitrate)
}

// ExtractAudio extracts the audio track using this FFmpeg tool.
func (t *FFmpegTool) ExtractAudio(ctx context.Context, input, output, codec, bitrate string) error {
	if codec == "" {
		codec = "aac"
	}
	if bitrate == "" {
		bitrate = "128k"
	}
	cmd := NewCommand().
		LogLevel("error").
		Input(input).
		NoVideo().
		AudioCodec(codec).
		AudioBitRate(bitrate).
		Output(output)
	return t.Run(ctx, cmd.Args(), nil)
}

// ──────────────────────────────────────────────
// Clip / trim
// ──────────────────────────────────────────────

// ClipOptions configures a clip extraction.
type ClipOptions struct {
	Start    float64 // start time in seconds (default: 0)
	End      float64 // end time in seconds (0 = until end)
	Duration float64 // duration in seconds (overrides End if set)
	Copy     bool    // if true, stream copy (no re-encoding, faster but less precise)
}

// ClipOption is a functional option for ClipOptions.
type ClipOption func(*ClipOptions)

// WithClipStart sets the clip start time.
func WithClipStart(seconds float64) ClipOption { return func(o *ClipOptions) { o.Start = seconds } }

// WithClipEnd sets the clip end time.
func WithClipEnd(seconds float64) ClipOption { return func(o *ClipOptions) { o.End = seconds } }

// WithClipDuration sets the clip duration.
func WithClipDuration(seconds float64) ClipOption {
	return func(o *ClipOptions) { o.Duration = seconds }
}

// WithClipCopy uses stream copy (no re-encoding).
func WithClipCopy() ClipOption { return func(o *ClipOptions) { o.Copy = true } }

// Clip extracts a segment from a video file.
func Clip(ctx context.Context, input, output string, opts ...ClipOption) error {
	return DefaultFFmpeg.Clip(ctx, input, output, opts...)
}

// Clip extracts a segment using this FFmpeg tool.
func (t *FFmpegTool) Clip(ctx context.Context, input, output string, opts ...ClipOption) error {
	o := ClipOptions{}
	for _, opt := range opts {
		opt(&o)
	}

	cmd := NewCommand().LogLevel("error")

	if o.Start > 0 {
		cmd.SeekTo(o.Start)
	}
	cmd.Input(input)
	if o.Duration > 0 {
		cmd.Duration(o.Duration)
	} else if o.End > 0 && o.Start > 0 {
		cmd.Duration(o.End - o.Start)
	} else if o.End > 0 {
		cmd.Duration(o.End)
	}

	if o.Copy {
		cmd.CopyVideo().CopyAudio()
	}

	cmd.Output(output)
	return t.Run(ctx, cmd.Args(), nil)
}

// ──────────────────────────────────────────────
// Concat
// ──────────────────────────────────────────────

// Concat concatenates multiple video files into one. All files should
// have the same codec and resolution. Uses the concat demuxer.
func Concat(ctx context.Context, inputs []string, output string) error {
	return DefaultFFmpeg.Concat(ctx, inputs, output)
}

// Concat concatenates multiple video files using this FFmpeg tool.
func (t *FFmpegTool) Concat(ctx context.Context, inputs []string, output string) error {
	if len(inputs) == 0 {
		return fmt.Errorf("videoutil: no input files for concat")
	}

	// Write concat list to a temp file (pipe:0 is not on the concat whitelist
	// in many ffmpeg builds).
	tmp, err := osCreateTemp("", "videoutil-concat-*.txt")
	if err != nil {
		return fmt.Errorf("videoutil: create concat list: %w", err)
	}
	tmpPath := tmp.Name()
	defer func() { _ = osRemove(tmpPath) }()

	var listContent strings.Builder
	for _, in := range inputs {
		// Escape single quotes in file paths for the concat demuxer.
		escaped := strings.ReplaceAll(in, "'", `'\''`)
		listContent.WriteString(fmt.Sprintf("file '%s'\n", escaped))
	}
	if _, err := tmp.WriteString(listContent.String()); err != nil {
		tmp.Close()
		return fmt.Errorf("videoutil: write concat list: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("videoutil: close concat list: %w", err)
	}

	cmd := NewCommand().
		LogLevel("error").
		Append("-f", "concat", "-safe", "0", "-i", tmpPath).
		CopyVideo().
		CopyAudio().
		Output(output)
	return t.Run(ctx, cmd.Args(), nil)
}
