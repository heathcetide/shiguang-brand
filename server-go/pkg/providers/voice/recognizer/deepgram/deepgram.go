// Package synthesizer implements the Deepgram ASR adapter for ling-base.
package synthesizer

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common/logger"
	base "github.com/heathcetide/DietDigiDose/pkg/providers/voice/recognizer"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

// Compile-time guard ensuring DeepgramASR implements base.Engine.
var _ base.Engine = (*DeepgramASR)(nil)

// DeepgramASR is the Deepgram streaming ASR engine.
type DeepgramASR struct {
	Handler     interface{}
	sentence    string
	startTime   time.Time
	endTime     time.Time
	sendReqTime *time.Time
	endReqTime  *time.Time

	opt DeepgramASROption

	conn   *websocket.Conn
	ctx    context.Context
	cancel context.CancelFunc

	dialogID string

	tr base.ResultFunc
	er base.ErrorFunc

	isStreaming bool
	mu          sync.Mutex

	audioQueue chan []byte
	closeChan  chan struct{}
}

// DeepgramASROption configures the Deepgram streaming ASR.
type DeepgramASROption struct {
	APIKey      string `json:"apiKey" yaml:"api_key" env:"DEEPGRAM_API_KEY"`
	URL         string `json:"url" yaml:"url" default:"wss://api.deepgram.com/v1/listen"`
	Language    string `json:"language" yaml:"language" default:"en-US"`
	Model       string `json:"model" yaml:"model" default:"nova-2"`
	Encoding    string `json:"encoding" yaml:"encoding" default:"linear16"`
	SampleRate  int    `json:"sampleRate" yaml:"sample_rate" default:"16000"`
	Channels    int    `json:"channels" yaml:"channels" default:"1"`
	ReqChanSize int    `json:"reqChanSize" yaml:"req_chan_size" default:"128"`
}

// GetVendor returns the vendor identifier.
func (opt *DeepgramASROption) GetVendor() base.Vendor {
	return base.VendorDeepgram
}

// NewDeepgramASROption creates a default DeepgramASROption with the given API key.
func NewDeepgramASROption(apiKey string) DeepgramASROption {
	return DeepgramASROption{
		APIKey:      apiKey,
		URL:         "wss://api.deepgram.com/v1/listen",
		Language:    "en-US",
		Model:       "nova-2",
		Encoding:    "linear16",
		SampleRate:  16000,
		Channels:    1,
		ReqChanSize: 128,
	}
}

// NewDeepgramASR builds a Deepgram ASR engine.
func NewDeepgramASR(opt DeepgramASROption) *DeepgramASR {
	if opt.ReqChanSize <= 0 {
		opt.ReqChanSize = 128
	}
	if strings.TrimSpace(opt.URL) == "" {
		opt.URL = "wss://api.deepgram.com/v1/listen"
	}
	if strings.TrimSpace(opt.Model) == "" {
		opt.Model = "nova-2"
	}
	if strings.TrimSpace(opt.Language) == "" {
		opt.Language = "en-US"
	}
	if strings.TrimSpace(opt.Encoding) == "" {
		opt.Encoding = "linear16"
	}
	if opt.SampleRate <= 0 {
		opt.SampleRate = 16000
	}
	if opt.Channels <= 0 {
		opt.Channels = 1
	}
	return &DeepgramASR{
		opt:        opt,
		audioQueue: make(chan []byte, 1024),
		closeChan:  make(chan struct{}, 4),
	}
}

// Init registers the result and error callbacks.
func (dg *DeepgramASR) Init(tr base.ResultFunc, er base.ErrorFunc) {
	dg.tr = tr
	dg.er = er
}

// Vendor returns the vendor identifier string.
func (dg *DeepgramASR) Vendor() string { return "deepgram" }

// ConnAndReceive establishes the WebSocket connection to Deepgram and starts
// the read/send loops. dialogID is a unique identifier for the current dialog.
func (dg *DeepgramASR) ConnAndReceive(dialogID string) error {
	dg.mu.Lock()
	defer dg.mu.Unlock()

	dg.dialogID = dialogID
	if dg.audioQueue == nil {
		dg.audioQueue = make(chan []byte, 1024)
	}
	if dg.closeChan == nil {
		dg.closeChan = make(chan struct{}, 4)
	}

	n := time.Now()
	dg.sendReqTime = &n
	dg.endReqTime = nil
	dg.startTime = n
	dg.sentence = ""
	dg.isStreaming = false

	return dg.buildClient()
}

