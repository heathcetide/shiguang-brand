// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package realtime provides a framework-independent WebSocket abstraction for
// OpenAI-compatible Realtime API sessions.
//
// It bridges a client WebSocket connection with an upstream provider WebSocket,
// forwarding events bidirectionally while accumulating usage/token metrics.
// The design avoids any HTTP framework coupling: callers supply a
// `Conn`-compatible WebSocket and a `Connector` that knows how to dial the
// upstream provider.
package realtime

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"

	"github.com/heathcetide/DietDigiDose/pkg/relay/meter"
	"github.com/heathcetide/DietDigiDose/pkg/relay/relaykit/dto"
)

// Conn is the minimal WebSocket connection interface used by the bridge.
// It is satisfied by *gorilla/websocket.Conn and by test doubles.
type Conn interface {
	// ReadMessage returns the next message from the peer.
	ReadMessage() (messageType int, p []byte, err error)
	// WriteMessage writes a message to the peer.
	WriteMessage(messageType int, data []byte) error
	// Close closes the connection.
	Close() error
}

// Connector dials an upstream realtime WebSocket for a given session.
// Implementations are provider-specific (OpenAI, Azure, etc.).
type Connector interface {
	// Dial connects to the upstream realtime endpoint and returns the
	// upstream Conn. The returned Conn must be closed by the caller.
	Dial(ctx context.Context, session *Session) (Conn, error)
}

// SessionConfig carries the parameters needed to open a realtime session.
type SessionConfig struct {
	// Model is the upstream realtime model name (e.g. "gpt-4o-realtime-preview").
	Model string
	// Voice is the voice to use for output (optional, provider-specific).
	Voice string
	// Instructions is the system instruction for the session (optional).
	Instructions string
	// Modalities is the list of modalities (e.g. ["text","audio"]).
	Modalities []string
	// InputAudioFormat / OutputAudioFormat are codec names (e.g. "pcm16").
	InputAudioFormat  string
	OutputAudioFormat string
	// Temperature is the sampling temperature (optional).
	Temperature *float64
	// Tools is the list of tools the model may call.
	Tools []dto.RealTimeTool
	// APIKey is the upstream API key.
	APIKey string
	// BaseURL is the upstream WebSocket base URL (e.g. "wss://api.openai.com/v1/realtime").
	BaseURL string
}

// Session is a realtime session bridging a client and upstream connection.
type Session struct {
	cfg    SessionConfig
	client Conn
	target Conn

	mu     sync.Mutex
	usage  dto.RealtimeUsage
	meter  meter.Meter
	model  string
	provider string
}

// NewSession creates a new realtime session.
// The client Conn must already be accepted/upgraded by the caller.
func NewSession(client Conn, cfg SessionConfig) *Session {
	return &Session{
		cfg:    cfg,
		client: client,
		model:  cfg.Model,
	}
}

// SetMeter attaches a usage meter. If set, usage events are recorded on close.
func (s *Session) SetMeter(m meter.Meter, provider string) {
	s.meter = m
	s.provider = provider
}

// Connect dials the upstream provider using the supplied Connector and
// begins bridging messages bidirectionally. It blocks until either side
// closes or the context is cancelled.
func (s *Session) Connect(ctx context.Context, connector Connector) error {
	target, err := connector.Dial(ctx, s)
	if err != nil {
		return fmt.Errorf("realtime: dial upstream: %w", err)
	}
	s.target = target

	// Send initial session.update if configured.
	if err := s.sendInitialSessionUpdate(); err != nil {
		s.closeBoth()
		return fmt.Errorf("realtime: send session.update: %w", err)
	}

	// Bridge bidirectionally.
	errC := make(chan error, 2)
	go func() { errC <- s.forwardClient(ctx) }()
	go func() { errC <- s.forwardUpstream(ctx) }()

	// Wait for either direction to finish.
	err = <-errC
	s.closeBoth()
	// Drain the other goroutine.
	<-errC
	return err
}

// Usage returns the accumulated upstream usage so far.
func (s *Session) Usage() dto.RealtimeUsage {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.usage
}

// closeBoth closes both connections, ignoring errors.
func (s *Session) closeBoth() {
	_ = s.client.Close()
	if s.target != nil {
		_ = s.target.Close()
	}
}

// sendInitialSessionUpdate sends a session.update event to the upstream
// with the configured session parameters.
func (s *Session) sendInitialSessionUpdate() error {
	session := dto.RealtimeSession{
		Modalities:        s.cfg.Modalities,
		Instructions:      s.cfg.Instructions,
		Voice:             s.cfg.Voice,
		InputAudioFormat:  s.cfg.InputAudioFormat,
		OutputAudioFormat: s.cfg.OutputAudioFormat,
		Tools:             s.cfg.Tools,
	}
	if s.cfg.Temperature != nil {
		session.Temperature = *s.cfg.Temperature
	}
	event := dto.RealtimeEvent{
		Type:    dto.RealtimeEventTypeSessionUpdate,
		Session: &session,
	}
	data, err := json.Marshal(event)
	if err != nil {
		return err
	}
	return s.target.WriteMessage(1, data) // 1 = TextMessage
}

// forwardClient reads messages from the client and writes them to upstream.
func (s *Session) forwardClient(ctx context.Context) error {
	for {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		_, data, err := s.client.ReadMessage()
		if err != nil {
			return err
		}
		if err := s.target.WriteMessage(1, data); err != nil {
			return err
		}
	}
}

// forwardUpstream reads messages from upstream, accumulates usage, and
// forwards them to the client.
func (s *Session) forwardUpstream(ctx context.Context) error {
	for {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		_, data, err := s.target.ReadMessage()
		if err != nil {
			return err
		}

		// Inspect the event for usage.
		var event dto.RealtimeEvent
		if json.Unmarshal(data, &event) == nil {
			if event.Type == dto.RealtimeEventTypeResponseDone && event.Response != nil && event.Response.Usage != nil {
				s.accumulateUsage(*event.Response.Usage)
			}
		}

		// Forward to client.
		if err := s.client.WriteMessage(1, data); err != nil {
			return err
		}
	}
}

// accumulateUsage adds upstream-reported usage to the session total and
// records it with the meter (if configured).
func (s *Session) accumulateUsage(u dto.RealtimeUsage) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.usage.TotalTokens += u.TotalTokens
	s.usage.InputTokens += u.InputTokens
	s.usage.OutputTokens += u.OutputTokens

	if s.meter != nil {
		_ = s.meter.Record(context.Background(), &meter.UsageRecord{
			Provider: s.provider,
			Model:    s.model,
			Usage: meter.Usage{
				InputTokens:  u.InputTokens,
				OutputTokens: u.OutputTokens,
				TotalTokens:  u.TotalTokens,
				RequestCount: 1,
				Source:       "realtime",
			},
		})
	}
}

// Config returns the session configuration.
func (s *Session) Config() SessionConfig { return s.cfg }
