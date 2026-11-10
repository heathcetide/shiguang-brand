// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package wsutil provides WebSocket utilities built on top of
// github.com/gorilla/websocket.
//
// It offers a connection wrapper with timeouts and ping/pong handling, an
// HTTP upgrader, a client dialer, and a Hub for broadcasting messages to
// many connected clients.
//
// # Quick start
//
//	// Server side
//	upgrader := wsutil.NewUpgrader(wsutil.DefaultConfig())
//	conn, err := upgrader.Upgrade(w, r)
//	if err != nil { ... }
//	defer conn.Close()
//
//	// Client side
//	conn, err := wsutil.Dial(ctx, "ws://localhost:8080/ws", wsutil.DefaultConfig())
//	if err != nil { ... }
//	defer conn.Close()
//	_ = conn.WriteText("hello")
package wsutil

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// MessageType identifies the type of a WebSocket message.
type MessageType int

const (
	// TextMessage is a UTF-8 text payload.
	TextMessage MessageType = MessageType(websocket.TextMessage)
	// BinaryMessage is a binary payload.
	BinaryMessage MessageType = MessageType(websocket.BinaryMessage)
)

// Config holds tuning parameters for a WebSocket connection.
type Config struct {
	// PingInterval is the interval between automatic ping frames.
	PingInterval time.Duration
	// PongTimeout is how long to wait for a pong before closing.
	PongTimeout time.Duration
	// WriteTimeout is the deadline for write operations.
	WriteTimeout time.Duration
	// ReadTimeout is the deadline for read operations (0 = no deadline).
	ReadTimeout time.Duration
	// MaxMessageSize is the maximum allowed message size in bytes.
	MaxMessageSize int64
}

// DefaultConfig returns a sensible default configuration.
func DefaultConfig() Config {
	return Config{
		PingInterval:   30 * time.Second,
		PongTimeout:    70 * time.Second,
		WriteTimeout:   10 * time.Second,
		ReadTimeout:    0,
		MaxMessageSize: 1 << 20, // 1 MiB
	}
}

// Conn wraps a gorilla/websocket connection with timeouts and helpers.
type Conn struct {
	ws     *websocket.Conn
	config Config
	mu     sync.Mutex
}

// Upgrader upgrades HTTP requests to WebSocket connections.
type Upgrader struct {
	config   Config
	upgrader *websocket.Upgrader
}

// NewUpgrader creates a new Upgrader with the given configuration.
func NewUpgrader(config Config) *Upgrader {
	return &Upgrader{
		config: config,
		upgrader: &websocket.Upgrader{
			ReadBufferSize:  4096,
			WriteBufferSize: 4096,
			CheckOrigin:     func(r *http.Request) bool { return true },
		},
	}
}

// Upgrade upgrades an HTTP request to a WebSocket connection.
func (u *Upgrader) Upgrade(w http.ResponseWriter, r *http.Request) (*Conn, error) {
	ws, err := u.upgrader.Upgrade(w, r, nil)
	if err != nil {
		return nil, fmt.Errorf("wsutil: upgrade failed: %w", err)
	}
	return newConn(ws, u.config), nil
}

// Dial connects to the given WebSocket URL as a client.
func Dial(ctx context.Context, url string, config Config) (*Conn, error) {
	dialer := websocket.Dialer{
		HandshakeTimeout: 45 * time.Second,
	}
	ws, _, err := dialer.DialContext(ctx, url, nil)
	if err != nil {
		return nil, fmt.Errorf("wsutil: dial failed: %w", err)
	}
	return newConn(ws, config), nil
}

// newConn wraps a raw websocket.Conn applying the given config.
func newConn(ws *websocket.Conn, config Config) *Conn {
	c := &Conn{ws: ws, config: config}
	if config.MaxMessageSize > 0 {
		ws.SetReadLimit(config.MaxMessageSize)
	}
	if config.ReadTimeout > 0 {
		_ = ws.SetReadDeadline(time.Now().Add(config.ReadTimeout))
	}
	return c
}

// setWriteDeadline applies the configured write timeout.
func (c *Conn) setWriteDeadline() {
	if c.config.WriteTimeout > 0 {
		_ = c.ws.SetWriteDeadline(time.Now().Add(c.config.WriteTimeout))
	} else {
		_ = c.ws.SetWriteDeadline(time.Time{})
	}
}

// WriteText writes a text message.
func (c *Conn) WriteText(msg string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.setWriteDeadline()
	return c.ws.WriteMessage(websocket.TextMessage, []byte(msg))
}

