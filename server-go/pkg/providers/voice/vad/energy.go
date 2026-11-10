// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: AGPL-3.0

package vad

import (
	"encoding/binary"
	"errors"
	"fmt"
	"math"
	"sync"
	"sync/atomic"
	"time"
)

// ErrInvalidDataType is returned when a component receives unexpected data.
var ErrInvalidDataType = errors.New("vad: invalid data type")

// ──────────────────────────────────────────────
// RMS + ZCR combined calculation (single pass)
// ──────────────────────────────────────────────

// rmsZcrPCM16LE computes both RMS amplitude and zero-crossing rate in a
// single pass over the PCM16 LE data, avoiding two separate iterations.
func rmsZcrPCM16LE(pcm []byte, maxZCR float64) (rms, zcr float64) {
	n := len(pcm) / 2
	if n < 2 {
		return 0, 0
	}

	var sum float64
	crossings := 0
	var prev int16

	for i := 0; i+1 < len(pcm); i += 2 {
		sample := int16(binary.LittleEndian.Uint16(pcm[i : i+2]))
		f := float64(sample)
		sum += f * f
		if i > 0 && (prev >= 0) != (sample >= 0) {
			crossings++
		}
		prev = sample
	}

	rms = math.Sqrt(sum / float64(n))
	zcr = float64(crossings) / float64(n-1)
	return
}

// rmsPCM16LE computes the RMS amplitude of PCM16 little-endian audio.
func rmsPCM16LE(pcm []byte) float64 {
	if len(pcm) < 2 {
		return 0
	}
	n := len(pcm) / 2
	var sum float64
	for i := 0; i+1 < len(pcm); i += 2 {
		v := int16(binary.LittleEndian.Uint16(pcm[i : i+2]))
		f := float64(v)
		sum += f * f
	}
	return math.Sqrt(sum / float64(n))
}

// zcrPCM16LE computes the zero-crossing rate (fraction of samples that
// cross zero) of PCM16 little-endian audio.
func zcrPCM16LE(pcm []byte) float64 {
	if len(pcm) < 4 {
		return 0
	}
	n := len(pcm) / 2
	if n < 2 {
		return 0
	}
	crossings := 0
	var prev int16
	for i := 0; i+1 < len(pcm); i += 2 {
		sample := int16(binary.LittleEndian.Uint16(pcm[i : i+2]))
		if i > 0 && (prev >= 0) != (sample >= 0) {
			crossings++
		}
		prev = sample
	}
	return float64(crossings) / float64(n-1)
}

// ──────────────────────────────────────────────
// PlaybackGate (for barge-in)
// ──────────────────────────────────────────────

type playbackGate struct {
	isPlaying   func() bool
	queueDepth  func() int
	tail        time.Duration
	lastActiveN atomic.Int64
}

func newPlaybackGate(isPlaying func() bool, queueDepth func() int, tail time.Duration) *playbackGate {
	return &playbackGate{isPlaying: isPlaying, queueDepth: queueDepth, tail: tail}
}

func (g *playbackGate) isStreaming() bool {
	if g == nil {
		return false
	}
	if g.isPlaying != nil && g.isPlaying() {
		g.lastActiveN.Store(time.Now().UnixNano())
		return true
	}
	return false
}

func (g *playbackGate) isQueued() bool {
	if g == nil || g.queueDepth == nil {
		return false
	}
	return g.queueDepth() > 0
}

func (g *playbackGate) isBargeInWindow() bool {
	if g == nil {
		return false
	}
	if g.isStreaming() || g.isQueued() {
		return true
	}
	if g.tail <= 0 {
		return false
	}
	last := g.lastActiveN.Load()
	if last == 0 {
		return false
	}
	return time.Since(time.Unix(0, last)) < g.tail
}

func (g *playbackGate) reset() {
	if g != nil {
		g.lastActiveN.Store(0)
	}
}

// ──────────────────────────────────────────────
// EnergyDetector — RMS + ZCR based VAD
// ──────────────────────────────────────────────

// EnergyConfig configures the energy-based VAD detector.
type EnergyConfig struct {
	SampleRate      int     // 8000 or 16000
	FrameDurationMs int     // 10, 20, or 30
	Threshold       float64 // RMS threshold (0 = auto-calibrate)
	MinSpeechFrames int     // consecutive frames to trigger speech
	HangoverFrames  int     // consecutive silence frames before speech end
	MaxZCR          float64 // max zero-crossing rate for speech (0.0-1.0, 0 = disable ZCR check)
	AdaptiveNoise   bool    // enable adaptive noise floor
	MaxNoiseSamples int     // max samples for noise floor estimation
}

// DefaultEnergyConfig returns production-ready energy VAD defaults.
func DefaultEnergyConfig() EnergyConfig {
	return EnergyConfig{
		SampleRate:      16000,
		FrameDurationMs: 20,
		Threshold:       1500.0,
		MinSpeechFrames: 3,
		HangoverFrames:  15,
		MaxZCR:          0.0,
		AdaptiveNoise:   true,
	}
}

