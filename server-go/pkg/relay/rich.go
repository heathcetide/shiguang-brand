// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package relay

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	common "github.com/heathcetide/DietDigiDose/pkg/relay/common"
	"github.com/heathcetide/DietDigiDose/pkg/relay/relaykit/dto"
	relaymode "github.com/heathcetide/DietDigiDose/pkg/relay/relaymode"
)

// RichChatRequest is the rich content-block version of ChatRequest.
// It uses RichMessage (with ContentBlock[]) instead of the flat OpenAI
// Message format, so the agent loop can work with structured content
// (text, tool_use, tool_result, thinking, images) without depending on
// any specific SDK.
type RichChatRequest struct {
	Model           string         `json:"model"`
	Messages        []RichMessage  `json:"messages"`
	System          string         `json:"system,omitempty"`
	Temperature     *float64       `json:"temperature,omitempty"`
	MaxTokens       int            `json:"max_tokens,omitempty"`
	Tools           []RichTool     `json:"tools,omitempty"`
	ToolChoice      json.RawMessage `json:"tool_choice,omitempty"`
	Betas           []string       `json:"betas,omitempty"`
	ReasoningEffort string         `json:"reasoning_effort,omitempty"`
	Stream          bool           `json:"stream,omitempty"`
}

// RichTool is a tool definition in the rich format.
type RichTool struct {
	Name        string          `json:"name"`
	Description string          `json:"description,omitempty"`
	InputSchema json.RawMessage `json:"input_schema,omitempty"`
	// Type is "function" for custom tools. Some providers have built-in
	// tools (e.g. Anthropic web_search) with different types.
	Type string `json:"type,omitempty"`
}

// RichChatResult holds the stream channel and final usage for a rich stream.
type RichChatResult struct {
	Ch    chan RichStreamChunk
	Final RichResponse
}

// RichChatStream sends a streaming rich chat request. It returns a channel
// of rich stream chunks. The channel closes when the stream ends.
//
// For the Claude/Anthropic channel, it calls /v1/messages directly with
// native content blocks. For OpenAI-compatible channels, it translates
// to the flat Chat Completions format and back.
func (c *Client) RichChatStream(ctx context.Context, req *RichChatRequest) (*RichChatResult, error) {
	if err := c.ensureProvider(); err != nil {
		return nil, err
	}

	// Check if the provider is the Anthropic channel — it can handle
	// rich requests natively. Otherwise, translate to the flat format.
	if c.isAnthropicProvider() {
		return c.richChatStreamAnthropic(ctx, req)
	}
	return c.richChatStreamTranslated(ctx, req)
}

// isAnthropicProvider reports whether the configured provider is the
// Anthropic/Claude channel.
func (c *Client) isAnthropicProvider() bool {
	if c.provider == nil {
		return false
	}
	return c.provider.Name() == "claude" || c.provider.Name() == "anthropic"
}

// richChatStreamAnthropic calls the Anthropic Messages API natively with
// content blocks, streaming the response as rich chunks.
func (c *Client) richChatStreamAnthropic(ctx context.Context, req *RichChatRequest) (*RichChatResult, error) {
	adaptor := c.provider.Adaptor()
	info := c.buildRelayInfo(relaymode.RelayModeChatCompletions, req.Model, true)
	adaptor.Init(info)

	// Build the Claude request from rich types.
	claudeReq := richToClaudeRequest(req)
	converted, err := adaptor.ConvertClaudeRequest(ctx, info, claudeReq)
	if err != nil {
		return nil, fmt.Errorf("relay: convert claude request: %w", err)
	}

	jsonData, err := json.Marshal(converted)
	if err != nil {
		return nil, fmt.Errorf("relay: marshal request: %w", err)
	}

	url, err := adaptor.GetRequestURL(info)
	if err != nil {
		return nil, fmt.Errorf("relay: build URL: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, "POST", url, strings.NewReader(string(jsonData)))
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "text/event-stream")
	// Beta headers
	for _, beta := range req.Betas {
		httpReq.Header.Add("anthropic-beta", beta)
	}
	if err := adaptor.SetupRequestHeader(ctx, &httpReq.Header, info); err != nil {
		return nil, fmt.Errorf("relay: setup headers: %w", err)
	}

	resp, err := c.doRequest(ctx, adaptor, info, httpReq)
	if err != nil {
		return nil, fmt.Errorf("relay: request failed: %w", err)
	}

	// Check for non-200 status before streaming.
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		return nil, fmt.Errorf("relay: anthropic API returned %d: %s", resp.StatusCode, string(body))
	}

	result := &RichChatResult{
		Ch: make(chan RichStreamChunk, 100),
	}

	go func() {
		defer resp.Body.Close()
		defer close(result.Ch)

		select {
		case <-ctx.Done():
			result.Ch <- RichStreamChunk{Type: ChunkTypeError, Err: ctx.Err()}
			return
		default:
		}

		// Parse the Anthropic SSE stream into rich chunks.
		final, err := parseAnthropicSSE(resp.Body, result.Ch)
		if err != nil {
			result.Ch <- RichStreamChunk{Type: ChunkTypeError, Err: err}
			return
		}
		result.Final = final
	}()

	return result, nil
}

