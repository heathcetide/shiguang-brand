// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package relay

import (
	"encoding/json"
)

// ─── Rich content blocks (provider-neutral, Anthropic-shaped) ─────────────
//
// These types mirror the Anthropic Messages API content-block model, which is
// the richest among LLM providers (text, tool_use, tool_result, thinking,
// images). The agent loop uses them directly instead of anthropic-sdk-go
// types, so it has zero dependency on any specific SDK.
//
// The relay Claude channel passes them through natively; the OpenAI channel
// translates to/from the flat Chat Completions format.

// ContentBlock is a discriminated union of content block types.
// Exactly one of the pointer fields is non-nil (except Image which carries
// its data inline).
type ContentBlock struct {
	Type string `json:"type"`

	// text block
	Text string `json:"text,omitempty"`

	// tool_use block (assistant)
	ID    string          `json:"id,omitempty"`
	Name  string          `json:"name,omitempty"`
	Input json.RawMessage `json:"input,omitempty"`

	// tool_result block (user, replying to a tool_use)
	ToolUseID string          `json:"tool_use_id,omitempty"`
	Content   json.RawMessage `json:"content,omitempty"` // string or array of blocks
	IsError   bool            `json:"is_error,omitempty"`

	// thinking block (extended thinking)
	Thinking  string `json:"thinking,omitempty"`
	Signature string `json:"signature,omitempty"`

	// image block
	Source *ImageSource `json:"source,omitempty"`

	// CacheControl places a prompt-cache breakpoint on this block.
	// "ephemeral" is the only supported value today. Empty = no breakpoint.
	CacheControl json.RawMessage `json:"cache_control,omitempty"`
}

// ImageSource is the source of an image content block.
type ImageSource struct {
	Type      string `json:"type"`       // "base64"
	MediaType string `json:"media_type"` // "image/png", "image/jpeg", ...
	Data      string `json:"data"`       // base64-encoded
}

// BlockType constants.
const (
	BlockTypeText       = "text"
	BlockTypeToolUse    = "tool_use"
	BlockTypeToolResult = "tool_result"
	BlockTypeThinking   = "thinking"
	BlockTypeImage      = "image"
)

// NewTextBlock creates a text content block.
func NewTextBlock(text string) ContentBlock {
	return ContentBlock{Type: BlockTypeText, Text: text}
}

// NewToolUseBlock creates a tool_use content block.
func NewToolUseBlock(id, name string, input json.RawMessage) ContentBlock {
	return ContentBlock{Type: BlockTypeToolUse, ID: id, Name: name, Input: input}
}

// NewToolResultBlock creates a tool_result content block.
// content can be a plain string (will be JSON-encoded) or a JSON array of blocks.
func NewToolResultBlock(toolUseID string, content string, isError bool) ContentBlock {
	return ContentBlock{
		Type:      BlockTypeToolResult,
		ToolUseID: toolUseID,
		Content:   json.RawMessage(jsonQuoteString(content)),
		IsError:   isError,
	}
}

// NewToolResultBlockRaw creates a tool_result with raw JSON content.
func NewToolResultBlockRaw(toolUseID string, content json.RawMessage, isError bool) ContentBlock {
	return ContentBlock{
		Type:      BlockTypeToolResult,
		ToolUseID: toolUseID,
		Content:   content,
		IsError:   isError,
	}
}

// NewThinkingBlock creates a thinking content block.
func NewThinkingBlock(thinking, signature string) ContentBlock {
	return ContentBlock{Type: BlockTypeThinking, Thinking: thinking, Signature: signature}
}

// NewImageBlock creates an image content block from base64 data.
func NewImageBlock(mediaType, base64Data string) ContentBlock {
	return ContentBlock{
		Type:   BlockTypeImage,
		Source: &ImageSource{Type: "base64", MediaType: mediaType, Data: base64Data},
	}
}

// WithCacheControl attaches a prompt-cache breakpoint to this block.
func (b ContentBlock) WithCacheControl() ContentBlock {
	b.CacheControl = json.RawMessage(`{"type":"ephemeral"}`)
	return b
}

// IsText returns true if this is a text block.
func (b ContentBlock) IsText() bool { return b.Type == BlockTypeText }

// IsToolUse returns true if this is a tool_use block.
func (b ContentBlock) IsToolUse() bool { return b.Type == BlockTypeToolUse }

// IsToolResult returns true if this is a tool_result block.
func (b ContentBlock) IsToolResult() bool { return b.Type == BlockTypeToolResult }

// IsThinking returns true if this is a thinking block.
func (b ContentBlock) IsThinking() bool { return b.Type == BlockTypeThinking }

// IsImage returns true if this is an image block.
func (b ContentBlock) IsImage() bool { return b.Type == BlockTypeImage }

// GetText returns the text content (empty for non-text blocks).
func (b ContentBlock) GetText() string {
	if b.Type == BlockTypeText {
		return b.Text
	}
	return ""
}

