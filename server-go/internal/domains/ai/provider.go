// Copyright (c) 2026 heathcetide. All rights reserved.

package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/heathcetide/DietDigiDose/internal/dbx"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"strings"
	"time"
)

const (
	errAINotConfigured = "AI_NOT_CONFIGURED"
	defaultBaseURL     = "https://api.openai.com/v1"
	defaultChatModel   = "deepseek-ai/DeepSeek-V3"
	defaultVisionModel = "Qwen/Qwen2.5-VL-72B-Instruct"
	defaultAsrModel    = "FunAudioLLM/SenseVoiceSmall"
)

// ProviderConfig holds resolved OpenAI-compatible credentials for AI routes.
type ProviderConfig struct {
	APIKey       string
	BaseURL      string
	ChatModel    string
	VisionModel  string
	AsrModel     string
	SystemPrompt string
	Protocol     string // openai | anthropic
	visionKey    string
	visionBase   string
	asrKey       string
	asrBase      string
}

// ChatMessage is an OpenAI-compatible chat message.
type ChatMessage struct {
	Role    string `json:"role"`
	Content any    `json:"content"`
}

// ChatOptions tunes a chat completion request.
type ChatOptions struct {
	Model       string
	Temperature float64
	JSONMode    bool
	MaxTokens   int
	Timeout     time.Duration
}

// ProviderError carries a stable machine code for handlers.
type ProviderError struct {
	Code    string
	Message string
}

func (e *ProviderError) Error() string {
	if e.Message != "" {
		return e.Message
	}
	return e.Code
}

func isNotConfigured(err error) bool {
	var pe *ProviderError
	if errors.As(err, &pe) {
		return pe.Code == errAINotConfigured
	}
	return false
}

// LoadProviderConfig resolves AI settings from env, system_settings, and optional AI_RESOURCE_CONFIG_V1.
func LoadProviderConfig(db *dbx.DB) ProviderConfig {
	settings := loadAISettings(db)
	cfg := ProviderConfig{
		APIKey: firstNonEmpty(
			os.Getenv("AI_API_KEY"), os.Getenv("OPENAI_API_KEY"), settings["AI_API_KEY"],
		),
		BaseURL: trimBaseURL(firstNonEmpty(os.Getenv("AI_BASE_URL"), settings["AI_BASE_URL"], defaultBaseURL)),
		ChatModel: firstNonEmpty(
			os.Getenv("AI_CHAT_MODEL"), os.Getenv("AI_MODEL"),
			settings["AI_CHAT_MODEL"], settings["AI_MODEL"], defaultChatModel,
		),
		VisionModel:  firstNonEmpty(os.Getenv("AI_VISION_MODEL"), settings["AI_VISION_MODEL"], defaultVisionModel),
		AsrModel:     firstNonEmpty(os.Getenv("AI_ASR_MODEL"), settings["AI_ASR_MODEL"], defaultAsrModel),
		SystemPrompt: strings.TrimSpace(firstNonEmpty(os.Getenv("AI_SYSTEM_PROMPT"), settings["AI_SYSTEM_PROMPT"])),
		Protocol: strings.ToLower(firstNonEmpty(os.Getenv("AI_PROTOCOL"), settings["AI_PROTOCOL"], "openai")),
	}
	if strings.Contains(strings.ToLower(cfg.BaseURL), "anthropic") {
		cfg.Protocol = "anthropic"
	}
	cfg.visionKey = firstNonEmpty(os.Getenv("AI_VISION_API_KEY"), settings["AI_VISION_API_KEY"], cfg.APIKey)
	cfg.visionBase = trimBaseURL(firstNonEmpty(os.Getenv("AI_VISION_BASE_URL"), settings["AI_VISION_BASE_URL"], cfg.BaseURL))
	cfg.asrKey = firstNonEmpty(os.Getenv("AI_ASR_API_KEY"), settings["AI_ASR_API_KEY"], cfg.APIKey)
	cfg.asrBase = trimBaseURL(firstNonEmpty(os.Getenv("AI_ASR_BASE_URL"), settings["AI_ASR_BASE_URL"], cfg.BaseURL))

	if raw := strings.TrimSpace(settings["AI_RESOURCE_CONFIG_V1"]); raw != "" {
		applyResourceDocument(&cfg, raw)
	}
	if cfg.SystemPrompt == "" {
		cfg.SystemPrompt = "你是「食语」，一位专业的中式烹饪与健康饮食助手。回答简洁实用，优先考虑用户当前库存与安全饮食。"
	}
	return cfg
}

