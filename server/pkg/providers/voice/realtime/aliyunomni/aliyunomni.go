// Package realtime implements the DashScope Qwen-Omni realtime adapter for ling-base.
//
//	wss://dashscope.aliyuncs.com/api-ws/v1/realtime?model=<model>
//
// Wire protocol is the OpenAI-realtime-style JSON stream.
// Auth: Authorization Bearer + X-DashScope-OmniRealtime: true.
package realtime

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	base "github.com/heathcetide/DietDigiDose/pkg/providers/voice/realtime"
	"github.com/gorilla/websocket"
)

const (
	ProviderSlug   = "aliyun_omni"
	DefaultBaseURL = "wss://dashscope.aliyuncs.com/api-ws/v1/realtime"
	DefaultModel   = "qwen3.5-omni-flash-realtime-2026-03-15"
	DefaultVoice   = "Tina"
	DefaultDialMs  = 10000
	DefaultSendBuf = 64
)

func init() {
	base.Register(New, ProviderSlug, "qwen_omni", "dashscope_omni")
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
//	cfg keys: apiKey (required), model, voice, instructions, baseUrl, dialTimeoutMs
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
		return nil, fmt.Errorf("aliyunomni: apiKey is required")
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

// Agent is the Qwen-Omni realtime client.
type Agent struct {
	cfg Config
	ba  *base.BaseAgent

	pendingFCMu sync.Mutex
	pendingFCs  []pendingFunctionCall
}

type pendingFunctionCall struct {
	CallID    string
	Name      string
	Arguments string
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
	headers.Set("X-DashScope-OmniRealtime", "true")

	conn, resp, err := dialer.DialContext(ctx, wsURL, headers)
	if err != nil {
		status := -1
		if resp != nil {
			status = resp.StatusCode
			_ = resp.Body.Close()
		}
		return fmt.Errorf("aliyunomni: dial %s (status=%d): %w", wsURL, status, err)
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
		return fmt.Errorf("aliyunomni: session.update: %w", err)
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
		"input_audio_format":  "pcm",
		"output_audio_format": "pcm",
		"input_audio_transcription": map[string]any{
			"model": "gummy-realtime-v1",
		},
	}
	if tools := base.ToolsForSession(opts.Tools); len(tools) > 0 {
		session["tools"] = tools
	}
	if !opts.DisableServerVAD {
		session["turn_detection"] = map[string]any{
			"type":                "server_vad",
			"threshold":           0.8,
			"prefix_padding_ms":   500,
			"silence_duration_ms": 1000,
			"create_response":     true,
			"interrupt_response":  true,
		}
	} else {
		session["turn_detection"] = nil
	}
	if strings.TrimSpace(a.cfg.Instructions) != "" {
		session["instructions"] = a.cfg.Instructions
	}
	if opts.Temperature > 0 {
		t := opts.Temperature
		if t < 0.6 {
			t = 0.6
		}
		if t > 1.2 {
			t = 1.2
		}
		session["temperature"] = t
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

// EnableServerVAD switches the omni session to server-side turn detection.
func (a *Agent) EnableServerVAD() error {
	if a.ba.IsClosed() || a.ba.Conn() == nil {
		return base.ErrAgentClosed
	}
	return a.ba.SendJSON(map[string]any{
		"type": "session.update",
		"session": map[string]any{
			"turn_detection": map[string]any{
				"type":                "server_vad",
				"threshold":           0.8,
				"prefix_padding_ms":   500,
				"silence_duration_ms": 1000,
			},
		},
	}, false)
}

// CreateResponse asks DashScope to generate a reply after manual commit.
func (a *Agent) CreateResponse(instructions string) error {
	if a.ba.IsClosed() {
		return base.ErrAgentClosed
	}
	payload := map[string]any{"type": "response.create"}
	instructions = strings.TrimSpace(instructions)
	if instructions != "" {
		payload["response"] = map[string]any{"instructions": instructions}
	}
	return a.ba.SendJSON(payload, false)
}

// ClearInputAudio drops buffered caller audio on the omni session.
func (a *Agent) ClearInputAudio() error {
	if a.ba.IsClosed() {
		return base.ErrAgentClosed
	}
	return a.ba.SendJSON(map[string]any{"type": "input_audio_buffer.clear"}, false)
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
		"type": "session.update",
		"session": map[string]any{
			"instructions": instructions,
		},
	}, false)
}

func (a *Agent) Close() error { return a.ba.Close() }

func (a *Agent) dispatch(raw []byte) {
	var head wireHead
	if err := json.Unmarshal(raw, &head); err != nil {
		a.ba.Emit(base.Event{
			Type:   base.EventError,
			Vendor: ProviderSlug,
			Err:    fmt.Errorf("aliyunomni: bad json: %w", err),
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
		var msg wireTranscript
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
		var msg wireDelta
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
		var msg wireTranscript
		_ = json.Unmarshal(raw, &msg)
		text := msg.Transcript
		if text == "" {
			var alt wireDelta
			_ = json.Unmarshal(raw, &alt)
			text = alt.Delta
		}
		a.ba.Emit(base.Event{
			Type:   base.EventAssistantText,
			Vendor: ProviderSlug,
			Text:   text,
			Final:  true,
		})

	case "response.audio.delta", "response.output_audio.delta":
		var msg wireDelta
		_ = json.Unmarshal(raw, &msg)
		if msg.Delta == "" {
			return
		}
		pcm, err := base64.StdEncoding.DecodeString(msg.Delta)
		if err != nil {
			a.ba.Emit(base.Event{
				Type:   base.EventError,
				Vendor: ProviderSlug,
				Err:    fmt.Errorf("aliyunomni: bad base64 audio: %w", err),
			})
			return
		}
		a.ba.Emit(base.Event{
			Type:    base.EventAssistantAudio,
			Vendor:  ProviderSlug,
			AudioPC: pcm,
		})

	case "response.function_call_arguments.done":
		var msg wireFunctionCallDone
		_ = json.Unmarshal(raw, &msg)
		if msg.Name != "" && msg.CallID != "" {
			a.pendingFCMu.Lock()
			a.pendingFCs = append(a.pendingFCs, pendingFunctionCall{
				CallID:    msg.CallID,
				Name:      msg.Name,
				Arguments: msg.Arguments,
			})
			a.pendingFCMu.Unlock()
		} else {
			a.ba.Emit(base.Event{
				Type:   base.EventError,
				Vendor: ProviderSlug,
				Err:    fmt.Errorf("aliyunomni: function_call_arguments.done missing name/call_id"),
				Raw:    raw,
			})
		}

	case "response.done":
		a.finishResponseTurn(raw)

	case "error":
		var msg wireError
		_ = json.Unmarshal(raw, &msg)
		text := "unknown"
		if msg.Error != nil {
			if msg.Error.Message != "" {
				text = msg.Error.Message
			} else if msg.Error.Code != "" {
				text = msg.Error.Code
			}
		}
		fatal := true
		lower := strings.ToLower(text)
		if strings.Contains(lower, "none active response") || strings.Contains(lower, "no active response") {
			fatal = false
		}
		a.ba.Emit(base.Event{
			Type:   base.EventError,
			Vendor: ProviderSlug,
			Err:    fmt.Errorf("aliyunomni: server error: %s", text),
			Fatal:  fatal,
			Raw:    raw,
		})
	}
}

func (a *Agent) finishResponseTurn(raw []byte) {
	a.pendingFCMu.Lock()
	pending := append([]pendingFunctionCall(nil), a.pendingFCs...)
	a.pendingFCs = nil
	a.pendingFCMu.Unlock()

	if len(pending) > 0 && a.ba.Opts().ToolHandler != nil {
		for _, fc := range pending {
			var args map[string]any
			if fc.Arguments != "" {
				_ = json.Unmarshal([]byte(fc.Arguments), &args)
			}
			if args == nil {
				args = map[string]any{}
			}
			output := a.ba.Opts().ToolHandler(fc.Name, args)
			_ = a.ba.SendJSON(map[string]any{
				"type": "conversation.item.create",
				"item": map[string]any{
					"type":    "function_call_output",
					"call_id": fc.CallID,
					"output":  output,
				},
			}, false)
		}
		_ = a.ba.SendJSON(map[string]any{"type": "response.create"}, false)
	}
	ev := base.Event{Type: base.EventAssistantTurnEnd, Vendor: ProviderSlug, Raw: raw}
	if len(pending) > 0 {
		names := make([]string, 0, len(pending))
		for _, fc := range pending {
			names = append(names, fc.Name)
		}
		ev.Text = strings.Join(names, ",")
	}
	a.ba.Emit(ev)
}

// BuildURL constructs the WebSocket URL with the model query parameter.
func BuildURL(baseURL, model string) (string, error) {
	if baseURL == "" {
		baseURL = DefaultBaseURL
	}
	u, err := url.Parse(baseURL)
	if err != nil {
		return "", fmt.Errorf("aliyunomni: parse baseUrl: %w", err)
	}
	if u.Scheme != "ws" && u.Scheme != "wss" {
		return "", fmt.Errorf("aliyunomni: baseUrl must be ws:// or wss://, got %q", u.Scheme)
	}
	q := u.Query()
	if q.Get("model") == "" && model != "" {
		q.Set("model", model)
		u.RawQuery = q.Encode()
	}
	return u.String(), nil
}

// --- wire types -------------------------------------------------------------

type wireHead struct {
	Type string `json:"type"`
}

type wireDelta struct {
	Delta string `json:"delta"`
}

type wireTranscript struct {
	Transcript string `json:"transcript"`
}

type wireFunctionCallDone struct {
	CallID    string `json:"call_id"`
	Name      string `json:"name"`
	Arguments string `json:"arguments"`
}

type wireError struct {
	Error *struct {
		Type    string `json:"type"`
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

// Compile-time guards.
var _ base.Agent = (*Agent)(nil)
