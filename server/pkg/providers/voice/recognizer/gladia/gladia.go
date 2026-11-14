// Package synthesizer implements the Gladia ASR adapter for ling-base.
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
	"github.com/gorilla/websocket"
)

// closeMsg is the terminate message sent to Gladia to signal end of stream.
var closeMsg = []byte(`{"event": "terminate"}`)

// Compile-time guard ensuring GladiaASR implements base.Engine.
var _ base.Engine = (*GladiaASR)(nil)

// GladiaASR is the Gladia streaming ASR engine.
type GladiaASR struct {
	Handler interface{}

	sentence    string
	startTime   *time.Time
	endTime     *time.Time
	sendReqTime *time.Time
	endReqTime  *time.Time

	opt GladiaASROption

	conn   *websocket.Conn
	ctx    context.Context
	cancel context.CancelFunc

	dialogID string

	tr base.ResultFunc
	er base.ErrorFunc

	isStreaming bool
	mu          sync.Mutex

	audioQueue chan []byte
}

// GladiaASROption configures the Gladia ASR engine.
type GladiaASROption struct {
	APIKey      string `json:"apiKey" yaml:"api_key"`
	URL         string `json:"url" yaml:"url" default:"wss://api.gladia.io/audio/text/streaming"`
	Language    string `json:"language" yaml:"language" default:"english"`
	Model       string `json:"model" yaml:"model" default:"fast-conversational"`
	SampleRate  int    `json:"sampleRate" yaml:"sample_rate" default:"16000"`
	Encoding    string `json:"encoding" yaml:"encoding" default:"wav/pcm"`
	ReqChanSize int    `json:"reqChanSize" yaml:"req_chan_size" default:"128"`
}

// GetVendor returns the vendor identifier.
func (opt *GladiaASROption) GetVendor() base.Vendor {
	return base.VendorGladia
}

// NewGladiaASROption creates a default GladiaASROption.
func NewGladiaASROption(apiKey string) GladiaASROption {
	return GladiaASROption{
		APIKey:      apiKey,
		URL:         "wss://api.gladia.io/audio/text/streaming",
		Language:    "english",
		Model:       "fast-conversational",
		SampleRate:  16000,
		Encoding:    "wav/pcm",
		ReqChanSize: 128,
	}
}

// NewGladiaASR builds a Gladia ASR engine.
func NewGladiaASR(opt GladiaASROption) *GladiaASR {
	if opt.ReqChanSize <= 0 {
		opt.ReqChanSize = 128
	}
	if strings.TrimSpace(opt.URL) == "" {
		opt.URL = "wss://api.gladia.io/audio/text/streaming"
	}
	if strings.TrimSpace(opt.Language) == "" {
		opt.Language = "english"
	}
	if strings.TrimSpace(opt.Model) == "" {
		opt.Model = "fast-conversational"
	}
	if strings.TrimSpace(opt.Encoding) == "" {
		opt.Encoding = "wav/pcm"
	}
	if opt.SampleRate <= 0 {
		opt.SampleRate = 16000
	}
	return &GladiaASR{
		opt:        opt,
		audioQueue: make(chan []byte, 1024),
	}
}

func (g *GladiaASR) Init(tr base.ResultFunc, er base.ErrorFunc) {
	g.tr = tr
	g.er = er
}

func (g *GladiaASR) Vendor() string { return "gladia" }

func (g *GladiaASR) ConnAndReceive(dialogID string) error {
	g.mu.Lock()
	defer g.mu.Unlock()

	g.dialogID = dialogID
	now := time.Now()
	g.sendReqTime = &now
	g.endReqTime = nil
	g.sentence = ""

	// Build URL with query params
	u, err := url.Parse(g.opt.URL)
	if err != nil {
		return fmt.Errorf("gladia asr: parse url: %w", err)
	}
	q := u.Query()
	q.Set("language", g.opt.Language)
	q.Set("model", g.opt.Model)
	q.Set("encoding", g.opt.Encoding)
	q.Set("sample_rate", fmt.Sprintf("%d", g.opt.SampleRate))
	u.RawQuery = q.Encode()

	header := http.Header{}
	header.Set("Authorization", "Bearer "+g.opt.APIKey)

	conn, _, err := websocket.DefaultDialer.Dial(u.String(), header)
	if err != nil {
		logger.Error("gladia asr: fail to dial", logger.WithError(err))
		return err
	}
	g.conn = conn

	ctx, cancel := context.WithCancel(context.Background())
	g.ctx = ctx
	g.cancel = cancel

	go g.handleReadLoop()
	go g.handleWriteLoop()

	return nil
}