func loadAISettings(db *dbx.DB) map[string]string {
	keys := []string{
		"AI_API_KEY", "AI_BASE_URL", "AI_MODEL", "AI_CHAT_MODEL", "AI_VISION_MODEL", "AI_ASR_MODEL",
		"AI_CHAT_API_KEY", "AI_CHAT_BASE_URL", "AI_VISION_API_KEY", "AI_VISION_BASE_URL",
		"AI_ASR_API_KEY", "AI_ASR_BASE_URL", "AI_SYSTEM_PROMPT", "AI_RESOURCE_CONFIG_V1",
	}
	out := make(map[string]string, len(keys))
	if db == nil {
		return out
	}
	placeholders := strings.Repeat("?,", len(keys))
	placeholders = strings.TrimSuffix(placeholders, ",")
	args := make([]any, len(keys))
	for i, k := range keys {
		args[i] = k
	}
	q := `SELECT key, value FROM system_settings WHERE key IN (` + placeholders + `)`
	rows, err := db.Query(q, args...)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var k, v string
		if rows.Scan(&k, &v) == nil {
			out[k] = strings.TrimSpace(v)
		}
	}
	return out
}

type resourceDocument struct {
	SchemaVersion int `json:"schemaVersion"`
	Resources     []struct {
		ID      string `json:"id"`
		Kind    string `json:"kind"`
		Scope   string `json:"scope"`
		APIKey  string `json:"apiKey"`
		BaseURL string `json:"baseUrl"`
		Models  []struct {
			ID           string   `json:"id"`
			Capabilities []string `json:"capabilities"`
		} `json:"models"`
	} `json:"resources"`
	Defaults struct {
		Chat   serviceTarget `json:"chat"`
		Vision serviceTarget `json:"vision"`
		Asr    serviceTarget `json:"asr"`
	} `json:"defaults"`
	Services map[string]json.RawMessage `json:"services"`
}

type serviceTarget struct {
	ResourceID string `json:"resourceId"`
	Model      string `json:"model"`
}

func applyResourceDocument(cfg *ProviderConfig, raw string) {
	var doc resourceDocument
	if json.Unmarshal([]byte(raw), &doc) != nil {
		return
	}
	resolve := func(capability string, def serviceTarget) (apiKey, baseURL, model string) {
		target := def
		if doc.Services != nil {
			if binding, ok := doc.Services[capability]; ok {
				var inherit struct {
					Inherit bool `json:"inherit"`
				}
				if json.Unmarshal(binding, &inherit) == nil && inherit.Inherit {
					// keep default target
				} else {
					var explicit serviceTarget
					if json.Unmarshal(binding, &explicit) == nil && explicit.ResourceID != "" {
						target = explicit
					}
				}
			}
		}
		for _, res := range doc.Resources {
			if res.ID != target.ResourceID {
				continue
			}
			if res.Kind == "legacy" {
				switch res.Scope {
				case "chat":
					return cfg.APIKey, cfg.BaseURL, firstNonEmpty(target.Model, cfg.ChatModel)
				case "vision":
					return cfg.visionKey, cfg.visionBase, firstNonEmpty(target.Model, cfg.VisionModel)
				case "asr":
					return cfg.asrKey, cfg.asrBase, firstNonEmpty(target.Model, cfg.AsrModel)
				}
				continue
			}
			if res.Kind != "connection" {
				continue
			}
			model := target.Model
			if model == "" && len(res.Models) > 0 {
				model = res.Models[0].ID
			}
			return strings.TrimSpace(res.APIKey), trimBaseURL(res.BaseURL), model
		}
		return cfg.APIKey, cfg.BaseURL, cfg.ChatModel
	}
	if key, base, model := resolve("chat", doc.Defaults.Chat); key != "" || model != "" {
		if key != "" {
			cfg.APIKey = key
		}
		if base != "" {
			cfg.BaseURL = base
		}
		if model != "" {
			cfg.ChatModel = model
		}
	}
	if key, base, model := resolve("vision", doc.Defaults.Vision); key != "" || model != "" {
		if key != "" {
			cfg.visionKey = key
		}
		if base != "" {
			cfg.visionBase = base
		}
		if model != "" {
			cfg.VisionModel = model
		}
	}
	if key, base, model := resolve("asr", doc.Defaults.Asr); key != "" || model != "" {
		if key != "" {
			cfg.asrKey = key
		}
		if base != "" {
			cfg.asrBase = base
		}
		if model != "" {
			cfg.AsrModel = model
		}
	}
}

