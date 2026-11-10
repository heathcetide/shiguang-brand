// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package idempotency provides a reusable idempotency / anti-replay
// facility for message queue consumers, HTTP handlers, and any other
// processing pipeline where the same operation must not be executed
// more than once.
//
// # Design
//
// The package implements a three-state state machine per operation ID:
//
//	┌─────────┐  Begin     ┌───────────┐  Complete  ┌─────────────┐
//	│  ABSENT │ ─────────► │ IN_FLIGHT │ ─────────► │ ACCOMPLISHED │
//	└─────────┘            └───────────┘            └─────────────┘
//	                              │
//	                              │ Error / Del
//	                              ▼
//	                         ┌───────────┐
//	                         │  ABSENT   │
//	                         └───────────┘
//
//  1. **Begin(id)** — atomically claims the ID. If the ID is absent,
//     it is marked IN_FLIGHT and the caller proceeds. If already
//     IN_FLIGHT or ACCOMPLISHED, the caller skips the operation.
//  2. **Complete(id)** — marks an IN_FLIGHT operation as ACCOMPLISHED.
//  3. **Del(id)** — removes the idempotency record (used on error so
//     the operation can be retried).
//  4. **IsAccomplished(id)** — checks whether the operation finished
//     successfully.
//
// # Storage
//
// The [Storage] interface abstracts the backing store. An in-memory
// implementation ([MemoryStorage]) is provided for testing and
// single-process use. A Redis implementation can be built on top of
// SETNX + EXPIRE; see the example below.
//
// # Quick start
//
//	store := idempotency.NewMemoryStorage()
//	h := idempotency.New(store, idempotency.WithTTL(5*time.Minute))
//
//	// In a message consumer:
//	msgID := msg.ID
//	state, err := h.Begin(ctx, msgID)
//	if err != nil { ... }
//	if state != idempotency.StateBegin {
//	    // Already in-flight or accomplished — skip.
//	    return nil
//	}
//	// Process the message…
//	if err := process(msg); err != nil {
//	    _ = h.Del(ctx, msgID) // allow retry
//	    return err
//	}
//	_ = h.Complete(ctx, msgID)
//	return nil
package idempotency

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"
)

// ──────────────────────────────────────────────
// Errors
// ──────────────────────────────────────────────

var (
	// ErrEmptyKey is returned when the idempotency key is empty.
	ErrEmptyKey = errors.New("idempotency: key must not be empty")
	// ErrStorageClosed is returned when the storage is closed.
	ErrStorageClosed = errors.New("idempotency: storage closed")
)

// ──────────────────────────────────────────────
// State
// ──────────────────────────────────────────────

// State represents the processing state of an idempotent operation.
type State int

const (
	// StateAbsent means the key has no record (never seen or deleted).
	StateAbsent State = iota
	// StateInFlight means the operation has started but not completed.
	StateInFlight
	// StateAccomplished means the operation completed successfully.
	StateAccomplished
)

// String returns a human-readable state name.
func (s State) String() string {
	switch s {
	case StateInFlight:
		return "in-flight"
	case StateAccomplished:
		return "accomplished"
	default:
		return "absent"
	}
}

// ──────────────────────────────────────────────
// BeginResult
// ──────────────────────────────────────────────

// BeginResult is the outcome of a [Handler.Begin] call.
type BeginResult int

const (
	// BeginClaimed means the caller acquired the ID and should proceed
	// with the operation.
	BeginClaimed BeginResult = iota
	// BeginAlreadyInFlight means another caller is currently processing
	// this ID; the caller should skip.
	BeginAlreadyInFlight
	// BeginAlreadyAccomplished means the operation was already completed
	// successfully; the caller should skip.
	BeginAlreadyAccomplished
)

// ──────────────────────────────────────────────
// Storage interface
// ──────────────────────────────────────────────

// Storage is the persistence backend for idempotency records.
// Implementations must be safe for concurrent use.
type Storage interface {
	// Get returns the state for key, or StateAbsent if not found.
	Get(ctx context.Context, key string) (State, error)

	// SetIfAbsent atomically sets key to StateInFlight with the given
	// TTL only if key is currently absent. Returns true if the claim
	// succeeded, false if the key already existed.
	SetIfAbsent(ctx context.Context, key string, ttl time.Duration) (bool, error)

	// Set marks key to the given state with the TTL. Overwrites any
	// existing value.
	Set(ctx context.Context, key string, state State, ttl time.Duration) error

	// Delete removes the key. Not an error if the key doesn't exist.
	Delete(ctx context.Context, key string) error

	// Close releases resources.
	Close() error
}

// ──────────────────────────────────────────────
// Handler
// ──────────────────────────────────────────────

// Handler is the idempotency state-machine facade. It is safe for
// concurrent use.
type Handler struct {
	store Storage
	ttl   time.Duration
}

// Option configures a [Handler].
type Option func(*Handler)

// WithTTL sets the TTL for idempotency records. Default is 5 minutes.
// A TTL of 0 means records never expire (not recommended for Redis
// backends).
func WithTTL(ttl time.Duration) Option {
	return func(h *Handler) { h.ttl = ttl }
}

// New creates a Handler backed by store.
func New(store Storage, opts ...Option) *Handler {
	h := &Handler{
		store: store,
		ttl:   5 * time.Minute,
	}
	for _, opt := range opts {
		if opt != nil {
			opt(h)
		}
	}
	return h
}

