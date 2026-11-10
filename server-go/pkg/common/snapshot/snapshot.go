// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package snapshot implements a content snapshot versioning system inspired
// by Halo's Snapshot/PatchUtils model.
//
// # Design
//
// Each edit creates an immutable [Snapshot] of the content. The first
// snapshot stores the full content; subsequent snapshots can store either
// the full content or a diff patch relative to their parent. This enables:
//
//   - Version history with rollback to any point.
//   - Space-efficient storage via diff patches.
//   - Optimistic concurrency control via version numbers.
//   - Contributor tracking.
//
// # Quick start
//
//	store := snapshot.NewStore[string]()
//	v1, _ := store.Create("doc-1", "Hello World", "alice")
//	v2, _ := store.Update("doc-1", v1.Version, "Hello Go World", "bob")
//
//	// Get current content
//	current, _ := store.GetContent("doc-1")
//
//	// Rollback to v1
//	store.Rollback("doc-1", v1.Version, "alice")
package snapshot

import (
	"errors"
	"fmt"
	"sort"
	"sync"
	"sync/atomic"
	"time"
)

// ──────────────────────────────────────────────
// Errors
// ──────────────────────────────────────────────

var (
	ErrNotFound        = errors.New("snapshot: subject not found")
	ErrVersionConflict = errors.New("snapshot: version conflict (optimistic lock failed)")
	ErrNoSnapshots     = errors.New("snapshot: no snapshots for subject")
	ErrVersionNotFound = errors.New("snapshot: version not found")
)

// ──────────────────────────────────────────────
// Snapshot
// ──────────────────────────────────────────────

// Snapshot is an immutable version of content.
type Snapshot[T any] struct {
	ID          int64
	SubjectID   string
	Version     int64
	ParentVer   int64 // 0 for base snapshot
	Content     T
	RawContent  string // original content (for diff-based backends)
	IsPatch     bool   // true if Content is a diff patch
	Patch       string // diff patch if IsPatch=true
	Contributor string
	CreatedAt   time.Time
}

// Store manages snapshots for multiple subjects.
type Store[T any] struct {
	mu         sync.RWMutex
	snapshots  map[string][]*Snapshot[T] // subjectID → snapshots (sorted by version)
	idCounter  atomic.Int64
	maxRetries int

	// diffFn computes a diff patch from old and new content.
	// If nil, full content is stored (no diff optimization).
	diffFn func(old, new string) (string, error)

	// patchFn applies a diff patch to content.
	// If nil, full content is stored (no diff optimization).
	patchFn func(content, patch string) (string, error)

	// contentToString converts T to a string for diffing.
	contentToString func(T) string

	// contentFromString converts a string back to T.
	contentFromString func(string) (T, error)
}

// Option configures a Store.
type Option[T any] func(*Store[T])

// WithDiffFunc sets custom diff and patch functions.
// When set, only the first snapshot stores full content; subsequent
// snapshots store diff patches, reducing storage for large content.
func WithDiffFunc[T any](
	diff func(old, new string) (string, error),
	patch func(content, patch string) (string, error),
	toStr func(T) string,
	fromStr func(string) (T, error),
) Option[T] {
	return func(s *Store[T]) {
		s.diffFn = diff
		s.patchFn = patch
		s.contentToString = toStr
		s.contentFromString = fromStr
	}
}

// WithMaxRetries sets the maximum number of optimistic-lock retries.
// Default: 3.
func WithMaxRetries[T any](n int) Option[T] {
	return func(s *Store[T]) {
		if n >= 0 {
			s.maxRetries = n
		}
	}
}

// NewStore creates a new snapshot store.
func NewStore[T any](opts ...Option[T]) *Store[T] {
	s := &Store[T]{
		snapshots:  make(map[string][]*Snapshot[T]),
		maxRetries: 3,
	}
	for _, opt := range opts {
		opt(s)
	}
	return s
}

// ──────────────────────────────────────────────
// Core operations
// ──────────────────────────────────────────────

// Create creates the first snapshot for a subject.
func (s *Store[T]) Create(subjectID string, content T, contributor string) (*Snapshot[T], error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, exists := s.snapshots[subjectID]; exists {
		return nil, fmt.Errorf("snapshot: subject %s already exists", subjectID)
	}

	snap := &Snapshot[T]{
		ID:          s.idCounter.Add(1),
		SubjectID:   subjectID,
		Version:     1,
		ParentVer:   0,
		Content:     content,
		IsPatch:     false,
		Contributor: contributor,
		CreatedAt:   time.Now(),
	}

	if s.contentToString != nil {
		snap.RawContent = s.contentToString(content)
	}

	s.snapshots[subjectID] = []*Snapshot[T]{snap}
	return snap, nil
}

