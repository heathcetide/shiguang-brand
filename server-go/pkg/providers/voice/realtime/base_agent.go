package realtime

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"
)

// BaseAgent provides the common WebSocket-based realtime agent infrastructure
// that vendor implementations can embed to reduce boilerplate. It handles:
//   - send channel serialization (all outbound frames go through one goroutine)
//   - write loop / read loop lifecycle
//   - Close() idempotency and goroutine draining
//   - closed flag and ErrAgentClosed enforcement
//   - openFired de-duplication for EventSessionOpen
//
// Vendor implementations embed *BaseAgent and override:
//   - Dispatch(raw []byte) — translate vendor wire events into Event
//   - BuildSession() or equivalent — construct the vendor-specific session.update
//
// Vendor implementations call:
//   - b.Init(vendor, opts, sendBuf) — in their constructor
//   - b.SetConn(conn) — after successful WS dial
//   - b.StartLoops(ctx) — to launch write/read goroutines
//   - b.SendJSON(event, nonBlocking) — to queue outbound frames
//   - b.Emit(ev) — to deliver events to the caller
//   - b.IsClosed() — to check the closed flag
type BaseAgent struct {
	vendor string
	opts   Options

	conn *websocket.Conn

	startOnce sync.Once
	closeOnce sync.Once
	closed    atomic.Bool
	openFired atomic.Bool

	sendCh chan []byte
	wg     sync.WaitGroup

	rootCtx    context.Context
	rootCancel context.CancelFunc

	// Dispatch is called by the read loop for each inbound message.
	// Vendor implementations set this field before calling StartLoops.
	Dispatch func(raw []byte)

	// OnWriteError is called when the write loop encounters a WS write error.
	// Defaults to emitting a fatal EventError.
	OnWriteError func(err error)

	// OnReadError is called when the read loop encounters a WS read error.
	// Defaults to emitting a fatal EventError (unless closed).
	OnReadError func(err error)

	// OnSessionClose is called after the read loop exits, before the
	// EventSessionClose is emitted. Optional.
	OnSessionClose func()
}

// NewBaseAgent creates a BaseAgent with the given vendor slug and options.
// sendBuf controls the send channel buffer size.
func NewBaseAgent(vendor string, opts Options, sendBuf int) *BaseAgent {
	if sendBuf <= 0 {
		sendBuf = 64
	}
	return &BaseAgent{
		vendor: vendor,
		opts:   opts,
		sendCh: make(chan []byte, sendBuf),
	}
}

// Vendor returns the vendor slug.
func (b *BaseAgent) Vendor() string { return b.vendor }

// Opts returns the session options.
func (b *BaseAgent) Opts() Options { return b.opts }

// IsClosed returns true if Close has been called.
func (b *BaseAgent) IsClosed() bool { return b.closed.Load() }

// HasFiredOpen returns true if EventSessionOpen has already been emitted.
func (b *BaseAgent) HasFiredOpen() bool { return b.openFired.Load() }

// SetConn sets the underlying WebSocket connection.
func (b *BaseAgent) SetConn(conn *websocket.Conn) { b.conn = conn }

// Conn returns the underlying WebSocket connection.
func (b *BaseAgent) Conn() *websocket.Conn { return b.conn }

// SetRootContext sets the root context and cancel function for the agent.
// This is typically called with context.WithCancel(context.Background())
// after a successful WS dial.
func (b *BaseAgent) SetRootContext(ctx context.Context, cancel context.CancelFunc) {
	b.rootCtx = ctx
	b.rootCancel = cancel
}

// RootContext returns the root context.
func (b *BaseAgent) RootContext() context.Context { return b.rootCtx }

// RootCancel returns the root cancel function.
func (b *BaseAgent) RootCancel() context.CancelFunc { return b.rootCancel }

// MarkStartOnce records that Start has been called. Returns the startOnce
// for vendors that need custom Start logic.
func (b *BaseAgent) MarkStartOnce(fn func()) {
	b.startOnce.Do(fn)
}

// StartLoops launches the write and read goroutines. The vendor must set
// Dispatch before calling this.
func (b *BaseAgent) StartLoops() {
	b.wg.Add(2)
	go b.writeLoop()
	go b.readLoop()
}

// SendJSON queues a JSON event onto the writer goroutine. If nonBlocking is
// true, the frame is dropped silently when the send channel is full (used
// for high-frequency audio frames). Returns ErrAgentClosed if the agent is
// closed.
func (b *BaseAgent) SendJSON(event map[string]any, nonBlocking bool) error {
	if b.closed.Load() {
		return ErrAgentClosed
	}
	buf, err := json.Marshal(event)
	if err != nil {
		return err
	}
	return b.SendRaw(buf, nonBlocking)
}