// WriteBinary writes a binary message.
func (c *Conn) WriteBinary(msg []byte) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.setWriteDeadline()
	return c.ws.WriteMessage(websocket.BinaryMessage, msg)
}

// WriteJSON writes a JSON-encoded message.
func (c *Conn) WriteJSON(v any) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.setWriteDeadline()
	return c.ws.WriteJSON(v)
}

// Read reads a single message returning its type and payload.
func (c *Conn) Read() (MessageType, []byte, error) {
	mt, data, err := c.ws.ReadMessage()
	if err != nil {
		return 0, nil, err
	}
	if c.config.ReadTimeout > 0 {
		_ = c.ws.SetReadDeadline(time.Now().Add(c.config.ReadTimeout))
	}
	return MessageType(mt), data, nil
}

// ReadText reads a single text message.
func (c *Conn) ReadText() (string, error) {
	mt, data, err := c.Read()
	if err != nil {
		return "", err
	}
	if mt != TextMessage {
		return "", fmt.Errorf("wsutil: expected text message, got %d", mt)
	}
	return string(data), nil
}

// ReadJSON reads a single message and decodes it as JSON.
func (c *Conn) ReadJSON(v any) error {
	_, r, err := c.ws.NextReader()
	if err != nil {
		return err
	}
	if c.config.ReadTimeout > 0 {
		_ = c.ws.SetReadDeadline(time.Now().Add(c.config.ReadTimeout))
	}
	return json.NewDecoder(r).Decode(v)
}

// Close closes the underlying connection.
func (c *Conn) Close() error {
	return c.ws.Close()
}

// SetReadDeadline sets the read deadline for the connection.
func (c *Conn) SetReadDeadline(t time.Time) error {
	return c.ws.SetReadDeadline(t)
}

// SetWriteDeadline sets the write deadline for the connection.
func (c *Conn) SetWriteDeadline(t time.Time) error {
	return c.ws.SetWriteDeadline(t)
}

// SetPingHandler sets the handler for ping messages.
func (c *Conn) SetPingHandler(handler func(appData string) error) {
	c.ws.SetPingHandler(handler)
}

// SetPongHandler sets the handler for pong messages.
func (c *Conn) SetPongHandler(handler func(appData string) error) {
	c.ws.SetPongHandler(handler)
}

// StartPing launches a goroutine that periodically sends ping frames. It
// returns a cancel function that stops the pinger.
func (c *Conn) StartPing() context.CancelFunc {
	ctx, cancel := context.WithCancel(context.Background())
	interval := c.config.PingInterval
	if interval <= 0 {
		interval = 30 * time.Second
	}
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				c.mu.Lock()
				c.setWriteDeadline()
				err := c.ws.WriteMessage(websocket.PingMessage, nil)
				c.mu.Unlock()
				if err != nil {
					return
				}
			}
		}
	}()
	return cancel
}

// Hub manages a set of WebSocket connections and supports broadcasting.
type Hub struct {
	mu    sync.RWMutex
	conns map[*Conn]struct{}
}

// NewHub creates a new Hub.
func NewHub() *Hub {
	return &Hub{conns: make(map[*Conn]struct{})}
}

// Register adds a connection to the hub.
func (h *Hub) Register(conn *Conn) {
	h.mu.Lock()
	h.conns[conn] = struct{}{}
	h.mu.Unlock()
}

// Unregister removes a connection from the hub.
func (h *Hub) Unregister(conn *Conn) {
	h.mu.Lock()
	delete(h.conns, conn)
	h.mu.Unlock()
}

// Broadcast sends a binary message to all registered connections.
func (h *Hub) Broadcast(msg []byte) {
	h.mu.RLock()
	conns := make([]*Conn, 0, len(h.conns))
	for c := range h.conns {
		conns = append(conns, c)
	}
	h.mu.RUnlock()
	for _, c := range conns {
		_ = c.WriteBinary(msg)
	}
}

// BroadcastText sends a text message to all registered connections.
func (h *Hub) BroadcastText(msg string) {
	h.mu.RLock()
	conns := make([]*Conn, 0, len(h.conns))
	for c := range h.conns {
		conns = append(conns, c)
	}
	h.mu.RUnlock()
	for _, c := range conns {
		_ = c.WriteText(msg)
	}
}

// Close closes all registered connections and clears the hub.
func (h *Hub) Close() {
	h.mu.Lock()
	defer h.mu.Unlock()
	for c := range h.conns {
		_ = c.Close()
		delete(h.conns, c)
	}
}
