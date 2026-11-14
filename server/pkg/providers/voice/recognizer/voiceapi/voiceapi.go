// Package synthesizer implements the VoiceAPI ASR adapter for ling-base.
package synthesizer

// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: AGPL-3.0

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common/logger"
	base "github.com/heathcetide/DietDigiDose/pkg/providers/voice/recognizer"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

// VoiceAPIASR is the VoiceAPI streaming ASR engine. It speaks a simple
// WebSocket protocol: the client streams raw PCM audio as binary frames and
// the server replies with JSON objects describing the partial/final
// transcription state.
type VoiceAPIASR struct {
	Handler interface{}

	sentence    string
	startTime   time.Time
	endTime     time.Time
	sendReqTime *time.Time
	endReqTime  *time.Time

	opt VoiceAPIASROption

	conn   *websocket.Conn
	ctx    context.Context
	cancel context.CancelFunc

	dialogID string

	tr base.ResultFunc
	er base.ErrorFunc

	isStreaming bool

	mu         sync.Mutex
	audioQueue chan []byte
}

// VoiceAPIASROption configures the VoiceAPI streaming ASR.
type VoiceAPIASROption struct {
	URL         string `json:"url" yaml:"url" env:"ASR_VOICEAPI_URL"`
	APIKey      string `json:"apiKey" yaml:"api_key" env:"ASR_VOICEAPI_API_KEY"`
	Model       string `json:"model" yaml:"model" env:"ASR_VOICEAPI_MODEL" default:"default"`
	Language    string `json:"language" yaml:"language" env:"ASR_VOICEAPI_LANGUAGE" default:"zh-CN"`
	SampleRate  int    `json:"sampleRate" yaml:"sample_rate" env:"ASR_VOICEAPI_SAMPLE_RATE" default:"16000"`
	Encoding    string `json:"encoding" yaml:"encoding" env:"ASR_VOICEAPI_ENCODING" default:"pcm"`
	ReqChanSize int    `json:"reqChanSize" yaml:"req_chan_size" default:"128"`
}

// VoiceAPIResponse is the parsed ASR response from the VoiceAPI server.
type VoiceAPIResponse struct {
	Idx      int    `json:"idx"`
	Finished bool   `json:"finished"`
	Text     string `json:"text"`
}

// Compile-time guard ensuring VoiceAPIASR satisfies base.Engine.
var _ base.Engine = (*VoiceAPIASR)(nil)

// GetVendor returns the vendor identifier.
func (opt VoiceAPIASROption) GetVendor() base.Vendor {
	return base.VendorVoiceAPI
}

// NewVoiceAPIASROption creates a default VoiceAPIASROption.
func NewVoiceAPIASROption(url string, apiKey string) VoiceAPIASROption {
	return VoiceAPIASROption{
		URL:         url,
		APIKey:      apiKey,
		Model:       "default",
		Language:    "zh-CN",
		SampleRate:  16000,
		Encoding:    "pcm",
		ReqChanSize: 128,
	}
}

// NewVoiceAPIASR builds a VoiceAPI ASR engine.
func NewVoiceAPIASR(opt VoiceAPIASROption) *VoiceAPIASR {
	if opt.ReqChanSize <= 0 {
		opt.ReqChanSize = 128
	}
	if strings.TrimSpace(opt.Model) == "" {
		opt.Model = "default"
	}
	if strings.TrimSpace(opt.Language) == "" {
		opt.Language = "zh-CN"
	}
	if opt.SampleRate <= 0 {
		opt.SampleRate = 16000
	}
	if strings.TrimSpace(opt.Encoding) == "" {
		opt.Encoding = "pcm"
	}
	return &VoiceAPIASR{opt: opt}
}

// Init registers the result and error callbacks.
func (vapi *VoiceAPIASR) Init(tr base.ResultFunc, er base.ErrorFunc) {
	vapi.tr = tr
	vapi.er = er
}

// Vendor returns the vendor identifier string.
func (vapi *VoiceAPIASR) Vendor() string {
	return "voiceapi"
}

