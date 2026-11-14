// Package realtime implements the iFlytek Spark OS (讯飞超拟人交互) adapter
// for ling-base.
//
//	wss://sparkos.xfyun.cn/v1/openapi/chat
//
// The Spark OS service provides a full-duplex end-to-end voice interaction
// pipeline (ASR → LLM → TTS) over WebSocket. Auth uses APPID + APIKey +
// APISecret with HMAC-SHA256 signature on the WebSocket handshake URL.
//
// The protocol uses JSON frames with a header/parameter/payload structure.
// Audio is base64-encoded in JSON payload fields. The interaction mode
// supports "continuous" (全双工) and "continuous_vad" (单工).
package realtime

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
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
	ProviderSlug   = "iflytek_sparkos"
	DefaultBaseURL = "wss://sparkos.xfyun.cn/v1/openapi/chat"
	DefaultVoice   = "x5_lingfeiyi_flow"
	DefaultDialMs  = 15000
	DefaultSendBuf = 64
)

func init() {
	base.Register(New, ProviderSlug, "iflytek", "iflytek_sparkos", "sparkos", "xfyun")
}

// Config is the typed shape of the credential JSON.
type Config struct {
	AppID         string
	APIKey        string
	APISecret     string
	BaseURL       string
	Voice         string
	SystemPrompt  string
	InteractMode  string // "continuous" (全双工) or "continuous_vad" (单工)
	DialTimeoutMs int
	InputRate     int
}

// New is the realtime.Provider entry point.
func New(cfg map[string]any, opts base.Options) (base.Agent, error) {
	c := Config{
		AppID:         base.FirstString(cfg, "appId", "app_id"),
		APIKey:        base.FirstString(cfg, "apiKey", "api_key"),
		APISecret:     base.FirstString(cfg, "apiSecret", "api_secret"),
		BaseURL:       base.FirstString(cfg, "baseUrl", "base_url"),
		Voice:         base.FirstString(cfg, "voice", "vcn"),
		SystemPrompt:  base.FirstString(cfg, "systemPrompt", "system_prompt", "instructions"),
		InteractMode:  base.FirstString(cfg, "interactMode", "interact_mode"),
		DialTimeoutMs: base.FirstInt(cfg, "dialTimeoutMs", "dial_timeout_ms"),
		InputRate:     base.FirstInt(cfg, "inputSampleRate", "input_sample_rate"),
	}
	if strings.TrimSpace(c.AppID) == "" {
		c.AppID = strings.TrimSpace(os.Getenv("IFLYTEK_APP_ID"))
	}
	if strings.TrimSpace(c.APIKey) == "" {
		c.APIKey = strings.TrimSpace(os.Getenv("IFLYTEK_API_KEY"))
	}
	if strings.TrimSpace(c.APISecret) == "" {
		c.APISecret = strings.TrimSpace(os.Getenv("IFLYTEK_API_SECRET"))
	}
	if c.AppID == "" || c.APIKey == "" || c.APISecret == "" {
		return nil, fmt.Errorf("iflytek_sparkos: appId, apiKey, and apiSecret are required")
	}
	if c.BaseURL == "" {
		c.BaseURL = DefaultBaseURL
	}
	if c.Voice == "" {
		c.Voice = DefaultVoice
	}
	if c.InteractMode == "" {
		c.InteractMode = "continuous"
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
	sys := strings.TrimSpace(c.SystemPrompt)
	if sys == "" {
		c.SystemPrompt = strings.TrimSpace(opts.SystemPrompt)
	} else if sp := strings.TrimSpace(opts.SystemPrompt); sp != "" {
		c.SystemPrompt = sys + "\n\n" + sp
	}
	if strings.TrimSpace(opts.Voice) != "" {
		c.Voice = strings.TrimSpace(opts.Voice)
	}
	return &Agent{cfg: c, ba: base.NewBaseAgent(ProviderSlug, opts, DefaultSendBuf)}, nil
}

// Agent is the iFlytek Spark OS client.
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
	wsURL, err := BuildSignedURL(a.cfg)
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
		return fmt.Errorf("iflytek_sparkos: dial (status=%d): %w", status, err)
	}
	a.ba.SetConn(conn)

	rootCtx, rootCancel := context.WithCancel(context.Background())
	a.ba.SetRootContext(rootCtx, rootCancel)
	a.ba.Dispatch = a.dispatch
	a.ba.StartLoops()

	// Send initial session frame
	if err := a.ba.SendJSON(a.buildSessionStart(), false); err != nil {
		_ = conn.Close()
		return fmt.Errorf("iflytek_sparkos: session start: %w", err)
	}
	return nil
}

