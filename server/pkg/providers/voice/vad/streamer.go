// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: AGPL-3.0

package vad

import (
	"errors"
	"sync"
	"sync/atomic"
	"time"
)

// EventType identifies a speech state transition.
type EventType int

const (
	EventNone        EventType = iota
	EventSpeechStart           // speech segment started
	EventSpeechEnd             // speech segment ended
)

// Event is a speech state transition emitted by Streamer.
type Event struct {
	Type      EventType
	Timestamp time.Time
	// FrameIndex is the sequential frame number since the stream started.
	FrameIndex int
	// Probability is the speech probability at the transition frame.
	Probability float64
}

// String returns a human-readable description.
func (e Event) String() string {
	switch e.Type {
	case EventSpeechStart:
		return "speech_start"
	case EventSpeechEnd:
		return "speech_end"
	default:
		return "none"
	}
}

// StreamerConfig holds Streamer-specific configuration.
type StreamerConfig struct {
	// MinSpeechFrames is the minimum consecutive speech frames before
	// declaring speech start. Default: 3.
	MinSpeechFrames int

	// HangoverFrames is the number of consecutive non-speech frames
	// before declaring speech end (debounce). Default: 15.
	HangoverFrames int

	// PreSpeechBufferFrames is the number of audio frames to buffer before
	// the speech start point. When a SpeechStart event fires, the buffered
	// frames are available via PreSpeechAudio(). This captures the lead-in
	// audio that would otherwise be lost during the MinSpeechFrames delay.
	// Default: 0 (disabled).
	PreSpeechBufferFrames int
}

// Streamer wraps a Detector with a state machine that emits SpeechStart /
// SpeechEnd events. It implements hangover (debounce) so brief silence gaps
// within a speech segment don't cause false ends.
//
// Streamer is safe for concurrent use: ProcessFrame can be called from the
// audio goroutine while events are consumed from another goroutine via
// Events() channel.
type Streamer struct {
	detector Detector
	cfg      StreamerConfig

	mu           sync.Mutex
	speechActive bool
	frameIndex   int
	speechFrames int // consecutive speech frames
	silenceFrames int // consecutive non-speech frames in hangover
	lastEvent    Event

	// Pre-speech audio buffer (ring buffer of PCM frames).
	preSpeechBuf   [][]byte
	preSpeechIdx   int
	preSpeechCount int

	// Hot-path reads use atomics to avoid mutex contention.
	speechActiveAtomic atomic.Bool
	frameIndexAtomic   atomic.Int64

	eventCh chan Event
	done    chan struct{}
}

// NewStreamer creates a streaming VAD state machine over the given detector.
// The config controls MinSpeechFrames (onset) and HangoverFrames (offset
// debounce).
func NewStreamer(detector Detector, cfg Config) *Streamer {
	cfg.validate()
	return newStreamerInternal(detector, StreamerConfig{
		MinSpeechFrames: cfg.MinSpeechFrames,
		HangoverFrames:  cfg.HangoverFrames,
	})
}

// NewStreamerExplicit creates a streaming VAD state machine with explicit
// StreamerConfig, including PreSpeechBufferFrames.
func NewStreamerExplicit(detector Detector, cfg StreamerConfig) *Streamer {
	return newStreamerInternal(detector, cfg)
}

// newStreamerInternal is the shared constructor.
func newStreamerInternal(detector Detector, cfg StreamerConfig) *Streamer {
	if cfg.MinSpeechFrames <= 0 {
		cfg.MinSpeechFrames = 3
	}
	if cfg.HangoverFrames <= 0 {
		cfg.HangoverFrames = 15
	}
	s := &Streamer{
		detector: detector,
		cfg:      cfg,
		eventCh:  make(chan Event, 16),
		done:     make(chan struct{}),
	}
	if cfg.PreSpeechBufferFrames > 0 {
		// Pre-allocate all ring buffer slots to avoid per-frame allocation.
		// Each slot is sized for the worst-case frame (32ms @ 16kHz = 1024 bytes).
		// Smaller frames just use the first len(pcm) bytes.
		s.preSpeechBuf = make([][]byte, cfg.PreSpeechBufferFrames)
		for i := range s.preSpeechBuf {
			s.preSpeechBuf[i] = make([]byte, 0, 1024)
		}
	}
	return s
}

