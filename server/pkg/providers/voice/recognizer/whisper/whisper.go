// Package synthesizer implements the Whisper WebSocket ASR adapter for ling-base.
//
// This adapter connects to a Whisper-compatible streaming ASR WebSocket endpoint.
// It sends a JSON configuration message upon connection, streams raw PCM audio
// frames as binary WebSocket messages, and parses JSON responses containing
// partial/final transcription results.
package synthesizer

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common/logger"
	base "github.com/heathcetide/DietDigiDose/pkg/providers/voice/recognizer"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

// WhisperResponse is the parsed ASR response from a Whisper-compatible server.
type WhisperResponse struct {
	IsFinal bool   `json:"is_final"`
	Text    string `json:"text"`
}

// whisperConfig is the initial configuration message sent after connecting.
type whisperConfig struct {
	URL        string `json:"url"`
	APIKey     string `json:"api_key,omitempty"`
	Model      string `json:"model"`
	Language   string `json:"language"`
	SampleRate int    `json:"sample_rate"`
	Channels   int    `json:"channels"`
	BitDepth   int    `json:"bit_depth"`
	Format     string `json:"format"`
}

// WhisperASR is the Whisper WebSocket ASR engine.
type WhisperASR struct {
	Handler     interface{}
	sentence    string
	startTime   *time.Time
	endTime     *time.Time
	sendReqTime *time.Time
	endReqTime  *time.Time
	opt         WhisperASROption
	conn        *websocket.Conn
	ctx         context.Context
	cancel      context.CancelFunc
	dialogID    string
	tr          base.ResultFunc
	er          base.ErrorFunc
	isStreaming bool
	mu          sync.Mutex
	audioQueue  chan []byte
}

// WhisperASROption configures the Whisper ASR engine.
type WhisperASROption struct {
	URL         string `json:"url" yaml:"url"`
	APIKey      string `json:"apiKey" yaml:"api_key"`
	Model       string `json:"model" yaml:"model"`
	Language    string `json:"language" yaml:"language" default:"en"`
	SampleRate  int    `json:"sampleRate" yaml:"sample_rate" default:"16000"`
	Channels    int    `json:"channels" yaml:"channels" default:"1"`
	BitDepth    int    `json:"bitDepth" yaml:"bit_depth" default:"16"`
	Format      string `json:"format" yaml:"format" default:"pcm"`
	ReqChanSize int    `json:"reqChanSize" yaml:"req_chan_size" default:"128"`
}

// GetVendor returns the vendor identifier.
func (opt *WhisperASROption) GetVendor() base.Vendor {
	return base.VendorWhisper
}

// NewWhisperASROption creates a default WhisperASROption.
func NewWhisperASROption(url, apiKey string) WhisperASROption {
	return WhisperASROption{
		URL:         url,
		APIKey:      apiKey,
		Model:       "base",
		Language:    "en",
		SampleRate:  16000,
		Channels:    1,
		BitDepth:    16,
		Format:      "pcm",
		ReqChanSize: 128,
	}
}

// NewWhisperASR builds a Whisper ASR engine.
func NewWhisperASR(opt WhisperASROption) *WhisperASR {
	if opt.ReqChanSize <= 0 {
		opt.ReqChanSize = 128
	}
	if opt.SampleRate <= 0 {
		opt.SampleRate = 16000
	}
	if opt.Channels <= 0 {
		opt.Channels = 1
	}
	if opt.BitDepth <= 0 {
		opt.BitDepth = 16
	}
	if strings.TrimSpace(opt.Format) == "" {
		opt.Format = "pcm"
	}
	if strings.TrimSpace(opt.Language) == "" {
		opt.Language = "en"
	}
	if strings.TrimSpace(opt.Model) == "" {
		opt.Model = "base"
	}
	return &WhisperASR{
		opt:        opt,
		audioQueue: make(chan []byte, opt.ReqChanSize),
	}
}

// Init registers the result and error callbacks.
func (w *WhisperASR) Init(tr base.ResultFunc, er base.ErrorFunc) {
	w.tr = tr
	w.er = er
}

// Vendor returns the vendor identifier string.
func (w *WhisperASR) Vendor() string { return "whisper" }