func (a *Agent) buildSessionStart() map[string]any {
	frame := map[string]any{
		"header": map[string]any{
			"app_id":        a.cfg.AppID,
			"uid":           "ling-base",
			"status":        0,
			"stmid":         "1",
			"scene":         "sos_app",
			"interact_mode": a.cfg.InteractMode,
		},
		"parameter": map[string]any{
			"iat": map[string]any{
				"iat": map[string]any{
					"encoding": "utf8",
					"compress": "raw",
					"format":   "json",
				},
			},
			"nlp": map[string]any{
				"nlp": map[string]any{
					"encoding": "utf8",
					"compress": "raw",
					"format":   "json",
				},
				"prompt": a.cfg.SystemPrompt,
			},
			"tts": map[string]any{
				"vcn":    a.cfg.Voice,
				"speed":  50,
				"volume": 50,
				"pitch":  50,
				"tts": map[string]any{
					"encoding":    "raw",
					"sample_rate": a.cfg.InputRate,
					"channels":    1,
					"bit_depth":   16,
				},
			},
		},
		"payload": map[string]any{},
	}
	return frame
}

func (a *Agent) PushAudio(pcm []byte) error {
	if a.ba.IsClosed() {
		return base.ErrAgentClosed
	}
	if len(pcm) == 0 {
		return nil
	}
	return a.ba.SendJSON(map[string]any{
		"header": map[string]any{
			"app_id": a.cfg.AppID,
			"status": 1,
			"stmid":  "1",
		},
		"payload": map[string]any{
			"audio": map[string]any{
				"status":      1,
				"audio":       base64.StdEncoding.EncodeToString(pcm),
				"encoding":    "raw",
				"sample_rate": a.cfg.InputRate,
				"channels":    1,
				"bit_depth":   16,
			},
		},
	}, true)
}

func (a *Agent) CommitInputAudio() error {
	if a.ba.IsClosed() {
		return base.ErrAgentClosed
	}
	return a.ba.SendJSON(map[string]any{
		"header": map[string]any{
			"app_id": a.cfg.AppID,
			"status": 2,
			"stmid":  "1",
		},
		"payload": map[string]any{
			"audio": map[string]any{
				"status": 2,
				"audio":  "",
			},
		},
	}, false)
}

func (a *Agent) Cancel() error {
	if a.ba.IsClosed() {
		return base.ErrAgentClosed
	}
	// iFlytek doesn't have a direct cancel; send a new turn
	return a.ba.SendJSON(map[string]any{
		"header": map[string]any{
			"app_id": a.cfg.AppID,
			"status": 0,
			"stmid":  "1",
		},
	}, false)
}

func (a *Agent) UpdateInstructions(instructions string) error {
	instructions = strings.TrimSpace(instructions)
	if instructions == "" {
		return nil
	}
	a.cfg.SystemPrompt = instructions
	// iFlytek doesn't support mid-session prompt update; store for next session
	return nil
}

func (a *Agent) Close() error { return a.ba.Close() }

