// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package bootstrap

import (
	"fmt"
	"reflect"
	"sync"
)

// Registry is a component container, analogous to Spring's BeanFactory /
// ApplicationContext. It stores named components (beans) and supports
// type-based lookup.
type Registry struct {
	mu     sync.RWMutex
	byName map[string]any
	byType map[reflect.Type][]string
	order  []string // registration order
}

// NewRegistry creates a new empty Registry.
func NewRegistry() *Registry {
	return &Registry{
		byName: make(map[string]any),
		byType: make(map[reflect.Type][]string),
	}
}

// Register stores a component under the given name. If a component with the
// same name already exists it returns an error.
func (r *Registry) Register(name string, component any) error {
	if name == "" {
		return fmt.Errorf("component name cannot be empty")
	}
	if component == nil {
		return fmt.Errorf("component cannot be nil")
	}

	r.mu.Lock()
	defer r.mu.Unlock()
	if _, exists := r.byName[name]; exists {
		return fmt.Errorf("component %q already registered", name)
	}

	r.byName[name] = component
	r.order = append(r.order, name)

	t := reflect.TypeOf(component)
	r.byType[t] = append(r.byType[t], name)

	// Also register pointer-to or value type for interface lookups.
	if t.Kind() == reflect.Ptr {
		elemType := t.Elem()
		r.byType[elemType] = append(r.byType[elemType], name)
	}
	return nil
}

// MustRegister is like Register but panics on error.
func (r *Registry) MustRegister(name string, component any) {
	if err := r.Register(name, component); err != nil {
		panic(err)
	}
}

// Get retrieves a component by name. Returns nil and false if not found.
func (r *Registry) Get(name string) (any, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	c, ok := r.byName[name]
	return c, ok
}

// MustGet retrieves a component by name, panicking if not found.
func (r *Registry) MustGet(name string) any {
	c, ok := r.Get(name)
	if !ok {
		panic(fmt.Sprintf("component %q not found", name))
	}
	return c
}

// GetByType retrieves the first component matching the given type.
// Returns nil and false if none found.
func (r *Registry) GetByType(typ reflect.Type) (any, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	names, ok := r.byType[typ]
	if !ok || len(names) == 0 {
		return nil, false
	}
	return r.byName[names[0]], true
}

// GetAllByType retrieves all components matching the given type.
func (r *Registry) GetAllByType(typ reflect.Type) []any {
	r.mu.RLock()
	defer r.mu.RUnlock()
	names, ok := r.byType[typ]
	if !ok {
		return nil
	}
	result := make([]any, 0, len(names))
	for _, name := range names {
		result = append(result, r.byName[name])
	}
	return result
}

// Names returns all registered component names in registration order.
func (r *Registry) Names() []string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	result := make([]string, len(r.order))
	copy(result, r.order)
	return result
}

// Count returns the number of registered components.
func (r *Registry) Count() int {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return len(r.byName)
}

// Contains reports whether a component with the given name is registered.
func (r *Registry) Contains(name string) bool {
	r.mu.RLock()
	defer r.mu.RUnlock()
	_, ok := r.byName[name]
	return ok
}

// Unregister removes a component by name. Returns false if not found.
func (r *Registry) Unregister(name string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	c, ok := r.byName[name]
	if !ok {
		return false
	}
	delete(r.byName, name)

	// Remove from order slice.
	for i, n := range r.order {
		if n == name {
			r.order = append(r.order[:i], r.order[i+1:]...)
			break
		}
	}

	// Remove from byType.
	t := reflect.TypeOf(c)
	if names, ok := r.byType[t]; ok {
		for i, n := range names {
			if n == name {
				r.byType[t] = append(names[:i], names[i+1:]...)
				break
			}
		}
		if len(r.byType[t]) == 0 {
			delete(r.byType, t)
		}
	}
	if t.Kind() == reflect.Ptr {
		elemType := t.Elem()
		if names, ok := r.byType[elemType]; ok {
			for i, n := range names {
				if n == name {
					r.byType[elemType] = append(names[:i], names[i+1:]...)
					break
				}
			}
			if len(r.byType[elemType]) == 0 {
				delete(r.byType, elemType)
			}
		}
	}
	return true
}

// Range iterates over all components in registration order.
func (r *Registry) Range(fn func(name string, component any) bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	for _, name := range r.order {
		if !fn(name, r.byName[name]) {
			return
		}
	}
}
