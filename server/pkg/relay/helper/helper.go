// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package helper provides utility functions for relay providers, adapted
// from LingRein's pkg/relay/helper with gin.Context dependencies removed.
//
// These helpers handle SSE streaming, response ID generation, and other
// common tasks that provider adaptors need.
package helper

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/heathcetide/DietDigiDose/pkg/relay/relaykit/dto"
)

// SetEventStreamHeaders sets SSE headers on an http.ResponseWriter.
func SetEventStreamHeaders(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Transfer-Encoding", "chunked")
}

// StringData writes an SSE data line to the writer.
func StringData(w http.ResponseWriter, str string) error {
	_, err := fmt.Fprintf(w, "data: %s\n\n", str)
	if f, ok := w.(http.Flusher); ok {
		f.Flush()
	}
	return err
}

// ObjectData marshals an object to JSON and writes it as an SSE data line.
func ObjectData(w http.ResponseWriter, object any) error {
	if object == nil {
		return fmt.Errorf("object is nil")
	}
	jsonData, err := json.Marshal(object)
	if err != nil {
		return fmt.Errorf("error marshalling object: %w", err)
	}
	return StringData(w, string(jsonData))
}

// Done writes the SSE [DONE] marker.
func Done(w http.ResponseWriter) {
	_ = StringData(w, "[DONE]")
}

// GetResponseID generates a response ID from a request ID.
func GetResponseID(requestID string) string {
	if requestID == "" {
		return fmt.Sprintf("chatcmpl-%d", 0)
	}
	return fmt.Sprintf("chatcmpl-%s", requestID)
}

// GenerateStartEmptyResponse creates an empty start response for streaming.
func GenerateStartEmptyResponse(id string, createAt int64, model string, systemFingerprint *string) *dto.ChatCompletionsStreamResponse {
	resp := &dto.ChatCompletionsStreamResponse{
		Id:      id,
		Model:   model,
		Object:  "chat.completion.chunk",
		Created: createAt,
		Choices: []dto.ChatCompletionsStreamResponseChoice{
			{
				Index: 0,
				Delta: dto.ChatCompletionsStreamResponseChoiceDelta{
					Role: "assistant",
				},
				FinishReason: nil,
			},
		},
	}
	if systemFingerprint != nil {
		resp.SystemFingerprint = systemFingerprint
	}
	return resp
}

// GenerateStopResponse creates a stop response for streaming.
func GenerateStopResponse(id string, createAt int64, model string, systemFingerprint *string) *dto.ChatCompletionsStreamResponse {
	stopReason := "stop"
	resp := &dto.ChatCompletionsStreamResponse{
		Id:      id,
		Model:   model,
		Object:  "chat.completion.chunk",
		Created: createAt,
		Choices: []dto.ChatCompletionsStreamResponseChoice{
			{
				Index: 0,
				Delta: dto.ChatCompletionsStreamResponseChoiceDelta{},
				FinishReason: &stopReason,
			},
		},
	}
	if systemFingerprint != nil {
		resp.SystemFingerprint = systemFingerprint
	}
	return resp
}

// GenerateFinalUsageResponse creates a final usage response for streaming.
func GenerateFinalUsageResponse(id string, createAt int64, model string, usage *dto.Usage) *dto.ChatCompletionsStreamResponse {
	resp := &dto.ChatCompletionsStreamResponse{
		Id:      id,
		Model:   model,
		Object:  "chat.completion.chunk",
		Created: createAt,
		Choices: []dto.ChatCompletionsStreamResponseChoice{},
	}
	if usage != nil {
		resp.Usage = usage
	}
	return resp
}

// StreamScanner wraps an io.Reader to scan SSE lines.
type StreamScanner struct {
	reader io.Reader
	buf    []byte
}

// NewStreamScanner creates a new StreamScanner.
func NewStreamScanner(reader io.Reader) *StreamScanner {
	return &StreamScanner{reader: reader, buf: make([]byte, 0, 4096)}
}

// Scan returns the next SSE data line. Returns io.EOF at end.
func (s *StreamScanner) Scan() (string, error) {
	// Read until we find a complete SSE data line.
	chunk := make([]byte, 4096)
	for {
		// Check if we have a complete line in buffer.
		idx := strings.Index(string(s.buf), "\n\n")
		if idx >= 0 {
			line := string(s.buf[:idx])
			s.buf = s.buf[idx+2:]
			// Extract data: prefix
			if strings.HasPrefix(line, "data: ") {
				return strings.TrimPrefix(line, "data: "), nil
			}
			continue
		}
		// Read more data.
		n, err := s.reader.Read(chunk)
		if n > 0 {
			s.buf = append(s.buf, chunk[:n]...)
		}
		if err != nil {
			return "", err
		}
	}
}

// StreamResult holds the result of a stream scan.
type StreamResult struct {
	Data string
	Done bool
}

// StreamScannerHandler processes a streaming response, calling the handler
// for each data line. Returns when the stream is done or an error occurs.
func StreamScannerHandler(resp *http.Response, handler func(data string) error) error {
	scanner := NewStreamScanner(resp.Body)
	for {
		data, err := scanner.Scan()
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return err
		}
		if data == "[DONE]" {
			return nil
		}
		if err := handler(data); err != nil {
			return err
		}
	}
}
