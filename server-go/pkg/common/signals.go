// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package common

import "sync"

// SignalHandler is a callback invoked when a signal event is emitted.
// sender is the originator of the event; params are arbitrary event data.
type SignalHandler func(sender any, params ...any)

// SigHandler pairs a unique handler ID with its callback.
type SigHandler struct {
	ID      uint
	Handler SignalHandler
}

// QueryResult is the synchronous result collected by Signals.Query.
// Handlers fill in Value/Value2/Err during Emit; the caller reads them
// after all handlers have returned.
type QueryResult struct {
	Value  any
	Value2 any
	Err    error
}

// Signals is a process-wide synchronous event bus.
//
// Concurrency contract:
//   - sigHandlers is copy-on-write. Connect/Disconnect never mutate a slice
//     that a concurrent Emit may already be iterating; they publish a fresh
//     slice instead. Emit can therefore snapshot under RLock and invoke
//     handlers with the lock released.
//   - Releasing the lock before invoking handlers is what makes reentrancy
//     safe: handlers routinely Connect/Disconnect (notably one-shot handlers
//     that unsubscribe themselves) and would otherwise self-deadlock.
type Signals struct {
	mu          sync.RWMutex
	lastID      uint
	sigHandlers map[string][]SigHandler
}

var (
	sig     *Signals
	sigOnce sync.Once
)

func init() {
	Sig()
}

// Sig returns the process-wide singleton Signals instance.
func Sig() *Signals {
	sigOnce.Do(func() {
		sig = NewSignals()
	})
	return sig
}

// NewSignals creates a new Signals event bus.
func NewSignals() *Signals {
	return &Signals{
		lastID:      0,
		sigHandlers: map[string][]SigHandler{},
	}
}

// Connect registers a handler for the given event and returns its handler ID.
// The handler will be invoked on subsequent Emit calls for this event.
func (s *Signals) Connect(event string, handler SignalHandler) uint {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.lastID += 1
	id := s.lastID

	cur := s.sigHandlers[event]
	next := make([]SigHandler, 0, len(cur)+1)
	next = append(next, cur...)
	next = append(next, SigHandler{ID: id, Handler: handler})
	s.sigHandlers[event] = next

	return id
}

// Disconnect removes the handler with the given ID from the event.
func (s *Signals) Disconnect(event string, id uint) {
	s.mu.Lock()
	defer s.mu.Unlock()

	cur := s.sigHandlers[event]
	for i := range cur {
		if cur[i].ID != id {
			continue
		}
		if len(cur) == 1 {
			delete(s.sigHandlers, event)
			return
		}
		next := make([]SigHandler, 0, len(cur)-1)
		next = append(next, cur[:i]...)
		next = append(next, cur[i+1:]...)
		s.sigHandlers[event] = next
		return
	}
}

// Clear removes all handlers for the given events.
func (s *Signals) Clear(events ...string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, event := range events {
		delete(s.sigHandlers, event)
	}
}

// Emit fires the event synchronously, calling all registered handlers in
// registration order. The lock is released before invoking handlers so that
// reentrant Connect/Disconnect is safe.
func (s *Signals) Emit(event string, sender any, params ...any) {
	s.mu.RLock()
	sigs := s.sigHandlers[event]
	s.mu.RUnlock()

	// sigs is copy-on-write, so it stays valid without the lock held; handlers
	// must run unlocked because they may Connect/Disconnect reentrantly.
	for _, sig := range sigs {
		sig.Handler(sender, params...)
	}
}

// Query emits a signal and collects the synchronous result.
// The last parameter passed to handlers is *QueryResult, which handlers
// populate. The caller reads the returned result after all handlers return.
func (s *Signals) Query(event string, params ...any) *QueryResult {
	r := &QueryResult{}
	s.Emit(event, nil, append(params, r)...)
	return r
}