// Activity returns true if the engine is actively connected.
func (dg *DeepgramASR) Activity() bool {
	dg.mu.Lock()
	defer dg.mu.Unlock()
	return dg.conn != nil
}

// RestartClient stops the current connection and re-establishes a new one.
func (dg *DeepgramASR) RestartClient() {
	_ = dg.StopConn()
	id := strings.TrimSpace(dg.dialogID)
	if id == "" {
		id = uuid.New().String()
	}
	if err := dg.ConnAndReceive(id); err != nil {
		dg.causeErr(err)
	}
}

// SendAudioBytes sends audio data to Deepgram for recognition.
func (dg *DeepgramASR) SendAudioBytes(data []byte) error {
	if data == nil || len(data) == 0 {
		return nil
	}
	if !dg.Activity() {
		dg.RestartClient()
		if !dg.Activity() {
			return fmt.Errorf("deepgram recognizer is not running")
		}
	}
	if dg.sendReqTime == nil {
		n := time.Now()
		dg.sendReqTime = &n
	}
	select {
	case dg.audioQueue <- data:
		return nil
	default:
		select {
		case dg.audioQueue <- data:
			return nil
		case <-time.After(200 * time.Millisecond):
			return fmt.Errorf("deepgram audio queue full")
		}
	}
}

// SendEnd signals the end of the audio stream by sending a CloseStream message.
func (dg *DeepgramASR) SendEnd() error {
	dg.mu.Lock()
	conn := dg.conn
	dg.mu.Unlock()
	if conn == nil {
		return nil
	}
	n := time.Now()
	dg.endReqTime = &n

	closeMsg, _ := json.Marshal(map[string]string{"type": "CloseStream"})
	dg.mu.Lock()
	err := conn.WriteMessage(websocket.TextMessage, closeMsg)
	dg.mu.Unlock()
	if err != nil {
		logger.Error("deepgram asr: fail to send CloseStream", logger.WithError(err))
		return err
	}
	if dg.closeChan != nil {
		select {
		case dg.closeChan <- struct{}{}:
		default:
		}
	}
	return nil
}

// StopConn stops the connection and releases resources.
func (dg *DeepgramASR) StopConn() error {
	dg.mu.Lock()
	cancel := dg.cancel
	conn := dg.conn
	dg.conn = nil
	dg.cancel = nil
	dg.isStreaming = false
	dg.mu.Unlock()

	if cancel != nil {
		cancel()
	}
	if conn != nil {
		_ = conn.Close()
	}
	return nil
}

// causeErr reports an error through the registered error callback.
func (dg *DeepgramASR) causeErr(err error) {
	if err == nil {
		return
	}
	if dg.er != nil {
		dg.er(err, true)
	}
}

// sinceSend returns the duration since the first audio request was sent.
func (dg *DeepgramASR) sinceSend() time.Duration {
	if dg.sendReqTime == nil {
		return 0
	}
	return time.Since(*dg.sendReqTime)
}

// emitPartial emits a partial (interim) recognition result.
func (dg *DeepgramASR) emitPartial(text string) {
	text = strings.TrimSpace(text)
	if text == "" {
		return
	}
	dg.sentence = text
	if dg.tr != nil {
		dg.tr(text, false, dg.sinceSend(), dg.dialogID)
	}
}

// emitFinal emits a final recognition result.
func (dg *DeepgramASR) emitFinal(text string) {
	text = strings.TrimSpace(text)
	if text == "" {
		text = strings.TrimSpace(dg.sentence)
	}
	if text == "" {
		return
	}
	dg.sentence = text
	dur := dg.sinceSend()
	if dg.tr != nil {
		dg.tr(text, true, dur, dg.dialogID)
	}
	dg.sentence = ""
}

