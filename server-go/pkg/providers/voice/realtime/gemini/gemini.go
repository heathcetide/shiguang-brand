// Package realtime implements the Google Gemini Live API adapter for ling-base.
//
//	wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=API_KEY
//
// Auth: API key query param (GEMINI_API_KEY / GOOGLE_API_KEY / cfg apiKey).
// Protocol: first message = setup; audio via realtimeInput; serverContent audio/text out.
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
	ProviderSlug   = "gemini_live"
	DefaultBaseURL = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent"
	DefaultModel   = "gemini-2.0-flash-live-001"
	DefaultVoice   = "Puck"
	DefaultDialMs  = 15000
	DefaultSendBuf = 64
)

func init() {
	base.Register(New, ProviderSlug, "gemini", "google_gemini_live", "gemini_live_api")
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
		c.APIKey = strings.TrimSpace(os.Getenv("GEMINI_API_KEY"))
	}
	if strings.TrimSpace(c.APIKey) == "" {
		c.APIKey = strings.TrimSpace(os.Getenv("GOOGLE_API_KEY"))
	}
	if strings.TrimSpace(c.APIKey) == "" {
		return nil, fmt.Errorf("gemini_live: apiKey, GEMINI_API_KEY, or GOOGLE_API_KEY is required")
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
	return &Agent{
		cfg:       c,
		ba:        base.NewBaseAgent(ProviderSlug, opts, DefaultSendBuf),
		setupDone: make(chan struct{}),
	}, nil
}

// Agent is the Gemini Live API client.
type Agent struct {
	cfg       Config
	ba        *base.BaseAgent
	setupDone chan struct{}
}

func (a *Agent) Start(ctx context.Context) error {
	var startErr error
	a.ba.MarkStartOnce(func() {
		startErr = a.doStart(ctx)
	})
	return startErr
}

func (a *Agent) doStart(ctx context.Context) error {
	wsURL, err := BuildURL(a.cfg.BaseURL, a.cfg.APIKey)
	if err != nil {
		return err
	}
	dialer := *websocket.DefaultDialer
	dialer.HandshakeTimeout = time.Duration(a.cfg.DialTimeoutMs) * time.Millisecond

	conn, resp, err := dialer.DialContext(ctx, wsURL, http.Header{})
	if err != nil {
		status := -1
		if resp != nil {
			status = resp.StatusCode
			_ = resp.Body.Close()
		}
		return fmt.Errorf("gemini_live: dial (status=%d): %w", status, err)
	}
	a.ba.SetConn(conn)

	rootCtx, rootCancel := context.WithCancel(context.Background())
	a.ba.SetRootContext(rootCtx, rootCancel)
	a.ba.Dispatch = a.dispatch
	a.ba.StartLoops()

	if err := a.ba.SendJSON(a.buildSetup(), false); err != nil {
		_ = conn.Close()
		return fmt.Errorf("gemini_live: setup: %w", err)
	}
	// Wait for setupComplete before accepting audio (API contract).
	select {
	case <-ctx.Done():
		_ = a.Close()
		return ctx.Err()
	case <-a.setupDone:
		return nil
	case <-time.After(time.Duration(a.cfg.DialTimeoutMs) * time.Millisecond):
		_ = a.Close()
		return fmt.Errorf("gemini_live: timeout waiting for setupComplete")
	}
}

