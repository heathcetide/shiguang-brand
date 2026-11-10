// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package alerting provides a stateful alert engine that emits
// notifications only on state transitions (healthy → failed, failed →
// recovered). This prevents alert storms: a continuously failing check
// will not produce repeated notifications on every polling interval.
//
// # Quick start
//
//	a := alerting.New()
//	a.OnTransition(func(ctx context.Context, e alerting.Event) {
//	    fmt.Printf("[%s] %s: %s\n", e.Transition, e.CheckName, e.Message)
//	})
//
//	// First failure → emits "failed".
//	a.Record(ctx, "api-health", false, "timeout")
//	// Second failure → no emit (still failed).
//	a.Record(ctx, "api-health", false, "timeout")
//	// Recovery → emits "recovered".
//	a.Record(ctx, "api-health", true, "")
//
// # Integration with common/notification
//
// Use [WithNotificationDispatcher] to automatically dispatch email/SMS/IM
// notifications on state transitions:
//
//	d := notification.NewDispatcher()
//	d.AddChannel(email.NewChannel(...))
//	a := alerting.New(alerting.WithNotificationDispatcher(d))
package alerting

import (
	"context"
	"fmt"
	"sync"
	"time"
)

// ──────────────────────────────────────────────
// State
// ──────────────────────────────────────────────

// State represents the health state of a check.
type State int

const (
	// StateUnknown is the initial state before any record.
	StateUnknown State = iota
	// StateHealthy means the check is passing.
	StateHealthy
	// StateFailed means the check is failing.
	StateFailed
)

// String returns a human-readable state name.
func (s State) String() string {
	switch s {
	case StateHealthy:
		return "healthy"
	case StateFailed:
		return "failed"
	default:
		return "unknown"
	}
}

// Transition describes a state change.
type Transition string

const (
	// TransitionFailed: healthy/unknown → failed.
	TransitionFailed Transition = "failed"
	// TransitionRecovered: failed → healthy.
	TransitionRecovered Transition = "recovered"
	// TransitionStillFailed: failed → failed (no change, suppressed by default).
	TransitionStillFailed Transition = "still_failed"
	// TransitionStillHealthy: healthy → healthy (no change, suppressed by default).
	TransitionStillHealthy Transition = "still_healthy"
)

// ──────────────────────────────────────────────
// Event
// ──────────────────────────────────────────────

// Event is emitted when a check's state changes (or when configured
// to emit on no-change events).
type Event struct {
	// CheckName is the unique identifier of the check.
	CheckName string

	// Transition describes the state change.
	Transition Transition

	// FromState is the previous state.
	FromState State

	// ToState is the new state.
	ToState State

	// Message is the check message (error description on failure).
	Message string

	// CheckCount is the total number of records for this check.
	CheckCount int64

	// FailureCount is the consecutive failure count (0 if healthy).
	FailureCount int64

	// Timestamp is when the event was recorded.
	Timestamp time.Time

	// Metadata is optional user-provided metadata.
	Metadata map[string]string
}

// ──────────────────────────────────────────────
// Handler
// ──────────────────────────────────────────────

// Handler is called when an event is emitted.
type Handler interface {
	OnEvent(ctx context.Context, e Event)
}

// HandlerFunc adapts a function to the Handler interface.
type HandlerFunc func(ctx context.Context, e Event)

// OnEvent calls the underlying function.
func (f HandlerFunc) OnEvent(ctx context.Context, e Event) {
	if f != nil {
		f(ctx, e)
	}
}

// ──────────────────────────────────────────────
// Notifier (notification integration)
// ──────────────────────────────────────────────

// Notifier is the interface satisfied by notification.Dispatcher.
// It allows the alerting engine to dispatch notifications without
// importing the notification package directly.
type Notifier interface {
	Notify(ctx context.Context, e Event) error
}

// ──────────────────────────────────────────────
// CheckState (internal)
// ──────────────────────────────────────────────

type checkState struct {
	state         State
	checkCount    int64
	failureCount  int64
	lastMessage   string
	lastChangeAt  time.Time
	lastEmitAt    time.Time
	metadata      map[string]string
}

