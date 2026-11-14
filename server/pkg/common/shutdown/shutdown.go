// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package shutdown provides a graceful shutdown orchestrator for
// long-running services. It listens for OS signals (SIGINT, SIGTERM),
// and when triggered, runs registered cleanup functions in reverse
// registration order with a configurable timeout.
//
// # Quick start
//
//	mgr := shutdown.New(
//	    shutdown.WithTimeout(30 * time.Second),
//	    shutdown.WithLogger(log.Printf),
//	)
//
//	// Register cleanup functions (LIFO order).
//	mgr.Add("http-server", func(ctx context.Context) error {
//	    return httpServer.Shutdown(ctx)
//	})
//	mgr.Add("database", func(ctx context.Context) error {
//	    return db.Close()
//	})
//	mgr.Add("redis", func(ctx context.Context) error {
//	    return redisClient.Close()
//	})
//
//	// Block until a signal is received or Listen returns.
//	if err := mgr.Listen(context.Background()); err != nil {
//	    log.Fatalf("shutdown error: %v", err)
//	}
//
// # Manual trigger
//
//	// Trigger shutdown programmatically (e.g. from a health check).
//	mgr.Trigger()
package shutdown

import (
	"context"
	"fmt"
	"log"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"
)

// ──────────────────────────────────────────────
// Errors
// ──────────────────────────────────────────────

var (
	// ErrAlreadyTriggered is returned when Trigger is called after
	// shutdown has already been initiated.
	ErrAlreadyTriggered = fmt.Errorf("shutdown: already triggered")
	// ErrTimeout is returned when the shutdown timeout is exceeded.
	ErrTimeout = fmt.Errorf("shutdown: timeout exceeded")
)

// ──────────────────────────────────────────────
// CleanupFunc
// ──────────────────────────────────────────────

// CleanupFunc is a function called during shutdown. It receives a
// context that is canceled when the shutdown timeout expires.
type CleanupFunc func(ctx context.Context) error

// ──────────────────────────────────────────────
// hook
// ──────────────────────────────────────────────

type hook struct {
	name string
	fn   CleanupFunc
}

// ──────────────────────────────────────────────
// Manager
// ──────────────────────────────────────────────

// Manager orchestrates graceful shutdown of multiple components.
type Manager struct {
	mu          sync.Mutex
	hooks       []hook
	timeout     time.Duration
	logger      func(format string, args ...any)
	signals     []os.Signal
	triggered   bool
	triggerChan chan struct{}
	doneChan    chan struct{}
	result      error
}

// Option configures a Manager.
type Option func(*Manager)

// WithTimeout sets the maximum time to wait for all cleanup functions
// to complete. Default is 30 seconds.
func WithTimeout(d time.Duration) Option {
	return func(m *Manager) {
		if d > 0 {
			m.timeout = d
		}
	}
}

// WithLogger sets a custom logger for shutdown progress messages.
// The default is log.Printf.
func WithLogger(fn func(format string, args ...any)) Option {
	return func(m *Manager) {
		if fn != nil {
			m.logger = fn
		}
	}
}

// WithSignals sets the OS signals that trigger shutdown.
// Default is [syscall.SIGINT, syscall.SIGTERM].
func WithSignals(sigs ...os.Signal) Option {
	return func(m *Manager) {
		if len(sigs) > 0 {
			m.signals = sigs
		}
	}
}

// New creates a new shutdown Manager with the given options.
func New(opts ...Option) *Manager {
	m := &Manager{
		timeout:     30 * time.Second,
		logger:      log.Printf,
		signals:     []os.Signal{syscall.SIGINT, syscall.SIGTERM},
		triggerChan: make(chan struct{}),
		doneChan:    make(chan struct{}),
	}
	for _, opt := range opts {
		opt(m)
	}
	return m
}

// Add registers a cleanup function with a name. Functions are called
// in LIFO (last-in, first-out) order during shutdown.
func (m *Manager) Add(name string, fn CleanupFunc) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.hooks = append(m.hooks, hook{name: name, fn: fn})
}

// AddAfter is an alias for Add that makes the LIFO ordering explicit.
// The registered function runs after all previously registered functions.
func (m *Manager) AddAfter(name string, fn CleanupFunc) {
	m.Add(name, fn)
}

// AddBefore registers a cleanup function that runs before the given
// target hook. If the target is not found, it is appended to the end.
func (m *Manager) AddBefore(target, name string, fn CleanupFunc) {
	m.mu.Lock()
	defer m.mu.Unlock()

	idx := -1
	for i, h := range m.hooks {
		if h.name == target {
			idx = i
			break
		}
	}

	newHook := hook{name: name, fn: fn}
	if idx >= 0 {
		m.hooks = append(m.hooks[:idx], append([]hook{newHook}, m.hooks[idx:]...)...)
	} else {
		m.hooks = append(m.hooks, newHook)
	}
}

// Trigger initiates shutdown programmatically. This is non-blocking;
// use Wait to block until shutdown completes.
func (m *Manager) Trigger() error {
	m.mu.Lock()
	if m.triggered {
		m.mu.Unlock()
		return ErrAlreadyTriggered
	}
	m.triggered = true
	close(m.triggerChan)
	m.mu.Unlock()
	return nil
}

// Listen blocks until a shutdown signal is received or Trigger is called,
// then runs all cleanup functions in reverse order. Returns the first
// error encountered, or ErrTimeout if the shutdown timeout is exceeded.
//
// The parent context is used for the shutdown lifecycle. If it is
// canceled, shutdown is triggered automatically.
func (m *Manager) Listen(parent context.Context) error {
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, m.signals...)
	defer signal.Stop(sigChan)

	select {
	case <-sigChan:
		m.logger("shutdown: signal received")
	case <-m.triggerChan:
		m.logger("shutdown: triggered programmatically")
	case <-parent.Done():
		m.logger("shutdown: parent context canceled")
	}

	return m.run()
}

// Wait blocks until the shutdown has completed and returns the result.
func (m *Manager) Wait() error {
	<-m.doneChan
	return m.result
}

// IsTriggered returns true if shutdown has been triggered.
func (m *Manager) IsTriggered() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.triggered
}

// ──────────────────────────────────────────────
// Internal: run cleanup hooks
// ──────────────────────────────────────────────

func (m *Manager) run() error {
	ctx, cancel := context.WithTimeout(context.Background(), m.timeout)
	defer cancel()

	m.mu.Lock()
	hooks := make([]hook, len(m.hooks))
	copy(hooks, m.hooks)
	m.mu.Unlock()

	var firstErr error

	// Run hooks in reverse order (LIFO).
	for i := len(hooks) - 1; i >= 0; i-- {
		h := hooks[i]
		m.logger("shutdown: running %s...", h.name)

		done := make(chan error, 1)
		go func() {
			done <- h.fn(ctx)
		}()

		select {
		case err := <-done:
			if err != nil {
				m.logger("shutdown: %s failed: %v", h.name, err)
				if firstErr == nil {
					firstErr = fmt.Errorf("shutdown: %s: %w", h.name, err)
				}
			} else {
				m.logger("shutdown: %s done", h.name)
			}
		case <-ctx.Done():
			m.logger("shutdown: %s timed out", h.name)
			if firstErr == nil {
				firstErr = fmt.Errorf("shutdown: %s: %w", h.name, ErrTimeout)
			}
		}
	}

	m.result = firstErr
	close(m.doneChan)
	return firstErr
}
