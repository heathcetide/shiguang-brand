// Package synthesizer implements the Aliyun DashScope Qwen-TTS realtime adapter for ling-base.
package synthesizer

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

	"github.com/heathcetide/DietDigiDose/pkg/common/logger"
	base "github.com/heathcetide/DietDigiDose/pkg/providers/voice/synthesizer"
	"github.com/gorilla/websocket"
)

const (
	aliyunDefaultEndpoint = "wss://dashscope.aliyuncs.com/api-ws/v1/realtime"
	aliyunDefaultModel    = "qwen3-tts-flash-realtime"
	aliyunDefaultVoice    = "Cherry"
	aliyunDefaultLanguage = "Auto"
	aliyunDefaultMode     = "server_commit"
)

// AliyunTTSConfig 阿里云 DashScope Qwen-TTS realtime 配置
type AliyunTTSConfig struct {
	APIKey               string `json:"apiKey" yaml:"api_key" env:"DASHSCOPE_API_KEY"`
	BaseURL              string `json:"baseUrl" yaml:"base_url"`
	Model                string `json:"model" yaml:"model" default:"qwen3-tts-flash-realtime"`
	Voice                string `json:"voice" yaml:"voice" default:"Cherry"`
	LanguageType         string `json:"languageType" yaml:"language_type" default:"Auto"`
	Mode                 string `json:"mode" yaml:"mode" default:"server_commit"` // commit | server_commit
	SampleRate           int    `json:"sampleRate" yaml:"sample_rate" default:"24000"`
	Channels             int    `json:"channels" yaml:"channels" default:"1"`
	BitDepth             int    `json:"bitDepth" yaml:"bit_depth" default:"16"`
	FrameDuration        string `json:"frameDuration" yaml:"frame_duration" default:"20ms"`
	DialTimeoutMs        int    `json:"dialTimeoutMs" yaml:"dial_timeout_ms" default:"10000"`
	Instructions         string `json:"instructions" yaml:"instructions"`
	OptimizeInstructions bool   `json:"optimizeInstructions" yaml:"optimize_instructions"`
}

// GetProvider returns the TTS provider type
func (c *AliyunTTSConfig) GetProvider() base.Provider {
	return base.ProviderAliyun
}

// NewAliyunTTSConfig 创建阿里云 TTS 配置
func NewAliyunTTSConfig(apiKey string) AliyunTTSConfig {
	return AliyunTTSConfig{
		APIKey:        apiKey,
		BaseURL:       aliyunDefaultEndpoint,
		Model:         aliyunDefaultModel,
		Voice:         aliyunDefaultVoice,
		LanguageType:  aliyunDefaultLanguage,
		Mode:          aliyunDefaultMode,
		SampleRate:    24000,
		Channels:      1,
		BitDepth:      16,
		FrameDuration: "20ms",
		DialTimeoutMs: 10000,
	}
}

// AliyunService 阿里云 TTS 服务
type AliyunService struct {
	opt AliyunTTSConfig
	mu  sync.Mutex
}

// NewAliyunService 创建阿里云 TTS 服务
func NewAliyunService(opt AliyunTTSConfig) *AliyunService {
	return &AliyunService{opt: opt}
}

func (as *AliyunService) Provider() base.Provider {
	return base.ProviderAliyun
}

func (as *AliyunService) Format() base.StreamFormat {
	as.mu.Lock()
	defer as.mu.Unlock()
	return base.StreamFormat{
		SampleRate:    as.opt.SampleRate,
		BitDepth:      as.opt.BitDepth,
		Channels:      as.opt.Channels,
		Codec:         "pcm",
		FrameDuration: base.NormalizeFramePeriod(as.opt.FrameDuration),
	}
}

func (as *AliyunService) CacheKey(text string) string {
	as.mu.Lock()
	defer as.mu.Unlock()
	return fmt.Sprintf("aliyun.tts-%s-%s-%d-%s.pcm", as.opt.Model, as.opt.Voice, as.opt.SampleRate, base.HashText(text))
}

func (as *AliyunService) Capabilities() base.Capabilities {
	return base.StreamingCapabilities()
}