// GetToolResultText extracts the text from a tool_result's Content field.
// If Content is a JSON string, it unquotes it. If it's an array of blocks,
// it concatenates the text blocks. Returns "" for non-tool_result blocks.
func (b ContentBlock) GetToolResultText() string {
	if b.Type != BlockTypeToolResult || len(b.Content) == 0 {
		return ""
	}
	// Try string first.
	var s string
	if json.Unmarshal(b.Content, &s) == nil {
		return s
	}
	// Try array of blocks.
	var blocks []ContentBlock
	if json.Unmarshal(b.Content, &blocks) == nil {
		var out string
		for _, blk := range blocks {
			if blk.Type == BlockTypeText {
				out += blk.Text
			}
		}
		return out
	}
	return ""
}

// ─── Rich message (carries content blocks) ───────────────────────────────

// RichMessage is a conversation message with structured content blocks.
// It is the provider-neutral equivalent of anthropic.BetaMessageParam.
// Role is "user", "assistant", or "system".
type RichMessage struct {
	Role    string         `json:"role"`
	Content []ContentBlock `json:"content"`
}

// NewUserMessage creates a user message with text content.
func NewUserMessage(text string) RichMessage {
	return RichMessage{Role: "user", Content: []ContentBlock{NewTextBlock(text)}}
}

// NewUserMessageBlocks creates a user message from content blocks.
func NewUserMessageBlocks(blocks ...ContentBlock) RichMessage {
	return RichMessage{Role: "user", Content: blocks}
}

// NewAssistantMessage creates an assistant message from content blocks.
func NewAssistantMessageBlocks(blocks ...ContentBlock) RichMessage {
	return RichMessage{Role: "assistant", Content: blocks}
}

// NewSystemMessage creates a system message (rarely used; system is usually
// a top-level field on the request).
func NewSystemMessage(text string) RichMessage {
	return RichMessage{Role: "system", Content: []ContentBlock{NewTextBlock(text)}}
}

// ─── Rich response (from the model) ──────────────────────────────────────

// RichResponse is the assembled response from a model turn, in content-block
// form. It is the provider-neutral equivalent of anthropic.BetaMessage.
type RichResponse struct {
	ID          string         `json:"id"`
	Role        string         `json:"role"` // always "assistant"
	Content     []ContentBlock `json:"content"`
	StopReason  string         `json:"stop_reason"` // "end_turn" | "tool_use" | "max_tokens" | ...
	Model       string         `json:"model"`
	InputTokens int64          `json:"input_tokens"`
	OutputTokens int64         `json:"output_tokens"`
	// Prompt-cache usage (Anthropic-specific; zero for other providers).
	CacheReadInputTokens     int64 `json:"cache_read_input_tokens,omitempty"`
	CacheCreationInputTokens int64 `json:"cache_creation_input_tokens,omitempty"`
}

// Text concatenates all text blocks.
func (r RichResponse) Text() string {
	var s string
	for _, b := range r.Content {
		if b.Type == BlockTypeText {
			s += b.Text
		}
	}
	return s
}

// ToolUses returns all tool_use blocks in order.
func (r RichResponse) ToolUses() []ContentBlock {
	var out []ContentBlock
	for _, b := range r.Content {
		if b.Type == BlockTypeToolUse {
			out = append(out, b)
		}
	}
	return out
}

// ─── Stream chunk (rich version) ─────────────────────────────────────────

// RichStreamChunk is one chunk in a streaming response, in content-block form.
// It carries incremental updates as the model generates.
type RichStreamChunk struct {
	// Type identifies what kind of update this is:
	// "text_delta" — Text carries the incremental text
	// "tool_use_delta" — ToolUseIndex + ToolUseID/Name/InputFragment
	// "thinking_delta" — Thinking carries the incremental thinking text
	// "finish" — FinishReason is set
	// "usage" — InputTokens/OutputTokens are set (final usage)
	// "error" — Err is set
	Type string `json:"type"`

	// text delta
	Text string `json:"text,omitempty"`

	// thinking delta
	Thinking string `json:"thinking,omitempty"`

	// tool_use delta (accumulated by index)
	ToolUseIndex int    `json:"tool_use_index,omitempty"`
	ToolUseID    string `json:"tool_use_id,omitempty"`
	ToolUseName  string `json:"tool_use_name,omitempty"`
	// InputFragment is a piece of the tool input JSON (accumulated by index).
	InputFragment string `json:"input_fragment,omitempty"`

	// finish
	FinishReason string `json:"finish_reason,omitempty"`

	// usage (final chunk)
	InputTokens  int64 `json:"input_tokens,omitempty"`
	OutputTokens int64 `json:"output_tokens,omitempty"`

	// cache usage
	CacheReadInputTokens     int64 `json:"cache_read_input_tokens,omitempty"`
	CacheCreationInputTokens int64 `json:"cache_creation_input_tokens,omitempty"`

	Err  error `json:"-"`
	Done bool  `json:"-"`
}

// Stream chunk type constants.
const (
	ChunkTypeTextDelta    = "text_delta"
	ChunkTypeToolUseDelta = "tool_use_delta"
	ChunkTypeThinkingDelta = "thinking_delta"
	ChunkTypeFinish        = "finish"
	ChunkTypeUsage         = "usage"
	ChunkTypeError         = "error"
)

// ─── Helpers ─────────────────────────────────────────────────────────────

// jsonQuoteString wraps a string in JSON quotes.
func jsonQuoteString(s string) string {
	b, _ := json.Marshal(s)
	return string(b)
}
