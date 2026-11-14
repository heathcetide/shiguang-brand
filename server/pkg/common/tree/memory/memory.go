// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package memory provides an in-process, goroutine-safe implementation
// of [tree.Store] for testing and single-node agents.
//
// It has zero external dependencies and keeps all nodes in a map keyed
// by primary key. Child lookups scan the map; this is fine for trees of
// up to a few thousand nodes. For larger trees or persistence, use one
// of the SQL backends (tree/gormstore, tree/mysql, …).
//
// # Quick start
//
//	store := memory.New()
//	tr, _ := tree.New(store)
//	_, _ = tr.Add(ctx, "inf.monitor.prometheus")
package memory

import (
	"context"
	"sync"
	"sync/atomic"

	"github.com/heathcetide/DietDigiDose/pkg/common/tree"
)

// Store is the in-memory implementation of [tree.Store].
type Store struct {
	mu     sync.RWMutex
	nextID atomic.Int64
	nodes  map[int64]*tree.Node
}

// New creates an empty in-memory store.
func New() *Store {
	s := &Store{
		nodes: make(map[int64]*tree.Node),
	}
	s.nextID.Store(1)
	return s
}

// ensure Store satisfies tree.Store at compile time.
var _ tree.Store = (*Store)(nil)

func (s *Store) Insert(ctx context.Context, n *tree.Node) error {
	if n == nil {
		return tree.ErrNodeNotFound
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	// Uniqueness check: (level, path, name) must be unique.
	for _, existing := range s.nodes {
		if existing.Level == n.Level && existing.Path == n.Path && existing.Name == n.Name {
			return tree.ErrNodeExists
		}
	}
	n.ID = s.nextID.Add(1)
	// Store a copy to avoid external mutation.
	cp := *n
	s.nodes[cp.ID] = &cp
	// Reflect assigned ID back to caller.
	n.ID = cp.ID
	return nil
}

func (s *Store) Get(ctx context.Context, level int, path, name string) (*tree.Node, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, n := range s.nodes {
		if n.Level == level && n.Path == path && n.Name == name {
			cp := *n
			return &cp, nil
		}
	}
	return nil, tree.ErrNodeNotFound
}

func (s *Store) GetByID(ctx context.Context, id int64) (*tree.Node, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	n, ok := s.nodes[id]
	if !ok {
		return nil, tree.ErrNodeNotFound
	}
	cp := *n
	return &cp, nil
}

func (s *Store) DeleteByID(ctx context.Context, id int64) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.nodes[id]; !ok {
		return tree.ErrNodeNotFound
	}
	delete(s.nodes, id)
	return nil
}

func (s *Store) ListChildren(ctx context.Context, level int, path string) ([]*tree.Node, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	var result []*tree.Node
	for _, n := range s.nodes {
		if n.Level == level && n.Path == path {
			cp := *n
			result = append(result, &cp)
		}
	}
	if result == nil {
		result = []*tree.Node{}
	}
	return result, nil
}

func (s *Store) ListByPathPrefix(ctx context.Context, level int, pathPrefix string) ([]*tree.Node, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	var result []*tree.Node
	for _, n := range s.nodes {
		if level != 0 && n.Level != level {
			continue
		}
		if hasPathPrefix(n.Path, pathPrefix) {
			cp := *n
			result = append(result, &cp)
		}
	}
	if result == nil {
		result = []*tree.Node{}
	}
	return result, nil
}

// hasPathPrefix reports whether path starts with prefix followed by "/"
// or equals prefix exactly. This avoids "/5" matching "/55".
func hasPathPrefix(path, prefix string) bool {
	if path == prefix {
		return true
	}
	if len(path) > len(prefix) && path[:len(prefix)] == prefix && path[len(prefix)] == '/' {
		return true
	}
	return false
}

// Tx is a no-op for the memory store: fn is called directly. The memory
// store holds a single mutex, so concurrent writers are already serialized.
func (s *Store) Tx(ctx context.Context, fn func(ctx context.Context) error) error {
	return fn(ctx)
}

func (s *Store) Close() error { return nil }
