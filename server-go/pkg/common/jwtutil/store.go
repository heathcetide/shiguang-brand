// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package jwtutil

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"sync"
	"time"
)

// IDGenerator generates unique token IDs (jti claim).
type IDGenerator interface {
	NewID() (string, error)
}

// defaultIDGenerator uses crypto/rand to generate a 16-byte hex ID.
type defaultIDGenerator struct{}

func (defaultIDGenerator) NewID() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("jwtutil: generate id: %w", err)
	}
	return hex.EncodeToString(b), nil
}

// CounterIDGenerator is a deterministic, monotonic ID generator for testing.
type CounterIDGenerator struct {
	mu  sync.Mutex
	val uint64
}

// NewCounterIDGenerator creates a counter-based ID generator starting at 1.
func NewCounterIDGenerator() *CounterIDGenerator {
	return &CounterIDGenerator{}
}

func (g *CounterIDGenerator) NewID() (string, error) {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.val++
	return fmt.Sprintf("jti-%d", g.val), nil
}

// ──────────────────────────────────────────────
// MemoryTokenStore
// ──────────────────────────────────────────────

// MemoryTokenStore is an in-process TokenStore. Useful for single-instance
// deployments and testing. Not suitable for multi-instance setups.
type MemoryTokenStore struct {
	mu      sync.RWMutex
	revoked map[string]time.Time // jti -> expiry
	used    map[string]time.Time // jti -> expiry (for refresh replay prevention)
}

// NewMemoryTokenStore creates an in-memory token store.
func NewMemoryTokenStore() *MemoryTokenStore {
	return &MemoryTokenStore{
		revoked: make(map[string]time.Time),
		used:    make(map[string]time.Time),
	}
}

// Revoke marks the token ID as revoked until the given expiry.
func (s *MemoryTokenStore) Revoke(_ context.Context, jti string, expiry time.Time) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.revoked[jti] = expiry
	return nil
}

// IsRevoked returns true if the token ID has been revoked and its
// revocation expiry has not passed.
func (s *MemoryTokenStore) IsRevoked(_ context.Context, jti string) (bool, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	expiry, ok := s.revoked[jti]
	if !ok {
		return false, nil
	}
	if time.Now().After(expiry) {
		return false, nil // revocation expired
	}
	return true, nil
}

// MarkUsed marks a refresh token ID as used. Returns true if it was
// not previously used, false if already used.
func (s *MemoryTokenStore) MarkUsed(_ context.Context, jti string, expiry time.Time) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if existing, ok := s.used[jti]; ok && time.Now().Before(existing) {
		return false, nil // already used
	}
	s.used[jti] = expiry
	return true, nil
}

// Cleanup removes expired entries from the store. This should be called
// periodically to prevent unbounded memory growth.
func (s *MemoryTokenStore) Cleanup() {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now()
	for jti, expiry := range s.revoked {
		if now.After(expiry) {
			delete(s.revoked, jti)
		}
	}
	for jti, expiry := range s.used {
		if now.After(expiry) {
			delete(s.used, jti)
		}
	}
}

// Len returns the number of revoked and used entries.
func (s *MemoryTokenStore) Len() (revoked, used int) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.revoked), len(s.used)
}

// Compile-time interface checks.
var (
	_ TokenStore  = (*MemoryTokenStore)(nil)
	_ IDGenerator = defaultIDGenerator{}
	_ IDGenerator = (*CounterIDGenerator)(nil)
)
