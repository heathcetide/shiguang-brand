// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package realtime

import (
	"context"
	"fmt"
	"net/http"
	"strings"

	"github.com/gorilla/websocket"
)

// OpenAIConnector dials the OpenAI Realtime API over WebSocket.
type OpenAIConnector struct {
	// BaseURL is the WebSocket endpoint, e.g. "wss://api.openai.com/v1/realtime".
	// If empty, defaults to the public OpenAI endpoint.
	BaseURL string
	// APIKey is the OpenAI API key.
	APIKey string
	// Model is the realtime model to connect to (e.g. "gpt-4o-realtime-preview").
	// If non-empty, it is appended as a query parameter.
	Model string
}

// NewOpenAIConnector creates a connector for the OpenAI Realtime API.
func NewOpenAIConnector(apiKey, model string) *OpenAIConnector {
	return &OpenAIConnector{
		BaseURL: "wss://api.openai.com/v1/realtime",
		APIKey:  apiKey,
		Model:   model,
	}
}

// Dial connects to the OpenAI Realtime WebSocket.
func (c *OpenAIConnector) Dial(ctx context.Context, session *Session) (Conn, error) {
	baseURL := c.BaseURL
	if baseURL == "" {
		baseURL = "wss://api.openai.com/v1/realtime"
	}

	model := c.Model
	if model == "" {
		model = session.Config().Model
	}

	// Build URL with model query param.
	url := baseURL
	if !strings.Contains(url, "?") {
		url += "?model=" + model
	} else {
		url += "&model=" + model
	}

	header := http.Header{}
	header.Set("Authorization", "Bearer "+c.APIKey)
	header.Set("OpenAI-Beta", "realtime=v1")

	// gorilla websocket dialer.
	dialer := websocket.Dialer{}
	conn, resp, err := dialer.DialContext(ctx, url, header)
	if err != nil {
		if resp != nil {
			resp.Body.Close()
		}
		return nil, fmt.Errorf("realtime: openai dial: %w", err)
	}
	return conn, nil
}