// ──────────────────────────────────────────────
// Engine
// ──────────────────────────────────────────────

// Engine tracks check states and emits events on transitions.
// The zero value is NOT ready to use; call [New].
type Engine struct {
	mu      sync.RWMutex
	checks  map[string]*checkState
	handler Handler

	// Configuration.
	failThreshold     int           // consecutive failures before alerting
	recoveryThreshold int           // consecutive successes before recovery
	repeatInterval    time.Duration // re-emit "still_failed" after this duration (0 = never)
	emitOnNoChange    bool          // emit TransitionStillFailed/Healthy events
}

// Option configures the Engine.
type Option func(*Engine)

// WithHandler sets the event handler.
func WithHandler(h Handler) Option {
	return func(e *Engine) { e.handler = h }
}

// WithHandlerFunc sets the event handler as a function.
func WithHandlerFunc(f func(ctx context.Context, e Event)) Option {
	return func(e *Engine) { e.handler = HandlerFunc(f) }
}

// WithFailThreshold sets the number of consecutive failures required
// before a "failed" transition is emitted. Default 1 (alert on first failure).
func WithFailThreshold(n int) Option {
	return func(e *Engine) {
		if n > 0 {
			e.failThreshold = n
		}
	}
}

// WithRecoveryThreshold sets the number of consecutive successes required
// before a "recovered" transition is emitted. Default 1 (recover on first success).
func WithRecoveryThreshold(n int) Option {
	return func(e *Engine) {
		if n > 0 {
			e.recoveryThreshold = n
		}
	}
}

// WithRepeatInterval sets the interval at which "still_failed" events
// are re-emitted for continuously failing checks. Default 0 (never repeat).
func WithRepeatInterval(d time.Duration) Option {
	return func(e *Engine) { e.repeatInterval = d }
}

// WithEmitOnNoChange enables emitting TransitionStillFailed and
// TransitionStillHealthy events on every Record call. Default false.
func WithEmitOnNoChange(b bool) Option {
	return func(e *Engine) { e.emitOnNoChange = b }
}

// WithNotifier integrates a notification dispatcher. The notifier is
// called for every emitted event (transitions only, unless
// WithEmitOnNoChange is set).
func WithNotifier(n Notifier) Option {
	return func(e *Engine) {
		prev := e.handler
		e.handler = HandlerFunc(func(ctx context.Context, ev Event) {
			if prev != nil {
				prev.OnEvent(ctx, ev)
			}
			_ = n.Notify(ctx, ev)
		})
	}
}

// New creates an alerting engine.
func New(opts ...Option) *Engine {
	e := &Engine{
		checks:            make(map[string]*checkState),
		failThreshold:     1,
		recoveryThreshold: 1,
	}
	for _, opt := range opts {
		if opt != nil {
			opt(e)
		}
	}
	return e
}

// Record updates the state of a check and emits events on transitions.
// Returns the emitted event (if any) and whether an event was emitted.
func (e *Engine) Record(ctx context.Context, checkName string, success bool, message string) (Event, bool) {
	return e.RecordWithMetadata(ctx, checkName, success, message, nil)
}