// buildClient dials the Deepgram WebSocket and starts the read/send loops.
func (dg *DeepgramASR) buildClient() error {
	url := dg.buildWebSocketURL()

	header := http.Header{}
	header.Set("Authorization", fmt.Sprintf("Token %s", dg.opt.APIKey))

	logger.Info("deepgram asr: dialing deepgram websocket", logger.WithFields(map[string]interface{}{
		"dialogID": dg.dialogID,
		"url":      url,
	})...)

	conn, _, err := websocket.DefaultDialer.Dial(url, header)
	if err != nil {
		logger.Error("deepgram asr: fail to dial", logger.WithError(err))
		return err
	}

	ctx, cancel := context.WithCancel(context.Background())
	dg.mu.Lock()
	dg.conn = conn
	dg.ctx = ctx
	dg.cancel = cancel
	dg.isStreaming = true
	dg.mu.Unlock()

	go dg.handleReadLoop(ctx)
	go dg.handleSendLoop(ctx)
	go dg.keepAlive(ctx)

	return nil
}

// buildWebSocketURL constructs the Deepgram streaming URL with query parameters.
func (dg *DeepgramASR) buildWebSocketURL() string {
	q := url.Values{}
	q.Set("model", dg.opt.Model)
	q.Set("language", dg.opt.Language)
	q.Set("encoding", dg.opt.Encoding)
	q.Set("sample_rate", fmt.Sprintf("%d", dg.opt.SampleRate))
	q.Set("channels", fmt.Sprintf("%d", dg.opt.Channels))
	q.Set("punctuate", "true")
	q.Set("smart_format", "true")
	q.Set("interim_results", "true")
	q.Set("vad_events", "true")
	q.Set("utterance_end_ms", "1000")

	return dg.opt.URL + "?" + q.Encode()
}

// handleReadLoop reads messages from the Deepgram WebSocket and parses responses.
func (dg *DeepgramASR) handleReadLoop(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		dg.mu.Lock()
		conn := dg.conn
		dg.mu.Unlock()
		if conn == nil {
			return
		}

		_, message, err := conn.ReadMessage()
		if err != nil {
			if websocket.IsCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway) {
				logger.Info("deepgram asr: recv close message, connection closed")
			} else {
				logger.Error("deepgram asr: recv error, connection closed", logger.WithError(err))
			}
			if strings.TrimSpace(dg.sentence) != "" {
				dg.emitFinal(dg.sentence)
			}
			dg.RestartClient()
			return
		}

		var resp DeepgramResponse
		if err := json.Unmarshal(message, &resp); err != nil {
			logger.Warn("deepgram asr: fail to parse response", append(logger.WithFields(map[string]interface{}{"data": string(message)}), logger.WithError(err))...)
			continue
		}

		dg.handleResponse(&resp)
	}
}

// handleResponse dispatches a parsed Deepgram response to the appropriate handler.
func (dg *DeepgramASR) handleResponse(resp *DeepgramResponse) {
	switch resp.Type {
	case "Results":
		dg.handleResults(resp)
	case "Metadata":
		logger.Debug("deepgram asr: metadata received", logger.WithFields(map[string]interface{}{"dialogID": dg.dialogID})...)
	case "SpeechStarted":
		logger.Debug("deepgram asr: speech started", logger.WithFields(map[string]interface{}{"dialogID": dg.dialogID})...)
	case "UtteranceEnd":
		logger.Debug("deepgram asr: utterance ended", logger.WithFields(map[string]interface{}{"dialogID": dg.dialogID})...)
		if strings.TrimSpace(dg.sentence) != "" {
			dg.emitFinal(dg.sentence)
		}
	case "Error":
		errMsg := fmt.Sprintf("deepgram asr: error.err_code: %s, error.err_msg: %s, error.description: %s",
			resp.ErrCode, resp.ErrMsg, resp.Description)
		logger.Error(errMsg, logger.WithFields(map[string]interface{}{"dialogID": dg.dialogID})...)
		dg.causeErr(fmt.Errorf("%s", errMsg))
	case "Close":
		logger.Info("deepgram asr: close event received", logger.WithFields(map[string]interface{}{"dialogID": dg.dialogID})...)
	default:
		logger.Debug("deepgram asr: unhandled event", logger.WithFields(map[string]interface{}{
			"dialogID": dg.dialogID,
			"type":     resp.Type,
		})...)
	}
}