// Begin atomically claims key for processing. Returns BeginClaimed if
// the caller should proceed, or BeginAlreadyInFlight /
// BeginAlreadyAccomplished if the operation is already in progress or
// done.
func (h *Handler) Begin(ctx context.Context, key string) (BeginResult, error) {
	if key == "" {
		return 0, ErrEmptyKey
	}
	ok, err := h.store.SetIfAbsent(ctx, key, h.ttl)
	if err != nil {
		return 0, fmt.Errorf("idempotency: begin %q: %w", key, err)
	}
	if ok {
		return BeginClaimed, nil
	}
	state, err := h.store.Get(ctx, key)
	if err != nil {
		return 0, fmt.Errorf("idempotency: get %q: %w", key, err)
	}
	switch state {
	case StateAccomplished:
		return BeginAlreadyAccomplished, nil
	default:
		return BeginAlreadyInFlight, nil
	}
}

// Complete marks key as ACCOMPLISHED. Should be called after the
// operation succeeds.
func (h *Handler) Complete(ctx context.Context, key string) error {
	if key == "" {
		return ErrEmptyKey
	}
	if err := h.store.Set(ctx, key, StateAccomplished, h.ttl); err != nil {
		return fmt.Errorf("idempotency: complete %q: %w", key, err)
	}
	return nil
}

// Del removes the idempotency record for key. Should be called when
// the operation fails, so it can be retried.
func (h *Handler) Del(ctx context.Context, key string) error {
	if key == "" {
		return ErrEmptyKey
	}
	if err := h.store.Delete(ctx, key); err != nil {
		return fmt.Errorf("idempotency: delete %q: %w", key, err)
	}
	return nil
}

// IsAccomplished reports whether key is in the ACCOMPLISHED state.
func (h *Handler) IsAccomplished(ctx context.Context, key string) (bool, error) {
	if key == "" {
		return false, ErrEmptyKey
	}
	state, err := h.store.Get(ctx, key)
	if err != nil {
		return false, fmt.Errorf("idempotency: check %q: %w", key, err)
	}
	return state == StateAccomplished, nil
}

// IsInFlight reports whether key is in the IN_FLIGHT state.
func (h *Handler) IsInFlight(ctx context.Context, key string) (bool, error) {
	if key == "" {
		return false, ErrEmptyKey
	}
	state, err := h.store.Get(ctx, key)
	if err != nil {
		return false, fmt.Errorf("idempotency: check %q: %w", key, err)
	}
	return state == StateInFlight, nil
}

// Close releases the underlying storage.
func (h *Handler) Close() error {
	return h.store.Close()
}

// ──────────────────────────────────────────────
// Execute helper
// ──────────────────────────────────────────────

// Execute wraps an operation with idempotency protection. If the key
// was already accomplished, it returns nil immediately. If the
// operation fn fails, the idempotency record is deleted so the
// operation can be retried.
//
// This is the simplest way to use the package:
//
//	err := h.Execute(ctx, msg.ID, func(ctx context.Context) error {
//	    return processMessage(msg)
//	})
func (h *Handler) Execute(ctx context.Context, key string, fn func(context.Context) error) error {
	result, err := h.Begin(ctx, key)
	if err != nil {
		return err
	}
	switch result {
	case BeginAlreadyAccomplished:
		return nil
	case BeginAlreadyInFlight:
		return ErrAlreadyInFlight
	}
	if err := fn(ctx); err != nil {
		_ = h.Del(ctx, key)
		return err
	}
	return h.Complete(ctx, key)
}

// ErrAlreadyInFlight is returned by [Handler.Execute] when the
// operation is already being processed by another caller.
var ErrAlreadyInFlight = errors.New("idempotency: operation already in flight")

// ──────────────────────────────────────────────
// MemoryStorage
// ──────────────────────────────────────────────

// memoryEntry holds a state and its expiry.
type memoryEntry struct {
	state  State
	expiry time.Time
}

// MemoryStorage is an in-process Storage implementation. Safe for
// concurrent use.
type MemoryStorage struct {
	mu      sync.RWMutex
	entries map[string]memoryEntry
	closed  bool
}

// NewMemoryStorage creates an in-memory Storage.
func NewMemoryStorage() *MemoryStorage {
	return &MemoryStorage{entries: make(map[string]memoryEntry)}
}

// Get implements Storage.
func (m *MemoryStorage) Get(ctx context.Context, key string) (State, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if m.closed {
		return StateAbsent, ErrStorageClosed
	}
	e, ok := m.entries[key]
	if !ok || !e.expiry.IsZero() && time.Now().After(e.expiry) {
		return StateAbsent, nil
	}
	return e.state, nil
}

// SetIfAbsent implements Storage.
func (m *MemoryStorage) SetIfAbsent(ctx context.Context, key string, ttl time.Duration) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.closed {
		return false, ErrStorageClosed
	}
	// Check for expired entry.
	if e, ok := m.entries[key]; ok && !e.expiry.IsZero() && time.Now().After(e.expiry) {
		delete(m.entries, key)
	}
	if _, ok := m.entries[key]; ok {
		return false, nil
	}
	var exp time.Time
	if ttl > 0 {
		exp = time.Now().Add(ttl)
	}
	m.entries[key] = memoryEntry{state: StateInFlight, expiry: exp}
	return true, nil
}

// Set implements Storage.
func (m *MemoryStorage) Set(ctx context.Context, key string, state State, ttl time.Duration) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.closed {
		return ErrStorageClosed
	}
	var exp time.Time
	if ttl > 0 {
		exp = time.Now().Add(ttl)
	}
	m.entries[key] = memoryEntry{state: state, expiry: exp}
	return nil
}

// Delete implements Storage.
func (m *MemoryStorage) Delete(ctx context.Context, key string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.closed {
		return ErrStorageClosed
	}
	delete(m.entries, key)
	return nil
}

// Close implements Storage.
func (m *MemoryStorage) Close() error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.closed = true
	m.entries = nil
	return nil
}
