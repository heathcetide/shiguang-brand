// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package wsutil

import (
	"context"
	"sync"
	"time"
)

// ──────────────────────────────────────────────
// ConnInfo — per-connection metadata
// ──────────────────────────────────────────────

// ConnInfo holds metadata for a registered connection in an EnhancedHub.
type ConnInfo struct {
	// Conn is the underlying WebSocket connection.
	Conn *Conn

	// ID is a unique identifier for the connection (auto-assigned if empty).
	ID string

	// UserID is an optional authenticated user identifier.
	UserID string

	// Name is an optional human-readable name (e.g. node name).
	Name string

	// RemoteAddr is the remote network address.
	RemoteAddr string

	// LoginTime is when the connection was authenticated (zero if not).
	LoginTime time.Time

	// IsLogin indicates whether the connection has been authenticated.
	IsLogin bool

	// Metadata is arbitrary user-provided metadata.
	Metadata map[string]any

	// msgSize tracks total bytes received on this connection.
	msgSize int64
}

// MsgSize returns the total bytes received on this connection.
func (c *ConnInfo) MsgSize() int64 {
	return c.msgSize
}

// ──────────────────────────────────────────────
// EnhancedHub — connection registry with metadata & callbacks
// ──────────────────────────────────────────────

// EnhancedHub is a connection registry that tracks per-connection
// metadata, enforces a max connection limit, and invokes callbacks
// on register, login, and close events. It is safe for concurrent use.
//
// For simple broadcast-only scenarios, use [Hub] instead.
type EnhancedHub struct {
	mu          sync.RWMutex
	conns       map[*Conn]*ConnInfo
	maxConnSize int64
	idCounter   int64

	// Callbacks (all optional).
	onRegister   func(conn *Conn, info *ConnInfo)
	onLogin      func(conn *Conn, info *ConnInfo) error
	onClose      func(conn *Conn, info *ConnInfo, reason error)
	onConnect    func(conn *Conn, info *ConnInfo)
	onDisconnect func(conn *Conn, info *ConnInfo)
}

// EnhancedHubOption configures an EnhancedHub.
type EnhancedHubOption func(*EnhancedHub)

// WithMaxConnections sets the maximum number of concurrent connections.
// 0 means unlimited.
func WithMaxConnections(n int64) EnhancedHubOption {
	return func(h *EnhancedHub) { h.maxConnSize = n }
}

// WithOnRegister sets a callback invoked when a connection is registered.
func WithOnRegister(f func(conn *Conn, info *ConnInfo)) EnhancedHubOption {
	return func(h *EnhancedHub) { h.onRegister = f }
}

// WithOnLogin sets a callback invoked when a connection is marked as
// logged in. Returning an error aborts the login.
func WithOnLogin(f func(conn *Conn, info *ConnInfo) error) EnhancedHubOption {
	return func(h *EnhancedHub) { h.onLogin = f }
}

// WithOnClose sets a callback invoked when a connection is closed.
func WithOnClose(f func(conn *Conn, info *ConnInfo, reason error)) EnhancedHubOption {
	return func(h *EnhancedHub) { h.onClose = f }
}

// WithOnConnect sets a callback invoked when a connection is registered.
// Alias for WithOnRegister for clarity.
func WithOnConnect(f func(conn *Conn, info *ConnInfo)) EnhancedHubOption {
	return func(h *EnhancedHub) { h.onConnect = f }
}

// WithOnDisconnect sets a callback invoked when a connection is removed.
func WithOnDisconnect(f func(conn *Conn, info *ConnInfo)) EnhancedHubOption {
	return func(h *EnhancedHub) { h.onDisconnect = f }
}

// NewEnhancedHub creates a new EnhancedHub with the given options.
func NewEnhancedHub(opts ...EnhancedHubOption) *EnhancedHub {
	h := &EnhancedHub{
		conns: make(map[*Conn]*ConnInfo),
	}
	for _, opt := range opts {
		if opt != nil {
			opt(h)
		}
	}
	return h
}

// Register adds a connection to the hub with optional initial metadata.
// Returns the ConnInfo and an error if the max connection limit is reached.
func (h *EnhancedHub) Register(conn *Conn, info *ConnInfo) (*ConnInfo, error) {
	h.mu.Lock()
	defer h.mu.Unlock()

	if h.maxConnSize > 0 && int64(len(h.conns)) >= h.maxConnSize {
		return nil, ErrMaxConnections
	}

	if info == nil {
		info = &ConnInfo{}
	}
	info.Conn = conn
	if info.ID == "" {
		h.idCounter++
		info.ID = formatConnID(h.idCounter)
	}

	h.conns[conn] = info

	// Invoke callbacks outside the lock would be ideal, but for simplicity
	// we call them while holding the lock. Callbacks should be fast.
	if h.onRegister != nil {
		h.onRegister(conn, info)
	}
	if h.onConnect != nil {
		h.onConnect(conn, info)
	}

	return info, nil
}

// Login marks a connection as authenticated and invokes the onLogin callback.
func (h *EnhancedHub) Login(conn *Conn, userID, name string) error {
	h.mu.Lock()
	defer h.mu.Unlock()

	info, ok := h.conns[conn]
	if !ok {
		return ErrNotRegistered
	}

	info.UserID = userID
	info.Name = name
	info.IsLogin = true
	info.LoginTime = time.Now()

	if h.onLogin != nil {
		if err := h.onLogin(conn, info); err != nil {
			info.IsLogin = false
			return err
		}
	}
	return nil
}

