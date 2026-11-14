// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: AGPL-3.0

package vad

import (
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/GanymedeNil/go-webrtcvad"
)

// WebRTCDetector wraps Google's WebRTC voice-activity detector behind the
// unified Detector interface.
//
// The WebRTC VAD uses a Gaussian Mixture Model (GMM) over six sub-band
// energies to classify frames as speech or non-speech. It's more
// discriminating than pure energy thresholding — it can distinguish
// speech from steady tones and hum — while maintaining low latency
// (~20ms per frame).
//
// Requirements: 8kHz or 16kHz mono PCM16 LE. Frame duration must be
// 10, 20, or 30ms.
type WebRTCDetector struct {
	mu         sync.Mutex
	vad        *webrtcvad.VAD
	sampleRate int
	frameMs    int
	mode       int
}

// NewWebRTCDetector creates a WebRTC VAD detector.
// mode: 0 (least aggressive) to 3 (most aggressive). Default: 2.
func NewWebRTCDetector(sampleRate, frameMs, mode int) (*WebRTCDetector, error) {
	if sampleRate != 8000 && sampleRate != 16000 && sampleRate != 32000 && sampleRate != 48000 {
		return nil, fmt.Errorf("webrtc vad: unsupported sample rate %d", sampleRate)
	}
	if frameMs != 10 && frameMs != 20 && frameMs != 30 {
		frameMs = 20
	}
	if mode < 0 || mode > 3 {
		mode = 2
	}
	v, err := webrtcvad.New()
	if err != nil {
		return nil, fmt.Errorf("webrtc vad: %w", err)
	}
	if err := v.SetMode(mode); err != nil {
		return nil, fmt.Errorf("webrtc vad: set mode: %w", err)
	}
	return &WebRTCDetector{
		vad:        v,
		sampleRate: sampleRate,
		frameMs:    frameMs,
		mode:       mode,
	}, nil
}

// Kind returns the engine kind.
func (w *WebRTCDetector) Kind() EngineKind { return EngineWebRTC }

// SampleRate returns the configured sample rate.
func (w *WebRTCDetector) SampleRate() int { return w.sampleRate }

// FrameDuration returns the frame duration in milliseconds.
func (w *WebRTCDetector) FrameDuration() int { return w.frameMs }

// Close releases resources.
func (w *WebRTCDetector) Close() error { return nil }

// ProcessFrame implements the Detector interface.
func (w *WebRTCDetector) ProcessFrame(pcm []byte) (FrameResult, error) {
	if w == nil || w.vad == nil {
		return FrameResult{}, errors.New("vad: nil webrtc detector")
	}
	if len(pcm) < 2 {
		return FrameResult{Timestamp: time.Now()}, nil
	}

	w.mu.Lock()
	defer w.mu.Unlock()

	active, err := w.vad.Process(w.sampleRate, pcm)
	if err != nil {
		return FrameResult{}, fmt.Errorf("webrtc vad: %w", err)
	}

	prob := 0.0
	if active {
		prob = 1.0
	}

	return FrameResult{
		Probability: prob,
		IsSpeech:    active,
		Timestamp:   time.Now(),
	}, nil
}

// Reset clears internal state (no-op for WebRTC VAD, which is stateless
// per frame).
func (w *WebRTCDetector) Reset() {
	// WebRTC VAD is stateless per-frame; no reset needed.
}

// SetMode sets the aggressiveness (0-3).
func (w *WebRTCDetector) SetMode(mode int) error {
	if mode < 0 || mode > 3 {
		return fmt.Errorf("webrtc vad: invalid mode %d", mode)
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	w.mode = mode
	return w.vad.SetMode(mode)
}

// Mode returns the current aggressiveness mode.
func (w *WebRTCDetector) Mode() int {
	return w.mode
}
