// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package trie implements a rune-aware prefix tree (trie) with support for
// arbitrary values, prefix matching, longest-prefix lookup (useful for route
// matching), autocomplete, and ordered walking.
//
// A [Trie] is not safe for concurrent use by multiple goroutines. For
// concurrent access, use [SafeTrie], which guards every operation with a
// sync.RWMutex.
//
// The implementation operates on runes rather than bytes, so Unicode keys
// (including CJK characters and emoji) are handled correctly.
package trie

import (
	"sort"
	"sync"
)

// node is an internal trie node. Each node holds a map of child runes, an
// end-of-key flag, and the value associated with the key ending at this node.
type node struct {
	children map[rune]*node
	isEnd    bool
	value    any
}

// newNode creates an empty node.
func newNode() *node {
	return &node{children: make(map[rune]*node)}
}

// Trie is a rune-based prefix tree. The zero value is NOT ready to use; always
// construct it with [New].
type Trie struct {
	root *node
	size int
}

// New creates an empty trie.
func New() *Trie {
	return &Trie{root: newNode()}
}

// Insert adds (or overwrites) the value associated with key. An empty key is
// ignored.
func (t *Trie) Insert(key string, value any) {
	if key == "" {
		return
	}
	cur := t.root
	for _, r := range key {
		child, ok := cur.children[r]
		if !ok {
			child = newNode()
			cur.children[r] = child
		}
		cur = child
	}
	if !cur.isEnd {
		t.size++
	}
	cur.isEnd = true
	cur.value = value
}

// InsertMany inserts all items from the map. Existing keys are overwritten.
func (t *Trie) InsertMany(items map[string]any) {
	for k, v := range items {
		t.Insert(k, v)
	}
}

// Search performs an exact lookup. It returns the value and true when key is
// present, or nil and false otherwise.
func (t *Trie) Search(key string) (any, bool) {
	if key == "" {
		return nil, false
	}
	cur := t.root
	for _, r := range key {
		child, ok := cur.children[r]
		if !ok {
			return nil, false
		}
		cur = child
	}
	if !cur.isEnd {
		return nil, false
	}
	return cur.value, true
}

// HasPrefix reports whether any stored key starts with prefix.
func (t *Trie) HasPrefix(prefix string) bool {
	cur := t.root
	for _, r := range prefix {
		child, ok := cur.children[r]
		if !ok {
			return false
		}
		cur = child
	}
	return true
}

// PrefixMatch returns all stored keys that start with prefix. The result is
// sorted lexicographically for deterministic output. An empty prefix returns
// all keys.
func (t *Trie) PrefixMatch(prefix string) []string {
	start := t.findNode(prefix)
	if start == nil {
		return nil
	}
	var keys []string
	t.collect(start, []rune(prefix), &keys)
	sort.Strings(keys)
	return keys
}

// PrefixMatchWithValues returns a map of all key/value pairs whose keys start
// with prefix.
func (t *Trie) PrefixMatchWithValues(prefix string) map[string]any {
	start := t.findNode(prefix)
	if start == nil {
		return nil
	}
	out := make(map[string]any)
	t.collectValues(start, []rune(prefix), out)
	return out
}

// Delete removes key from the trie. It returns true when the key existed and
// was removed, false otherwise. Empty keys are never stored and thus never
// deleted.
func (t *Trie) Delete(key string) bool {
	if key == "" {
		return false
	}
	runes := []rune(key)
	path := make([]*node, 0, len(runes))
	cur := t.root
	path = append(path, cur)
	for _, r := range runes {
		child, ok := cur.children[r]
		if !ok {
			return false
		}
		path = append(path, child)
		cur = child
	}
	if !cur.isEnd {
		return false
	}
	cur.isEnd = false
	cur.value = nil
	t.size--

	// Prune nodes that are no longer part of any key, walking backwards.
	for i := len(path) - 1; i >= 1; i-- {
		n := path[i]
		if len(n.children) == 0 && !n.isEnd {
			parent := path[i-1]
			delete(parent.children, runes[i-1])
		} else {
			break
		}
	}
	return true
}

// Size returns the number of stored keys.
func (t *Trie) Size() int {
	return t.size
}

// Clear removes all keys and values, resetting the trie to its initial state.
func (t *Trie) Clear() {
	t.root = newNode()
	t.size = 0
}

// Keys returns all stored keys, sorted lexicographically.
func (t *Trie) Keys() []string {
	var keys []string
	t.collect(t.root, nil, &keys)
	sort.Strings(keys)
	return keys
}

// LongestPrefix returns the longest stored key that is a prefix of s, i.e. the
// deepest node along the path spelled by s that has isEnd set. This is useful
// for route matching where the most specific registered pattern should win.
//
// The boolean is false when no stored key is a prefix of s.
func (t *Trie) LongestPrefix(s string) (string, bool) {
	if s == "" {
		return "", false
	}
	runes := []rune(s)
	cur := t.root
	lastEnd := -1
	for i, r := range runes {
		child, ok := cur.children[r]
		if !ok {
			break
		}
		cur = child
		if cur.isEnd {
			lastEnd = i
		}
	}
	if lastEnd < 0 {
		return "", false
	}
	return string(runes[:lastEnd+1]), true
}