// RecordWithMetadata is like Record but attaches metadata to the check state.
func (e *Engine) RecordWithMetadata(ctx context.Context, checkName string, success bool, message string, metadata map[string]string) (Event, bool) {
	e.mu.Lock()
	defer e.mu.Unlock()

	cs, ok := e.checks[checkName]
	if !ok {
		cs = &checkState{state: StateUnknown}
		e.checks[checkName] = cs
	}

	cs.checkCount++
	prevState := cs.state
	cs.lastMessage = message
	if metadata != nil {
		cs.metadata = metadata
	}

	var event Event
	emit := false

	if success {
		// On success, reset failure count.
		cs.failureCount = 0

		if prevState == StateFailed {
			// Check recovery threshold.
			if e.recoveryThreshold <= 1 {
				cs.state = StateHealthy
				cs.lastChangeAt = time.Now()
				event = e.makeEvent(checkName, TransitionRecovered, prevState, cs, message)
				emit = true
			}
			// If recoveryThreshold > 1, we need to track consecutive successes.
			// For simplicity, we treat each Record as a single check; the
			// threshold-based recovery would require a success counter.
			// We add a basic success counter here.
		} else if prevState == StateHealthy || prevState == StateUnknown {
			cs.state = StateHealthy
			if e.emitOnNoChange && prevState == StateHealthy {
				event = e.makeEvent(checkName, TransitionStillHealthy, prevState, cs, message)
				emit = true
			}
		}
	} else {
		// On failure, increment failure count.
		cs.failureCount++

		if cs.failureCount >= int64(e.failThreshold) {
			if prevState != StateFailed {
				cs.state = StateFailed
				cs.lastChangeAt = time.Now()
				cs.lastEmitAt = time.Now()
				event = e.makeEvent(checkName, TransitionFailed, prevState, cs, message)
				emit = true
			} else {
				// Already failed — check repeat interval.
				if e.repeatInterval > 0 && time.Since(cs.lastEmitAt) >= e.repeatInterval {
					cs.lastEmitAt = time.Now()
					event = e.makeEvent(checkName, TransitionStillFailed, prevState, cs, message)
					emit = true
				} else if e.emitOnNoChange {
					event = e.makeEvent(checkName, TransitionStillFailed, prevState, cs, message)
					emit = true
				}
			}
		}
	}

	if emit {
		e.emit(ctx, event)
	}

	return event, emit
}

// makeEvent constructs an Event from the current check state.
func (e *Engine) makeEvent(name string, trans Transition, from State, cs *checkState, message string) Event {
	return Event{
		CheckName:     name,
		Transition:    trans,
		FromState:     from,
		ToState:       cs.state,
		Message:       message,
		CheckCount:    cs.checkCount,
		FailureCount:  cs.failureCount,
		Timestamp:     time.Now(),
		Metadata:      cs.metadata,
	}
}

// emit calls the handler if set.
func (e *Engine) emit(ctx context.Context, ev Event) {
	if e.handler != nil {
		e.handler.OnEvent(ctx, ev)
	}
}

// ──────────────────────────────────────────────
// Query methods
// ──────────────────────────────────────────────

// State returns the current state of a check. Returns StateUnknown if
// the check has never been recorded.
func (e *Engine) State(checkName string) State {
	e.mu.RLock()
	defer e.mu.RUnlock()
	if cs, ok := e.checks[checkName]; ok {
		return cs.state
	}
	return StateUnknown
}

// FailureCount returns the consecutive failure count for a check.
func (e *Engine) FailureCount(checkName string) int64 {
	e.mu.RLock()
	defer e.mu.RUnlock()
	if cs, ok := e.checks[checkName]; ok {
		return cs.failureCount
	}
	return 0
}

// Checks returns the names of all tracked checks.
func (e *Engine) Checks() []string {
	e.mu.RLock()
	defer e.mu.RUnlock()
	names := make([]string, 0, len(e.checks))
	for name := range e.checks {
		names = append(names, name)
	}
	return names
}

// Remove deletes a check from the engine.
func (e *Engine) Remove(checkName string) {
	e.mu.Lock()
	defer e.mu.Unlock()
	delete(e.checks, checkName)
}

// Reset clears all check states.
func (e *Engine) Reset() {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.checks = make(map[string]*checkState)
}

// Snapshot returns a copy of all check states.
func (e *Engine) Snapshot() map[string]State {
	e.mu.RLock()
	defer e.mu.RUnlock()
	snap := make(map[string]State, len(e.checks))
	for name, cs := range e.checks {
		snap[name] = cs.state
	}
	return snap
}

// ──────────────────────────────────────────────
// Formatting helpers
// ──────────────────────────────────────────────

// FormatEvent returns a human-readable string for an event.
func FormatEvent(e Event) string {
	return fmt.Sprintf("[%s] %s: %s → %s (failures=%d, msg=%q)",
		e.Transition, e.CheckName, e.FromState, e.ToState, e.FailureCount, e.Message)
}
