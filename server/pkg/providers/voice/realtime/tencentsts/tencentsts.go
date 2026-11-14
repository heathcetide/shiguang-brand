// Package realtime implements the Tencent Cloud STS (Speech-to-Speech 智能实时对话)
// adapter for ling-base.
//
//	wss://mps.cloud.tencent.com/sts/v1/?{query-params}
//
// The STS service provides a full-duplex WebSocket pipeline:
// 上行流式音频 → ASR → LLM → TTS → 下行流式音频.
//
// Auth: signed URL query parameters (secretid, signature, etc.) or token-based.
// The protocol uses JSON text frames for control messages and binary frames
// for PCM audio. See protocol.go for handshake and framing details.
package realtime

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	base "github.com/heathcetide/DietDigiDose/pkg/providers/voice/realtime"
	"github.com/gorilla/websocket"
)

const (
	ProviderSlug   = "tencent_sts"
	DefaultBaseURL = "wss://mps.cloud.tencent.com/sts/v1/"
	DefaultVoice   = "101001"
	DefaultDialMs  = 15000
	DefaultSendBuf = 64
)

func init() {
	base.Register(New, ProviderSlug, "tencent_sts", "tencent", "tencent_realtime")
}

// Config is the typed shape of the credential JSON.
type Config struct {
	SecretID      string
	SecretKey     string
	AppID         string
	Token         string
	BaseURL       string
	VoiceID       string
	SourceLang    string
	SystemPrompt  string
	LLMModel      string
	DialTimeoutMs int
	InputRate     int
	OutputRate    int
}

// New is the realtime.Provider entry point.
func New(cfg map[string]any, opts base.Options) (base.Agent, error) {
	c := Config{
		SecretID:      base.FirstString(cfg, "secretId", "secret_id"),
		SecretKey:     base.FirstString(cfg, "secretKey", "secret_key"),
		AppID:         base.FirstString(cfg, "appId", "app_id"),
		Token:         base.FirstString(cfg, "token"),
		BaseURL:       base.FirstString(cfg, "baseUrl", "base_url"),
		VoiceID:       base.FirstString(cfg, "voiceId", "voice_id", "voice"),
		SourceLang:    base.FirstString(cfg, "sourceLang", "source_lang"),
		SystemPrompt:  base.FirstString(cfg, "systemPrompt", "system_prompt", "instructions"),
		LLMModel:      base.FirstString(cfg, "llmModel", "llm_model"),
		DialTimeoutMs: base.FirstInt(cfg, "dialTimeoutMs", "dial_timeout_ms"),
		InputRate:     base.FirstInt(cfg, "inputSampleRate", "input_sample_rate"),
		OutputRate:    base.FirstInt(cfg, "outputSampleRate", "output_sample_rate"),
	}
	if strings.TrimSpace(c.SecretID) == "" {
		c.SecretID = strings.TrimSpace(os.Getenv("TENCENT_SECRET_ID"))
	}
	if strings.TrimSpace(c.SecretKey) == "" {
		c.SecretKey = strings.TrimSpace(os.Getenv("TENCENT_SECRET_KEY"))
	}
	if c.SecretID == "" || c.SecretKey == "" {
		return nil, fmt.Errorf("tencent_sts: secretId and secretKey are required")
	}
	if c.BaseURL == "" {
		c.BaseURL = DefaultBaseURL
	}
	if c.VoiceID == "" {
		c.VoiceID = DefaultVoice
	}
	if c.SourceLang == "" {
		c.SourceLang = "en"
	}
	if c.DialTimeoutMs <= 0 {
		c.DialTimeoutMs = DefaultDialMs
	}
	if c.InputRate <= 0 {
		c.InputRate = opts.InputSampleRate
		if c.InputRate <= 0 {
			c.InputRate = 16000
		}
	}
	if c.OutputRate <= 0 {
		c.OutputRate = opts.OutputSampleRate
		if c.OutputRate <= 0 {
			c.OutputRate = 24000
		}
	}
	sys := strings.TrimSpace(c.SystemPrompt)
	if sys == "" {
		c.SystemPrompt = strings.TrimSpace(opts.SystemPrompt)
	} else if sp := strings.TrimSpace(opts.SystemPrompt); sp != "" {
		c.SystemPrompt = sys + "\n\n" + sp
	}
	if strings.TrimSpace(opts.Voice) != "" {
		c.VoiceID = strings.TrimSpace(opts.Voice)
	}
	return &Agent{cfg: c, ba: base.NewBaseAgent(ProviderSlug, opts, DefaultSendBuf)}, nil
}

