// Package synthesizer implements the FunASR ASR adapter for ling-base.
package synthesizer

import (
	"context"
	"crypto/tls"
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

// endSpeaking is the JSON payload sent to FunASR to signal that the user
// has stopped speaking.
var endSpeaking = []byte(`{"is_speaking":false}`)

// Session is a minimal session representation used for logging context.
// It mirrors the subset of media.MediaHandler.GetSession() that this
// adapter relies on, without importing the media package.
type Session struct {
	ID string
}

// Handler is a minimal media handler interface used for session context.
// Implementations may provide a session identifier for structured logging.
type Handler interface {
	GetSession() *Session
}

// FunASRResponse is the parsed ASR response returned by the FunASR server.
type FunASRResponse struct {
	Mode    string `json:"mode"`
	Text    string `json:"text"`
	IsFinal bool   `json:"is_final"`
}

// FunASROption configures the FunASR engine.
type FunASROption struct {
	URL         string `json:"url" yaml:"url" env:"FUNASR_URL"`
	Model       string `json:"model" yaml:"model"`
	SampleRate  int    `json:"sampleRate" yaml:"sample_rate"`
	Format      string `json:"format" yaml:"format"`
	ReqChanSize int    `json:"reqChanSize" yaml:"req_chan_size" default:"128"`
	HotWords    string `json:"hotWords" yaml:"hot_words"`
	Itn         bool   `json:"itn" yaml:"itn"`
	Punc        bool   `json:"punc" yaml:"punc"`

	// Advanced FunASR streaming options.
	Mode                 string `json:"mode" yaml:"mode"`
	ChunkSize            []int  `json:"chunkSize" yaml:"chunk_size"`
	ChunkInterval        int    `json:"chunkInterval" yaml:"chunk_interval"`
	EncoderChunkLookBack int    `json:"encoderChunkLookBack" yaml:"encoder_chunk_look_back"`
	DecoderChunkLookBack int    `json:"decoderChunkLookBack" yaml:"decoder_chunk_look_back"`
	AudioFs              int    `json:"audioFs" yaml:"audio_fs"`
	WavName              string `json:"wavName" yaml:"wav_name"`
	WavFormat            string `json:"wavFormat" yaml:"wav_format"`
	IsSpeaking           bool   `json:"isSpeaking" yaml:"is_speaking"`
}

// funASRRequestOption is the payload sent as the initial configuration
// message right after the WebSocket connection is established.
type funASRRequestOption struct {
	Mode                 string `json:"mode"`
	ChunkSize            []int  `json:"chunk_size"`
	ChunkInterval        int    `json:"chunk_interval"`
	EncoderChunkLookBack int    `json:"encoder_chunk_look_back"`
	DecoderChunkLookBack int    `json:"decoder_chunk_look_back"`
	AudioFs              int    `json:"audio_fs"`
	WavName              string `json:"wav_name"`
	WavFormat            string `json:"wav_format"`
	IsSpeaking           bool   `json:"is_speaking"`
	Hotwords             string `json:"hotwords"`
	Itn                  bool   `json:"itn"`
}

// GetVendor returns the vendor identifier for this option.
func (opt *FunASROption) GetVendor() base.Vendor {
	return base.VendorFunASR
}

// NewFunASROption creates a FunASROption with sensible defaults for the
// given WebSocket URL.
func NewFunASROption(url string) FunASROption {
	return FunASROption{
		URL:                  url,
		ReqChanSize:          128,
		Model:                "paraformer-realtime-v2",
		SampleRate:           16000,
		Format:               "pcm",
		Mode:                 "2pass",
		ChunkSize:            []int{5, 10, 5},
		ChunkInterval:        10,
		EncoderChunkLookBack: 4,
		DecoderChunkLookBack: 0,
		AudioFs:              16000,
		WavName:              "demo",
		WavFormat:            "pcm",
		IsSpeaking:           true,
		HotWords:             "",
		Itn:                  false,
		Punc:                 false,
	}
}

// newFunASRRequestOption builds the initial config payload from an option.
func newFunASRRequestOption(opt FunASROption) funASRRequestOption {
	return funASRRequestOption{
		Mode:                 opt.Mode,
		ChunkSize:            opt.ChunkSize,
		ChunkInterval:        opt.ChunkInterval,
		EncoderChunkLookBack: opt.EncoderChunkLookBack,
		DecoderChunkLookBack: opt.DecoderChunkLookBack,
		AudioFs:              opt.AudioFs,
		WavName:              opt.WavName,
		WavFormat:            opt.WavFormat,
		IsSpeaking:           opt.IsSpeaking,
		Hotwords:             opt.HotWords,
		Itn:                  opt.Itn,
	}
}

// FunASR is the FunASR streaming ASR engine.
type FunASR struct {
	Handler     Handler
	sentence    string
	startTime   *time.Time
	endTime     *time.Time
	sendReqTime *time.Time
	endReqTime  *time.Time
	opt         FunASROption
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

// Compile-time guard ensuring FunASR implements base.Engine.
var _ base.Engine = (*FunASR)(nil)

// NewFunASR builds a FunASR ASR engine from the supplied option.
func NewFunASR(opt FunASROption) *FunASR {
	if opt.ReqChanSize <= 0 {
		opt.ReqChanSize = 128
	}
	if strings.TrimSpace(opt.Mode) == "" {
		opt.Mode = "2pass"
	}
	if opt.ChunkSize == nil {
		opt.ChunkSize = []int{5, 10, 5}
	}
	if opt.ChunkInterval == 0 {
		opt.ChunkInterval = 10
	}
	if opt.AudioFs == 0 {
		opt.AudioFs = opt.SampleRate
	}
	if opt.AudioFs == 0 {
		opt.AudioFs = 16000
	}
	if strings.TrimSpace(opt.WavFormat) == "" {
		opt.WavFormat = opt.Format
	}
	if strings.TrimSpace(opt.WavFormat) == "" {
		opt.WavFormat = "pcm"
	}
	if strings.TrimSpace(opt.WavName) == "" {
		opt.WavName = "demo"
	}
	return &FunASR{
		opt:        opt,
		audioQueue: make(chan []byte, opt.ReqChanSize),
	}
}

// Init registers the result and error callbacks.
func (fun *FunASR) Init(tr base.ResultFunc, er base.ErrorFunc) {
	fun.tr = tr
	fun.er = er
}

// Vendor returns the vendor identifier string.
func (fun *FunASR) Vendor() string {
	return "funasr"
}

// ConnAndReceive dials the FunASR WebSocket server, sends the initial
// configuration message, and starts the background read loop.
func (fun *FunASR) ConnAndReceive(dialogID string) error {
	fun.mu.Lock()
	defer fun.mu.Unlock()

	fun.dialogID = dialogID
	fun.sentence = ""
	fun.isStreaming = true
	now := time.Now()
	fun.sendReqTime = &now
	fun.endReqTime = nil

	if fun.audioQueue == nil {
		fun.audioQueue = make(chan []byte, fun.opt.ReqChanSize)
	}

	dialer := websocket.Dialer{
		TLSClientConfig: &tls.Config{
			InsecureSkipVerify: true,
		},
		HandshakeTimeout: 10 * time.Second,
		ReadBufferSize:   1024,
		WriteBufferSize:  1024,
	}
	conn, _, err := dialer.Dial(fun.opt.URL, nil)
	if err != nil {
		logger.Error("funasr asr: dial failed", append(logger.WithFields(map[string]interface{}{
			"url":       fun.opt.URL,
			"dialogID":  dialogID,
			"sessionID": fun.sessionID(),
		}), logger.WithError(err))...)
		return err
	}

	option := newFunASRRequestOption(fun.opt)
	jsonOption, err := json.Marshal(option)
	if err != nil {
		_ = conn.Close()
		return err
	}
	// Send the initial configuration message.
	if err = conn.WriteMessage(websocket.TextMessage, jsonOption); err != nil {
		_ = conn.Close()
		return err
	}

	ctx, cancel := context.WithCancel(context.Background())
	fun.conn = conn
	fun.ctx = ctx
	fun.cancel = cancel

	logger.Info("funasr asr: connected", logger.WithFields(map[string]interface{}{
		"url":       fun.opt.URL,
		"dialogID":  dialogID,
		"sessionID": fun.sessionID(),
	})...)

	go fun.handleReadLoop(ctx, conn)
	return nil
}

// Activity returns true if the engine is actively connected and streaming.
func (fun *FunASR) Activity() bool {
	fun.mu.Lock()
	defer fun.mu.Unlock()
	return fun.conn != nil && fun.isStreaming
}

// RestartClient stops the current connection and re-establishes a new one.
func (fun *FunASR) RestartClient() {
	if err := fun.StopConn(); err != nil {
		logger.Error("funasr asr: close client encountered an error", logger.WithError(err))
	}
	id := strings.TrimSpace(fun.dialogID)
	if id == "" {
		id = uuid.New().String()
	}
	if err := fun.ConnAndReceive(id); err != nil {
		if fun.er != nil {
			fun.er(err, true)
		}
	}
}

// SendAudioBytes sends a chunk of raw audio bytes to the FunASR server.
func (fun *FunASR) SendAudioBytes(data []byte) error {
	if len(data) == 0 {
		return nil
	}
	fun.mu.Lock()
	conn := fun.conn
	fun.mu.Unlock()
	if conn == nil {
		return fmt.Errorf("funasr asr: connection is not established")
	}
	if fun.sendReqTime == nil {
		n := time.Now()
		fun.sendReqTime = &n
	}
	return conn.WriteMessage(websocket.BinaryMessage, data)
}

// SendEnd signals that the user has stopped speaking.
func (fun *FunASR) SendEnd() error {
	fun.mu.Lock()
	defer fun.mu.Unlock()

	fun.isStreaming = false
	n := time.Now()
	fun.endReqTime = &n
	if fun.conn == nil {
		return nil
	}
	return fun.conn.WriteMessage(websocket.TextMessage, endSpeaking)
}

// StopConn cancels the read loop and closes the WebSocket connection.
func (fun *FunASR) StopConn() error {
	fun.mu.Lock()
	cancel := fun.cancel
	conn := fun.conn
	fun.mu.Unlock()

	if cancel != nil {
		cancel()
	}
	if conn != nil {
		err := conn.Close()
		fun.mu.Lock()
		fun.conn = nil
		fun.isStreaming = false
		fun.mu.Unlock()
		return err
	}
	return nil
}

// handleReadLoop reads messages from the FunASR server, parses the JSON
// responses, and emits partial/final recognition results via the
// registered callbacks.
func (fun *FunASR) handleReadLoop(ctx context.Context, conn *websocket.Conn) {
	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		messageType, message, err := conn.ReadMessage()
		if err != nil {
			if websocket.IsCloseError(err, websocket.CloseNormalClosure) {
				logger.Debug("funasr asr: recv close message, connection closed", logger.WithFields(map[string]interface{}{
					"sessionID": fun.sessionID(),
					"dialogID":  fun.dialogID,
				})...)
				fun.emitFinalOnClose()
				if fun.er != nil {
					fun.er(nil, false)
				}
				return
			}

			logger.Error("funasr asr: recv error, connection closed", append(logger.WithFields(map[string]interface{}{
				"sessionID":   fun.sessionID(),
				"dialogID":    fun.dialogID,
				"message":     string(message),
				"messageType": messageType,
			}), logger.WithError(err))...)
			fun.emitFinalOnClose()
			if fun.er != nil {
				fun.er(err, false)
			}
			return
		}

		var msg FunASRResponse
		if err = json.Unmarshal(message, &msg); err != nil {
			logger.Error("funasr asr: serialize frame failed", append(logger.WithFields(map[string]interface{}{
				"sessionID": fun.sessionID(),
				"dialogID":  fun.dialogID,
				"url":       fun.opt.URL,
				"raw":       string(message),
			}), logger.WithError(err))...)
			if fun.er != nil {
				fun.er(err, false)
			}
			return
		}

		fun.mu.Lock()
		if msg.IsFinal {
			if strings.TrimSpace(msg.Text) != "" {
				fun.sentence = msg.Text
			}
			text := fun.sentence
			dur := fun.sinceSend()
			fun.mu.Unlock()

			fun.emitFinal(text, dur)
		} else {
			fun.sentence += msg.Text
			text := fun.sentence
			dur := fun.sinceSend()
			fun.mu.Unlock()

			fun.emitPartial(text, dur)
		}
	}
}

// emitPartial emits a partial (non-final) recognition result.
func (fun *FunASR) emitPartial(text string, dur time.Duration) {
	text = strings.TrimSpace(text)
	if text == "" {
		return
	}
	if fun.tr != nil {
		fun.tr(text, false, dur, fun.dialogID)
	}
}

// emitFinal emits a final recognition result.
func (fun *FunASR) emitFinal(text string, dur time.Duration) {
	text = strings.TrimSpace(text)
	if text == "" {
		return
	}
	if fun.tr != nil {
		fun.tr(text, true, dur, fun.dialogID)
	}
}

// emitFinalOnClose flushes any pending sentence as a final result when the
// connection is closed unexpectedly.
func (fun *FunASR) emitFinalOnClose() {
	fun.mu.Lock()
	text := strings.TrimSpace(fun.sentence)
	dur := fun.sinceSend()
	fun.sentence = ""
	fun.mu.Unlock()

	if text == "" {
		return
	}
	if fun.tr != nil {
		fun.tr(text, true, dur, fun.dialogID)
	}
}

// sinceSend returns the duration since the request was started. It must be
// called while holding fun.mu (or after locking it).
func (fun *FunASR) sinceSend() time.Duration {
	if fun.sendReqTime == nil {
		return 0
	}
	return time.Since(*fun.sendReqTime)
}

// sessionID returns the current session identifier for logging, if a
// Handler is registered.
func (fun *FunASR) sessionID() string {
	if fun.Handler != nil {
		if s := fun.Handler.GetSession(); s != nil {
			return s.ID
		}
	}
	return ""
}