// ChatCompletion calls the configured chat API (OpenAI or Anthropic-compatible).
func ChatCompletion(ctx context.Context, cfg ProviderConfig, messages []ChatMessage, opts ChatOptions) (string, error) {
	apiKey := strings.TrimSpace(cfg.APIKey)
	if apiKey == "" {
		return "", &ProviderError{Code: errAINotConfigured, Message: errAINotConfigured}
	}
	if strings.EqualFold(cfg.Protocol, "anthropic") {
		return chatCompletionAnthropic(ctx, cfg, messages, opts)
	}
	return chatCompletionOpenAI(ctx, cfg, messages, opts)
}

func chatCompletionOpenAI(ctx context.Context, cfg ProviderConfig, messages []ChatMessage, opts ChatOptions) (string, error) {
	apiKey := strings.TrimSpace(cfg.APIKey)
	model := opts.Model
	if model == "" {
		model = cfg.ChatModel
	}
	normalized := normalizeSystemMessages(messages)
	payload := map[string]any{
		"model":       model,
		"messages":    normalized,
		"temperature": 0.7,
	}
	if opts.Temperature > 0 {
		payload["temperature"] = opts.Temperature
	}
	if opts.MaxTokens > 0 {
		payload["max_tokens"] = opts.MaxTokens
	} else {
		payload["max_tokens"] = 2048
	}
	if opts.JSONMode {
		payload["response_format"] = map[string]string{"type": "json_object"}
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	timeout := 60 * time.Second
	if opts.Timeout > 0 {
		timeout = opts.Timeout
	}
	reqCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	req, err := http.NewRequestWithContext(reqCtx, http.MethodPost, cfg.BaseURL+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+apiKey)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", &ProviderError{Code: "AI_REQUEST_FAILED", Message: err.Error()}
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", &ProviderError{Code: "AI_REQUEST_FAILED", Message: fmt.Sprintf("chat HTTP %d", resp.StatusCode)}
	}
	var parsed struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if json.Unmarshal(raw, &parsed) != nil {
		return "", &ProviderError{Code: "AI_REQUEST_FAILED", Message: "invalid chat response"}
	}
	if len(parsed.Choices) == 0 {
		return "", &ProviderError{Code: "AI_REQUEST_FAILED", Message: "empty chat choices"}
	}
	reply := strings.TrimSpace(parsed.Choices[0].Message.Content)
	if reply == "" {
		return "", &ProviderError{Code: "AI_REQUEST_FAILED", Message: "empty chat reply"}
	}
	return reply, nil
}

