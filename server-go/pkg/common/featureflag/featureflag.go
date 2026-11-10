// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package featureflag provides a thread-safe feature-flag manager that
// supports full on/off toggles, percentage-based gradual rollouts (using a
// deterministic FNV hash so the same user always gets the same result),
// per-user whitelists and blacklists.
//
// # Evaluation order
//
// When [Manager.IsEnabled] is called for a given flag and user, the manager
// evaluates the following rules in order and short-circuits on the first
// match:
//
//  1. If the flag is disabled, return false.
//  2. If the user is in the blacklist, return false.
//  3. If the user is in the whitelist, return true.
//  4. Otherwise apply percentage rollout: the user is enabled when
//     hash(name+userID) % 100 < Percentage.
//
// All operations on [Manager] are safe for concurrent use.
package featureflag

import (
	"hash/fnv"
	"sort"
	"sync"
)

// Flag describes a single feature flag.
type Flag struct {
	// Name is the unique identifier of the flag.
	Name string
	// Enabled controls whether the flag is on at all. When false,
	// IsEnabled always returns false (except it is still checked after
	// the blacklist/whitelist? No — disabled means fully off).
	Enabled bool
	// Percentage is the rollout percentage in the range [0, 100]. A value
	// of 100 means all users (not in the blacklist) are enabled.
	Percentage int
	// Whitelist is a list of user IDs that are always enabled for this
	// flag, regardless of Percentage.
	Whitelist []string
	// Blacklist is a list of user IDs that are always disabled for this
	// flag, taking precedence over the whitelist and percentage.
	Blacklist []string
	// Metadata is an optional bag of arbitrary user-defined attributes.
	Metadata map[string]any
}

// Manager is a thread-safe collection of feature flags.
type Manager struct {
	mu    sync.RWMutex
	flags map[string]*Flag
}

// NewManager returns a new empty [Manager].
func NewManager() *Manager {
	return &Manager{
		flags: make(map[string]*Flag),
	}
}

