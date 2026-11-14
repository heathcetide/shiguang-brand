// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package bootstrap

import (
	"context"
	"fmt"
	"sync"
)

// Phase represents a lifecycle phase.
type Phase int

const (
	PhaseInit  Phase = iota // before start, like @PostConstruct
	PhaseStart              // when application starts
	PhaseStop               // when application stops, like @PreDestroy
)

func (p Phase) String() string {
	switch p {
	case PhaseInit:
		return "init"
	case PhaseStart:
		return "start"
	case PhaseStop:
		return "stop"
	default:
		return "unknown"
	}
}

// Lifecycle is implemented by components that need startup/shutdown callbacks.
// This is analogous to Spring's SmartLifecycle interface.
type Lifecycle interface {
	// Start is called when the application starts.
	Start(ctx context.Context) error
	// Stop is called when the application shuts down.
	Stop(ctx context.Context) error
	// IsRunning reports whether the component is currently active.
	IsRunning() bool
}

// InitHook is a function called during the init phase (before start).
// Analogous to Spring's @PostConstruct.
type InitHook func(ctx context.Context) error

// ShutdownHook is a function called during shutdown.
// Analogous to Spring's @PreDestroy.
type ShutdownHook func(ctx context.Context) error

// LifecycleManager manages the lifecycle of registered components.
type LifecycleManager struct {
	mu            sync.Mutex
	lifecycles    []namedLifecycle
	initHooks     []namedHook
	shutdownHooks []namedHook
	started       bool
}

type namedLifecycle struct {
	name string
	lc   Lifecycle
}

type namedHook struct {
	name string
	fn   func(context.Context) error
}

// NewLifecycleManager creates a new LifecycleManager.
func NewLifecycleManager() *LifecycleManager {
	return &LifecycleManager{}
}

// AddLifecycle registers a Lifecycle component.
func (m *LifecycleManager) AddLifecycle(name string, lc Lifecycle) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.lifecycles = append(m.lifecycles, namedLifecycle{name: name, lc: lc})
}

// AddInitHook registers an init hook (called before start).
func (m *LifecycleManager) AddInitHook(name string, fn InitHook) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.initHooks = append(m.initHooks, namedHook{name: name, fn: fn})
}

// AddShutdownHook registers a shutdown hook (called during shutdown).
func (m *LifecycleManager) AddShutdownHook(name string, fn ShutdownHook) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.shutdownHooks = append(m.shutdownHooks, namedHook{name: name, fn: fn})
}

// Init runs all init hooks in registration order.
func (m *LifecycleManager) Init(ctx context.Context) error {
	m.mu.Lock()
	hooks := make([]namedHook, len(m.initHooks))
	copy(hooks, m.initHooks)
	m.mu.Unlock()

	for _, h := range hooks {
		if err := h.fn(ctx); err != nil {
			return fmt.Errorf("init hook %q failed: %w", h.name, err)
		}
	}
	return nil
}

// Start starts all registered lifecycle components in registration order.
func (m *LifecycleManager) Start(ctx context.Context) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.started {
		return fmt.Errorf("lifecycle already started")
	}

	for _, nlc := range m.lifecycles {
		if err := nlc.lc.Start(ctx); err != nil {
			// Rollback: stop already-started components.
			for i := len(m.lifecycles) - 1; i >= 0; i-- {
				if m.lifecycles[i].lc.IsRunning() {
					m.lifecycles[i].lc.Stop(ctx)
				}
			}
			return fmt.Errorf("start component %q failed: %w", nlc.name, err)
		}
	}
	m.started = true
	return nil
}

// Stop stops all registered lifecycle components in reverse registration order.
// Shutdown hooks are called after all components are stopped.
func (m *LifecycleManager) Stop(ctx context.Context) error {
	m.mu.Lock()
	lifecycles := make([]namedLifecycle, len(m.lifecycles))
	copy(lifecycles, m.lifecycles)
	hooks := make([]namedHook, len(m.shutdownHooks))
	copy(hooks, m.shutdownHooks)
	m.started = false
	m.mu.Unlock()

	// Stop lifecycles in reverse order.
	var firstErr error
	for i := len(lifecycles) - 1; i >= 0; i-- {
		if lifecycles[i].lc.IsRunning() {
			if err := lifecycles[i].lc.Stop(ctx); err != nil && firstErr == nil {
				firstErr = fmt.Errorf("stop component %q failed: %w", lifecycles[i].name, err)
			}
		}
	}

	// Run shutdown hooks in reverse order.
	for i := len(hooks) - 1; i >= 0; i-- {
		if err := hooks[i].fn(ctx); err != nil && firstErr == nil {
			firstErr = fmt.Errorf("shutdown hook %q failed: %w", hooks[i].name, err)
		}
	}

	return firstErr
}

// IsRunning reports whether the lifecycle is started.
func (m *LifecycleManager) IsRunning() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.started
}

// ComponentCount returns the number of registered lifecycle components.
func (m *LifecycleManager) ComponentCount() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.lifecycles)
}