// Autocomplete returns up to limit keys that start with prefix, sorted
// lexicographically. If limit <= 0, all matching keys are returned.
func (t *Trie) Autocomplete(prefix string, limit int) []string {
	start := t.findNode(prefix)
	if start == nil {
		return nil
	}
	var keys []string
	t.collect(start, []rune(prefix), &keys)
	sort.Strings(keys)
	if limit > 0 && len(keys) > limit {
		keys = keys[:limit]
	}
	return keys
}

// Walk invokes fn for every stored key/value pair. Iteration order is
// lexicographic by key. If fn returns false, iteration stops immediately.
func (t *Trie) Walk(fn func(key string, value any) bool) {
	keys := t.Keys()
	for _, k := range keys {
		v, _ := t.Search(k)
		if !fn(k, v) {
			return
		}
	}
}

// findNode descends from the root following the runes of prefix and returns the
// node at the end of the path, or nil if the path does not exist.
func (t *Trie) findNode(prefix string) *node {
	cur := t.root
	for _, r := range prefix {
		child, ok := cur.children[r]
		if !ok {
			return nil
		}
		cur = child
	}
	return cur
}

// collect appends all keys rooted at n (with the accumulated prefix) to keys.
func (t *Trie) collect(n *node, prefix []rune, keys *[]string) {
	if n.isEnd {
		*keys = append(*keys, string(prefix))
	}
	// Iterate children in sorted order for deterministic output before the
	// final sort.Strings call (kept for explicitness).
	runes := make([]rune, 0, len(n.children))
	for r := range n.children {
		runes = append(runes, r)
	}
	sort.Slice(runes, func(i, j int) bool { return runes[i] < runes[j] })
	for _, r := range runes {
		t.collect(n.children[r], append(prefix, r), keys)
	}
}

// collectValues populates out with all key/value pairs rooted at n.
func (t *Trie) collectValues(n *node, prefix []rune, out map[string]any) {
	if n.isEnd {
		out[string(prefix)] = n.value
	}
	for r, child := range n.children {
		t.collectValues(child, append(prefix, r), out)
	}
}

// ──────────────────────────────────────────────
// SafeTrie: concurrency-safe wrapper
// ──────────────────────────────────────────────

// SafeTrie wraps a [Trie] with a sync.RWMutex, making every operation safe for
// concurrent use by multiple goroutines.
type SafeTrie struct {
	trie *Trie
	mu   sync.RWMutex
}

// NewSafe creates an empty concurrency-safe trie.
func NewSafe() *SafeTrie {
	return &SafeTrie{trie: New()}
}

// Insert adds or overwrites the value for key.
func (s *SafeTrie) Insert(key string, value any) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.trie.Insert(key, value)
}

// InsertMany inserts all items from the map.
func (s *SafeTrie) InsertMany(items map[string]any) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.trie.InsertMany(items)
}

// Search performs an exact lookup.
func (s *SafeTrie) Search(key string) (any, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.trie.Search(key)
}

// HasPrefix reports whether any stored key starts with prefix.
func (s *SafeTrie) HasPrefix(prefix string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.trie.HasPrefix(prefix)
}

// PrefixMatch returns all keys starting with prefix (sorted).
func (s *SafeTrie) PrefixMatch(prefix string) []string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.trie.PrefixMatch(prefix)
}

// PrefixMatchWithValues returns all key/value pairs whose keys start with prefix.
func (s *SafeTrie) PrefixMatchWithValues(prefix string) map[string]any {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.trie.PrefixMatchWithValues(prefix)
}

// Delete removes key and returns whether it existed.
func (s *SafeTrie) Delete(key string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.trie.Delete(key)
}

// Size returns the number of stored keys.
func (s *SafeTrie) Size() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.trie.Size()
}

// Clear removes all keys.
func (s *SafeTrie) Clear() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.trie.Clear()
}

// Keys returns all stored keys (sorted).
func (s *SafeTrie) Keys() []string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.trie.Keys()
}

// LongestPrefix returns the longest stored key that is a prefix of str.
func (s *SafeTrie) LongestPrefix(str string) (string, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.trie.LongestPrefix(str)
}

// Autocomplete returns up to limit keys starting with prefix.
func (s *SafeTrie) Autocomplete(prefix string, limit int) []string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.trie.Autocomplete(prefix, limit)
}

// Walk invokes fn for every stored key/value pair (sorted by key). Iteration
// stops early when fn returns false. The lock is held for the entire walk, so
// fn must not call back into the SafeTrie (doing so would deadlock).
func (s *SafeTrie) Walk(fn func(key string, value any) bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	s.trie.Walk(fn)
}
