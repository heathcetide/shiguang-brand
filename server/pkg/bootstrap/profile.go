// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package bootstrap

import (
	"fmt"
	"os"
	"strings"
	"sync"
)

// Profile constants for common environments.
const (
	ProfileDev     = "dev"
	ProfileTest    = "test"
	ProfileStaging = "staging"
	ProfileProd    = "prod"
)

// ProfileManager manages active profiles, analogous to Spring's
// @Profile / Environment.getActiveProfiles().
type ProfileManager struct {
	mu       sync.RWMutex
	active   map[string]bool
	default_ string
}

// NewProfileManager creates a new ProfileManager with the given default profile.
func NewProfileManager(defaultProfile string) *ProfileManager {
	if defaultProfile == "" {
		defaultProfile = ProfileDev
	}
	return &ProfileManager{
		active:   map[string]bool{defaultProfile: true},
		default_: defaultProfile,
	}
}

// Active sets the active profiles, replacing any previously active profiles.
func (m *ProfileManager) Active(profiles ...string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.active = make(map[string]bool, len(profiles))
	for _, p := range profiles {
		p = strings.TrimSpace(strings.ToLower(p))
		if p != "" {
			m.active[p] = true
		}
	}
}

// AddActive adds a profile to the active set.
func (m *ProfileManager) AddActive(profile string) {
	profile = strings.TrimSpace(strings.ToLower(profile))
	if profile == "" {
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.active[profile] = true
}

// RemoveActive removes a profile from the active set.
func (m *ProfileManager) RemoveActive(profile string) {
	profile = strings.TrimSpace(strings.ToLower(profile))
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.active, profile)
}

// IsActive reports whether the given profile is active.
func (m *ProfileManager) IsActive(profile string) bool {
	profile = strings.TrimSpace(strings.ToLower(profile))
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.active[profile]
}

// ActiveProfiles returns all active profile names.
func (m *ProfileManager) ActiveProfiles() []string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	result := make([]string, 0, len(m.active))
	for p := range m.active {
		result = append(result, p)
	}
	return result
}

// DefaultProfile returns the default profile.
func (m *ProfileManager) DefaultProfile() string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.default_
}

// IsDev is a convenience method for IsActive(ProfileDev).
func (m *ProfileManager) IsDev() bool { return m.IsActive(ProfileDev) }

// IsTest is a convenience method for IsActive(ProfileTest).
func (m *ProfileManager) IsTest() bool { return m.IsActive(ProfileTest) }

// IsStaging is a convenience method for IsActive(ProfileStaging).
func (m *ProfileManager) IsStaging() bool { return m.IsActive(ProfileStaging) }

// IsProd is a convenience method for IsActive(ProfileProd).
func (m *ProfileManager) IsProd() bool { return m.IsActive(ProfileProd) }

// LoadFromEnv loads the active profile from the APP_ENV environment variable
// (or the given env key). If the variable is not set, the default profile is used.
func (m *ProfileManager) LoadFromEnv(envKey string) {
	if envKey == "" {
		envKey = "APP_ENV"
	}
	if v := os.Getenv(envKey); v != "" {
		m.Active(v)
	}
}

// String returns a human-readable representation.
func (m *ProfileManager) String() string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	profiles := make([]string, 0, len(m.active))
	for p := range m.active {
		profiles = append(profiles, p)
	}
	return fmt.Sprintf("profiles=%v (default=%s)", profiles, m.default_)
}