// ConnAndReceive dials the WebSocket endpoint, sends the configuration message,
// and starts the read/send loops.
func (w *WhisperASR) ConnAndReceive(dialogID string) error {
	w.mu.Lock()
	defer w.mu.Unlock()

	w.dialogID = dialogID
	if w.audioQueue == nil {
		w.audioQueue = make(chan []byte, w.opt.ReqChanSize)
	}
	n := time.Now()
	w.sendReqTime = &n
	w.endReqTime = nil
	w.startTime = &n
	w.sentence = ""
	w.isStreaming = true

	conn, _, err := websocket.DefaultDialer.Dial(w.opt.URL, nil)
	if err != nil {
		logger.Error("whisper asr: dial failed", append(logger.WithFields(map[string]interface{}{
			"dialogID": w.dialogID,
			"url":      w.opt.URL,
		}), logger.WithError(err))...)
		return err
	}
	w.conn = conn

	if err = w.sendConfig(conn); err != nil {
		logger.Error("whisper asr: fail to send config", logger.WithError(err))
		_ = conn.Close()
		w.conn = nil
		return err
	}

	ctx, cancel := context.WithCancel(context.Background())
	w.ctx = ctx
	w.cancel = cancel

	logger.Info("whisper asr: connected", logger.WithFields(map[string]interface{}{
		"dialogID": w.dialogID,
		"url":      w.opt.URL,
	})...)

	go w.handleReadLoop(ctx)
	go w.handleSendLoop(ctx)
	return nil
}

// sendConfig sends the initial JSON configuration message.
func (w *WhisperASR) sendConfig(conn *websocket.Conn) error {
	cfg := whisperConfig{
		URL:        w.opt.URL,
		APIKey:     w.opt.APIKey,
		Model:      w.opt.Model,
		Language:   w.opt.Language,
		SampleRate: w.opt.SampleRate,
		Channels:   w.opt.Channels,
		BitDepth:   w.opt.BitDepth,
		Format:     w.opt.Format,
	}
	data, err := json.Marshal(cfg)
	if err != nil {
		return fmt.Errorf("whisper asr: marshal config: %w", err)
	}
	if err = conn.WriteMessage(websocket.TextMessage, data); err != nil {
		return fmt.Errorf("whisper asr: write config: %w", err)
	}
	return nil
}

// Activity returns true if the engine is actively connected.
func (w *WhisperASR) Activity() bool {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.conn != nil
}

// RestartClient stops the current connection and re-establishes it.
func (w *WhisperASR) RestartClient() {
	_ = w.StopConn()
	id := strings.TrimSpace(w.dialogID)
	if id == "" {
		id = uuid.New().String()
	}
	if err := w.ConnAndReceive(id); err != nil {
		w.causeErr(err)
	}
}

// SendAudioBytes queues audio data for transmission to the Whisper server.
func (w *WhisperASR) SendAudioBytes(data []byte) error {
	if data == nil || len(data) == 0 {
		return nil
	}
	if !w.Activity() {
		w.RestartClient()
		if !w.Activity() {
			return fmt.Errorf("whisper recognizer is not running")
		}
	}
	w.mu.Lock()
	if w.sendReqTime == nil {
		n := time.Now()
		w.sendReqTime = &n
	}
	w.mu.Unlock()
	select {
	case w.audioQueue <- data:
		return nil
	default:
		select {
		case w.audioQueue <- data:
			return nil
		case <-time.After(200 * time.Millisecond):
			return fmt.Errorf("whisper audio queue full")
		}
	}
}

// SendEnd signals the end of the audio stream.
func (w *WhisperASR) SendEnd() error {
	w.mu.Lock()
	w.isStreaming = false
	n := time.Now()
	w.endReqTime = &n
	w.mu.Unlock()
	// Send an empty binary frame to signal end-of-stream.
	if w.conn != nil {
		if err := w.conn.WriteMessage(websocket.BinaryMessage, []byte{}); err != nil {
			logger.Error("whisper asr: fail to send end frame", logger.WithError(err))
			return err
		}
	}
	return nil
}

// StopConn stops the connection and cleans up resources.
func (w *WhisperASR) StopConn() error {
	w.mu.Lock()
	cancel := w.cancel
	conn := w.conn
	w.conn = nil
	w.cancel = nil
	w.mu.Unlock()

	if cancel != nil {
		cancel()
	}
	if conn != nil {
		return conn.Close()
	}
	return nil
}