// SetFlag inserts or updates the flag identified by flag.Name.
//
// The provided flag is stored by value through a shallow copy so later
// mutations to the caller's struct do not affect the manager state. Slice
// and map fields are copied so the manager owns its own copies.
func (m *Manager) SetFlag(flag *Flag) {
	if flag == nil || flag.Name == "" {
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()

	cp := *flag
	if cp.Percentage < 0 {
		cp.Percentage = 0
	}
	if cp.Percentage > 100 {
		cp.Percentage = 100
	}
	if cp.Whitelist != nil {
		cp.Whitelist = append([]string(nil), cp.Whitelist...)
	}
	if cp.Blacklist != nil {
		cp.Blacklist = append([]string(nil), cp.Blacklist...)
	}
	if cp.Metadata != nil {
		cp.Metadata = make(map[string]any, len(cp.Metadata))
		for k, v := range flag.Metadata {
			cp.Metadata[k] = v
		}
	}
	m.flags[cp.Name] = &cp
}

// IsEnabled reports whether the flag named name is enabled for the given
// userID. See the package documentation for the evaluation order.
//
// If the flag does not exist the result is false.
func (m *Manager) IsEnabled(name, userID string) bool {
	m.mu.RLock()
	flag, ok := m.flags[name]
	m.mu.RUnlock()
	if !ok {
		return false
	}
	return m.evaluate(flag, userID)
}

// evaluate applies the evaluation rules. It assumes the caller already
// holds at least a read lock on the flag pointer's contents (the flag is
// only mutated under the manager write lock, so reading its fields under
// the read lock is safe).
func (m *Manager) evaluate(flag *Flag, userID string) bool {
	m.mu.RLock()
	defer m.mu.RUnlock()

	return m.evaluateLocked(flag, userID)
}

// evaluateLocked is the inner evaluation routine that assumes the read
// lock is already held.
func (m *Manager) evaluateLocked(flag *Flag, userID string) bool {
	if !flag.Enabled {
		return false
	}
	for _, id := range flag.Blacklist {
		if id == userID {
			return false
		}
	}
	for _, id := range flag.Whitelist {
		if id == userID {
			return true
		}
	}
	if flag.Percentage >= 100 {
		return true
	}
	if flag.Percentage <= 0 {
		return false
	}
	return hashPercentage(flag.Name, userID) < flag.Percentage
}

// hashPercentage returns a deterministic value in [0, 100) derived from
// the flag name and user ID using FNV-1a. The same (name, userID) pair
// always yields the same value.
func hashPercentage(name, userID string) int {
	h := fnv.New64a()
	_, _ = h.Write([]byte(name))
	_, _ = h.Write([]byte(userID))
	return int(h.Sum64() % 100)
}

// Enable turns the flag fully on (Enabled = true, Percentage = 100). If
// the flag does not exist it is created.
func (m *Manager) Enable(name string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	flag, ok := m.flags[name]
	if !ok {
		flag = &Flag{Name: name}
		m.flags[name] = flag
	}
	flag.Enabled = true
	flag.Percentage = 100
}

// Disable turns the flag fully off (Enabled = false). If the flag does
// not exist it is created.
func (m *Manager) Disable(name string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	flag, ok := m.flags[name]
	if !ok {
		flag = &Flag{Name: name}
		m.flags[name] = flag
	}
	flag.Enabled = false
}

// SetPercentage sets the rollout percentage for the flag and ensures it
// is enabled. pct is clamped to [0, 100]. If the flag does not exist it
// is created.
func (m *Manager) SetPercentage(name string, pct int) {
	if pct < 0 {
		pct = 0
	}
	if pct > 100 {
		pct = 100
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	flag, ok := m.flags[name]
	if !ok {
		flag = &Flag{Name: name}
		m.flags[name] = flag
	}
	flag.Enabled = true
	flag.Percentage = pct
}

// AddWhitelist adds userID to the flag's whitelist and enables the flag.
// If the flag does not exist it is created. Duplicate entries are
// ignored.
func (m *Manager) AddWhitelist(name, userID string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	flag, ok := m.flags[name]
	if !ok {
		flag = &Flag{Name: name}
		m.flags[name] = flag
	}
	flag.Enabled = true
	for _, id := range flag.Whitelist {
		if id == userID {
			return
		}
	}
	flag.Whitelist = append(flag.Whitelist, userID)
}

// RemoveFlag deletes the flag with the given name. It is a no-op if the
// flag does not exist.
func (m *Manager) RemoveFlag(name string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.flags, name)
}

// GetFlag returns a copy of the flag with the given name, or nil if it
// does not exist. The returned copy can be mutated safely by the caller.
func (m *Manager) GetFlag(name string) *Flag {
	m.mu.RLock()
	defer m.mu.RUnlock()
	flag, ok := m.flags[name]
	if !ok {
		return nil
	}
	cp := *flag
	if cp.Whitelist != nil {
		cp.Whitelist = append([]string(nil), cp.Whitelist...)
	}
	if cp.Blacklist != nil {
		cp.Blacklist = append([]string(nil), cp.Blacklist...)
	}
	if cp.Metadata != nil {
		cp.Metadata = make(map[string]any, len(cp.Metadata))
		for k, v := range flag.Metadata {
			cp.Metadata[k] = v
		}
	}
	return &cp
}

// AllFlags returns copies of all registered flags sorted by name.
func (m *Manager) AllFlags() []*Flag {
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := make([]*Flag, 0, len(m.flags))
	for _, flag := range m.flags {
		cp := *flag
		if cp.Whitelist != nil {
			cp.Whitelist = append([]string(nil), cp.Whitelist...)
		}
		if cp.Blacklist != nil {
			cp.Blacklist = append([]string(nil), cp.Blacklist...)
		}
		if cp.Metadata != nil {
			cp.Metadata = make(map[string]any, len(cp.Metadata))
			for k, v := range flag.Metadata {
				cp.Metadata[k] = v
			}
		}
		out = append(out, &cp)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out
}
