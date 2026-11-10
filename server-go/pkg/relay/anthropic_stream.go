// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package relay

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"strings"
)

// parseAnthropicSSE reads an Anthropic Messages API SSE stream and emits
// RichStreamChunk events to ch. Returns the assembled final response.
func parseAnthropicSSE(body io.Reader, ch chan<- RichStreamChunk) (RichResponse, error) {
	sc := bufio.NewScanner(body)
	sc.Buffer(make([]byte, 0, 64*1024), 4*1024*1024)

	final := RichResponse{Role: "assistant"}

	// Track content blocks being assembled.
	type blockState struct {
		kind    string // "text" | "tool_use" | "thinking"
		id      string
		name    string
		text    strings.Builder
		input   strings.Builder
		thinking strings.Builder
		sig     string
	}
	blocks := map[int]*blockState{}

	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		data, ok := strings.CutPrefix(line, "data: ")
		if !ok {
			data, ok = strings.CutPrefix(line, "data:")
			if !ok {
				continue
			}
			data = strings.TrimSpace(data)
		}
		if data == "[DONE]" {
			continue
		}

		var ev struct {
			Type string `json:"type"`
			// message_start
			Message *struct {
				ID     string `json:"id"`
				Model  string `json:"model"`
				Usage  *struct {
					InputTokens              int64 `json:"input_tokens"`
					OutputTokens             int64 `json:"output_tokens"`
					CacheReadInputTokens     int64 `json:"cache_read_input_tokens"`
					CacheCreationInputTokens int64 `json:"cache_creation_input_tokens"`
				} `json:"usage"`
			} `json:"message"`
			// content_block_start
			Index *int `json:"index"`
			ContentBlock *struct {
				Type  string `json:"type"`
				Text  string `json:"text"`
				ID    string `json:"id"`
				Name  string `json:"name"`
				Input json.RawMessage `json:"input"`
				Thinking string `json:"thinking"`
				Signature string `json:"signature"`
			} `json:"content_block"`
			// content_block_delta
			Delta *struct {
				Type       string `json:"type"`
				Text       string `json:"text"`
				PartialJSON string `json:"partial_json"`
				Thinking   string `json:"thinking"`
				Signature  string `json:"signature"`
			} `json:"delta"`
			// message_delta
			DeltaMsg *struct {
				StopReason string `json:"stop_reason"`
			} `json:"delta"`
			Usage *struct {
				InputTokens              int64 `json:"input_tokens"`
				OutputTokens             int64 `json:"output_tokens"`
				CacheReadInputTokens     int64 `json:"cache_read_input_tokens"`
				CacheCreationInputTokens int64 `json:"cache_creation_input_tokens"`
			} `json:"usage"`
		}

		if json.Unmarshal([]byte(data), &ev) != nil {
			continue
		}

		switch ev.Type {
		case "message_start":
			if ev.Message != nil {
				final.ID = ev.Message.ID
				final.Model = ev.Message.Model
				if ev.Message.Usage != nil {
					final.InputTokens = ev.Message.Usage.InputTokens
					final.OutputTokens = ev.Message.Usage.OutputTokens
					final.CacheReadInputTokens = ev.Message.Usage.CacheReadInputTokens
					final.CacheCreationInputTokens = ev.Message.Usage.CacheCreationInputTokens
				}
			}
			ch <- RichStreamChunk{Type: ChunkTypeUsage, InputTokens: final.InputTokens, OutputTokens: final.OutputTokens}

		case "content_block_start":
			if ev.Index == nil || ev.ContentBlock == nil {
				continue
			}
			idx := *ev.Index
			bs := &blockState{kind: ev.ContentBlock.Type}
			blocks[idx] = bs
			switch ev.ContentBlock.Type {
			case "tool_use":
				bs.id = ev.ContentBlock.ID
				bs.name = ev.ContentBlock.Name
				if len(ev.ContentBlock.Input) > 0 {
					bs.input.WriteString(string(ev.ContentBlock.Input))
				}
			case "thinking":
				bs.thinking.WriteString(ev.ContentBlock.Thinking)
				bs.sig = ev.ContentBlock.Signature
			case "text":
				bs.text.WriteString(ev.ContentBlock.Text)
			}

		case "content_block_delta":
			if ev.Index == nil || ev.Delta == nil {
				continue
			}
			idx := *ev.Index
			bs := blocks[idx]
			if bs == nil {
				bs = &blockState{}
				blocks[idx] = bs
			}
			switch ev.Delta.Type {
			case "text_delta":
				bs.text.WriteString(ev.Delta.Text)
				ch <- RichStreamChunk{Type: ChunkTypeTextDelta, Text: ev.Delta.Text}
			case "input_json_delta":
				bs.input.WriteString(ev.Delta.PartialJSON)
				ch <- RichStreamChunk{
					Type:          ChunkTypeToolUseDelta,
					ToolUseIndex:  idx,
					ToolUseID:     bs.id,
					ToolUseName:   bs.name,
					InputFragment: ev.Delta.PartialJSON,
				}
			case "thinking_delta":
				bs.thinking.WriteString(ev.Delta.Thinking)
				ch <- RichStreamChunk{Type: ChunkTypeThinkingDelta, Thinking: ev.Delta.Thinking}
			case "signature_delta":
				bs.sig = ev.Delta.Signature
			}

		case "content_block_stop":
			// Block is complete; nothing to emit (deltas already sent).

		case "message_delta":
			if ev.DeltaMsg != nil {
				final.StopReason = ev.DeltaMsg.StopReason
			}
			if ev.Usage != nil {
				final.OutputTokens = ev.Usage.OutputTokens
				if ev.Usage.CacheReadInputTokens > 0 {
					final.CacheReadInputTokens = ev.Usage.CacheReadInputTokens
				}
				if ev.Usage.CacheCreationInputTokens > 0 {
					final.CacheCreationInputTokens = ev.Usage.CacheCreationInputTokens
				}
			}
			ch <- RichStreamChunk{
				Type:         ChunkTypeFinish,
				FinishReason: final.StopReason,
				InputTokens:  final.InputTokens,
				OutputTokens: final.OutputTokens,
			}

		case "message_stop":
			// Stream is done.
		}
	}

	if err := sc.Err(); err != nil {
		return final, err
	}

	// Assemble content blocks in index order.
	maxIdx := -1
	for idx := range blocks {
		if idx > maxIdx {
			maxIdx = idx
		}
	}
	for i := 0; i <= maxIdx; i++ {
		bs := blocks[i]
		if bs == nil {
			continue
		}
		switch bs.kind {
		case "text":
			if bs.text.Len() > 0 {
				final.Content = append(final.Content, NewTextBlock(bs.text.String()))
			}
		case "tool_use":
			input := json.RawMessage("{}")
			if s := strings.TrimSpace(bs.input.String()); s != "" {
				input = json.RawMessage(s)
			}
			final.Content = append(final.Content, NewToolUseBlock(bs.id, bs.name, input))
		case "thinking":
			final.Content = append(final.Content, NewThinkingBlock(bs.thinking.String(), bs.sig))
		}
	}

	if len(final.Content) == 0 {
		final.Content = []ContentBlock{NewTextBlock("[Provider returned no content]")}
	}

	ch <- RichStreamChunk{Type: ChunkTypeUsage, Done: true, InputTokens: final.InputTokens, OutputTokens: final.OutputTokens}
	return final, nil
}

// formatError is a helper for error formatting.
func formatError(format string, args ...any) error {
	return fmt.Errorf(format, args...)
}