// handleResults processes a "Results" type response, emitting partial or final text.
func (dg *DeepgramASR) handleResults(resp *DeepgramResponse) {
	if len(resp.Channel.Alternatives) == 0 {
		return
	}
	sentence := strings.TrimSpace(resp.Channel.Alternatives[0].Transcript)
	if sentence == "" {
		return
	}

	logger.Info("deepgram asr: received message", logger.WithFields(map[string]interface{}{
		"dialogID": dg.dialogID,
		"Sentence": sentence,
		"isFinal":  resp.IsFinal,
	})...)

	if resp.IsFinal {
		dg.emitFinal(sentence)
	} else {
		dg.emitPartial(sentence)
	}
}

// handleSendLoop reads audio data from the queue and sends it as binary
// WebSocket messages at a controlled rate.
func (dg *DeepgramASR) handleSendLoop(ctx context.Context) {
	const maxBytesPerSecond = 96000
	const sendInterval = 100 * time.Millisecond
	const maxBytesPerInterval = maxBytesPerSecond / 10

	ticker := time.NewTicker(sendInterval)
	defer ticker.Stop()

	var pendingData []byte

	for {
		select {
		case data := <-dg.audioQueue:
			pendingData = append(pendingData, data...)

		case <-ticker.C:
			if len(pendingData) > 0 {
				sendSize := len(pendingData)
				if sendSize > maxBytesPerInterval {
					sendSize = maxBytesPerInterval
				}
				toSend := pendingData[:sendSize]
				pendingData = pendingData[sendSize:]

				if err := dg.writeAudio(toSend); err != nil {
					logger.Error("deepgram asr: fail to send audio", logger.WithError(err))
					dg.RestartClient()
					return
				}
			}

		case <-dg.closeChan:
			if len(pendingData) > 0 {
				if err := dg.writeAudio(pendingData); err != nil {
					logger.Error("deepgram asr: fail to send remaining audio", logger.WithError(err))
				}
				pendingData = nil
			}
			return

		case <-ctx.Done():
			return
		}
	}
}

// writeAudio sends a binary audio frame to the Deepgram WebSocket.
func (dg *DeepgramASR) writeAudio(audio []byte) error {
	dg.mu.Lock()
	conn := dg.conn
	dg.mu.Unlock()
	if conn == nil {
		return fmt.Errorf("deepgram asr: connection closed")
	}
	dg.mu.Lock()
	err := conn.WriteMessage(websocket.BinaryMessage, audio)
	dg.mu.Unlock()
	return err
}

// keepAlive periodically sends a KeepAlive message to keep the WebSocket
// connection open during silence.
func (dg *DeepgramASR) keepAlive(ctx context.Context) {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			dg.mu.Lock()
			conn := dg.conn
			dg.mu.Unlock()
			if conn == nil {
				return
			}
			keepAliveMsg, _ := json.Marshal(map[string]string{"type": "KeepAlive"})
			dg.mu.Lock()
			err := conn.WriteMessage(websocket.TextMessage, keepAliveMsg)
			dg.mu.Unlock()
			if err != nil {
				logger.Error("deepgram asr: keep alive error", append(logger.WithFields(map[string]interface{}{"dialogID": dg.dialogID}), logger.WithError(err))...)
				dg.causeErr(err)
				return
			}
		}
	}
}

// DeepgramResponse is the parsed JSON response from the Deepgram streaming API.
type DeepgramResponse struct {
	Type        string  `json:"type"`
	Duration    float64 `json:"duration"`
	Start       float64 `json:"start"`
	IsFinal     bool    `json:"is_final"`
	Channel     Channel `json:"channel"`
	ErrCode     string  `json:"err_code,omitempty"`
	ErrMsg      string  `json:"err_msg,omitempty"`
	Description string  `json:"description,omitempty"`
	RequestID   string  `json:"request_id,omitempty"`
}

// Channel holds the recognition alternatives for a Deepgram response.
type Channel struct {
	Alternatives []Alternative `json:"alternatives"`
}

// Alternative holds a single transcript alternative.
type Alternative struct {
	Transcript string  `json:"transcript"`
	Confidence float64 `json:"confidence"`
}