// Agent is the Tencent STS client.
type Agent struct {
	cfg Config
	ba  *base.BaseAgent
}

func (a *Agent) Start(ctx context.Context) error {
	var startErr error
	a.ba.MarkStartOnce(func() {
		startErr = a.doStart(ctx)
	})
	return startErr
}

func (a *Agent) doStart(ctx context.Context) error {
	wsURL, err := BuildURL(a.cfg)
	if err != nil {
		return err
	}
	dialer := *websocket.DefaultDialer
	dialer.HandshakeTimeout = time.Duration(a.cfg.DialTimeoutMs) * time.Millisecond
	headers := http.Header{}

	conn, resp, err := dialer.DialContext(ctx, wsURL, headers)
	if err != nil {
		status := -1
		if resp != nil {
			status = resp.StatusCode
			_ = resp.Body.Close()
		}
		return fmt.Errorf("tencent_sts: dial %s (status=%d): %w", wsURL, status, err)
	}
	a.ba.SetConn(conn)

	rootCtx, rootCancel := context.WithCancel(context.Background())
	a.ba.SetRootContext(rootCtx, rootCancel)
	a.ba.Dispatch = a.dispatch
	a.ba.StartLoops()

	// Send handshake to initialize the session
	if err := a.ba.SendJSON(a.buildHandshake(), false); err != nil {
		_ = conn.Close()
		return fmt.Errorf("tencent_sts: handshake: %w", err)
	}
	return nil
}

func (a *Agent) buildHandshake() map[string]any {
	hs := map[string]any{
		"type":             "Handshake",
		"voiceId":          a.cfg.VoiceID,
		"sourceLang":       a.cfg.SourceLang,
		"inputSampleRate":  a.cfg.InputRate,
		"outputSampleRate": a.cfg.OutputRate,
		"outputFormat":     "pcm",
	}
	if a.cfg.SystemPrompt != "" {
		hs["systemPrompt"] = a.cfg.SystemPrompt
	}
	if a.cfg.LLMModel != "" {
		hs["llmModel"] = a.cfg.LLMModel
	}
	return hs
}

func (a *Agent) PushAudio(pcm []byte) error {
	if a.ba.IsClosed() {
		return base.ErrAgentClosed
	}
	if len(pcm) == 0 {
		return nil
	}
	// Binary audio frame — send directly via conn (not through JSON sendCh)
	// We use SendRaw with a binary marker. However BaseAgent's writeLoop sends
	// TextMessage. For binary, we need to send directly.
	return a.ba.SendRaw(pcm, true)
}

func (a *Agent) CommitInputAudio() error {
	if a.ba.IsClosed() {
		return base.ErrAgentClosed
	}
	return a.ba.SendJSON(map[string]any{"type": "Finish"}, false)
}

func (a *Agent) Cancel() error {
	if a.ba.IsClosed() {
		return base.ErrAgentClosed
	}
	return a.ba.SendJSON(map[string]any{"type": "Abort"}, false)
}

func (a *Agent) UpdateInstructions(instructions string) error {
	instructions = strings.TrimSpace(instructions)
	if instructions == "" {
		return nil
	}
	a.cfg.SystemPrompt = instructions
	if a.ba.IsClosed() || a.ba.Conn() == nil {
		return base.ErrAgentClosed
	}
	return a.ba.SendJSON(map[string]any{
		"type":         "UpdateConfig",
		"systemPrompt": instructions,
	}, false)
}

