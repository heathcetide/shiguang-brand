// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: AGPL-3.0

package vad

import (
	"errors"
	"math"
	"time"

	"github.com/zserge/govad"
)

// SileroDetector wraps the pure-Go Silero VAD neural network (govad)
// behind the unified Detector interface.
//
// Silero VAD is a neural network (Conv-STFT → Conv1d layers → LSTM → sigmoid)
// that outputs a speech probability per 32ms frame. It provides far better
// discrimination than energy-based VAD — tones, hum, and stationary noise
// don't trigger it — at the cost of higher latency (~32ms per frame).
//
// This wrapper handles:
//   - PCM16 LE → float32 conversion
//   - Frame buffering (govad requires exactly 512 samples = 32ms @ 16kHz)
//   - Probability thresholding
//
// Requirements: 16kHz mono audio. 8kHz is not supported by the embedded model.
type SileroDetector struct {
	vad        *govad.VAD
	threshold  float64
	sampleRate int
	frameMs    int

	// Ring buffer for accumulating samples when input frames don't match
	// govad.SamplesPerFrame (512 samples). Using a pre-allocated buffer
	// avoids per-frame heap allocations.
	sampleBuf []float32

	// inferenceFrame is a pre-allocated slice reused across ProcessFrame
	// calls to avoid per-frame make([]float32, 512) allocations.
	inferenceFrame []float32
}

// NewSileroDetector creates a Silero VAD detector with the given threshold.
// The sample rate must be 16000 (the only rate supported by the embedded
// Silero v5 model).
func NewSileroDetector(threshold float64) (*SileroDetector, error) {
	if threshold <= 0 || threshold > 1 {
		threshold = 0.5
	}
	v, err := govad.New()
	if err != nil {
		return nil, err
	}
	return &SileroDetector{
		vad:            v,
		threshold:      threshold,
		sampleRate:     16000,
		frameMs:        32, // 512 samples / 16000 Hz = 32ms
		sampleBuf:      make([]float32, 0, govad.SamplesPerFrame*2),
		inferenceFrame: make([]float32, govad.SamplesPerFrame),
	}, nil
}

// Kind returns the engine kind.
func (s *SileroDetector) Kind() EngineKind { return EngineSilero }

// SampleRate returns the configured sample rate (always 16000 for Silero).
func (s *SileroDetector) SampleRate() int { return s.sampleRate }

// FrameDuration returns the frame duration in milliseconds (32 for Silero).
func (s *SileroDetector) FrameDuration() int { return s.frameMs }

// Close releases resources.
func (s *SileroDetector) Close() error { return nil }

// ProcessFrame implements the Detector interface.
//
// The input pcm must be PCM16 LE mono at 16kHz. The frame size can be any
// multiple of 2 bytes; internally the detector buffers samples until it has
// exactly govad.SamplesPerFrame (512) samples, then runs inference.
//
// If the input frame doesn't contain enough samples for a full inference
// window, the returned FrameResult will have IsSpeech=false and
// Probability=0 (partial frame buffered). When enough samples accumulate,
// the result reflects the inference output.
func (s *SileroDetector) ProcessFrame(pcm []byte) (FrameResult, error) {
	if s == nil || s.vad == nil {
		return FrameResult{}, errors.New("vad: nil silero detector")
	}
	if len(pcm) < 2 {
		return FrameResult{Timestamp: time.Now()}, nil
	}

	// Convert PCM16 LE → float32 and append to buffer.
	// Inline conversion to avoid pcm16LEToFloat32 allocation.
	n := len(pcm) / 2
	// Grow sampleBuf if needed (rare; only when input frames are large).
	if cap(s.sampleBuf) < len(s.sampleBuf)+n {
		newCap := cap(s.sampleBuf) * 2
		if newCap < len(s.sampleBuf)+n {
			newCap = len(s.sampleBuf) + n
		}
		newBuf := make([]float32, len(s.sampleBuf), newCap)
		copy(newBuf, s.sampleBuf)
		s.sampleBuf = newBuf
	}
	for i := 0; i < n; i++ {
		sample := int16(uint16(pcm[i*2]) | uint16(pcm[i*2+1])<<8)
		s.sampleBuf = append(s.sampleBuf, float32(sample)/32768.0)
	}

	// Need exactly SamplesPerFrame (512) samples per inference call
	needed := govad.SamplesPerFrame
	if len(s.sampleBuf) < needed {
		return FrameResult{
			Probability: 0,
			IsSpeech:    false,
			Timestamp:   time.Now(),
		}, nil
	}

	// Copy first 512 samples into pre-allocated inference frame.
	// We can't pass s.sampleBuf[:needed] directly to vad.Process because
	// vad.Process may store the slice internally; using a stable buffer
	// avoids aliasing issues.
	copy(s.inferenceFrame, s.sampleBuf[:needed])

	// Compact the remaining samples (shift left without allocation).
	remaining := len(s.sampleBuf) - needed
	if remaining > 0 {
		copy(s.sampleBuf, s.sampleBuf[needed:])
	}
	s.sampleBuf = s.sampleBuf[:remaining]

	prob := float64(s.vad.Process(s.inferenceFrame))
	isSpeech := prob >= s.threshold

	// Clamp probability to [0, 1]
	prob = math.Max(0, math.Min(1, prob))

	return FrameResult{
		Probability: prob,
		IsSpeech:    isSpeech,
		Timestamp:   time.Now(),
	}, nil
}

// Reset clears the LSTM state for a new audio stream.
func (s *SileroDetector) Reset() {
	if s == nil || s.vad == nil {
		return
	}
	s.vad.Reset()
	s.sampleBuf = s.sampleBuf[:0]
}

// SetThreshold adjusts the speech probability threshold.
func (s *SileroDetector) SetThreshold(threshold float64) {
	if threshold > 0 && threshold <= 1 {
		s.threshold = threshold
	}
}

// Threshold returns the current threshold.
func (s *SileroDetector) Threshold() float64 {
	return s.threshold
}
