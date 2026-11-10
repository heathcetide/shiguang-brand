// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package videoutil provides a high-level Go wrapper around FFmpeg and
// FFprobe for video processing tasks including transcoding, screenshot
// extraction, watermarking, and media probing.
//
// # Design
//
// The package is a pure library — no web framework, no job manager, no
// global state. All operations are context-aware (cancelable, timeout-
// able) and return explicit errors.
//
// Three layers of API are provided:
//
//  1. **Preset functions** — one-call helpers for common tasks:
//     TranscodeMP4, Screenshot, AddImageWatermark, AddTextWatermark, etc.
//
//  2. **Command builder** — a fluent builder for custom FFmpeg commands:
//     videoutil.NewCommand().Input("in.mp4").VideoCodec("libx264")...
//
//  3. **FFmpeg/FFprobe tools** — low-level execution with progress
//     callbacks, pipe support, and binary auto-detection.
//
// # Quick start
//
//	// Transcode to MP4 (H.264 + AAC)
//	err := videoutil.TranscodeMP4("input.mov", "output.mp4",
//	    videoutil.WithCRF(23), videoutil.WithPreset("medium"))
//
//	// Extract a screenshot at 10 seconds
//	err := videoutil.Screenshot("input.mp4", "thumb.jpg", 10.0,
//	    videoutil.WithScreenshotSize(1280, 720))
//
//	// Add an image watermark
//	err := videoutil.AddImageWatermark("input.mp4", "logo.png", "output.mp4",
//	    videoutil.WithWatermarkPosition(videoutil.PositionBottomRight))
//
//	// Probe media info
//	info, err := videoutil.Probe("input.mp4")
//	fmt.Printf("Duration: %.1fs, Resolution: %dx%d\n",
//	    info.Duration.Seconds(), info.Video.Width, info.Video.Height)
package videoutil

import (
	"time"
)

// ──────────────────────────────────────────────
// Media info types (from ffprobe)
// ──────────────────────────────────────────────

// MediaInfo holds probed metadata about a media file.
type MediaInfo struct {
	Filename string            `json:"filename"`
	Format   string            `json:"format"`   // container format (e.g. "mp4")
	Duration time.Duration     `json:"duration"` // total duration
	Size     int64             `json:"size"`     // file size in bytes
	BitRate  int64             `json:"bitRate"`  // overall bitrate (bps)
	Video    *VideoStream      `json:"video"`    // first video stream (nil if none)
	Audio    *AudioStream      `json:"audio"`    // first audio stream (nil if none)
	Streams  []StreamInfo      `json:"streams"`  // all streams
	Tags     map[string]string `json:"tags"`     // format-level tags
}

// VideoStream holds metadata about a video stream.
type VideoStream struct {
	Index       int               `json:"index"`
	Codec       string            `json:"codec"` // e.g. "h264", "hevc"
	Profile     string            `json:"profile"`
	Width       int               `json:"width"`
	Height      int               `json:"height"`
	PixelFormat string            `json:"pixelFormat"`
	FPS         float64           `json:"fps"`     // frames per second
	BitRate     int64             `json:"bitRate"` // video bitrate (bps, 0 if unknown)
	Duration    time.Duration     `json:"duration"`
	IsHDR       bool              `json:"isHdr"`
	Tags        map[string]string `json:"tags"`
}

// AudioStream holds metadata about an audio stream.
type AudioStream struct {
	Index         int               `json:"index"`
	Codec         string            `json:"codec"` // e.g. "aac", "mp3"
	Profile       string            `json:"profile"`
	SampleRate    int               `json:"sampleRate"` // Hz
	Channels      int               `json:"channels"`
	ChannelLayout string            `json:"channelLayout"` // e.g. "stereo", "mono"
	BitRate       int64             `json:"bitRate"`
	Duration      time.Duration     `json:"duration"`
	Tags          map[string]string `json:"tags"`
}

// StreamInfo holds metadata about any stream (video, audio, subtitle, etc.).
type StreamInfo struct {
	Index      int               `json:"index"`
	Codec      string            `json:"codec"`
	CodecType  string            `json:"codecType"` // "video", "audio", "subtitle", etc.
	CodecLong  string            `json:"codecLong"`
	Width      int               `json:"width"`
	Height     int               `json:"height"`
	SampleRate int               `json:"sampleRate"`
	Channels   int               `json:"channels"`
	Duration   string            `json:"duration"`
	Tags       map[string]string `json:"tags"`
}

// ──────────────────────────────────────────────
// Progress type
// ──────────────────────────────────────────────

// Progress represents FFmpeg processing progress, reported via the
// -progress pipe:1 output.
type Progress struct {
	Frame   int           `json:"frame"`   // total frames processed
	FPS     float64       `json:"fps"`     // processing speed in frames/sec
	BitRate string        `json:"bitRate"` // current output bitrate
	Speed   string        `json:"speed"`   // processing speed (e.g. "1.5x")
	OutTime time.Duration `json:"outTime"` // output time
	Done    bool          `json:"done"`    // whether processing is complete
	// Percent is an estimate of completion (0-100), computed from
	// OutTime and the total duration if known. 0 if unknown.
	Percent float64 `json:"percent"`
	// Extra holds any unrecognized progress fields.
	Extra map[string]string `json:"extra,omitempty"`
}

// ──────────────────────────────────────────────
// Position type (for watermarks, overlays)
// ──────────────────────────────────────────────

// Position specifies where to place an overlay (watermark, logo, etc.)
// on the video frame.
type Position int

const (
	PositionTopLeft     Position = iota // top-left corner
	PositionTopRight                    // top-right corner
	PositionBottomLeft                  // bottom-left corner
	PositionBottomRight                 // bottom-right corner
	PositionCenter                      // center of the frame
)