func (as *AliyunService) Synthesize(ctx context.Context, handler base.Handler, text string) error {
	as.mu.Lock()
	opt := as.opt
	as.mu.Unlock()

	if opt.APIKey == "" {
		return fmt.Errorf("DASHSCOPE_API_KEY is required")
	}
	if opt.Mode != "commit" && opt.Mode != "server_commit" {
		opt.Mode = aliyunDefaultMode
	}
	if opt.Voice == "" {
		opt.Voice = aliyunDefaultVoice
	}
	if opt.Model == "" {
		opt.Model = aliyunDefaultModel
	}
	if opt.LanguageType == "" {
		opt.LanguageType = aliyunDefaultLanguage
	}
	if opt.SampleRate <= 0 {
		opt.SampleRate = 24000
	}
	if opt.Channels <= 0 {
		opt.Channels = 1
	}
	if opt.BitDepth <= 0 {
		opt.BitDepth = 16
	}
	if opt.DialTimeoutMs <= 0 {
		opt.DialTimeoutMs = 10000
	}

	endpoint := opt.BaseURL
	if endpoint == "" {
		endpoint = aliyunDefaultEndpoint
	}
	if !strings.HasPrefix(endpoint, "wss://") && !strings.HasPrefix(endpoint, "ws://") {
		return fmt.Errorf("aliyun tts: endpoint must be ws/wss URL, got %q", endpoint)
	}

	// Build auth URL
	authURL, err := buildAliyunAuthURL(endpoint, opt.APIKey)
	if err != nil {
		return fmt.Errorf("aliyun tts: build auth url: %w", err)
	}

	dialer := websocket.Dialer{
		HandshakeTimeout: time.Duration(opt.DialTimeoutMs) * time.Millisecond,
	}
	conn, resp, err := dialer.DialContext(ctx, authURL, nil)
	if err != nil {
		if resp != nil {
			_ = resp.Body.Close()
		}
		return fmt.Errorf("aliyun tts: dial: %w", err)
	}
	defer conn.Close()
	if resp != nil {
		_ = resp.Body.Close()
	}

	// Set initial read deadline
	if err := conn.SetReadDeadline(time.Now().Add(30 * time.Second)); err != nil {
		return fmt.Errorf("aliyun tts: set read deadline: %w", err)
	}

	// 1. session.update
	sessionUpdate := map[string]interface{}{
		"event_id": fmt.Sprintf("evt_session_%d", time.Now().UnixNano()),
		"type":     "session.update",
		"session": map[string]interface{}{
			"model":                 opt.Model,
			"voice":                 opt.Voice,
			"language":              opt.LanguageType,
			"modalities":            []string{"text", "audio"},
			"output_format":         "pcm",
			"sample_rate":           opt.SampleRate,
			"channels":              opt.Channels,
			"bit_depth":             opt.BitDepth,
			"mode":                  opt.Mode,
			"input_modalities":      []string{"text"},
			"instructions":          opt.Instructions,
			"optimize_instructions": opt.OptimizeInstructions,
		},
	}
	if err := writeAliyunJSON(conn, sessionUpdate); err != nil {
		return fmt.Errorf("aliyun tts: session.update: %w", err)
	}

	// 2. input_text_buffer.append
	appendEvent := map[string]interface{}{
		"event_id": fmt.Sprintf("evt_append_%d", time.Now().UnixNano()),
		"type":     "input_text_buffer.append",
		"text":     text,
	}
	if err := writeAliyunJSON(conn, appendEvent); err != nil {
		return fmt.Errorf("aliyun tts: input_text_buffer.append: %w", err)
	}

	// 3. commit (only for "commit" mode)
	if opt.Mode == "commit" {
		commitEvent := map[string]interface{}{
			"event_id": fmt.Sprintf("evt_commit_%d", time.Now().UnixNano()),
			"type":     "input_text_buffer.commit",
		}
		if err := writeAliyunJSON(conn, commitEvent); err != nil {
			return fmt.Errorf("aliyun tts: input_text_buffer.commit: %w", err)
		}
	}

	// 4. session.finish (signals no more input)
	finishEvent := map[string]interface{}{
		"event_id": fmt.Sprintf("evt_finish_%d", time.Now().UnixNano()),
		"type":     "session.finish",
	}
	if err := writeAliyunJSON(conn, finishEvent); err != nil {
		return fmt.Errorf("aliyun tts: session.finish: %w", err)
	}

	// Read loop
	var gotAudio bool
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}
		if err := conn.SetReadDeadline(time.Now().Add(30 * time.Second)); err != nil {
			return err
		}
		_, message, err := conn.ReadMessage()
		if err != nil {
			if websocket.IsCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway) {
				break
			}
			if strings.Contains(err.Error(), "use of closed network connection") {
				break
			}
			return fmt.Errorf("aliyun tts: read: %w", err)
		}
		var ev map[string]interface{}
		if err := json.Unmarshal(message, &ev); err != nil {
			logger.Debug("aliyun tts: skip non-json frame", logger.WithError(err))
			continue
		}
		eventType, _ := ev["type"].(string)
		switch eventType {
		case "response.audio.delta":
			if delta, ok := ev["delta"].(string); ok && delta != "" {
				audio, err := base64.StdEncoding.DecodeString(delta)
				if err != nil {
					logger.Warn("aliyun tts: decode audio delta failed", logger.WithError(err))
					continue
				}
				if len(audio) > 0 {
					gotAudio = true
					handler.OnMessage(audio)
				}
			}
		case "response.done":
			// fallthrough to session.finished
		case "session.finished":
			return nil
		case "error":
			errMsg, _ := ev["error"].(map[string]interface{})
			msg, _ := errMsg["message"].(string)
			if msg == "" {
				msg = string(message)
			}
			return fmt.Errorf("aliyun tts: server error: %s", msg)
		}
	}
	if !gotAudio {
		return fmt.Errorf("aliyun tts: no audio received")
	}
	return nil
}

func (as *AliyunService) Close() error {
	return nil
}

func writeAliyunJSON(conn *websocket.Conn, v interface{}) error {
	data, err := json.Marshal(v)
	if err != nil {
		return err
	}
	return conn.WriteMessage(websocket.TextMessage, data)
}

func buildAliyunAuthURL(endpoint, apiKey string) (string, error) {
	u, err := url.Parse(endpoint)
	if err != nil {
		return "", err
	}
	q := u.Query()
	q.Set("api-key", apiKey)
	u.RawQuery = q.Encode()
	return u.String(), nil
}

// Compile-time guard.
var _ base.Engine = (*AliyunService)(nil)
var _ base.CapableEngine = (*AliyunService)(nil)

// Unused but kept for compatibility with potential future direct-dial paths.
var _ = http.Header{}