// ProcessFrame feeds a PCM16 LE frame to the detector and updates the state
// machine. Returns the FrameResult from the underlying detector.
func (s *Streamer) ProcessFrame(pcm []byte) (FrameResult, error) {
	if s == nil || s.detector == nil {
		return FrameResult{}, errors.New("vad: nil streamer or detector")
	}

	result, err := s.detector.ProcessFrame(pcm)
	if err != nil {
		return result, err
	}

	s.mu.Lock()
	s.frameIndex++
	s.frameIndexAtomic.Store(int64(s.frameIndex))
	event := Event{
		Type:        EventNone,
		Timestamp:   result.Timestamp,
		FrameIndex:  s.frameIndex,
		Probability: result.Probability,
	}

	// Buffer pre-speech audio (ring buffer, zero-alloc: reuse pre-allocated slots).
	if s.preSpeechBuf != nil && !s.speechActive {
		slot := s.preSpeechBuf[s.preSpeechIdx][:0]
		s.preSpeechBuf[s.preSpeechIdx] = append(slot, pcm...)
		s.preSpeechIdx = (s.preSpeechIdx + 1) % len(s.preSpeechBuf)
		if s.preSpeechCount < len(s.preSpeechBuf) {
			s.preSpeechCount++
		}
	}

	if result.IsSpeech {
		s.silenceFrames = 0
		s.speechFrames++

		if !s.speechActive && s.speechFrames >= s.cfg.MinSpeechFrames {
			s.speechActive = true
			s.speechActiveAtomic.Store(true)
			event.Type = EventSpeechStart
		}
	} else {
		s.speechFrames = 0
		if s.speechActive {
			s.silenceFrames++
			if s.silenceFrames >= s.cfg.HangoverFrames {
				s.speechActive = false
				s.speechActiveAtomic.Store(false)
				s.silenceFrames = 0
				event.Type = EventSpeechEnd
			}
		}
	}

	if event.Type != EventNone {
		s.lastEvent = event
		// On SpeechEnd, reset the underlying detector to clear LSTM state
		// (Silero) and adaptive noise floor (Energy).
		if event.Type == EventSpeechEnd && s.detector != nil {
			s.detector.Reset()
		}
		// Clear pre-speech buffer on speech end.
		if event.Type == EventSpeechEnd {
			s.preSpeechCount = 0
			s.preSpeechIdx = 0
		}
		s.mu.Unlock()
		// Non-blocking send; drop if consumer is slow.
		select {
		case s.eventCh <- event:
		default:
		}
	} else {
		s.mu.Unlock()
	}

	return result, nil
}

// Events returns a channel of speech state transitions.
func (s *Streamer) Events() <-chan Event {
	return s.eventCh
}

// IsSpeech returns the current speech state (after hangover smoothing).
// Uses atomic read for lock-free hot-path access.
func (s *Streamer) IsSpeech() bool {
	return s.speechActiveAtomic.Load()
}

// FrameIndex returns the total number of frames processed.
// Uses atomic read for lock-free hot-path access.
func (s *Streamer) FrameIndex() int {
	return int(s.frameIndexAtomic.Load())
}

// LastEvent returns the most recent transition event.
func (s *Streamer) LastEvent() Event {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.lastEvent
}

// PreSpeechAudio returns the buffered audio frames leading up to the most
// recent SpeechStart event. The frames are in chronological order.
//
// This is useful when you need to capture the beginning of a speech segment
// that was "eaten" by the MinSpeechFrames onset delay. The returned slice
// is a copy; the caller may modify it freely.
//
// Returns nil if PreSpeechBufferFrames is 0 or no audio is buffered.
func (s *Streamer) PreSpeechAudio() [][]byte {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.preSpeechCount == 0 {
		return nil
	}
	out := make([][]byte, s.preSpeechCount)
	// Read from ring buffer in chronological order.
	start := s.preSpeechIdx - s.preSpeechCount
	if start < 0 {
		start += len(s.preSpeechBuf)
	}
	for i := 0; i < s.preSpeechCount; i++ {
		idx := (start + i) % len(s.preSpeechBuf)
		out[i] = append([]byte(nil), s.preSpeechBuf[idx]...)
	}
	return out
}

// Reset clears the state machine and underlying detector.
func (s *Streamer) Reset() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.speechActive = false
	s.speechActiveAtomic.Store(false)
	s.speechFrames = 0
	s.silenceFrames = 0
	s.frameIndex = 0
	s.frameIndexAtomic.Store(0)
	s.lastEvent = Event{}
	s.preSpeechCount = 0
	s.preSpeechIdx = 0
	if s.detector != nil {
		s.detector.Reset()
	}
}

// Close releases resources. After Close, the Events channel is closed.
func (s *Streamer) Close() error {
	if s == nil {
		return nil
	}
	select {
	case <-s.done:
		return nil
	default:
	}
	close(s.done)
	close(s.eventCh)
	if s.detector != nil {
		return s.detector.Close()
	}
	return nil
}

// Done returns a channel that is closed when Close is called.
func (s *Streamer) Done() <-chan struct{} {
	return s.done
}
