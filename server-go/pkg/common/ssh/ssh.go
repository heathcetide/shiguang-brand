// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package ssh provides a WebSSH bridge that connects a WebSocket client
// to a remote SSH session, enabling web-based terminal access.
//
// It is built on top of [golang.org/x/crypto/ssh] and integrates with
// [github.com/LingByte/ling-base/common/wsutil] for WebSocket transport.
//
// # Quick start (server side)
//
//	terminal := ssh.NewTerminal(ssh.Config{
//	    Host:     "remote-host:22",
//	    User:     "root",
//	    Password: "secret",
//	    Cols:     80,
//	    Rows:     24,
//	})
//	terminal.Run(wsConn)
//
// # Message protocol
//
// The WebSocket client sends JSON messages:
//
//	{"type":"cmd","cmd":"ls -la\n"}      // send command to SSH
//	{"type":"resize","cols":120,"rows":40} // resize terminal
//
// SSH output is sent back as text messages.
package ssh

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"sync"
	"time"

	"golang.org/x/crypto/ssh"
)

// ──────────────────────────────────────────────
// Errors
// ──────────────────────────────────────────────

var (
	// ErrNotConnected is returned when an operation is attempted on a
	// terminal that has not been connected yet.
	ErrNotConnected = fmt.Errorf("ssh: not connected")
	// ErrAlreadyRunning is returned when Run is called on an already-running terminal.
	ErrAlreadyRunning = fmt.Errorf("ssh: terminal already running")
)

// ──────────────────────────────────────────────
// Config
// ──────────────────────────────────────────────

// Config holds the SSH connection and terminal configuration.
type Config struct {
	// Host is the SSH server address (e.g. "host:22").
	Host string

	// User is the SSH username.
	User string

	// Password is the SSH password (for password auth).
	// Leave empty to use PrivateKey.
	Password string

	// PrivateKey is a PEM-encoded private key (for key auth).
	// Leave empty to use Password.
	PrivateKey []byte

	// PrivateKeyPath is a path to a private key file.
	// Used only if PrivateKey is empty and Password is empty.
	PrivateKeyPath string

	// Cols is the initial terminal width (default 80).
	Cols int

	// Rows is the initial terminal height (default 24).
	Rows int

	// TermType is the terminal type (default "xterm").
	TermType string

	// ConnectTimeout is the SSH connection timeout (default 10s).
	ConnectTimeout time.Duration

	// OutputInterval is how often SSH output is flushed to the WebSocket
	// (default 120ms).
	OutputInterval time.Duration

	// HostKeyCallback controls host key verification.
	// Default: ssh.InsecureIgnoreHostKey (use a proper callback in production).
	HostKeyCallback ssh.HostKeyCallback
}

// ──────────────────────────────────────────────
// WebSocket message protocol
// ──────────────────────────────────────────────

// ClientMessage is a message sent from the WebSocket client to the server.
type ClientMessage struct {
	Type string `json:"type"` // "cmd" or "resize"
	Cmd  string `json:"cmd"`  // command text (for type="cmd")
	Cols int    `json:"cols"` // new width (for type="resize")
	Rows int    `json:"rows"` // new height (for type="resize")
}

const (
	MsgTypeCmd    = "cmd"
	MsgTypeResize = "resize"
)

// ──────────────────────────────────────────────
// WebSocketConn — the interface satisfied by wsutil.Conn
// ──────────────────────────────────────────────

// WebSocketConn is the interface for a WebSocket connection used by the
// terminal. It is satisfied by *wsutil.Conn and can be implemented by
// any WebSocket wrapper.
type WebSocketConn interface {
	ReadMessage() (int, []byte, error)
	WriteMessage(messageType int, data []byte) error
	Close() error
}

// WebSocket text/binary message type constants.
const (
	WSTextMessage   = 1
	WSBinaryMessage = 2
	WSCloseMessage  = 8
)

// ──────────────────────────────────────────────
// bufferWriter — captures SSH stdout+stderr
// ──────────────────────────────────────────────

type bufferWriter struct {
	mu     sync.Mutex
	buffer bytes.Buffer
}

func (w *bufferWriter) Write(p []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.buffer.Write(p)
}