func chatCompletionAnthropic(ctx context.Context, cfg ProviderConfig, messages []ChatMessage, opts ChatOptions) (string, error) {
	apiKey := strings.TrimSpace(cfg.APIKey)
	model := opts.Model
	if model == "" {
		model = cfg.ChatModel
	}
	maxTokens := opts.MaxTokens
	if maxTokens <= 0 {
		maxTokens = 2048
	}
	systemPrompt := strings.TrimSpace(cfg.SystemPrompt)
	anthMsgs := make([]map[string]any, 0, len(messages))
	for _, m := range messages {
		role := strings.ToLower(strings.TrimSpace(m.Role))
		content := stringifyMessageContent(m.Content)
		if role == "system" {
			if systemPrompt == "" {
				systemPrompt = content
			} else {
				systemPrompt += "\n" + content
			}
			continue
		}
		if role != "assistant" {
			role = "user"
		}
		anthMsgs = append(anthMsgs, map[string]any{"role": role, "content": content})
	}
	if len(anthMsgs) == 0 {
		anthMsgs = append(anthMsgs, map[string]any{"role": "user", "content": "ping"})
	}
	payload := map[string]any{
		"model":      model,
		"max_tokens": maxTokens,
		"messages":   anthMsgs,
	}
	if systemPrompt != "" {
		payload["system"] = systemPrompt
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	timeout := 90 * time.Second
	if opts.Timeout > 0 {
		timeout = opts.Timeout
	}
	reqCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	endpoint := strings.TrimRight(cfg.BaseURL, "/") + "/v1/messages"
	req, err := http.NewRequestWithContext(reqCtx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-api-key", apiKey)
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("anthropic-version", "2023-06-01")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", &ProviderError{Code: "AI_REQUEST_FAILED", Message: err.Error()}
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", &ProviderError{Code: "AI_REQUEST_FAILED", Message: fmt.Sprintf("anthropic HTTP %d: %s", resp.StatusCode, truncateRunes(string(raw), 180))}
	}
	var parsed struct {
		Content []struct {
			Type string `json:"type"`
			Text string `json:"text"`
		} `json:"content"`
	}
	if json.Unmarshal(raw, &parsed) != nil {
		return "", &ProviderError{Code: "AI_REQUEST_FAILED", Message: "invalid anthropic response"}
	}
	var b strings.Builder
	for _, block := range parsed.Content {
		if block.Type == "text" || block.Type == "" {
			b.WriteString(block.Text)
		}
	}
	reply := strings.TrimSpace(b.String())
	if reply == "" {
		return "", &ProviderError{Code: "AI_REQUEST_FAILED", Message: "empty anthropic reply"}
	}
	return reply, nil
}

func stringifyMessageContent(content any) string {
	switch v := content.(type) {
	case string:
		return v
	case nil:
		return ""
	default:
		raw, _ := json.Marshal(v)
		return string(raw)
	}
}

func truncateRunes(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n])
}

// AnalyzeImage runs a vision chat completion with image_url content.
func AnalyzeImage(ctx context.Context, cfg ProviderConfig, imageBase64OrURL, prompt string, jsonMode bool) (string, error) {
	apiKey := strings.TrimSpace(cfg.visionKey)
	if apiKey == "" {
		apiKey = strings.TrimSpace(cfg.APIKey)
	}
	if apiKey == "" {
		return "", &ProviderError{Code: errAINotConfigured, Message: errAINotConfigured}
	}
	baseURL := cfg.visionBase
	if baseURL == "" {
		baseURL = cfg.BaseURL
	}
	imageURL := imageBase64OrURL
	if !strings.HasPrefix(imageURL, "http") && !strings.HasPrefix(imageURL, "data:") {
		imageURL = "data:image/jpeg;base64," + strings.TrimSpace(imageURL)
	}
	messages := []ChatMessage{{
		Role: "user",
		Content: []map[string]any{
			{"type": "text", "text": prompt},
			{"type": "image_url", "image_url": map[string]string{"url": imageURL}},
		},
	}}
	visionCfg := cfg
	visionCfg.APIKey = apiKey
	visionCfg.BaseURL = baseURL
	opts := ChatOptions{Model: cfg.VisionModel, JSONMode: jsonMode, MaxTokens: 4096, Timeout: 90 * time.Second}
	return ChatCompletion(ctx, visionCfg, messages, opts)
}

