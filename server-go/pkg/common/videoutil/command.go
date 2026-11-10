// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package videoutil

import (
	"fmt"
	"strconv"
	"strings"
)

// ──────────────────────────────────────────────
// Command builder — fluent FFmpeg command construction
// ──────────────────────────────────────────────

// Command is a fluent builder for FFmpeg command-line arguments.
// It does NOT execute anything — use FFmpegTool.Run to execute.
type Command struct {
	args []string
}

// NewCommand creates a new FFmpeg command with -y (overwrite) and
// -hide_banner as defaults.
func NewCommand() *Command {
	return &Command{args: []string{"-y", "-hide_banner"}}
}

// Args returns a copy of the accumulated arguments.
func (c *Command) Args() []string {
	out := make([]string, len(c.args))
	copy(out, c.args)
	return out
}

// String returns the full command as a space-joined string (for logging).
func (c *Command) String() string {
	return "ffmpeg " + strings.Join(c.args, " ")
}

// Append adds raw arguments. Returns c for chaining.
func (c *Command) Append(args ...string) *Command {
	c.args = append(c.args, args...)
	return c
}

// ── Global options ──

// LogLevel sets the log level: "quiet", "error", "warning", "info", etc.
func (c *Command) LogLevel(level string) *Command {
	return c.Append("-loglevel", level)
}

// Overwrite sets whether to overwrite output files. Default is true.
func (c *Command) Overwrite(on bool) *Command {
	if on {
		// -y is already the default; ensure it's present.
		for _, a := range c.args {
			if a == "-y" {
				return c
			}
		}
		return c.Append("-y")
	}
	// Remove -y, add -n.
	filtered := c.args[:0]
	for _, a := range c.args {
		if a != "-y" {
			filtered = append(filtered, a)
		}
	}
	c.args = filtered
	return c.Append("-n")
}

// ── Input options ──

// Input adds an input file. Can be called multiple times for multiple inputs.
func (c *Command) Input(path string) *Command {
	return c.Append("-i", path)
}

// InputFormat sets the input format (e.g. "mp4", "flv").
func (c *Command) InputFormat(format string) *Command {
	return c.Append("-f", format)
}

// SeekTo seeks to the given position before reading input (fast seek).
// Place before Input() for fast seeking, or after for accurate seeking.
func (c *Command) SeekTo(seconds float64) *Command {
	return c.Append("-ss", trimFloat(seconds))
}

// Duration limits the duration of the input (after -ss).
func (c *Command) Duration(seconds float64) *Command {
	return c.Append("-t", trimFloat(seconds))
}

// ── Video codec options ──

// VideoCodec sets the video codec (e.g. "libx264", "libx265", "copy").
func (c *Command) VideoCodec(codec string) *Command {
	return c.Append("-c:v", codec)
}

// CopyVideo copies the video stream without re-encoding.
func (c *Command) CopyVideo() *Command { return c.VideoCodec("copy") }

// CRF sets the Constant Rate Factor (quality) for x264/x265.
// Typical range: 0-51, lower = higher quality (18-28 is common).
func (c *Command) CRF(value int) *Command {
	return c.Append("-crf", strconv.Itoa(value))
}

// Preset sets the encoding preset (e.g. "ultrafast", "fast", "medium", "slow").
func (c *Command) Preset(preset string) *Command {
	return c.Append("-preset", preset)
}

// Tune sets the tuning (e.g. "film", "animation", "stillimage", "fastdecode").
func (c *Command) Tune(tune string) *Command {
	return c.Append("-tune", tune)
}

// VideoBitRate sets the video bitrate (e.g. "2M", "500k").
func (c *Command) VideoBitRate(bitrate string) *Command {
	return c.Append("-b:v", bitrate)
}

// VideoFrameRate sets the output frame rate (e.g. "30", "30000/1001").
func (c *Command) VideoFrameRate(fps string) *Command {
	return c.Append("-r", fps)
}