func (a *Agent) dispatch(raw []byte) {
	var frame struct {
		Header struct {
			Code int    `json:"code"`
			Msg  string `json:"message"`
			Type string `json:"type"`
		} `json:"header"`
		Payload struct {
			ASR struct {
				Text string `json:"text"`
			} `json:"asr"`
			NLP struct {
				Text string `json:"text"`
			} `json:"nlp"`
			TTS struct {
				Audio string `json:"audio"`
				Text  string `json:"text"`
			} `json:"tts"`
		} `json:"payload"`
	}
	if err := json.Unmarshal(raw, &frame); err != nil {
		a.ba.Emit(base.Event{
			Type:   base.EventError,
			Vendor: ProviderSlug,
			Err:    fmt.Errorf("iflytek_sparkos: bad json: %w", err),
			Raw:    raw,
		})
		return
	}

	// Check for error
	if frame.Header.Code != 0 && frame.Header.Code != 200 {
		a.ba.Emit(base.Event{
			Type:   base.EventError,
			Vendor: ProviderSlug,
			Err:    fmt.Errorf("iflytek_sparkos: code=%d msg=%s", frame.Header.Code, frame.Header.Msg),
			Fatal:  true,
			Raw:    raw,
		})
		return
	}

	hdrType := frame.Header.Type
	switch hdrType {
	case "handshake", "session_start":
		a.ba.FireOnce(base.Event{Type: base.EventSessionOpen, Vendor: ProviderSlug, Raw: raw})

	case "asr_result":
		if frame.Payload.ASR.Text != "" {
			a.ba.Emit(base.Event{
				Type:   base.EventUserTranscript,
				Vendor: ProviderSlug,
				Text:   frame.Payload.ASR.Text,
			})
		}

	case "nlp_result":
		if frame.Payload.NLP.Text != "" {
			a.ba.Emit(base.Event{
				Type:   base.EventAssistantText,
				Vendor: ProviderSlug,
				Text:   frame.Payload.NLP.Text,
				Final:  true,
			})
		}

	case "tts_result":
		if frame.Payload.TTS.Audio != "" {
			pcm, err := base64.StdEncoding.DecodeString(frame.Payload.TTS.Audio)
			if err != nil {
				a.ba.Emit(base.Event{
					Type:   base.EventError,
					Vendor: ProviderSlug,
					Err:    fmt.Errorf("iflytek_sparkos: bad base64 audio: %w", err),
				})
				return
			}
			a.ba.Emit(base.Event{
				Type:    base.EventAssistantAudio,
				Vendor:  ProviderSlug,
				AudioPC: pcm,
			})
		}

	case "tts_end", "response_end":
		a.ba.Emit(base.Event{Type: base.EventAssistantTurnEnd, Vendor: ProviderSlug, Raw: raw})

	case "error":
		a.ba.Emit(base.Event{
			Type:   base.EventError,
			Vendor: ProviderSlug,
			Err:    fmt.Errorf("iflytek_sparkos: %s", frame.Header.Msg),
			Fatal:  true,
			Raw:    raw,
		})
	}
}

// BuildSignedURL constructs the signed WebSocket URL for iFlytek Spark OS.
// The signature uses HMAC-SHA256 over the date, host, and request line.
func BuildSignedURL(c Config) (string, error) {
	baseURL := c.BaseURL
	if baseURL == "" {
		baseURL = DefaultBaseURL
	}
	u, err := url.Parse(baseURL)
	if err != nil {
		return "", fmt.Errorf("iflytek_sparkos: parse baseUrl: %w", err)
	}
	if u.Scheme != "ws" && u.Scheme != "wss" {
		return "", fmt.Errorf("iflytek_sparkos: baseUrl must be ws:// or wss://, got %q", u.Scheme)
	}

	// Build RFC1123 date
	now := time.Now().UTC().Format(http.TimeFormat)
	host := u.Host

	// Signature string: host\ndate\nGET {path} HTTP/1.1
	sigStr := fmt.Sprintf("host: %s\ndate: %s\nGET %s HTTP/1.1", host, now, u.Path)

	// HMAC-SHA256 with apiSecret
	mac := hmac.New(sha256.New, []byte(c.APISecret))
	mac.Write([]byte(sigStr))
	signature := base64.StdEncoding.EncodeToString(mac.Sum(nil))

	// Build authorization
	authOrig := fmt.Sprintf("api_key=\"%s\", algorithm=\"hmac-sha256\", headers=\"host date request-line\", signature=\"%s\"",
		c.APIKey, signature)
	authorization := base64.StdEncoding.EncodeToString([]byte(authOrig))

	q := u.Query()
	q.Set("authorization", authorization)
	q.Set("date", now)
	q.Set("host", host)
	u.RawQuery = q.Encode()
	return u.String(), nil
}

// Compile-time guard.
var _ base.Agent = (*Agent)(nil)
