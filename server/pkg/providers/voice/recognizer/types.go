// Package recognizer defines the core types and interfaces for speech recognition (ASR).
//
// This is the vendor-agnostic core package. Vendor-specific implementations
// live in submodules (e.g. recognizer/volcengine, recognizer/qcloud).
package recognizer

import (
	"context"
	"time"
)

// Result represents a single recognition result.
type Result struct {
	Text      string    `json:"text"`
	IsFinal   bool      `json:"is_final"`
	Timestamp time.Time `json:"timestamp"`
	Error     error     `json:"error,omitempty"`
}

// ResultCallback defines the callback for handling recognition results.
type ResultCallback func(*Result)

// ResultFunc is the callback for successful speech recognition results.
// text: recognized text
// isLast: true if this is the final result for the current utterance
// duration: time since the recognition request started
// dialogID: unique identifier for the current dialog/utterance
type ResultFunc func(text string, isLast bool, duration time.Duration, dialogID string)

// ErrorFunc is the callback for recognition errors.
// isFatal indicates whether the error is fatal (requires restart) or transient.
type ErrorFunc func(err error, isFatal bool)

// HotWord represents a hot word for boosting recognition accuracy.
type HotWord struct {
	Word   string `json:"word"`
	Weight int    `json:"weight"`
}

// Engine is the core ASR engine interface that all vendors implement.
// This matches the SpeechRecognitionEngine interface from LingEchoX.
type Engine interface {
	// Init registers the result and error callbacks.
	Init(resultCallback ResultFunc, errorCallback ErrorFunc)
	// Vendor returns the vendor identifier string.
	Vendor() string
	// ConnAndReceive establishes connection and starts receiving results.
	// dialogID is a unique identifier for the current dialog.
	ConnAndReceive(dialogID string) error
	// Activity returns true if the engine is actively connected.
	Activity() bool
	// RestartClient restarts the underlying client connection.
	RestartClient()
	// SendAudioBytes sends audio data for recognition.
	SendAudioBytes(data []byte) error
	// SendEnd signals end of audio stream.
	SendEnd() error
	// StopConn stops the connection and cleans up resources.
	StopConn() error
}

// ComputeSampleByteCount computes the number of bytes for audio samples
// based on sample rate, bit depth, and number of channels.
// Formula: (sampleRate * bitDepth * channels) / 8
func ComputeSampleByteCount(sampleRate, bitDepth, channels int) int {
	return (sampleRate * bitDepth * channels) / 8
}

// TimeoutConfig holds timeout settings for ASR clients.
type TimeoutConfig struct {
	Send time.Duration
	Read time.Duration
}

// DefaultTimeoutConfig returns default timeout settings.
func DefaultTimeoutConfig() TimeoutConfig {
	return TimeoutConfig{
		Send: 10 * time.Second,
		Read: 30 * time.Second,
	}
}

// ErrClientClosed is returned when the ASR client is closed.
var ErrClientClosed = errClientClosed("asr client closed")

// errClientClosed is a typed error for client closure.
type errClientClosed string

func (e errClientClosed) Error() string { return string(e) }

// Is implements errors.Is for errClientClosed.
func (e errClientClosed) Is(target error) bool {
	_, ok := target.(errClientClosed)
	return ok
}

// Ensure context is referenced.
var _ = context.Background