// ConnAndReceive dials the VoiceAPI WebSocket endpoint (attaching the API key
// as a Bearer auth header) and starts the read/send loops. dialogID is a
// unique identifier for the current dialog.
func (vapi *VoiceAPIASR) ConnAndReceive(dialogID string) error {
	vapi.mu.Lock()
	defer vapi.mu.Unlock()

	vapi.dialogID = dialogID
	if vapi.audioQueue == nil {
		vapi.audioQueue = make(chan []byte, vapi.opt.ReqChanSize)
	}

	header := http.Header{}
	if strings.TrimSpace(vapi.opt.APIKey) != "" {
		header.Set("Authorization", fmt.Sprintf("Bearer %s", vapi.opt.APIKey))
	}

	conn, _, err := websocket.DefaultDialer.Dial(vapi.opt.URL, header)
	if err != nil {
		logger.Error("voiceapi asr: failed to dial websocket", append(logger.WithFields(map[string]interface{}{
			"url": vapi.opt.URL,
		}), logger.WithError(err))...)
		return err
	}

	ctx, cancel := context.WithCancel(context.Background())
	vapi.conn = conn
	vapi.ctx = ctx
	vapi.cancel = cancel
	vapi.isStreaming = true
	vapi.sentence = ""

	now := time.Now()
	vapi.sendReqTime = &now
	vapi.endReqTime = nil
	vapi.startTime = now

	logger.Info("voiceapi asr: connection established", logger.WithFields(map[string]interface{}{
		"dialogID": dialogID,
		"url":      vapi.opt.URL,
	})...)

	go vapi.handleReadLoop()
	go vapi.handleSendLoop()
	return nil
}

// Activity returns true if the engine is actively connected.
func (vapi *VoiceAPIASR) Activity() bool {
	vapi.mu.Lock()
	defer vapi.mu.Unlock()
	return vapi.conn != nil && vapi.isStreaming
}

// RestartClient stops the current connection and re-establishes a new one
// with a fresh dialog ID.
func (vapi *VoiceAPIASR) RestartClient() {
	_ = vapi.StopConn()
	dialogID := strings.TrimSpace(vapi.dialogID)
	if dialogID == "" {
		dialogID = uuid.New().String()
	}
	if err := vapi.ConnAndReceive(dialogID); err != nil {
		vapi.causeErr(err)
	}
}

// SendAudioBytes sends audio data for recognition. If the engine is not
// running it will be restarted automatically.
func (vapi *VoiceAPIASR) SendAudioBytes(data []byte) error {
	if data == nil || len(data) == 0 {
		return nil
	}
	if !vapi.Activity() {
		vapi.RestartClient()
		if !vapi.Activity() {
			return fmt.Errorf("voiceapi recognizer is not running")
		}
	}
	if vapi.sendReqTime == nil {
		n := time.Now()
		vapi.sendReqTime = &n
	}
	select {
	case vapi.audioQueue <- data:
		return nil
	default:
		select {
		case vapi.audioQueue <- data:
			return nil
		case <-time.After(200 * time.Millisecond):
			return fmt.Errorf("voiceapi audio queue full")
		}
	}
}

// SendEnd signals end of audio stream.
func (vapi *VoiceAPIASR) SendEnd() error {
	vapi.mu.Lock()
	if vapi.conn == nil {
		vapi.mu.Unlock()
		return nil
	}
	vapi.mu.Unlock()

	n := time.Now()
	vapi.endReqTime = &n

	// Send a text "end" marker so the server can flush its final result.
	endMsg, _ := json.Marshal(map[string]interface{}{
		"type":     "end",
		"idx":      0,
		"finished": true,
	})
	if err := vapi.writeMessage(websocket.TextMessage, endMsg); err != nil {
		logger.Error("voiceapi asr: failed to send end marker", logger.WithError(err))
		return err
	}
	return nil
}

// StopConn stops the connection and cleans up resources.
func (vapi *VoiceAPIASR) StopConn() error {
	vapi.mu.Lock()
	vapi.isStreaming = false
	cancel := vapi.cancel
	conn := vapi.conn
	vapi.cancel = nil
	vapi.conn = nil
	vapi.mu.Unlock()

	if cancel != nil {
		cancel()
	}
	if conn != nil {
		_ = conn.WriteMessage(websocket.CloseMessage,
			websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""))
		_ = conn.Close()
	}
	return nil
}

// causeErr forwards an error to the registered error callback.
func (vapi *VoiceAPIASR) causeErr(err error) {
	if err == nil {
		return
	}
	if vapi.er != nil {
		vapi.er(err, true)
	}
}