// SendRaw queues a pre-serialized frame onto the writer goroutine.
func (b *BaseAgent) SendRaw(buf []byte, nonBlocking bool) error {
	if b.closed.Load() {
		return ErrAgentClosed
	}
	if b.rootCtx == nil {
		return ErrAgentClosed
	}
	if nonBlocking {
		select {
		case b.sendCh <- buf:
			return nil
		case <-b.rootCtx.Done():
			return ErrAgentClosed
		default:
			return nil
		}
	}
	select {
	case b.sendCh <- buf:
		return nil
	case <-b.rootCtx.Done():
		return ErrAgentClosed
	}
}

// Emit delivers an event to the caller's OnEvent callback. Events are
// suppressed after Close (except EventSessionClose).
func (b *BaseAgent) Emit(ev Event) {
	if b.opts.OnEvent == nil {
		return
	}
	if b.closed.Load() && ev.Type != EventSessionClose {
		return
	}
	if ev.Vendor == "" {
		ev.Vendor = b.vendor
	}
	b.opts.OnEvent(ev)
}

// FireOnce emits EventSessionOpen exactly once (de-duplication).
func (b *BaseAgent) FireOnce(ev Event) {
	if b.openFired.CompareAndSwap(false, true) {
		if ev.Vendor == "" {
			ev.Vendor = b.vendor
		}
		b.opts.OnEvent(ev)
	}
}

// Close tears down the agent. Idempotent.
func (b *BaseAgent) Close() error {
	b.closeOnce.Do(func() {
		b.closed.Store(true)
		if b.rootCancel != nil {
			b.rootCancel()
		}
		if b.conn != nil {
			_ = b.conn.WriteControl(websocket.CloseMessage,
				websocket.FormatCloseMessage(websocket.CloseNormalClosure, "client close"),
				time.Now().Add(200*time.Millisecond))
			_ = b.conn.Close()
		}
		b.wg.Wait()
	})
	return nil
}

// CloseWithTeardown allows vendor-specific teardown frames before closing.
// The teardown function is called with the conn still open; it should send
// any vendor-specific finish/disconnect frames. It must not block.
func (b *BaseAgent) CloseWithTeardown(teardown func(conn *websocket.Conn)) error {
	b.closeOnce.Do(func() {
		b.closed.Store(true)
		if b.rootCancel != nil {
			b.rootCancel()
		}
		if b.conn != nil {
			if teardown != nil {
				teardown(b.conn)
			}
			_ = b.conn.WriteControl(websocket.CloseMessage,
				websocket.FormatCloseMessage(websocket.CloseNormalClosure, "client close"),
				time.Now().Add(200*time.Millisecond))
			_ = b.conn.Close()
		}
		b.wg.Wait()
	})
	return nil
}

// writeLoop serializes all outbound WS writes.
func (b *BaseAgent) writeLoop() {
	defer b.wg.Done()
	for {
		select {
		case <-b.rootCtx.Done():
			return
		case buf, ok := <-b.sendCh:
			if !ok {
				return
			}
			if b.conn == nil {
				continue
			}
			if err := b.conn.WriteMessage(websocket.TextMessage, buf); err != nil {
				if b.OnWriteError != nil {
					b.OnWriteError(err)
				} else {
					b.Emit(Event{
						Type:   EventError,
						Vendor: b.vendor,
						Err:    fmt.Errorf("%s: write: %w", b.vendor, err),
						Fatal:  true,
					})
				}
				return
			}
		}
	}
}

// readLoop reads inbound WS messages and dispatches them.
func (b *BaseAgent) readLoop() {
	defer b.wg.Done()
	defer b.Emit(Event{Type: EventSessionClose, Vendor: b.vendor})
	if b.OnSessionClose != nil {
		defer b.OnSessionClose()
	}
	for {
		_, raw, err := b.conn.ReadMessage()
		if err != nil {
			if b.closed.Load() {
				return
			}
			if websocket.IsCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway) {
				return
			}
			if b.OnReadError != nil {
				b.OnReadError(err)
			} else {
				b.Emit(Event{
					Type:   EventError,
					Vendor: b.vendor,
					Err:    fmt.Errorf("%s: read: %w", b.vendor, err),
					Fatal:  true,
				})
			}
			return
		}
		if b.Dispatch != nil {
			b.Dispatch(raw)
		}
	}
}