func (a *Agent) Close() error {
	return a.ba.CloseWithTeardown(func(conn *websocket.Conn) {
		// Best-effort FinishConnection
		msg, _ := json.Marshal(map[string]any{"type": "FinishConnection"})
		_ = conn.WriteMessage(websocket.TextMessage, msg)
	})
}

func (a *Agent) dispatch(raw []byte) {
	// Tencent STS sends JSON text frames for control events
	var head struct {
		Type    string `json:"type"`
		Event   string `json:"event"`
		ASRText string `json:"asrText"`
		Text    string `json:"text"`
		Audio   string `json:"audio"`
		Error   string `json:"error"`
		IsFinal bool   `json:"isFinal"`
	}
	if err := json.Unmarshal(raw, &head); err != nil {
		a.ba.Emit(base.Event{
			Type:   base.EventError,
			Vendor: ProviderSlug,
			Err:    fmt.Errorf("tencent_sts: bad json: %w", err),
			Raw:    raw,
		})
		return
	}
	evtType := head.Type
	if evtType == "" {
		evtType = head.Event
	}
	switch evtType {
	case "HandshakeResult", "SessionStarted":
		a.ba.FireOnce(base.Event{Type: base.EventSessionOpen, Vendor: ProviderSlug, Raw: raw})

	case "ASRResult", "asr_result":
		text := head.ASRText
		if text == "" {
			text = head.Text
		}
		if text != "" {
			a.ba.Emit(base.Event{
				Type:   base.EventUserTranscript,
				Vendor: ProviderSlug,
				Text:   text,
				Final:  head.IsFinal,
			})
		}

	case "LLMResult", "llm_result":
		if head.Text != "" {
			a.ba.Emit(base.Event{
				Type:   base.EventAssistantText,
				Vendor: ProviderSlug,
				Text:   head.Text,
				Final:  head.IsFinal,
			})
		}

	case "TTSResult", "tts_result":
		if head.Audio != "" {
			pcm, err := base64.StdEncoding.DecodeString(head.Audio)
			if err != nil {
				a.ba.Emit(base.Event{
					Type:   base.EventError,
					Vendor: ProviderSlug,
					Err:    fmt.Errorf("tencent_sts: bad base64 audio: %w", err),
				})
				return
			}
			a.ba.Emit(base.Event{
				Type:    base.EventAssistantAudio,
				Vendor:  ProviderSlug,
				AudioPC: pcm,
			})
		}

	case "TTSEnded", "ResponseDone":
		a.ba.Emit(base.Event{Type: base.EventAssistantTurnEnd, Vendor: ProviderSlug, Raw: raw})

	case "Error", "error":
		text := head.Error
		if text == "" {
			text = "unknown"
		}
		a.ba.Emit(base.Event{
			Type:   base.EventError,
			Vendor: ProviderSlug,
			Err:    fmt.Errorf("tencent_sts: server error: %s", text),
			Fatal:  true,
			Raw:    raw,
		})
	}
}

// BuildURL constructs the signed WebSocket URL for Tencent STS.
// In production, the signature should be computed server-side. For dev/test,
// a pre-signed URL can be passed via baseUrl in the credential config.
func BuildURL(c Config) (string, error) {
	baseURL := c.BaseURL
	if baseURL == "" {
		baseURL = DefaultBaseURL
	}
	u, err := url.Parse(baseURL)
	if err != nil {
		return "", fmt.Errorf("tencent_sts: parse baseUrl: %w", err)
	}
	if u.Scheme != "ws" && u.Scheme != "wss" {
		return "", fmt.Errorf("tencent_sts: baseUrl must be ws:// or wss://, got %q", u.Scheme)
	}
	q := u.Query()
	if q.Get("secretid") == "" && c.SecretID != "" {
		q.Set("secretid", c.SecretID)
	}
	if c.AppID != "" && q.Get("appid") == "" {
		q.Set("appid", c.AppID)
	}
	if c.Token != "" && q.Get("token") == "" {
		q.Set("token", c.Token)
	}
	u.RawQuery = q.Encode()
	return u.String(), nil
}

// Compile-time guard.
var _ base.Agent = (*Agent)(nil)
