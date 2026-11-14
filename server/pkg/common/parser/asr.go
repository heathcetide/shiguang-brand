package parser

import (
	"context"
	"fmt"
	"os"
	"strings"
	"sync"
	"time"

	base "github.com/heathcetide/DietDigiDose/pkg/providers/voice/recognizer"
)

// ASRParser transcribes audio files using the ling-base recognizer package.
// It wraps a recognizer.Engine (local, volcengine, qcloud, etc.) and provides
// a synchronous file-to-text API suitable for the parser router.
//
// The engine must be injected via NewASRParser or SetEngine. If no engine is
// configured, Parse returns ErrUnsupportedFileType.
type ASRParser struct {
	mu     sync.Mutex
	engine base.Engine
	// SampleRate controls the PCM decode target rate sent to the engine.
	// Defaults to 16000.
	SampleRate int
}

// NewASRParser creates an ASRParser backed by the given recognizer Engine.
func NewASRParser(engine base.Engine) *ASRParser {
	return &ASRParser{
		engine:     engine,
		SampleRate: defaultASRSampleRate,
	}
}

// SetEngine replaces the underlying recognizer engine.
func (p *ASRParser) SetEngine(engine base.Engine) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.engine = engine
}

func (p *ASRParser) Provider() string { return "asr" }

func (p *ASRParser) SupportedTypes() []string {
	return []string{FileTypeWAV, FileTypeMP3, FileTypeOGG, FileTypeFLAC, FileTypeM4A, FileTypeAAC}
}

func (p *ASRParser) Parse(ctx context.Context, req *ParseRequest, opts *ParseOptions) (*ParseResult, error) {
	if req == nil {
		return nil, ErrEmptyInput
	}

	p.mu.Lock()
	engine := p.engine
	sampleRate := p.SampleRate
	p.mu.Unlock()

	if engine == nil {
		return nil, fmt.Errorf("asr: no recognizer engine configured: %w", ErrUnsupportedFileType)
	}

	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	default:
	}

	data, fileName, err := readRequestBytes(req)
	if err != nil {
		return nil, err
	}

	pcm, err := decodeAudioToPCM(data, fileName)
	if err != nil {
		return nil, err
	}
	_ = sampleRate // pcm.SampleRate is authoritative

	// Synchronous transcription via the streaming Engine interface.
	text, err := transcribeSync(ctx, engine, pcm.Samples)
	if err != nil {
		return nil, fmt.Errorf("asr: transcribe: %w", err)
	}

	text = normalizeText(text, opts)
	text = truncateText(text, opts)

	ft := req.FileType
	if ft == "" {
		ft = DetectFileType(req)
	}

	return &ParseResult{
		FileType: ft,
		FileName: fileName,
		Text:     text,
		Sections: []Section{{Type: SectionTypeDocument, Index: 0, Title: fileName, Text: text}},
		Metadata: req.Metadata,
		ParsedAt: time.Now(),
	}, nil
}

// transcribeSync drives a streaming recognizer.Engine synchronously and
// collects the final text result. It sends all PCM samples in chunks,
// signals end, and waits for the final callback.
func transcribeSync(ctx context.Context, engine base.Engine, pcm []byte) (string, error) {
	var (
		mu      sync.Mutex
		result  string
		lastErr error
		done    = make(chan struct{})
	)

	engine.Init(
		func(text string, isLast bool, duration time.Duration, dialogID string) {
			mu.Lock()
			if text != "" {
				result = text
			}
			if isLast {
				select {
				case <-done:
				default:
					close(done)
				}
			}
			mu.Unlock()
		},
		func(err error, isFatal bool) {
			mu.Lock()
			lastErr = err
			if isFatal {
				select {
				case <-done:
				default:
					close(done)
				}
			}
			mu.Unlock()
		},
	)

	dialogID := fmt.Sprintf("parser-asr-%d", time.Now().UnixNano())
	if err := engine.ConnAndReceive(dialogID); err != nil {
		return "", fmt.Errorf("connect: %w", err)
	}

	// Send audio in ~200ms chunks (3200 bytes at 16kHz/16bit/mono).
	chunkSize := 3200
	for offset := 0; offset < len(pcm); offset += chunkSize {
		end := offset + chunkSize
		if end > len(pcm) {
			end = len(pcm)
		}
		if err := engine.SendAudioBytes(pcm[offset:end]); err != nil {
			_ = engine.StopConn()
			return "", fmt.Errorf("send audio: %w", err)
		}
	}

	if err := engine.SendEnd(); err != nil {
		_ = engine.StopConn()
		return "", fmt.Errorf("send end: %w", err)
	}

	// Wait for final result or context cancellation.
	select {
	case <-done:
	case <-ctx.Done():
		_ = engine.StopConn()
		return "", ctx.Err()
	case <-time.After(60 * time.Second):
		_ = engine.StopConn()
		return "", fmt.Errorf("asr: timeout waiting for result")
	}

	_ = engine.StopConn()

	mu.Lock()
	defer mu.Unlock()
	if lastErr != nil && result == "" {
		return "", lastErr
	}
	return strings.TrimSpace(result), nil
}

// ASRParserFromEnv creates an ASRParser with a local engine detected from PATH.
// This is a convenience for simple use cases; for production, inject a specific
// engine via NewASRParser.
func ASRParserFromEnv() *ASRParser {
	return &ASRParser{
		SampleRate: defaultASRSampleRate,
	}
}

// compile-time guard: ensure ASRParser is a Parser
var _ Parser = (*ASRParser)(nil)

// Ensure os import is used (for potential future env-based config).
var _ = os.Getenv