// causeErr reports an error via the error callback.
func (w *WhisperASR) causeErr(err error) {
	if err == nil {
		return
	}
	if w.er != nil {
		w.er(err, true)
	}
}

// sinceSend returns the duration since the first request was sent.
func (w *WhisperASR) sinceSend() time.Duration {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.sendReqTime == nil {
		return 0
	}
	return time.Since(*w.sendReqTime)
}

// emitPartial emits a partial (non-final) recognition result.
func (w *WhisperASR) emitPartial(text string) {
	text = strings.TrimSpace(text)
	if text == "" {
		return
	}
	w.mu.Lock()
	w.sentence = text
	w.mu.Unlock()
	if w.tr != nil {
		w.tr(text, false, w.sinceSend(), w.dialogID)
	}
}

// emitFinal emits a final recognition result.
func (w *WhisperASR) emitFinal(text string) {
	text = strings.TrimSpace(text)
	if text == "" {
		w.mu.Lock()
		text = strings.TrimSpace(w.sentence)
		w.mu.Unlock()
	}
	if text == "" {
		return
	}
	w.mu.Lock()
	w.sentence = text
	w.mu.Unlock()
	dur := w.sinceSend()
	if w.tr != nil {
		w.tr(text, true, dur, w.dialogID)
	}
	w.mu.Lock()
	w.sentence = ""
	w.mu.Unlock()
}

// handleSendLoop drains the audio queue and writes binary frames to the server.
func (w *WhisperASR) handleSendLoop(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case data := <-w.audioQueue:
			w.mu.Lock()
			conn := w.conn
			w.mu.Unlock()
			if conn == nil {
				return
			}
			if err := conn.WriteMessage(websocket.BinaryMessage, data); err != nil {
				logger.Error("whisper asr: fail to send audio", logger.WithError(err))
				w.causeErr(err)
				return
			}
		}
	}
}

// handleReadLoop reads messages from the server, parses JSON responses, and
// emits partial/final recognition results.
func (w *WhisperASR) handleReadLoop(ctx context.Context) {
	ttfbDone := false
	for {
		select {
		case <-ctx.Done():
			return
		default:
		}
		w.mu.Lock()
		conn := w.conn
		w.mu.Unlock()
		if conn == nil {
			return
		}

		messageType, message, err := conn.ReadMessage()
		if err != nil {
			if websocket.IsCloseError(err, websocket.CloseNormalClosure) {
				logger.Info("whisper asr: recv close message, connection closed")
			} else {
				logger.Error("whisper asr: recv error, connection closed", append(logger.WithFields(map[string]interface{}{
					"dialogID":    w.dialogID,
					"err":         err,
					"message":     string(message),
					"messageType": messageType,
				}), logger.WithError(err))...)
				w.causeErr(err)
			}
			w.mu.Lock()
			sentence := w.sentence
			w.mu.Unlock()
			if strings.TrimSpace(sentence) != "" {
				w.emitFinal(sentence)
			}
			return
		}

		// Ignore keep-alive ping messages.
		if string(message) == "ping" {
			continue
		}

		var result WhisperResponse
		if err = json.Unmarshal(message, &result); err != nil {
			logger.Error("whisper asr: unmarshal result failed", append(logger.WithFields(map[string]interface{}{
				"dialogID": w.dialogID,
			}), logger.WithError(err))...)
			continue
		}

		if !ttfbDone && result.Text != "" {
			ttfbDone = true
			logger.Info("whisper asr: time to first byte", logger.WithFields(map[string]interface{}{
				"dialogID": w.dialogID,
				"ttfb":     w.sinceSend(),
			})...)
		}

		w.mu.Lock()
		w.sentence = result.Text
		w.mu.Unlock()

		if result.IsFinal {
			w.emitFinal(result.Text)
		} else {
			w.emitPartial(result.Text)
		}

		logger.Debug("whisper asr: recv frame", logger.WithFields(map[string]interface{}{
			"dialogID": w.dialogID,
			"word":     result.Text,
			"isFinal":  result.IsFinal,
		})...)
	}
}

// Compile-time guard ensuring WhisperASR implements base.Engine.
var _ base.Engine = (*WhisperASR)(nil)
