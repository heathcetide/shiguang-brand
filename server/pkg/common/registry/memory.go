// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package registry

import (
	"context"
	"sync"
)

// MemoryRegistry is an in-memory Registry implementation for testing
// and local development. It is safe for concurrent use.
type MemoryRegistry struct {
	mu        sync.RWMutex
	instances map[string]map[string]Instance // serviceName -> instanceID -> Instance
	watchers  map[string][]chan []Instance    // serviceName -> watcher channels
	closed    bool
}

// NewMemoryRegistry creates a new in-memory registry.
func NewMemoryRegistry() *MemoryRegistry {
	return &MemoryRegistry{
		instances: make(map[string]map[string]Instance),
		watchers:  make(map[string][]chan []Instance),
	}
}

// Register adds a service instance to the in-memory store.
func (m *MemoryRegistry) Register(ctx context.Context, inst Instance) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.closed {
		return ErrClosed
	}

	if inst.ID == "" {
		inst.ID = inst.ServiceName + "-" + formatAddress(inst.Host, inst.Port)
	}

	if m.instances[inst.ServiceName] == nil {
		m.instances[inst.ServiceName] = make(map[string]Instance)
	}
	m.instances[inst.ServiceName][inst.ID] = inst
	m.notifyWatchersLocked(inst.ServiceName)
	return nil
}

// Deregister removes a service instance by ID.
func (m *MemoryRegistry) Deregister(ctx context.Context, instanceID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.closed {
		return ErrClosed
	}

	for svcName, insts := range m.instances {
		if _, ok := insts[instanceID]; ok {
			delete(insts, instanceID)
			m.notifyWatchersLocked(svcName)
			return nil
		}
	}
	return ErrNotRegistered
}

// Discover returns all instances for a service name.
func (m *MemoryRegistry) Discover(ctx context.Context, serviceName string) ([]Instance, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	if m.closed {
		return nil, ErrClosed
	}

	insts, ok := m.instances[serviceName]
	if !ok || len(insts) == 0 {
		return nil, ErrNotFound
	}

	result := make([]Instance, 0, len(insts))
	for _, inst := range insts {
		result = append(result, inst)
	}
	return result, nil
}

// Watch returns a channel that receives updated instance lists
// whenever the service's membership changes.
func (m *MemoryRegistry) Watch(ctx context.Context, serviceName string) (<-chan []Instance, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.closed {
		return nil, ErrClosed
	}

	ch := make(chan []Instance, 8)
	m.watchers[serviceName] = append(m.watchers[serviceName], ch)

	// Send initial state.
	if insts := m.instances[serviceName]; len(insts) > 0 {
		result := make([]Instance, 0, len(insts))
		for _, inst := range insts {
			result = append(result, inst)
		}
		ch <- result
	}

	go func() {
		<-ctx.Done()
		m.mu.Lock()
		// Remove this watcher from the list.
		watchers := m.watchers[serviceName]
		for i, w := range watchers {
			if w == ch {
				m.watchers[serviceName] = append(watchers[:i], watchers[i+1:]...)
				break
			}
		}
		close(ch)
		m.mu.Unlock()
	}()

	return ch, nil
}

// Close releases all resources.
func (m *MemoryRegistry) Close() error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.closed {
		return nil
	}
	m.closed = true
	m.instances = nil

	for _, watchers := range m.watchers {
		for _, ch := range watchers {
			close(ch)
		}
	}
	m.watchers = nil
	return nil
}

// notifyWatchersLocked sends the current instance list to all watchers.
// Caller must hold m.mu.
func (m *MemoryRegistry) notifyWatchersLocked(serviceName string) {
	insts := m.instances[serviceName]
	result := make([]Instance, 0, len(insts))
	for _, inst := range insts {
		result = append(result, inst)
	}
	for _, ch := range m.watchers[serviceName] {
		select {
		case ch <- result:
		default:
			// Drop if watcher is slow.
		}
	}
}