// EnergyDetector is a production-grade energy + ZCR voice activity detector.
type EnergyDetector struct {
	mu          sync.Mutex
	cfg         EnergyConfig
	sampleRate  int
	frameMs     int

	// Adaptive noise floor — ring buffer to avoid slice front-shift.
	noiseRing       []float64
	noiseRingIdx    int
	noiseRingFilled bool
	noiseSum        float64 // running sum for O(1) average
	noiseLevel      float64
	adaptiveThreshold float64

	enabled      bool
	frameCounter int
	armed        bool

	// Barge-in integration
	gate            *playbackGate
	bargeInCallback func()
	logger          func(string)

	bargeIn   atomic.Bool
	playing   atomic.Bool
	threshold atomic.Uint64 // float64 bits
}

// NewEnergyDetectorWithConfig creates an energy VAD with explicit configuration.
func NewEnergyDetectorWithConfig(cfg EnergyConfig) *EnergyDetector {
	if cfg.SampleRate != 8000 && cfg.SampleRate != 16000 {
		cfg.SampleRate = 16000
	}
	if cfg.FrameDurationMs <= 0 {
		cfg.FrameDurationMs = 20
	}
	if cfg.Threshold <= 0 {
		cfg.Threshold = 1500.0
	}
	if cfg.MinSpeechFrames <= 0 {
		cfg.MinSpeechFrames = 3
	}
	if cfg.HangoverFrames <= 0 {
		cfg.HangoverFrames = 15
	}
	if cfg.MaxNoiseSamples <= 0 {
		cfg.MaxNoiseSamples = 20
	}
	d := &EnergyDetector{
		cfg:           cfg,
		sampleRate:    cfg.SampleRate,
		frameMs:       cfg.FrameDurationMs,
		enabled:       true,
		noiseRing:     make([]float64, cfg.MaxNoiseSamples),
		noiseRingIdx:  0,
		noiseRingFilled: false,
	}
	d.threshold.Store(math.Float64bits(cfg.Threshold))
	return d
}

// NewEnergyDetector builds a barge-in detector with sip-aligned defaults.
func NewEnergyDetector() *EnergyDetector {
	d := NewEnergyDetectorWithConfig(EnergyConfig{
		SampleRate:      16000,
		FrameDurationMs: 20,
		Threshold:       5500.0,
		MinSpeechFrames: 8,
		HangoverFrames:  15,
		AdaptiveNoise:   true,
	})
	d.gate = newPlaybackGate(func() bool { return d.playing.Load() }, nil, 0)
	d.bargeInCallback = func() { d.bargeIn.Store(true) }
	return d
}

func (d *EnergyDetector) Kind() EngineKind      { return EngineEnergy }
func (d *EnergyDetector) SampleRate() int        { return d.sampleRate }
func (d *EnergyDetector) FrameDuration() int     { return d.frameMs }
func (d *EnergyDetector) Close() error           { return nil }

// ProcessFrame implements the Detector interface.
func (d *EnergyDetector) ProcessFrame(pcm []byte) (FrameResult, error) {
	if d == nil {
		return FrameResult{}, errors.New("vad: nil detector")
	}
	if len(pcm) < 2 {
		return FrameResult{Timestamp: time.Now()}, nil
	}

	d.mu.Lock()
	defer d.mu.Unlock()

	// Single-pass RMS + ZCR computation.
	rms, zcr := rmsZcrPCM16LE(pcm, d.cfg.MaxZCR)

	if d.cfg.AdaptiveNoise {
		d.updateNoiseFloor(rms)
	}

	threshold := d.effectiveThreshold()
	isSpeech := rms > threshold

	if isSpeech && d.cfg.MaxZCR > 0 && zcr > d.cfg.MaxZCR {
		isSpeech = false
	}

	prob := 0.0
	if isSpeech {
		prob = 1.0
	} else if threshold > 0 {
		prob = math.Min(1.0, rms/threshold*0.5)
	}

	return FrameResult{
		Probability: prob,
		IsSpeech:    isSpeech,
		RMS:         rms,
		Timestamp:   time.Now(),
	}, nil
}

// Reset clears internal state.
func (d *EnergyDetector) Reset() {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.frameCounter = 0
	d.armed = false
	for i := range d.noiseRing {
		d.noiseRing[i] = 0
	}
	d.noiseRingIdx = 0
	d.noiseRingFilled = false
	d.noiseSum = 0
	d.noiseLevel = 0
	d.adaptiveThreshold = 0
	d.bargeIn.Store(false)
	if d.gate != nil {
		d.gate.reset()
	}
}