func (g *GladiaASR) Activity() bool {
	g.mu.Lock()
	defer g.mu.Unlock()
	return g.conn != nil && g.isStreaming
}

func (g *GladiaASR) RestartClient() {
	_ = g.StopConn()
	if err := g.ConnAndReceive(g.dialogID); err != nil {
		if g.er != nil {
			g.er(err, true)
		}
	}
}

func (g *GladiaASR) SendAudioBytes(data []byte) error {
	if data == nil || len(data) == 0 {
		return nil
	}
	select {
	case g.audioQueue <- data:
		return nil
	case <-time.After(200 * time.Millisecond):
		return fmt.Errorf("gladia asr: audio queue full")
	}
}

func (g *GladiaASR) SendEnd() error {
	if g.conn != nil {
		_ = g.conn.WriteMessage(websocket.TextMessage, closeMsg)
	}
	return nil
}

func (g *GladiaASR) StopConn() error {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.cancel != nil {
		g.cancel()
	}
	if g.conn != nil {
		_ = g.conn.Close()
		g.conn = nil
	}
	g.isStreaming = false
	return nil
}

func (g *GladiaASR) handleWriteLoop() {
	for {
		select {
		case <-g.ctx.Done():
			return
		case data := <-g.audioQueue:
			if g.conn == nil {
				return
			}
			_ = g.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := g.conn.WriteMessage(websocket.BinaryMessage, data); err != nil {
				logger.Error("gladia asr: fail to send audio", logger.WithError(err))
				if g.er != nil {
					g.er(err, false)
				}
				return
			}
		}
	}
}

func (g *GladiaASR) handleReadLoop() {
	g.isStreaming = true
	defer func() {
		g.isStreaming = false
	}()

	for {
		select {
		case <-g.ctx.Done():
			return
		default:
		}
		if g.conn == nil {
			return
		}
		_ = g.conn.SetReadDeadline(time.Now().Add(30 * time.Second))
		_, message, err := g.conn.ReadMessage()
		if err != nil {
			if websocket.IsCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway) {
				logger.Info("gladia asr: connection closed normally")
			} else {
				logger.Error("gladia asr: read error", logger.WithError(err))
				if g.er != nil {
					g.er(err, false)
				}
			}
			return
		}

		var resp GladiaResponse
		if err := json.Unmarshal(message, &resp); err != nil {
			logger.Debug("gladia asr: skip non-json frame", logger.WithError(err))
			continue
		}

		if resp.Type == "error" {
			errMsg := resp.Error
			if errMsg == "" {
				errMsg = string(message)
			}
			logger.Error("gladia asr: server error", logger.WithFields(map[string]interface{}{"error": errMsg})...)
			if g.er != nil {
				g.er(fmt.Errorf("gladia asr: %s", errMsg), false)
			}
			continue
		}

		if resp.Type == "final" {
			text := strings.TrimSpace(resp.Text)
			if text != "" {
				g.emitFinal(text)
			}
			continue
		}

		if resp.Type == "partial" || resp.Type == "transcript" {
			text := strings.TrimSpace(resp.Text)
			if text != "" {
				g.emitPartial(text)
			}
		}
	}
}

func (g *GladiaASR) emitPartial(text string) {
	text = strings.TrimSpace(text)
	if text == "" {
		return
	}
	g.sentence = text
	if g.tr != nil {
		dur := time.Duration(0)
		if g.sendReqTime != nil {
			dur = time.Since(*g.sendReqTime)
		}
		g.tr(text, false, dur, g.dialogID)
	}
}

func (g *GladiaASR) emitFinal(text string) {
	text = strings.TrimSpace(text)
	if text == "" {
		text = strings.TrimSpace(g.sentence)
	}
	if text == "" {
		return
	}
	g.sentence = text
	dur := time.Duration(0)
	if g.sendReqTime != nil {
		dur = time.Since(*g.sendReqTime)
	}
	if g.tr != nil {
		g.tr(text, true, dur, g.dialogID)
	}
	g.sentence = ""
}

// GladiaResponse represents the JSON response from Gladia.
type GladiaResponse struct {
	Type  string `json:"type"`
	Text  string `json:"text"`
	Error string `json:"error,omitempty"`
	Event string `json:"event,omitempty"`
}