// richChatStreamTranslated translates rich → flat ChatRequest, calls the
// provider's ChatStream, and translates the flat chunks back to rich chunks.
func (c *Client) richChatStreamTranslated(ctx context.Context, req *RichChatRequest) (*RichChatResult, error) {
	flatReq := richToFlatRequest(req)
	flatResult, err := c.ChatStream(ctx, flatReq)
	if err != nil {
		return nil, err
	}

	result := &RichChatResult{
		Ch: make(chan RichStreamChunk, 100),
	}

	go func() {
		defer close(result.Ch)

		var textBuilder strings.Builder
		toolAccum := map[int]*toolAccumRich{}
		var finishReason string

		for chunk := range flatResult.Ch {
			if chunk.Err != nil {
				result.Ch <- RichStreamChunk{Type: ChunkTypeError, Err: chunk.Err}
				return
			}
			if chunk.Done {
				if chunk.Usage != nil {
					result.Ch <- RichStreamChunk{
						Type:         ChunkTypeUsage,
						InputTokens:  int64(chunk.Usage.InputTokens),
						OutputTokens: int64(chunk.Usage.OutputTokens),
						Done:         true,
					}
				}
				continue
			}
			if chunk.Delta != "" {
				textBuilder.WriteString(chunk.Delta)
				result.Ch <- RichStreamChunk{Type: ChunkTypeTextDelta, Text: chunk.Delta}
			}
			if chunk.Reasoning != "" {
				result.Ch <- RichStreamChunk{Type: ChunkTypeThinkingDelta, Thinking: chunk.Reasoning}
			}
			for _, tc := range chunk.ToolCalls {
				idx := 0
				if tc.Index != nil {
					idx = *tc.Index
				}
				acc := toolAccum[idx]
				if acc == nil {
					acc = &toolAccumRich{}
					toolAccum[idx] = acc
				}
				if tc.ID != "" {
					acc.id = tc.ID
				}
				if tc.Function.Name != "" {
					acc.name = tc.Function.Name
				}
				acc.args.WriteString(tc.Function.Arguments)
				result.Ch <- RichStreamChunk{
					Type:          ChunkTypeToolUseDelta,
					ToolUseIndex:  idx,
					ToolUseID:     tc.ID,
					ToolUseName:   tc.Function.Name,
					InputFragment: tc.Function.Arguments,
				}
			}
			if chunk.FinishReason != "" {
				finishReason = chunk.FinishReason
				result.Ch <- RichStreamChunk{Type: ChunkTypeFinish, FinishReason: mapFinishReasonToAnthropic(finishReason, len(toolAccum) > 0)}
			}
		}

		// Build the final response.
		final := RichResponse{
			Role:         "assistant",
			InputTokens:  int64(flatResult.Usage.InputTokens),
			OutputTokens: int64(flatResult.Usage.OutputTokens),
			StopReason:   mapFinishReasonToAnthropic(finishReason, len(toolAccum) > 0),
		}
		if text := textBuilder.String(); text != "" {
			final.Content = append(final.Content, NewTextBlock(text))
		}
		if len(toolAccum) > 0 {
			for i := 0; i < len(toolAccum); i++ {
				acc := toolAccum[i]
				if acc == nil {
					continue
				}
				input := json.RawMessage("{}")
				if s := strings.TrimSpace(acc.args.String()); s != "" {
					input = json.RawMessage(s)
				}
				final.Content = append(final.Content, NewToolUseBlock(acc.id, acc.name, input))
			}
		}
		if len(final.Content) == 0 {
			final.Content = []ContentBlock{NewTextBlock("[Provider returned no content]")}
		}
		result.Final = final
	}()

	return result, nil
}