// updateNoiseFloor uses a ring buffer with running sum for O(1) updates.
func (d *EnergyDetector) updateNoiseFloor(rms float64) {
	if rms >= 350 {
		return
	}

	// If ring is full, subtract the oldest value from the running sum.
	if d.noiseRingFilled {
		d.noiseSum -= d.noiseRing[d.noiseRingIdx]
	}

	// Store new value and advance index.
	d.noiseRing[d.noiseRingIdx] = rms
	d.noiseSum += rms
	d.noiseRingIdx++
	if d.noiseRingIdx >= len(d.noiseRing) {
		d.noiseRingIdx = 0
		d.noiseRingFilled = true
	}

	// Compute average from running sum.
	count := d.noiseRingIdx
	if d.noiseRingFilled {
		count = len(d.noiseRing)
	}
	if count == 0 {
		return
	}

	d.noiseLevel = d.noiseSum / float64(count)
	d.adaptiveThreshold = d.noiseLevel * 4.0
	if d.adaptiveThreshold < 180 {
		d.adaptiveThreshold = 180
	}
	threshold := math.Float64frombits(d.threshold.Load())
	if d.adaptiveThreshold > threshold {
		d.adaptiveThreshold = threshold
	}
}

func (d *EnergyDetector) effectiveThreshold() float64 {
	threshold := math.Float64frombits(d.threshold.Load())
	if d.cfg.AdaptiveNoise && d.adaptiveThreshold > threshold {
		return d.adaptiveThreshold
	}
	return threshold
}

// ──────────────────────────────────────────────
// Barge-in API (legacy compatibility)
// ──────────────────────────────────────────────

func (d *EnergyDetector) SetLogFunc(fn func(string)) {
	if d == nil {
		return
	}
	d.mu.Lock()
	d.logger = fn
	d.mu.Unlock()
}

func (d *EnergyDetector) CheckBargeIn(pcmData []byte, synthPlaying bool) bool {
	if d == nil || len(pcmData) < 2 || !d.enabled {
		return false
	}
	d.playing.Store(synthPlaying)
	if !synthPlaying {
		d.bargeIn.Store(false)
		d.Reset()
		return false
	}

	d.mu.Lock()
	if d.gate == nil {
		d.mu.Unlock()
		return false
	}

	if !d.gate.isBargeInWindow() {
		d.frameCounter = 0
		d.armed = false
		d.mu.Unlock()
		return false
	}

	rms, _ := rmsZcrPCM16LE(pcmData, 0)
	if d.cfg.AdaptiveNoise {
		d.updateNoiseFloor(rms)
	}
	threshold := d.effectiveThreshold()

	var cb func()
	if rms > threshold {
		d.frameCounter++
		if d.frameCounter >= d.cfg.MinSpeechFrames && !d.armed {
			d.armed = true
			d.frameCounter = 0
			if d.logger != nil {
				d.logger(fmt.Sprintf("[VAD] barge-in: rms=%.0f threshold=%.0f", rms, threshold))
			}
			cb = d.bargeInCallback
		}
	} else {
		d.frameCounter = 0
	}
	d.mu.Unlock()

	if cb != nil {
		cb()
	}

	if d.bargeIn.Load() {
		d.bargeIn.Store(false)
		return true
	}
	return false
}

func (d *EnergyDetector) SetBargeInCallback(fn func()) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.bargeInCallback = func() {
		if fn != nil {
			fn()
		}
		d.bargeIn.Store(true)
	}
}

func (d *EnergyDetector) SetEnabled(enabled bool) {
	if d == nil {
		return
	}
	d.mu.Lock()
	d.enabled = enabled
	if !enabled {
		d.frameCounter = 0
		d.armed = false
		d.bargeIn.Store(false)
	}
	d.mu.Unlock()
}

func (d *EnergyDetector) Enabled() bool { return d != nil && d.enabled }

func (d *EnergyDetector) Threshold() float64 {
	if d == nil {
		return 0
	}
	return math.Float64frombits(d.threshold.Load())
}

func (d *EnergyDetector) SetThreshold(threshold float64) {
	if d != nil {
		d.threshold.Store(math.Float64bits(threshold))
	}
}

func (d *EnergyDetector) SetConsecutiveFrames(frames int) {
	if d == nil {
		return
	}
	d.mu.Lock()
	d.cfg.MinSpeechFrames = frames
	d.mu.Unlock()
}

func (d *EnergyDetector) UserSpeechLikely(pcmData []byte) bool {
	if d == nil || len(pcmData) < 2 || !d.enabled {
		return false
	}
	thr := math.Float64frombits(d.threshold.Load())
	if thr <= 0 {
		thr = 5500.0
	}
	return CalculateRMS(pcmData) > thr
}

// CalculateRMS computes RMS for PCM16LE frames.
func CalculateRMS(pcmData []byte) float64 {
	if len(pcmData) < 2 {
		return 0
	}
	return rmsPCM16LE(pcmData)
}

// CalculateZCR computes the zero-crossing rate for PCM16LE frames.
func CalculateZCR(pcmData []byte) float64 {
	return zcrPCM16LE(pcmData)
}