func (w *bufferWriter) Flush() []byte {
	w.mu.Lock()
	defer w.mu.Unlock()
	data := w.buffer.Bytes()
	// Copy to avoid holding the buffer during Write.
	out := make([]byte, len(data))
	copy(out, data)
	w.buffer.Reset()
	return out
}

func (w *bufferWriter) Len() int {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.buffer.Len()
}

// ──────────────────────────────────────────────
// Terminal
// ──────────────────────────────────────────────

// Terminal bridges a WebSocket connection to a remote SSH session.
// The zero value is NOT ready to use; call [NewTerminal].
type Terminal struct {
	cfg     Config
	ws      WebSocketConn
	client  *ssh.Client
	session *ssh.Session
	stdin   io.WriteCloser
	output  *bufferWriter
	cancel  context.CancelFunc
	done    chan struct{}
	running bool
	mu      sync.Mutex
}

// NewTerminal creates a new Terminal with the given configuration.
// The WebSocket connection is set later via [Terminal.Run].
func NewTerminal(cfg Config) *Terminal {
	if cfg.Cols <= 0 {
		cfg.Cols = 80
	}
	if cfg.Rows <= 0 {
		cfg.Rows = 24
	}
	if cfg.TermType == "" {
		cfg.TermType = "xterm"
	}
	if cfg.ConnectTimeout <= 0 {
		cfg.ConnectTimeout = 10 * time.Second
	}
	if cfg.OutputInterval <= 0 {
		cfg.OutputInterval = 120 * time.Millisecond
	}
	if cfg.HostKeyCallback == nil {
		cfg.HostKeyCallback = ssh.InsecureIgnoreHostKey()
	}
	return &Terminal{cfg: cfg, done: make(chan struct{})}
}

// Run connects to the SSH server and bridges the WebSocket to the SSH session.
// It blocks until the session ends or the WebSocket is closed.
func (t *Terminal) Run(ws WebSocketConn) error {
	t.mu.Lock()
	if t.running {
		t.mu.Unlock()
		return ErrAlreadyRunning
	}
	t.running = true
	t.ws = ws
	t.mu.Unlock()

	defer func() {
		t.mu.Lock()
		t.running = false
		t.mu.Unlock()
		close(t.done)
	}()

	// Connect to SSH server.
	client, err := t.connect()
	if err != nil {
		t.sendError(err)
		return err
	}
	t.client = client
	defer client.Close()

	// Create session.
	session, stdin, output, err := t.createSession()
	if err != nil {
		t.sendError(err)
		return err
	}
	t.session = session
	t.stdin = stdin
	t.output = output
	defer session.Close()

	ctx, cancel := context.WithCancel(context.Background())
	t.cancel = cancel
	defer cancel()

	// Start goroutines.
	go t.readFromWebSocket(ctx)
	go t.sendOutput(ctx)

	// Wait for session to end.
	_ = session.Wait()
	return nil
}

// Close terminates the terminal session.
func (t *Terminal) Close() error {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.cancel != nil {
		t.cancel()
	}
	if t.session != nil {
		_ = t.session.Close()
	}
	if t.client != nil {
		_ = t.client.Close()
	}
	if t.ws != nil {
		_ = t.ws.Close()
	}
	return nil
}

// Done returns a channel that is closed when the terminal session ends.
func (t *Terminal) Done() <-chan struct{} {
	return t.done
}

// ──────────────────────────────────────────────
// SSH connection
// ──────────────────────────────────────────────

func (t *Terminal) connect() (*ssh.Client, error) {
	authMethods, err := t.authMethods()
	if err != nil {
		return nil, err
	}

	config := &ssh.ClientConfig{
		Timeout:         t.cfg.ConnectTimeout,
		User:            t.cfg.User,
		HostKeyCallback: t.cfg.HostKeyCallback,
		Auth:            authMethods,
	}

	return ssh.Dial("tcp", t.cfg.Host, config)
}

