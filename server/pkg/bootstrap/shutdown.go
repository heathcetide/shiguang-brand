// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package bootstrap

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common/logger"
)

// ShutdownManager handles graceful shutdown, analogous to Spring Boot's
// graceful shutdown with signal handling. It listens for OS signals
// (SIGINT, SIGTERM) and invokes registered shutdown hooks in reverse
// registration order with a configurable timeout.
type ShutdownManager struct {
	mu       sync.Mutex
	hooks    []namedShutdownHook
	timeout  time.Duration
	signals  []os.Signal
	stopped  atomic.Bool
	stopCh   chan struct{}
	onSignal func(sig os.Signal)
}

type namedShutdownHook struct {
	name     string
	fn       func(ctx context.Context) error
	priority int
}

// NewShutdownManager creates a new ShutdownManager with the given timeout.
func NewShutdownManager(timeout time.Duration) *ShutdownManager {
	if timeout <= 0 {
		timeout = 30 * time.Second
	}
	return &ShutdownManager{
		timeout: timeout,
		signals: []os.Signal{syscall.SIGINT, syscall.SIGTERM},
		stopCh:  make(chan struct{}),
	}
}

// SetTimeout sets the shutdown timeout.
func (m *ShutdownManager) SetTimeout(d time.Duration) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.timeout = d
}

// SetSignals sets the OS signals that trigger shutdown.
func (m *ShutdownManager) SetSignals(sigs ...os.Signal) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.signals = sigs
}

// OnSignal sets a callback invoked when a shutdown signal is received.
func (m *ShutdownManager) OnSignal(fn func(sig os.Signal)) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.onSignal = fn
}

// AddHook registers a shutdown hook. Higher priority hooks run first.
func (m *ShutdownManager) AddHook(name string, fn func(ctx context.Context) error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.hooks = append(m.hooks, namedShutdownHook{
		name:     name,
		fn:       fn,
		priority: len(m.hooks), // later = lower priority by default
	})
}

// AddPriorityHook registers a shutdown hook with explicit priority.
// Higher priority values run first.
func (m *ShutdownManager) AddPriorityHook(name string, priority int, fn func(ctx context.Context) error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.hooks = append(m.hooks, namedShutdownHook{
		name:     name,
		fn:       fn,
		priority: priority,
	})
}

// HookCount returns the number of registered shutdown hooks.
func (m *ShutdownManager) HookCount() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.hooks)
}

// Listen starts listening for OS signals. When a signal is received, Shutdown
// is called. This method blocks until a signal is received or Stop is called.
func (m *ShutdownManager) Listen() {
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, m.signals...)

	select {
	case sig := <-sigCh:
		logger.Infof("[shutdown] received signal: %v", sig)
		if m.onSignal != nil {
			m.onSignal(sig)
		}
		m.Shutdown()
	case <-m.stopCh:
		// Stop was called explicitly.
	}
}

// ListenAsync starts listening in a goroutine.
func (m *ShutdownManager) ListenAsync() {
	go m.Listen()
}

// Shutdown executes all shutdown hooks in priority order (highest first)
// with the configured timeout. This method is idempotent.
func (m *ShutdownManager) Shutdown() {
	if !m.stopped.CompareAndSwap(false, true) {
		return // already stopped
	}
	close(m.stopCh)

	m.mu.Lock()
	hooks := make([]namedShutdownHook, len(m.hooks))
	copy(hooks, m.hooks)
	timeout := m.timeout
	m.mu.Unlock()

	// Sort by priority descending (highest first).
	for i := 0; i < len(hooks); i++ {
		for j := i + 1; j < len(hooks); j++ {
			if hooks[j].priority > hooks[i].priority {
				hooks[i], hooks[j] = hooks[j], hooks[i]
			}
		}
	}

	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	for _, h := range hooks {
		logger.Infof("[shutdown] running hook: %s", h.name)
		if err := h.fn(ctx); err != nil {
			logger.Infof("[shutdown] hook %s failed: %v", h.name, err)
		}
	}
	logger.Infof("[shutdown] complete")
}

// Stop signals the shutdown manager to stop without waiting for an OS signal.
func (m *ShutdownManager) Stop() {
	m.Shutdown()
}

// IsStopped reports whether shutdown has been triggered.
func (m *ShutdownManager) IsStopped() bool {
	return m.stopped.Load()
}

// Wait blocks until shutdown is complete.
func (m *ShutdownManager) Wait() {
	<-m.stopCh
}

// WaitForSignal blocks until an OS signal is received, then runs shutdown.
// This is a convenience method that combines Listen + Wait.
func (m *ShutdownManager) WaitForSignal() {
	m.Listen()
}

// GracefulShutdown is a convenience function that registers a shutdown hook
// for the given cleanup function and blocks until a signal is received.
func GracefulShutdown(timeout time.Duration, cleanup func(ctx context.Context) error) {
	m := NewShutdownManager(timeout)
	m.AddHook("cleanup", cleanup)
	m.WaitForSignal()
}

// ShutdownWithError logs the error and returns a shutdown hook that wraps
// the given function, ensuring errors are logged but don't prevent other
// hooks from running.
func ShutdownWithError(name string, fn func(ctx context.Context) error) func(ctx context.Context) error {
	return func(ctx context.Context) error {
		if err := fn(ctx); err != nil {
			logger.Infof("[shutdown] %s error: %v", name, err)
			return fmt.Errorf("%s: %w", name, err)
		}
		return nil
	}
}