func (a *Agent) buildSetup() map[string]any {
	opts := a.ba.Opts()
	model := a.cfg.Model
	if !strings.HasPrefix(model, "models/") {
		model = "models/" + model
	}
	mods := opts.Modalities
	if len(mods) == 0 {
		mods = []string{"AUDIO"}
	} else {
		upper := make([]string, 0, len(mods))
		for _, m := range mods {
			m = strings.ToUpper(strings.TrimSpace(m))
			if m == "" {
				continue
			}
			if m == "AUDIO" || m == "TEXT" {
				upper = append(upper, m)
			}
		}
		if len(upper) == 0 {
			upper = []string{"AUDIO"}
		}
		mods = upper
	}
	genCfg := map[string]any{
		"responseModalities": mods,
		"speechConfig": map[string]any{
			"voiceConfig": map[string]any{
				"prebuiltVoiceConfig": map[string]any{
					"voiceName": a.cfg.Voice,
				},
			},
		},
	}
	if opts.Temperature > 0 {
		genCfg["temperature"] = opts.Temperature
	}
	setup := map[string]any{
		"model":                    model,
		"generationConfig":         genCfg,
		"inputAudioTranscription":  map[string]any{},
		"outputAudioTranscription": map[string]any{},
	}
	if strings.TrimSpace(a.cfg.Instructions) != "" {
		setup["systemInstruction"] = map[string]any{
			"parts": []map[string]any{{"text": a.cfg.Instructions}},
		}
	}
	if opts.DisableServerVAD {
		setup["realtimeInputConfig"] = map[string]any{
			"automaticActivityDetection": map[string]any{
				"disabled": true,
			},
		}
	}
	return map[string]any{"setup": setup}
}

func (a *Agent) PushAudio(pcm []byte) error {
	if a.ba.IsClosed() {
		return base.ErrAgentClosed
	}
	if len(pcm) == 0 {
		return nil
	}
	rate := a.ba.Opts().InputSampleRate
	if rate <= 0 {
		rate = 16000
	}
	return a.ba.SendJSON(map[string]any{
		"realtimeInput": map[string]any{
			"audio": map[string]any{
				"data":     base64.StdEncoding.EncodeToString(pcm),
				"mimeType": fmt.Sprintf("audio/pcm;rate=%d", rate),
			},
		},
	}, true)
}

func (a *Agent) CommitInputAudio() error {
	if a.ba.IsClosed() {
		return base.ErrAgentClosed
	}
	if a.ba.Opts().DisableServerVAD {
		return a.ba.SendJSON(map[string]any{
			"realtimeInput": map[string]any{
				"activityEnd": map[string]any{},
			},
		}, false)
	}
	return a.ba.SendJSON(map[string]any{
		"realtimeInput": map[string]any{
			"audioStreamEnd": true,
		},
	}, false)
}

func (a *Agent) Cancel() error {
	if a.ba.IsClosed() {
		return base.ErrAgentClosed
	}
	// Gemini Live has no response.cancel; barge-in is driven by server VAD.
	if a.ba.Opts().DisableServerVAD {
		return a.ba.SendJSON(map[string]any{
			"realtimeInput": map[string]any{
				"activityStart": map[string]any{},
			},
		}, false)
	}
	return nil
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
	// Live setup is immutable after open; inject as client content (best-effort).
	return a.ba.SendJSON(map[string]any{
		"clientContent": map[string]any{
			"turns": []map[string]any{{
				"role":  "user",
				"parts": []map[string]any{{"text": "[Updated system instructions]\n" + instructions}},
			}},
			"turnComplete": false,
		},
	}, false)
}

func (a *Agent) Close() error { return a.ba.Close() }