func (t *Terminal) authMethods() ([]ssh.AuthMethod, error) {
	if t.cfg.Password != "" {
		return []ssh.AuthMethod{ssh.Password(t.cfg.Password)}, nil
	}

	if len(t.cfg.PrivateKey) > 0 {
		signer, err := ssh.ParsePrivateKey(t.cfg.PrivateKey)
		if err != nil {
			return nil, fmt.Errorf("ssh: parse private key: %w", err)
		}
		return []ssh.AuthMethod{ssh.PublicKeys(signer)}, nil
	}

	if t.cfg.PrivateKeyPath != "" {
		// Read file and parse. We use os.ReadFile but avoid importing os
		// at the package level to keep the dependency minimal. Instead,
		// we return an error suggesting to pass the key bytes directly.
		return nil, fmt.Errorf("ssh: PrivateKeyPath not supported, pass PrivateKey bytes instead")
	}

	return nil, fmt.Errorf("ssh: no authentication method configured (need Password or PrivateKey)")
}

// ──────────────────────────────────────────────
// Session creation
// ──────────────────────────────────────────────

func (t *Terminal) createSession() (*ssh.Session, io.WriteCloser, *bufferWriter, error) {
	session, err := t.client.NewSession()
	if err != nil {
		return nil, nil, nil, fmt.Errorf("ssh: new session: %w", err)
	}

	stdin, err := session.StdinPipe()
	if err != nil {
		session.Close()
		return nil, nil, nil, fmt.Errorf("ssh: stdin pipe: %w", err)
	}

	output := &bufferWriter{}
	session.Stdout = output
	session.Stderr = output

	modes := ssh.TerminalModes{
		ssh.ECHO:          1,
		ssh.TTY_OP_ISPEED: 14400,
		ssh.TTY_OP_OSPEED: 14400,
	}

	if err := session.RequestPty(t.cfg.TermType, t.cfg.Rows, t.cfg.Cols, modes); err != nil {
		session.Close()
		return nil, nil, nil, fmt.Errorf("ssh: request pty: %w", err)
	}

	if err := session.Shell(); err != nil {
		session.Close()
		return nil, nil, nil, fmt.Errorf("ssh: start shell: %w", err)
	}

	return session, stdin, output, nil
}

// ──────────────────────────────────────────────
// WebSocket → SSH
// ──────────────────────────────────────────────

func (t *Terminal) readFromWebSocket(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		_, data, err := t.ws.ReadMessage()
		if err != nil {
			return
		}

		var msg ClientMessage
		if err := json.Unmarshal(data, &msg); err != nil {
			continue
		}

		switch msg.Type {
		case MsgTypeCmd:
			if _, err := t.stdin.Write([]byte(msg.Cmd)); err != nil {
				return
			}
		case MsgTypeResize:
			if msg.Cols > 0 && msg.Rows > 0 {
				_ = t.session.WindowChange(msg.Rows, msg.Cols)
			}
		}
	}
}

// ──────────────────────────────────────────────
// SSH → WebSocket
// ──────────────────────────────────────────────

func (t *Terminal) sendOutput(ctx context.Context) {
	ticker := time.NewTicker(t.cfg.OutputInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if t.output.Len() > 0 {
				data := t.output.Flush()
				if err := t.ws.WriteMessage(WSTextMessage, data); err != nil {
					return
				}
			}
		}
	}
}

// sendError sends an error message to the WebSocket client.
func (t *Terminal) sendError(err error) {
	if t.ws != nil {
		_ = t.ws.WriteMessage(WSTextMessage, []byte(fmt.Sprintf("\r\n[ssh error] %s\r\n", err)))
	}
}

// ──────────────────────────────────────────────
// DialClient — create an SSH client without a terminal
// ──────────────────────────────────────────────

// DialClient creates an SSH client using the given config. The caller
// is responsible for closing the client. This is useful for non-terminal
// SSH operations (e.g. running commands, port forwarding).
func DialClient(cfg Config) (*ssh.Client, error) {
	t := NewTerminal(cfg)
	return t.connect()
}

// RunCommand executes a command on a remote SSH server and returns
// the combined output. This is a convenience function for one-off
// command execution without a terminal.
func RunCommand(cfg Config, command string) (string, error) {
	client, err := DialClient(cfg)
	if err != nil {
		return "", err
	}
	defer client.Close()

	session, err := client.NewSession()
	if err != nil {
		return "", fmt.Errorf("ssh: new session: %w", err)
	}
	defer session.Close()

	output, err := session.CombinedOutput(command)
	if err != nil {
		return string(output), fmt.Errorf("ssh: run command: %w", err)
	}
	return string(output), nil
}
