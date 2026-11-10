// Package realtime implements the StepFun (阶跃星辰) Realtime API adapter for
// ling-base. StepFun's Realtime API is wire-compatible with OpenAI Realtime:
//
//	wss://api.stepfun.com/v1/realtime?model=<model>
//
// Auth: Authorization: Bearer <STEP_API_KEY>. The event flow (session.update,
// input_audio_buffer.append, response.audio.delta, etc.) is identical to
// OpenAI Realtime, so this adapter reuses the same dispatch logic.
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
	ProviderSlug   = "stepfun_realtime"
	DefaultBaseURL = "wss://api.stepfun.com/v1/realtime"
	DefaultModel   = "stepaudio-2.5-realtime"
	DefaultVoice   = "qingchunshaonv"
	DefaultDialMs  = 15000
	DefaultSendBuf = 64
)

func init() {
	base.Register(New, ProviderSlug, "stepfun", "step_audio", "step-audio", "stepfun_realtime")
}

// Config is the typed shape of the credential JSON.
type Config struct {
	APIKey        string
	BaseURL       string
	Model         string
	Voice         string
	Instructions  string
	DialTimeoutMs int
}

// New is the realtime.Provider entry point.
//
//	cfg keys: apiKey (required, or STEPFUN_API_KEY env), baseUrl, model,
//	voice, instructions, dialTimeoutMs
func New(cfg map[string]any, opts base.Options) (base.Agent, error) {
	c := Config{
		APIKey:        base.FirstString(cfg, "apiKey", "api_key"),
		BaseURL:       base.FirstString(cfg, "baseUrl", "base_url"),
		Model:         base.FirstString(cfg, "model"),
		Voice:         base.FirstString(cfg, "voice"),
		Instructions:  base.FirstString(cfg, "instructions"),
		DialTimeoutMs: base.FirstInt(cfg, "dialTimeoutMs", "dial_timeout_ms"),
	}
	if strings.TrimSpace(c.APIKey) == "" {
		c.APIKey = strings.TrimSpace(os.Getenv("STEPFUN_API_KEY"))
	}
	if strings.TrimSpace(c.APIKey) == "" {
		return nil, fmt.Errorf("stepfun_realtime: apiKey or STEPFUN_API_KEY is required")
	}
	if c.BaseURL == "" {
		c.BaseURL = DefaultBaseURL
	}
	if c.Model == "" {
		c.Model = DefaultModel
	}
	if c.Voice == "" {
		c.Voice = DefaultVoice
	}
	if c.DialTimeoutMs <= 0 {
		c.DialTimeoutMs = DefaultDialMs
	}
	instr := strings.TrimSpace(c.Instructions)
	sys := strings.TrimSpace(opts.SystemPrompt)
	switch {
	case instr != "" && sys != "":
		c.Instructions = instr + "\n\n" + sys
	case sys != "":
		c.Instructions = sys
	}
	if strings.TrimSpace(opts.Voice) != "" {
		c.Voice = opts.Voice
	}
	return &Agent{cfg: c, ba: base.NewBaseAgent(ProviderSlug, opts, DefaultSendBuf)}, nil
}

// Agent is the StepFun Realtime API client.
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
	wsURL, err := BuildURL(a.cfg.BaseURL, a.cfg.Model)
	if err != nil {
		return err
	}
	dialer := *websocket.DefaultDialer
	dialer.HandshakeTimeout = time.Duration(a.cfg.DialTimeoutMs) * time.Millisecond
	headers := http.Header{}
	headers.Set("Authorization", "Bearer "+a.cfg.APIKey)

	conn, resp, err := dialer.DialContext(ctx, wsURL, headers)
	if err != nil {
		status := -1
		if resp != nil {
			status = resp.StatusCode
			_ = resp.Body.Close()
		}
		return fmt.Errorf("stepfun_realtime: dial %s (status=%d): %w", wsURL, status, err)
	}
	a.ba.SetConn(conn)

	rootCtx, rootCancel := context.WithCancel(context.Background())
	a.ba.SetRootContext(rootCtx, rootCancel)
	a.ba.Dispatch = a.dispatch
	a.ba.StartLoops()

	if err := a.ba.SendJSON(map[string]any{
		"type":    "session.update",
		"session": a.buildSession(),
	}, false); err != nil {
		_ = conn.Close()
		return fmt.Errorf("stepfun_realtime: session.update: %w", err)
	}
	return nil
}

func (a *Agent) buildSession() map[string]any {
	opts := a.ba.Opts()
	mods := opts.Modalities
	if len(mods) == 0 {
		mods = []string{"text", "audio"}
	}
	session := map[string]any{
		"voice":               a.cfg.Voice,
		"modalities":          mods,
		"input_audio_format":  "pcm16",
		"output_audio_format": "pcm16",
	}
	if tools := base.ToolsForSession(opts.Tools); len(tools) > 0 {
		session["tools"] = tools
	}
	if !opts.DisableServerVAD {
		session["turn_detection"] = map[string]any{
			"type":                "server_vad",
			"prefix_padding_ms":   500,
			"silence_duration_ms": 500,
		}
	} else {
		session["turn_detection"] = nil
	}
	if strings.TrimSpace(a.cfg.Instructions) != "" {
		session["instructions"] = a.cfg.Instructions
	}
	if opts.Temperature > 0 {
		session["temperature"] = opts.Temperature
	}
	return session
}

