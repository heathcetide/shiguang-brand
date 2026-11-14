// Package synthesizer defines the core types and interfaces for text-to-speech synthesis.
//
// This is the provider-agnostic core package. Vendor-specific implementations
// live in submodules (e.g. synthesizer/aliyun, synthesizer/openai, synthesizer/volcengine).
package synthesizer

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"regexp"
	"time"
)

// TTS provider string constants (matching LingEchoX naming for compatibility).
const (
	TTS_QCLOUD            = "tts.qcloud"
	TTS_XUNFEI            = "tts.xunfei"
	TTS_QINIU             = "tts.qiniu"
	TTS_BAIDU             = "tts.baidu"
	TTS_GOOGLE            = "tts.google"
	TTS_AWS               = "tts.aws"
	TTS_AZURE             = "tts.azure"
	TTS_OPENAI            = "tts.openai"
	TTS_ELEVENLABS        = "tts.elevenlabs"
	TTS_LOCAL             = "tts.local"
	TTS_LOCAL_GOSPEECH    = "tts.local_gospeech"
	TTS_FISHSPEECH        = "tts.fishspeech"
	TTS_FISHAUDIO         = "tts.fishaudio"
	TTS_COQUI             = "tts.coqui"
	TTS_VOLCENGINE        = "tts.volcengine"
	TTS_VOLCENGINE_CLONE  = "tts.volcengine_clone"
	TTS_VOLCENGINE_LLM    = "tts.volcengine_llm"
	TTS_VOLCENGINE_STREAM = "tts.volcengine_stream"
	TTS_MINIMAX           = "tts.minimax"
	TTS_ALIYUN            = "tts.aliyun"
)

// Provider identifies a TTS service vendor.
type Provider string

const (
	ProviderQiniu           Provider = "qiniu"
	ProviderXunfei          Provider = "xunfei"
	ProviderAliyun          Provider = "aliyun"
	ProviderTencent         Provider = "qcloud"
	ProviderBaidu           Provider = "baidu"
	ProviderAzure           Provider = "azure"
	ProviderGoogle          Provider = "google"
	ProviderAWS             Provider = "aws"
	ProviderOpenAI          Provider = "openai"
	ProviderElevenLabs      Provider = "elevenlabs"
	ProviderLocal           Provider = "local"
	ProviderLocalGoSpeech   Provider = "local_gospeech"
	ProviderFishSpeech      Provider = "fishspeech"
	ProviderFishAudio       Provider = "fishaudio"
	ProviderCoqui           Provider = "coqui"
	ProviderVolcengine      Provider = "volcengine"
	ProviderVolcengineClone Provider = "volcengine_clone"
	ProviderVolcengineLLM   Provider = "volcengine_llm"
	ProviderMinimax         Provider = "minimax"
)

// ToString returns the string representation of the provider.
func (p Provider) ToString() string {
	return string(p)
}

// StreamFormat describes the audio output format.
type StreamFormat struct {
	SampleRate    int           // e.g. 16000, 24000
	BitDepth      int           // 8, 16, 24, 32
	Channels      int           // 1 = mono, 2 = stereo
	Codec         string        // "pcm", "mp3", "wav", "opus"
	FrameDuration time.Duration // e.g. 20ms
}

// DefaultFormat returns a sensible default audio format (16kHz, 16-bit, mono, PCM).
func DefaultFormat() StreamFormat {
	return StreamFormat{
		SampleRate:    16000,
		BitDepth:      16,
		Channels:      1,
		Codec:         "pcm",
		FrameDuration: 20 * time.Millisecond,
	}
}

// Word represents a single word with timing information.
type Word struct {
	Confidence float64 `json:"confidence"`
	EndTime    int     `json:"end_time"`   // milliseconds
	StartTime  int     `json:"start_time"` // milliseconds
	Word       string  `json:"word"`
}

// SentenceTimestamp holds word-level timestamps for a synthesized sentence.
type SentenceTimestamp struct {
	Words []Word `json:"words"`
}

// Handler is the callback interface for receiving TTS events.
type Handler interface {
	// OnMessage is called for each audio chunk (PCM or encoded).
	OnMessage(data []byte)
	// OnTimestamp is called when word-level timestamps are available.
	OnTimestamp(ts SentenceTimestamp)
}