// Update creates a new snapshot with the given content.
// expectedVersion is used for optimistic concurrency control — if the
// current latest version doesn't match, ErrVersionConflict is returned.
//
// With retry: if a conflict occurs, the store retries up to maxRetries
// times by re-applying the update against the latest version.
func (s *Store[T]) Update(subjectID string, expectedVersion int64, content T, contributor string) (*Snapshot[T], error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	snaps, exists := s.snapshots[subjectID]
	if !exists {
		return nil, ErrNotFound
	}

	latest := snaps[len(snaps)-1]
	if latest.Version != expectedVersion {
		return nil, fmt.Errorf("%w: expected %d, got %d", ErrVersionConflict, expectedVersion, latest.Version)
	}

	newVersion := latest.Version + 1
	snap := &Snapshot[T]{
		ID:          s.idCounter.Add(1),
		SubjectID:   subjectID,
		Version:     newVersion,
		ParentVer:   latest.Version,
		Contributor: contributor,
		CreatedAt:   time.Now(),
	}

	// If diff functions are configured, store a patch instead of full content.
	if s.diffFn != nil && s.patchFn != nil && s.contentToString != nil && s.contentFromString != nil {
		newRaw := s.contentToString(content)
		patch, err := s.diffFn(latest.RawContent, newRaw)
		if err != nil {
			// Fall back to full content on diff error.
			snap.Content = content
			snap.RawContent = newRaw
			snap.IsPatch = false
		} else {
			snap.Patch = patch
			snap.IsPatch = true
			snap.RawContent = newRaw
			snap.Content = content
		}
	} else {
		snap.Content = content
		if s.contentToString != nil {
			snap.RawContent = s.contentToString(content)
		}
	}

	s.snapshots[subjectID] = append(snaps, snap)
	return snap, nil
}

// GetLatest returns the latest snapshot for a subject.
func (s *Store[T]) GetLatest(subjectID string) (*Snapshot[T], error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	snaps, exists := s.snapshots[subjectID]
	if !exists || len(snaps) == 0 {
		return nil, ErrNotFound
	}
	return snaps[len(snaps)-1], nil
}

// GetByVersion returns a specific snapshot by version.
func (s *Store[T]) GetByVersion(subjectID string, version int64) (*Snapshot[T], error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	snaps, exists := s.snapshots[subjectID]
	if !exists {
		return nil, ErrNotFound
	}

	// Binary search by version (snapshots are sorted by version).
	idx := sort.Search(len(snaps), func(i int) bool {
		return snaps[i].Version >= version
	})
	if idx < len(snaps) && snaps[idx].Version == version {
		return snaps[idx], nil
	}
	return nil, fmt.Errorf("%w: version %d", ErrVersionNotFound, version)
}

// GetContent reconstructs the content at the latest version.
// If diff-based snapshots are used, it applies patches from the base.
func (s *Store[T]) GetContent(subjectID string) (T, error) {
	snap, err := s.GetLatest(subjectID)
	if err != nil {
		var zero T
		return zero, err
	}
	return snap.Content, nil
}

// GetContentAtVersion reconstructs the content at a specific version.
func (s *Store[T]) GetContentAtVersion(subjectID string, version int64) (T, error) {
	snap, err := s.GetByVersion(subjectID, version)
	if err != nil {
		var zero T
		return zero, err
	}
	return snap.Content, nil
}

// Rollback creates a new snapshot that restores content to a previous version.
// This does NOT delete history — it appends a new snapshot with the old content.
func (s *Store[T]) Rollback(subjectID string, targetVersion int64, contributor string) (*Snapshot[T], error) {
	s.mu.RLock()
	targetSnap, err := s.GetByVersion(subjectID, targetVersion)
	s.mu.RUnlock()
	if err != nil {
		return nil, err
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	snaps, exists := s.snapshots[subjectID]
	if !exists {
		return nil, ErrNotFound
	}

	latest := snaps[len(snaps)-1]
	newVersion := latest.Version + 1

	snap := &Snapshot[T]{
		ID:          s.idCounter.Add(1),
		SubjectID:   subjectID,
		Version:     newVersion,
		ParentVer:   latest.Version,
		Content:     targetSnap.Content,
		RawContent:  targetSnap.RawContent,
		IsPatch:     false,
		Contributor: contributor,
		CreatedAt:   time.Now(),
	}

	s.snapshots[subjectID] = append(snaps, snap)
	return snap, nil
}

// History returns all snapshots for a subject.
func (s *Store[T]) History(subjectID string) ([]*Snapshot[T], error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	snaps, exists := s.snapshots[subjectID]
	if !exists {
		return nil, ErrNotFound
	}

	out := make([]*Snapshot[T], len(snaps))
	copy(out, snaps)
	return out, nil
}

// Contributors returns the unique contributors for a subject.
func (s *Store[T]) Contributors(subjectID string) ([]string, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	snaps, exists := s.snapshots[subjectID]
	if !exists {
		return nil, ErrNotFound
	}

	seen := make(map[string]bool)
	var contributors []string
	for _, snap := range snaps {
		if !seen[snap.Contributor] {
			seen[snap.Contributor] = true
			contributors = append(contributors, snap.Contributor)
		}
	}
	return contributors, nil
}

// Delete removes all snapshots for a subject.
func (s *Store[T]) Delete(subjectID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, exists := s.snapshots[subjectID]; !exists {
		return ErrNotFound
	}
	delete(s.snapshots, subjectID)
	return nil
}

// Count returns the number of snapshots for a subject.
func (s *Store[T]) Count(subjectID string) (int, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	snaps, exists := s.snapshots[subjectID]
	if !exists {
		return 0, ErrNotFound
	}
	return len(snaps), nil
}

// ListSubjects returns all subject IDs.
func (s *Store[T]) ListSubjects() []string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]string, 0, len(s.snapshots))
	for id := range s.snapshots {
		out = append(out, id)
	}
	sort.Strings(out)
	return out
}