// MaxKeyInterval sets the maximum keyframe interval (GOP size).
func (c *Command) MaxKeyInterval(frames int) *Command {
	return c.Append("-g", strconv.Itoa(frames))
}

// PixelFormat sets the output pixel format (e.g. "yuv420p").
func (c *Command) PixelFormat(format string) *Command {
	return c.Append("-pix_fmt", format)
}

// MovFlagsFastStart moves the moov atom to the beginning for fast streaming.
func (c *Command) MovFlagsFastStart() *Command {
	return c.Append("-movflags", "+faststart")
}

// ── Audio codec options ──

// AudioCodec sets the audio codec (e.g. "aac", "mp3", "copy").
func (c *Command) AudioCodec(codec string) *Command {
	return c.Append("-c:a", codec)
}

// CopyAudio copies the audio stream without re-encoding.
func (c *Command) CopyAudio() *Command { return c.AudioCodec("copy") }

// AudioBitRate sets the audio bitrate (e.g. "128k", "192k").
func (c *Command) AudioBitRate(bitrate string) *Command {
	return c.Append("-b:a", bitrate)
}

// AudioSampleRate sets the audio sample rate (e.g. 44100, 48000).
func (c *Command) AudioSampleRate(hz int) *Command {
	return c.Append("-ar", strconv.Itoa(hz))
}

// AudioChannels sets the number of audio channels (1=mono, 2=stereo).
func (c *Command) AudioChannels(n int) *Command {
	return c.Append("-ac", strconv.Itoa(n))
}

// NoVideo drops the video stream (audio-only output).
func (c *Command) NoVideo() *Command { return c.Append("-vn") }

// NoAudio drops the audio stream (video-only output).
func (c *Command) NoAudio() *Command { return c.Append("-an") }

// ── Filter options ──

// VideoFilter sets the video filter chain (e.g. "scale=1280:720").
func (c *Command) VideoFilter(filter string) *Command {
	return c.Append("-vf", filter)
}

// VideoFilterComplex sets a complex filter graph.
func (c *Command) VideoFilterComplex(filter string) *Command {
	return c.Append("-filter_complex", filter)
}

// AudioFilter sets the audio filter chain.
func (c *Command) AudioFilter(filter string) *Command {
	return c.Append("-af", filter)
}

// Scale adds a scale filter to the video filter chain.
func (c *Command) Scale(width, height int) *Command {
	return c.VideoFilter(fmt.Sprintf("scale=%d:%d", width, height))
}

// ScaleKeepAspect scales to fit within width x height while keeping
// aspect ratio (no padding).
func (c *Command) ScaleKeepAspect(width, height int) *Command {
	return c.VideoFilter(fmt.Sprintf("scale=%d:%d:force_original_aspect_ratio=decrease", width, height))
}

// ScalePad scales to width x height, padding with black to maintain aspect.
func (c *Command) ScalePad(width, height int) *Command {
	return c.VideoFilter(fmt.Sprintf(
		"scale=%d:%d:force_original_aspect_ratio=decrease,pad=%d:%d:(ow-iw)/2:(oh-ih)/2:black",
		width, height, width, height))
}

// ── Stream mapping ──

// Map maps an input stream to output (e.g. "0:v:0", "0:a:0").
func (c *Command) Map(spec string) *Command {
	return c.Append("-map", spec)
}

// ── Output options ──

// Output sets the output file path.
func (c *Command) Output(path string) *Command {
	return c.Append(path)
}

// OutputFormat sets the output container format.
func (c *Command) OutputFormat(format string) *Command {
	return c.Append("-f", format)
}

// Frames limits the number of output video frames (useful for screenshots).
func (c *Command) Frames(n int) *Command {
	return c.Append("-frames:v", strconv.Itoa(n))
}

// ── Helpers ──

func trimFloat(f float64) string {
	s := fmt.Sprintf("%.3f", f)
	s = strings.TrimRight(s, "0")
	s = strings.TrimRight(s, ".")
	if s == "" {
		return "0"
	}
	return s
}