// HandlerFunc is a convenience type for implementing Handler with functions.
type HandlerFunc struct {
	OnMessageFn   func(data []byte)
	OnTimestampFn func(ts SentenceTimestamp)
}

func (h HandlerFunc) OnMessage(data []byte) {
	if h.OnMessageFn != nil {
		h.OnMessageFn(data)
	}
}

func (h HandlerFunc) OnTimestamp(ts SentenceTimestamp) {
	if h.OnTimestampFn != nil {
		h.OnTimestampFn(ts)
	}
}

// Engine is the core TTS engine interface that all vendors implement.
type Engine interface {
	// Provider returns the vendor identifier.
	Provider() Provider
	// Format returns the audio output format.
	Format() StreamFormat
	// CacheKey returns a unique cache key for the given text.
	CacheKey(text string) string
	// Synthesize converts text to speech and delivers audio via the handler.
	Synthesize(ctx context.Context, handler Handler, text string) error
	// Close releases resources.
	Close() error
}

// ComputeSampleByteCount computes the number of bytes for audio samples
// based on sample rate, bit depth, and number of channels.
// Formula: (sampleRate * bitDepth * channels) / 8
func ComputeSampleByteCount(sampleRate, bitDepth, channels int) int {
	return (sampleRate * bitDepth * channels) / 8
}

// NormalizeFramePeriod parses and validates a duration string, clamping to
// 10-300ms range with 20ms default.
func NormalizeFramePeriod(d string) time.Duration {
	parsed, err := time.ParseDuration(d)
	if err != nil {
		return 20 * time.Millisecond
	}
	if parsed == 0 {
		return 20 * time.Millisecond
	}
	if parsed < 10*time.Millisecond {
		return 20 * time.Millisecond
	}
	if parsed > 300*time.Millisecond {
		return 20 * time.Millisecond
	}
	return parsed
}

// HashText returns a short hex digest of the input text, suitable for cache keys.
func HashText(text string) string {
	h := sha256.Sum256([]byte(text))
	return hex.EncodeToString(h[:])[:16]
}

// emojiRegex matches a broad range of emoji codepoints.
var emojiRegex = regexp.MustCompile(`[\x{00A9}\x{00AE}\x{203C}\x{2049}\x{2122}\x{2139}\x{2194}-\x{2199}\x{21A9}-\x{21AA}\x{231A}-\x{231B}\x{2328}\x{23CF}\x{23E9}-\x{23F3}\x{23F8}-\x{23FA}\x{24C2}\x{25AA}-\x{25AB}\x{25B6}\x{25C0}\x{25FB}-\x{25FE}\x{2600}-\x{26FF}\x{2700}-\x{27BF}\x{2B05}-\x{2B07}\x{2B1B}-\x{2B1C}\x{2B50}\x{2B55}\x{3030}\x{303D}\x{3297}\x{3299}\x{1F004}\x{1F0CF}\x{1F170}-\x{1F251}\x{1F300}-\x{1F5FF}\x{1F600}-\x{1F64F}\x{1F680}-\x{1F6FF}\x{1F910}-\x{1F93E}\x{1F940}-\x{1F94C}\x{1F950}-\x{1F96B}\x{1F980}-\x{1F997}\x{1F9C0}-\x{1F9E6}\x{1FA70}-\x{1FA74}\x{1FA78}-\x{1FA7A}\x{1FA80}-\x{1FA86}\x{1FA90}-\x{1FAA8}\x{1FAB0}-\x{1FAB6}\x{1FAC0}-\x{1FAC2}\x{1FAD0}-\x{1FAD6}\x{1F1E6}-\x{1F1FF}\x{200D}\x{FE0F}]`)

// StripEmoji removes emoji characters from text.
func StripEmoji(text string) string {
	return emojiRegex.ReplaceAllString(text, "")
}

// SynthesisBuffer is a simple Handler that accumulates all audio chunks and
// the last timestamp. Useful for batch synthesis where callers want the full
// audio buffer at once.
type SynthesisBuffer struct {
	Data      []byte
	Timestamp SentenceTimestamp
}

func (s *SynthesisBuffer) OnMessage(data []byte) {
	s.Data = append(s.Data, data...)
}

func (s *SynthesisBuffer) OnTimestamp(ts SentenceTimestamp) {
	s.Timestamp = ts
}