func (a *Agent) dispatch(raw []byte) {
	var msg geminiServerMessage
	if err := json.Unmarshal(raw, &msg); err != nil {
		a.ba.Emit(base.Event{
			Type:   base.EventError,
			Vendor: ProviderSlug,
			Err:    fmt.Errorf("gemini_live: bad json: %w", err),
			Raw:    raw,
		})
		return
	}

	if msg.SetupComplete != nil {
		a.ba.FireOnce(base.Event{Type: base.EventSessionOpen, Vendor: ProviderSlug, Raw: raw})
		// Signal setupDone so Start can return.
		select {
		case <-a.setupDone:
		default:
			close(a.setupDone)
		}
		return
	}

	if msg.Error != nil {
		text := msg.Error.Message
		if text == "" {
			text = msg.Error.Status
		}
		if text == "" {
			text = "unknown"
		}
		a.ba.Emit(base.Event{
			Type:   base.EventError,
			Vendor: ProviderSlug,
			Err:    fmt.Errorf("gemini_live: server error: %s", text),
			Fatal:  true,
			Raw:    raw,
		})
		return
	}

	if sc := msg.ServerContent; sc != nil {
		if sc.Interrupted {
			a.ba.Emit(base.Event{Type: base.EventUserSpeechStarted, Vendor: ProviderSlug})
		}
		if sc.InputTranscription != nil && sc.InputTranscription.Text != "" {
			a.ba.Emit(base.Event{
				Type:   base.EventUserTranscript,
				Vendor: ProviderSlug,
				Text:   sc.InputTranscription.Text,
				Final:  true,
			})
		}
		if sc.OutputTranscription != nil && sc.OutputTranscription.Text != "" {
			a.ba.Emit(base.Event{
				Type:   base.EventAssistantText,
				Vendor: ProviderSlug,
				Text:   sc.OutputTranscription.Text,
				Final:  false,
			})
		}
		if sc.ModelTurn != nil {
			for _, part := range sc.ModelTurn.Parts {
				if part.Text != "" {
					a.ba.Emit(base.Event{
						Type:   base.EventAssistantText,
						Vendor: ProviderSlug,
						Text:   part.Text,
						Final:  false,
					})
				}
				if part.InlineData != nil && part.InlineData.Data != "" {
					pcm, err := base64.StdEncoding.DecodeString(part.InlineData.Data)
					if err != nil {
						a.ba.Emit(base.Event{
							Type:   base.EventError,
							Vendor: ProviderSlug,
							Err:    fmt.Errorf("gemini_live: bad base64 audio: %w", err),
						})
						continue
					}
					a.ba.Emit(base.Event{
						Type:    base.EventAssistantAudio,
						Vendor:  ProviderSlug,
						AudioPC: pcm,
					})
				}
			}
		}
		if sc.TurnComplete || sc.GenerationComplete {
			a.ba.Emit(base.Event{Type: base.EventAssistantTurnEnd, Vendor: ProviderSlug, Raw: raw})
		}
	}

	// Some payloads put transcriptions at the top level.
	if msg.InputTranscription != nil && msg.InputTranscription.Text != "" {
		a.ba.Emit(base.Event{
			Type:   base.EventUserTranscript,
			Vendor: ProviderSlug,
			Text:   msg.InputTranscription.Text,
			Final:  true,
		})
	}
	if msg.OutputTranscription != nil && msg.OutputTranscription.Text != "" {
		a.ba.Emit(base.Event{
			Type:   base.EventAssistantText,
			Vendor: ProviderSlug,
			Text:   msg.OutputTranscription.Text,
			Final:  false,
		})
	}
}

type geminiServerMessage struct {
	SetupComplete *json.RawMessage `json:"setupComplete"`
	ServerContent *struct {
		Interrupted        bool `json:"interrupted"`
		TurnComplete       bool `json:"turnComplete"`
		GenerationComplete bool `json:"generationComplete"`
		ModelTurn          *struct {
			Parts []struct {
				Text       string `json:"text"`
				InlineData *struct {
					MimeType string `json:"mimeType"`
					Data     string `json:"data"`
				} `json:"inlineData"`
			} `json:"parts"`
		} `json:"modelTurn"`
		InputTranscription  *geminiTranscription `json:"inputTranscription"`
		OutputTranscription *geminiTranscription `json:"outputTranscription"`
	} `json:"serverContent"`
	InputTranscription  *geminiTranscription `json:"inputTranscription"`
	OutputTranscription *geminiTranscription `json:"outputTranscription"`
	Error               *struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
		Status  string `json:"status"`
	} `json:"error"`
}

type geminiTranscription struct {
	Text string `json:"text"`
}

// BuildURL constructs the WebSocket URL with the API key query parameter.
func BuildURL(baseURL, apiKey string) (string, error) {
	if baseURL == "" {
		baseURL = DefaultBaseURL
	}
	u, err := url.Parse(baseURL)
	if err != nil {
		return "", fmt.Errorf("gemini_live: parse baseUrl: %w", err)
	}
	if u.Scheme != "ws" && u.Scheme != "wss" {
		return "", fmt.Errorf("gemini_live: baseUrl must be ws:// or wss://, got %q", u.Scheme)
	}
	q := u.Query()
	if q.Get("key") == "" && apiKey != "" {
		q.Set("key", apiKey)
	}
	u.RawQuery = q.Encode()
	return u.String(), nil
}

// Compile-time guard.
var _ base.Agent = (*Agent)(nil)