func (a *Agent) PushAudio(pcm []byte) error {
	if a.ba.IsClosed() {
		return base.ErrAgentClosed
	}
	if len(pcm) == 0 {
		return nil
	}
	return a.ba.SendJSON(map[string]any{
		"type":  "input_audio_buffer.append",
		"audio": base64.StdEncoding.EncodeToString(pcm),
	}, true)
}

func (a *Agent) CommitInputAudio() error {
	if a.ba.IsClosed() {
		return base.ErrAgentClosed
	}
	return a.ba.SendJSON(map[string]any{"type": "input_audio_buffer.commit"}, false)
}

func (a *Agent) Cancel() error {
	if a.ba.IsClosed() {
		return base.ErrAgentClosed
	}
	return a.ba.SendJSON(map[string]any{"type": "response.cancel"}, false)
}

func (a *Agent) UpdateInstructions(instructions string) error {
	instructions = strings.TrimSpace(instructions)
	if instructions == "" {
		return nil
	}
	a.cfg.Instructions = instructions
	if a.ba.IsClosed() || a.ba.Conn() == nil {
		return base.ErrAgentClosed
	}
	return a.ba.SendJSON(map[string]any{
		"type":    "session.update",
		"session": map[string]any{"instructions": instructions},
	}, false)
}

func (a *Agent) Close() error { return a.ba.Close() }

func (a *Agent) dispatch(raw []byte) {
	var head struct {
		Type string `json:"type"`
	}
	if err := json.Unmarshal(raw, &head); err != nil {
		a.ba.Emit(base.Event{
			Type:   base.EventError,
			Vendor: ProviderSlug,
			Err:    fmt.Errorf("stepfun_realtime: bad json: %w", err),
			Raw:    raw,
		})
		return
	}
	switch head.Type {
	case "session.created", "session.updated":
		a.ba.FireOnce(base.Event{Type: base.EventSessionOpen, Vendor: ProviderSlug, Raw: raw})

	case "input_audio_buffer.speech_started":
		a.ba.Emit(base.Event{Type: base.EventUserSpeechStarted, Vendor: ProviderSlug})

	case "input_audio_buffer.speech_stopped":
		a.ba.Emit(base.Event{Type: base.EventUserSpeechEnded, Vendor: ProviderSlug})

	case "conversation.item.input_audio_transcription.completed":
		var msg struct {
			Transcript string `json:"transcript"`
		}
		_ = json.Unmarshal(raw, &msg)
		if msg.Transcript != "" {
			a.ba.Emit(base.Event{
				Type:   base.EventUserTranscript,
				Vendor: ProviderSlug,
				Text:   msg.Transcript,
				Final:  true,
			})
		}

	case "response.audio_transcript.delta":
		var msg struct {
			Delta string `json:"delta"`
		}
		_ = json.Unmarshal(raw, &msg)
		if msg.Delta != "" {
			a.ba.Emit(base.Event{
				Type:   base.EventAssistantText,
				Vendor: ProviderSlug,
				Text:   msg.Delta,
				Final:  false,
			})
		}

	case "response.audio_transcript.done":
		var msg struct {
			Transcript string `json:"transcript"`
		}
		_ = json.Unmarshal(raw, &msg)
		a.ba.Emit(base.Event{
			Type:   base.EventAssistantText,
			Vendor: ProviderSlug,
			Text:   msg.Transcript,
			Final:  true,
		})

	case "response.audio.delta", "response.output_audio.delta":
		var msg struct {
			Delta string `json:"delta"`
		}
		_ = json.Unmarshal(raw, &msg)
		if msg.Delta == "" {
			return
		}
		pcm, err := base64.StdEncoding.DecodeString(msg.Delta)
		if err != nil {
			a.ba.Emit(base.Event{
				Type:   base.EventError,
				Vendor: ProviderSlug,
				Err:    fmt.Errorf("stepfun_realtime: bad base64 audio: %w", err),
			})
			return
		}
		a.ba.Emit(base.Event{
			Type:    base.EventAssistantAudio,
			Vendor:  ProviderSlug,
			AudioPC: pcm,
		})

	case "response.done":
		a.ba.Emit(base.Event{Type: base.EventAssistantTurnEnd, Vendor: ProviderSlug, Raw: raw})

	case "error":
		var msg struct {
			Error *struct {
				Message string `json:"message"`
				Code    string `json:"code"`
			} `json:"error"`
		}
		_ = json.Unmarshal(raw, &msg)
		text := "unknown"
		if msg.Error != nil {
			if msg.Error.Message != "" {
				text = msg.Error.Message
			} else if msg.Error.Code != "" {
				text = msg.Error.Code
			}
		}
		a.ba.Emit(base.Event{
			Type:   base.EventError,
			Vendor: ProviderSlug,
			Err:    fmt.Errorf("stepfun_realtime: server error: %s", text),
			Fatal:  true,
			Raw:    raw,
		})
	}
}

// BuildURL constructs the WebSocket URL with the model query parameter.
func BuildURL(baseURL, model string) (string, error) {
	if baseURL == "" {
		baseURL = DefaultBaseURL
	}
	u, err := url.Parse(baseURL)
	if err != nil {
		return "", fmt.Errorf("stepfun_realtime: parse baseUrl: %w", err)
	}
	if u.Scheme != "ws" && u.Scheme != "wss" {
		return "", fmt.Errorf("stepfun_realtime: baseUrl must be ws:// or wss://, got %q", u.Scheme)
	}
	q := u.Query()
	if q.Get("model") == "" && model != "" {
		q.Set("model", model)
		u.RawQuery = q.Encode()
	}
	return u.String(), nil
}

// Compile-time guard.
var _ base.Agent = (*Agent)(nil)