// sinceSend returns the duration since the last send request started.
func (vapi *VoiceAPIASR) sinceSend() time.Duration {
	if vapi.sendReqTime == nil {
		return 0
	}
	return time.Since(*vapi.sendReqTime)
}

// emitPartial emits a partial (non-final) recognition result.
func (vapi *VoiceAPIASR) emitPartial(text string) {
	text = strings.TrimSpace(text)
	if text == "" {
		return
	}
	vapi.sentence = text
	if vapi.tr != nil {
		vapi.tr(text, false, vapi.sinceSend(), vapi.dialogID)
	}
}

// emitFinal emits a final recognition result.
func (vapi *VoiceAPIASR) emitFinal(text string) {
	text = strings.TrimSpace(text)
	if text == "" {
		text = strings.TrimSpace(vapi.sentence)
	}
	if text == "" {
		return
	}
	vapi.sentence = text
	dur := vapi.sinceSend()
	if vapi.tr != nil {
		vapi.tr(text, true, dur, vapi.dialogID)
	}
	vapi.sentence = ""
	vapi.endTime = time.Now()
}

// writeMessage guards the WebSocket write with the mutex.
func (vapi *VoiceAPIASR) writeMessage(msgType int, data []byte) error {
	vapi.mu.Lock()
	defer vapi.mu.Unlock()
	if vapi.conn == nil {
		return fmt.Errorf("voiceapi asr: connection closed")
	}
	return vapi.conn.WriteMessage(msgType, data)
}

// handleSendLoop drains the audio queue and forwards PCM frames to the server
// as binary WebSocket messages.
func (vapi *VoiceAPIASR) handleSendLoop() {
	ctx := vapi.ctx
	for {
		select {
		case data := <-vapi.audioQueue:
			if err := vapi.writeMessage(websocket.BinaryMessage, data); err != nil {
				logger.Error("voiceapi asr: failed to send audio bytes", logger.WithError(err))
				vapi.causeErr(err)
				return
			}
		case <-ctx.Done():
			return
		}
	}
}

// handleReadLoop reads messages from the WebSocket, parses JSON responses and
// emits partial/final recognition results via the registered callbacks.
func (vapi *VoiceAPIASR) handleReadLoop() {
	ctx := vapi.ctx
	for {
		select {
		case <-ctx.Done():
			return
		default:
			vapi.mu.Lock()
			conn := vapi.conn
			vapi.mu.Unlock()
			if conn == nil {
				return
			}

			messageType, message, err := conn.ReadMessage()
			if err != nil {
				if websocket.IsCloseError(err, websocket.CloseNormalClosure) {
					logger.Info("voiceapi asr: recv close message, connection closed", logger.WithFields(map[string]interface{}{
						"dialogID": vapi.dialogID,
					})...)
				} else {
					logger.Error("voiceapi asr: recv error, connection closed", append(logger.WithFields(map[string]interface{}{
						"dialogID":    vapi.dialogID,
						"messageType": messageType,
						"message":     string(message),
					}), logger.WithError(err))...)
					vapi.causeErr(err)
				}
				if strings.TrimSpace(vapi.sentence) != "" {
					vapi.emitFinal(vapi.sentence)
				}
				vapi.mu.Lock()
				vapi.isStreaming = false
				vapi.mu.Unlock()
				return
			}

			var res VoiceAPIResponse
			if err = json.Unmarshal(message, &res); err != nil {
				logger.Error("voiceapi asr: failed to unmarshal message", append(logger.WithFields(map[string]interface{}{
					"dialogID": vapi.dialogID,
					"message":  string(message),
				}), logger.WithError(err))...)
				vapi.causeErr(err)
				return
			}

			vapi.sentence = res.Text
			vapi.emitPartial(res.Text)

			if res.Finished {
				logger.Info("voiceapi asr: final result received", logger.WithFields(map[string]interface{}{
					"dialogID": vapi.dialogID,
					"text":     res.Text,
				})...)
				vapi.emitFinal(res.Text)
				if vapi.endReqTime != nil {
					logger.Debug("voiceapi asr: end-to-end latency", logger.WithFields(map[string]interface{}{
						"duration": time.Since(*vapi.endReqTime),
					})...)
				}
			}
			if vapi.sendReqTime != nil {
				logger.Debug("voiceapi asr: frame latency", logger.WithFields(map[string]interface{}{
					"duration": time.Since(*vapi.sendReqTime),
				})...)
			}
		}
	}
}