// Unregister removes a connection from the hub and invokes the onClose callback.
func (h *EnhancedHub) Unregister(conn *Conn, reason error) {
	h.mu.Lock()
	info, ok := h.conns[conn]
	if ok {
		delete(h.conns, conn)
	}
	h.mu.Unlock()

	if ok {
		if h.onClose != nil {
			h.onClose(conn, info, reason)
		}
		if h.onDisconnect != nil {
			h.onDisconnect(conn, info)
		}
	}
}

// Get returns the ConnInfo for a connection, or nil if not registered.
func (h *EnhancedHub) Get(conn *Conn) *ConnInfo {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return h.conns[conn]
}

// Count returns the number of registered connections.
func (h *EnhancedHub) Count() int64 {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return int64(len(h.conns))
}

// Conns returns a snapshot of all registered connections.
func (h *EnhancedHub) Conns() map[*Conn]*ConnInfo {
	h.mu.RLock()
	defer h.mu.RUnlock()
	snap := make(map[*Conn]*ConnInfo, len(h.conns))
	for k, v := range h.conns {
		snap[k] = v
	}
	return snap
}

// Infos returns a snapshot of all ConnInfo entries.
func (h *EnhancedHub) Infos() []*ConnInfo {
	h.mu.RLock()
	defer h.mu.RUnlock()
	infos := make([]*ConnInfo, 0, len(h.conns))
	for _, info := range h.conns {
		infos = append(infos, info)
	}
	return infos
}

// Broadcast sends a binary message to all registered connections.
func (h *EnhancedHub) Broadcast(msg []byte) {
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
func (h *EnhancedHub) BroadcastText(msg string) {
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

// BroadcastFiltered sends a binary message to connections matching the filter.
func (h *EnhancedHub) BroadcastFiltered(msg []byte, filter func(info *ConnInfo) bool) {
	h.mu.RLock()
	type pair struct {
		conn *Conn
		info *ConnInfo
	}
	var targets []pair
	for c, info := range h.conns {
		if filter == nil || filter(info) {
			targets = append(targets, pair{c, info})
		}
	}
	h.mu.RUnlock()
	for _, t := range targets {
		_ = t.conn.WriteBinary(msg)
	}
}

// BroadcastTextFiltered sends a text message to connections matching the filter.
func (h *EnhancedHub) BroadcastTextFiltered(msg string, filter func(info *ConnInfo) bool) {
	h.mu.RLock()
	type pair struct {
		conn *Conn
		info *ConnInfo
	}
	var targets []pair
	for c, info := range h.conns {
		if filter == nil || filter(info) {
			targets = append(targets, pair{c, info})
		}
	}
	h.mu.RUnlock()
	for _, t := range targets {
		_ = t.conn.WriteText(msg)
	}
}

// SendTo sends a binary message to a specific connection by ID.
func (h *EnhancedHub) SendTo(id string, msg []byte) error {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for c, info := range h.conns {
		if info.ID == id {
			return c.WriteBinary(msg)
		}
	}
	return ErrNotRegistered
}

// SendTextTo sends a text message to a specific connection by ID.
func (h *EnhancedHub) SendTextTo(id string, msg string) error {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for c, info := range h.conns {
		if info.ID == id {
			return c.WriteText(msg)
		}
	}
	return ErrNotRegistered
}

// Close closes all registered connections and clears the hub.
func (h *EnhancedHub) Close() {
	h.mu.Lock()
	defer h.mu.Unlock()
	for c := range h.conns {
		_ = c.Close()
		delete(h.conns, c)
	}
}

// UpdateMetadata updates the metadata for a connection.
func (h *EnhancedHub) UpdateMetadata(conn *Conn, key string, value any) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if info, ok := h.conns[conn]; ok {
		if info.Metadata == nil {
			info.Metadata = make(map[string]any)
		}
		info.Metadata[key] = value
	}
}

// AddMsgSize adds to the message size counter for a connection.
func (h *EnhancedHub) AddMsgSize(conn *Conn, n int64) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if info, ok := h.conns[conn]; ok {
		info.msgSize += n
	}
}

// ──────────────────────────────────────────────
// Errors
// ──────────────────────────────────────────────

// ErrMaxConnections is returned when the hub has reached its max connection limit.
var ErrMaxConnections = wsError("wsutil: max connections reached")

// ErrNotRegistered is returned when a connection is not registered in the hub.
var ErrNotRegistered = wsError("wsutil: connection not registered")

type wsError string

func (e wsError) Error() string { return string(e) }

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

// formatConnID generates a connection ID from a counter.
func formatConnID(n int64) string {
	return formatID(n)
}

// formatID formats a numeric ID as a zero-padded string.
func formatID(n int64) string {
	if n < 10 {
		return "conn-00" + itoa(int(n))
	}
	if n < 100 {
		return "conn-0" + itoa(int(n))
	}
	return "conn-" + itoa(int(n))
}

// itoa is a small int-to-string helper to avoid strconv import.
func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var buf [20]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}

// ──────────────────────────────────────────────
// Context-aware read loop helper
// ──────────────────────────────────────────────

// ReadLoop reads messages from a connection in a loop, calling handler
// for each message. It returns when the connection is closed or ctx is cancelled.
// The hub's AddMsgSize is called for each message.
func (h *EnhancedHub) ReadLoop(ctx context.Context, conn *Conn, handler func(info *ConnInfo, msgType MessageType, data []byte)) {
	info := h.Get(conn)
	if info == nil {
		return
	}

	done := ctx.Done()
	for {
		select {
		case <-done:
			return
		default:
		}

		mt, data, err := conn.Read()
		if err != nil {
			h.Unregister(conn, err)
			return
		}

		h.AddMsgSize(conn, int64(len(data)))
		if handler != nil {
			handler(info, mt, data)
		}
	}
}
