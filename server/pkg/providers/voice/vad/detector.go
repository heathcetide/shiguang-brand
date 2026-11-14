// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: AGPL-3.0

package vad

import "time"

// EngineKind identifies the underlying VAD engine.
type EngineKind string

const (
	EngineEnergy  EngineKind = "energy"  // RMS + ZCR energy-based
	EngineWebRTC  EngineKind = "webrtc"  // WebRTC GMM
	EngineSilero  EngineKind = "silero"  // Silero neural (pure Go)
)

// FrameResult is the per-frame output of a Detector.
type FrameResult struct {
	// Probability is the speech probability in [0, 1] when available.
	// Energy-based detectors report 0 or 1; neural detectors report a float.
	Probability float64

	// IsSpeech is the boolean decision after thresholding.
	IsSpeech bool

	// RMS is the frame RMS amplitude (energy detectors only, 0 for others).
	RMS float64

	// Timestamp is when the frame was processed.
	Timestamp time.Time
}

// Detector is the unified VAD interface implemented by all engines.
//
// Implementations are NOT safe for concurrent use; protect calls with a
// mutex or create one per goroutine.
type Detector interface {
	// ProcessFrame analyzes a single PCM16 LE frame and returns the result.
	// The frame must be mono 16-bit little-endian PCM at the detector's
	// configured sample rate.
	ProcessFrame(pcm []byte) (FrameResult, error)

	// Kind returns the engine kind.
	Kind() EngineKind

	// SampleRate returns the configured sample rate (8000 or 16000).
	SampleRate() int

	// FrameDuration returns the frame duration in milliseconds.
	FrameDuration() int

	// Reset clears internal state for a new audio stream.
	Reset()

	// Close releases any resources.
	Close() error
}

// Config holds common VAD detector configuration.
type Config struct {
	// SampleRate is the audio sample rate. Must be 8000 or 16000.
	// Default: 16000.
	SampleRate int

	// FrameDurationMs is the frame duration in milliseconds.
	// Must be 10, 20, or 30. Default: 20 (energy/webrtc) or 32 (silero).
	FrameDurationMs int

	// Threshold is the speech probability threshold in [0, 1].
	// For energy detectors, this maps to an RMS threshold.
	// Default: 0.5.
	Threshold float64

	// MinSpeechFrames is the minimum consecutive speech frames before
	// declaring speech start. Default: 3.
	MinSpeechFrames int

	// HangoverFrames is the number of consecutive non-speech frames
	// before declaring speech end (debounce). Default: 15.
	HangoverFrames int

	// Mode is the aggressiveness for WebRTC (0-3). Default: 2.
	Mode int
}

// DefaultConfig returns production-ready defaults.
func DefaultConfig() Config {
	return Config{
		SampleRate:      16000,
		FrameDurationMs: 20,
		Threshold:       0.5,
		MinSpeechFrames: 3,
		HangoverFrames:  15,
		Mode:            2,
	}
}

// validate checks and fills defaults.
func (c *Config) validate() {
	if c.SampleRate != 8000 && c.SampleRate != 16000 {
		c.SampleRate = 16000
	}
	if c.FrameDurationMs <= 0 {
		if c.SampleRate == 16000 {
			c.FrameDurationMs = 20
		} else {
			c.FrameDurationMs = 20
		}
	}
	if c.Threshold <= 0 || c.Threshold > 1 {
		c.Threshold = 0.5
	}
	if c.MinSpeechFrames <= 0 {
		c.MinSpeechFrames = 3
	}
	if c.HangoverFrames <= 0 {
		c.HangoverFrames = 15
	}
	if c.Mode < 0 || c.Mode > 3 {
		c.Mode = 2
	}
}

// frameSampleCount returns the number of int16 samples per frame.
func (c *Config) frameSampleCount() int {
	return c.SampleRate * c.FrameDurationMs / 1000
}

// frameBytes returns the number of bytes per frame (2 bytes per int16 sample).
func (c *Config) frameBytes() int {
	return c.frameSampleCount() * 2
}