// Transcribe posts multipart audio to {base}/audio/transcriptions.
func Transcribe(ctx context.Context, cfg ProviderConfig, audioBytes []byte, mime, filename string) (string, error) {
	apiKey := strings.TrimSpace(cfg.asrKey)
	if apiKey == "" {
		apiKey = strings.TrimSpace(cfg.APIKey)
	}
	if apiKey == "" {
		return "", &ProviderError{Code: errAINotConfigured, Message: errAINotConfigured}
	}
	baseURL := cfg.asrBase
	if baseURL == "" {
		baseURL = cfg.BaseURL
	}
	if len(audioBytes) == 0 {
		return "", nil
	}
	if filename == "" {
		filename = extensionForMime(mime)
	}
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	fw, err := w.CreateFormFile("file", filename)
	if err != nil {
		return "", err
	}
	if _, err = fw.Write(audioBytes); err != nil {
		return "", err
	}
	_ = w.WriteField("model", cfg.AsrModel)
	if err = w.Close(); err != nil {
		return "", err
	}
	reqCtx, cancel := context.WithTimeout(ctx, 90*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(reqCtx, http.MethodPost, baseURL+"/audio/transcriptions", &buf)
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", w.FormDataContentType())
	req.Header.Set("Authorization", "Bearer "+apiKey)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", &ProviderError{Code: "AI_REQUEST_FAILED", Message: err.Error()}
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", &ProviderError{Code: "AI_REQUEST_FAILED", Message: fmt.Sprintf("asr HTTP %d", resp.StatusCode)}
	}
	var parsed struct {
		Text string `json:"text"`
	}
	if json.Unmarshal(raw, &parsed) != nil {
		return "", &ProviderError{Code: "AI_REQUEST_FAILED", Message: "invalid transcription response"}
	}
	return strings.TrimSpace(parsed.Text), nil
}

func normalizeSystemMessages(messages []ChatMessage) []ChatMessage {
	var systemParts []string
	rest := make([]ChatMessage, 0, len(messages))
	for _, m := range messages {
		if m.Role == "system" {
			if s, ok := m.Content.(string); ok && strings.TrimSpace(s) != "" {
				systemParts = append(systemParts, strings.TrimSpace(s))
			}
			continue
		}
		rest = append(rest, m)
	}
	if len(systemParts) == 0 {
		return rest
	}
	combined := ChatMessage{Role: "system", Content: strings.Join(systemParts, "\n\n")}
	return append([]ChatMessage{combined}, rest...)
}

func trimBaseURL(u string) string {
	return strings.TrimRight(strings.TrimSpace(u), "/")
}

func firstNonEmpty(parts ...string) string {
	for _, p := range parts {
		if strings.TrimSpace(p) != "" {
			return strings.TrimSpace(p)
		}
	}
	return ""
}

func extensionForMime(mime string) string {
	mime = strings.ToLower(mime)
	switch {
	case strings.Contains(mime, "wav"):
		return "speech.wav"
	case strings.Contains(mime, "webm"):
		return "speech.webm"
	case strings.Contains(mime, "mp3"):
		return "speech.mp3"
	default:
		return "speech.m4a"
	}
}

func providerName(cfg ProviderConfig) string {
	if cfg.BaseURL == defaultBaseURL {
		return "openai-compatible"
	}
	return "openai-compatible@" + cfg.BaseURL
}

// ForVision returns a config copy using vision credentials and model.
func (c ProviderConfig) ForVision() ProviderConfig {
	out := c
	if strings.TrimSpace(c.visionKey) != "" {
		out.APIKey = c.visionKey
	}
	if strings.TrimSpace(c.visionBase) != "" {
		out.BaseURL = c.visionBase
	}
	out.ChatModel = c.VisionModel
	return out
}

// ForAsr returns a config copy using ASR credentials.
func (c ProviderConfig) ForAsr() ProviderConfig {
	out := c
	if strings.TrimSpace(c.asrKey) != "" {
		out.APIKey = c.asrKey
	}
	if strings.TrimSpace(c.asrBase) != "" {
		out.BaseURL = c.asrBase
	}
	return out
}