// RichChat sends a non-streaming rich chat request and returns the assembled response.
func (c *Client) RichChat(ctx context.Context, req *RichChatRequest) (*RichResponse, error) {
	streamReq := *req
	streamReq.Stream = true

	result, err := c.RichChatStream(ctx, &streamReq)
	if err != nil {
		return nil, err
	}

	// Drain the channel and return the final response.
	for range result.Ch {
	}
	return &result.Final, nil
}

// ─── Translation helpers ─────────────────────────────────────────────────

// toolAccumRich accumulates a streamed tool call across delta fragments.
type toolAccumRich struct {
	id   string
	name string
	args strings.Builder
}

// richToClaudeRequest converts a RichChatRequest to a dto.ClaudeRequest.
func richToClaudeRequest(req *RichChatRequest) *dto.ClaudeRequest {
	maxTokens := uint(req.MaxTokens)
	if maxTokens == 0 {
		maxTokens = 8192
	}
	stream := true

	claudeReq := &dto.ClaudeRequest{
		Model:    req.Model,
		MaxTokens: &maxTokens,
		Stream:   &stream,
	}

	// System prompt
	if req.System != "" {
		claudeReq.System = req.System
	}

	// Temperature
	if req.Temperature != nil {
		claudeReq.Temperature = req.Temperature
	}

	// Messages
	for _, m := range req.Messages {
		claudeMsg := dto.ClaudeMessage{
			Role:    m.Role,
			Content: richBlocksToClaudeContent(m.Content),
		}
		claudeReq.Messages = append(claudeReq.Messages, claudeMsg)
	}

	// Tools
	if len(req.Tools) > 0 {
		tools := make([]dto.Tool, 0, len(req.Tools))
		for _, t := range req.Tools {
			toolType := t.Type
			if toolType == "" {
				toolType = "custom"
			}
			_ = toolType // Claude tools use dto.Tool, not the type field
			var schema map[string]interface{}
			if len(t.InputSchema) > 0 {
				_ = json.Unmarshal(t.InputSchema, &schema)
			}
			if schema == nil {
				schema = map[string]interface{}{"type": "object", "properties": map[string]any{}, "required": []string{}}
			}
			tools = append(tools, dto.Tool{
				Name:        t.Name,
				Description: t.Description,
				InputSchema: schema,
			})
		}
		claudeReq.Tools = tools
	}

	return claudeReq
}

// richBlocksToClaudeContent converts content blocks to Claude message content.
// Returns either a string (single text block) or an array of objects.
func richBlocksToClaudeContent(blocks []ContentBlock) any {
	if len(blocks) == 1 && blocks[0].Type == BlockTypeText {
		return blocks[0].Text
	}
	arr := make([]map[string]any, 0, len(blocks))
	for _, b := range blocks {
		m := map[string]any{"type": b.Type}
		switch b.Type {
		case BlockTypeText:
			m["text"] = b.Text
		case BlockTypeToolUse:
			m["id"] = b.ID
			m["name"] = b.Name
			var input any
			if len(b.Input) > 0 {
				_ = json.Unmarshal(b.Input, &input)
			}
			m["input"] = input
		case BlockTypeToolResult:
			m["tool_use_id"] = b.ToolUseID
			var content any
			if len(b.Content) > 0 {
				_ = json.Unmarshal(b.Content, &content)
			}
			m["content"] = content
			if b.IsError {
				m["is_error"] = true
			}
		case BlockTypeThinking:
			m["thinking"] = b.Thinking
			if b.Signature != "" {
				m["signature"] = b.Signature
			}
		case BlockTypeImage:
			if b.Source != nil {
				m["source"] = map[string]any{
					"type":       b.Source.Type,
					"media_type": b.Source.MediaType,
					"data":       b.Source.Data,
				}
			}
		}
		if len(b.CacheControl) > 0 {
			var cc any
			_ = json.Unmarshal(b.CacheControl, &cc)
			m["cache_control"] = cc
		}
		arr = append(arr, m)
	}
	return arr
}

// richToFlatRequest converts a RichChatRequest to a flat ChatRequest.
func richToFlatRequest(req *RichChatRequest) *ChatRequest {
	maxTokens := req.MaxTokens
	flatReq := &ChatRequest{
		Model:           req.Model,
		Temperature:     req.Temperature,
		MaxTokens:       &maxTokens,
		Stream:          true,
		ReasoningEffort: req.ReasoningEffort,
		System:          req.System,
		Betas:           req.Betas,
	}

	// System as a leading system message (for OpenAI-compatible providers).
	if req.System != "" {
		flatReq.Messages = append(flatReq.Messages, Message{
			Role:    "system",
			Content: req.System,
		})
	}

	// Convert rich messages to flat messages.
	for _, m := range req.Messages {
		flatMsgs := richMessageToFlat(m)
		flatReq.Messages = append(flatReq.Messages, flatMsgs...)
	}

	// Convert tools.
	for _, t := range req.Tools {
		toolType := t.Type
		if toolType == "" {
			toolType = "function"
		}
		var schema any
		if len(t.InputSchema) > 0 {
			_ = json.Unmarshal(t.InputSchema, &schema)
		}
		flatReq.Tools = append(flatReq.Tools, Tool{
			Type: toolType,
			Function: dto.FunctionRequest{
				Name:        t.Name,
				Description: t.Description,
				Parameters:  schema,
			},
		})
	}

	return flatReq
}

// richMessageToFlat converts one RichMessage to one or more flat Messages.
// Tool results become separate role:"tool" messages.
func richMessageToFlat(m RichMessage) []Message {
	var text strings.Builder
	var toolCallsJSON []byte
	var toolResults []Message

	type tcJSON struct {
		ID       string `json:"id"`
		Type     string `json:"type"`
		Function struct {
			Name      string `json:"name"`
			Arguments string `json:"arguments"`
		} `json:"function"`
	}
	var tcList []tcJSON

	for _, b := range m.Content {
		switch b.Type {
		case BlockTypeText:
			text.WriteString(b.Text)
		case BlockTypeToolUse:
			args := string(b.Input)
			if args == "" {
				args = "{}"
			}
			tc := tcJSON{ID: b.ID, Type: "function"}
			tc.Function.Name = b.Name
			tc.Function.Arguments = args
			tcList = append(tcList, tc)
		case BlockTypeToolResult:
			content := b.GetToolResultText()
			toolResults = append(toolResults, Message{
				Role:       "tool",
				ToolCallId: b.ToolUseID,
				Content:    content,
			})
		}
	}

	if len(tcList) > 0 {
		toolCallsJSON, _ = json.Marshal(tcList)
	}

	var msgs []Message
	if m.Role == "assistant" {
		am := Message{
			Role:    "assistant",
			Content: text.String(),
		}
		if toolCallsJSON != nil {
			am.ToolCalls = toolCallsJSON
		}
		msgs = append(msgs, am)
	} else {
		if text.Len() > 0 {
			msgs = append(msgs, Message{
				Role:    "user",
				Content: text.String(),
			})
		}
		msgs = append(msgs, toolResults...)
	}
	return msgs
}

// mapFinishReasonToAnthropic maps an OpenAI finish_reason to an Anthropic stop_reason.
func mapFinishReasonToAnthropic(finish string, hasTools bool) string {
	switch finish {
	case "tool_calls":
		return "tool_use"
	case "length":
		return "max_tokens"
	case "stop":
		return "end_turn"
	default:
		if hasTools {
			return "tool_use"
		}
		return "end_turn"
	}
}

// ─── Anthropic SSE stream parser ─────────────────────────────────────────

// (parseAnthropicSSE is in anthropic_stream.go)

// compile-time interface assertion
var _ = func() { _ = common.RelayInfo{} }
