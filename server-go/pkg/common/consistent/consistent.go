// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package consistent implements a consistent-hash ring with virtual nodes,
// suitable for distributing keys across a dynamic set of nodes (e.g. cache
// servers, shard owners) with minimal redistribution on topology changes.
//
// The ring is safe for concurrent use: all public methods acquire the
// appropriate read or write lock. [Ring.Snapshot] returns an independent copy
// for consistent point-in-time reads.
package consistent

import (
	"errors"
	"hash/crc32"
	"sort"
	"sync"
)

// Hash is the hash function used to map node names and keys onto the ring.
type Hash func(data []byte) uint32

// DefaultHash is the default hash function: CRC-32 (IEEE polynomial). It is fast
// and well-distributed for typical node/key strings.
var DefaultHash Hash = crc32.ChecksumIEEE

// defaultReplicas is the number of virtual nodes per physical node when no
// WithReplicas option is supplied.
const defaultReplicas = 50

// ErrEmptyRing is returned by Get/GetN when the ring contains no nodes.
var ErrEmptyRing = errors.New("consistent: ring is empty")

// ErrInvalidReplicas is returned when a non-positive replica count is
// configured.
var ErrInvalidReplicas = errors.New("consistent: replicas must be greater than zero")

// Ring is a consistent-hash ring with virtual nodes.
type Ring struct {
	mu            sync.RWMutex
	hash          Hash
	replicas      int
	virtualNodes  map[uint32]string // virtual-node hash -> physical node name
	sortedHashes  []uint32          // ascending, for binary search
	nodes         map[string]bool   // set of physical node names
}

// Option configures a Ring.
type Option func(*Ring)

// WithHash sets a custom hash function. Defaults to [DefaultHash].
func WithHash(fn Hash) Option {
	return func(r *Ring) {
		if fn != nil {
			r.hash = fn
		}
	}
}

// WithReplicas sets the number of virtual nodes per physical node. Must be > 0.
// Defaults to 50. A higher value improves distribution uniformity at the cost of
// memory and re-computation time.
func WithReplicas(n int) Option {
	return func(r *Ring) {
		r.replicas = n
	}
}

// New creates an empty ring applying the given options. It panics if
// WithReplicas is given a non-positive value, since that indicates a
// programming error.
func New(opts ...Option) *Ring {
	r := &Ring{
		hash:         DefaultHash,
		replicas:     defaultReplicas,
		virtualNodes: make(map[uint32]string),
		nodes:        make(map[string]bool),
	}
	for _, opt := range opts {
		opt(r)
	}
	if r.replicas <= 0 {
		panic(ErrInvalidReplicas)
	}
	return r
}

// Add inserts one or more physical nodes onto the ring, creating the configured
// number of virtual nodes for each. Adding an already-present node is a no-op.
func (r *Ring) Add(nodes ...string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, node := range nodes {
		if node == "" || r.nodes[node] {
			continue
		}
		r.nodes[node] = true
		for i := 0; i < r.replicas; i++ {
			h := r.hash([]byte(r.virtualNodeKey(node, i)))
			// On hash collision, the later virtual node wins; this is
			// astronomically unlikely with a 32-bit hash and few nodes.
			r.virtualNodes[h] = node
		}
	}
	r.updateSortedHashes()
}

// Remove deletes one or more physical nodes (and all their virtual nodes) from
// the ring. Removing a non-present node is a no-op.
func (r *Ring) Remove(nodes ...string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, node := range nodes {
		if !r.nodes[node] {
			continue
		}
		delete(r.nodes, node)
		for i := 0; i < r.replicas; i++ {
			h := r.hash([]byte(r.virtualNodeKey(node, i)))
			// Only delete if this hash still maps to this node (collision
			// safety).
			if r.virtualNodes[h] == node {
				delete(r.virtualNodes, h)
			}
		}
	}
	r.updateSortedHashes()
}

// Get returns the physical node responsible for key. When the ring is empty it
// returns "" and [ErrEmptyRing].
func (r *Ring) Get(key string) (string, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	if len(r.sortedHashes) == 0 {
		return "", false
	}
	h := r.hash([]byte(key))
	idx := r.search(h)
	return r.virtualNodes[r.sortedHashes[idx]], true
}

// GetN returns up to n distinct physical nodes responsible for key, in ring
// order starting from the first node at/after the key's hash. It is useful for
// placing replicas of the same key on different nodes.
//
// If the ring has fewer than n nodes, the returned slice contains all nodes and
// the error is nil. If the ring is empty, it returns nil and [ErrEmptyRing]. If
// n <= 0, it returns nil and nil error.
func (r *Ring) GetN(key string, n int) ([]string, error) {
	if n <= 0 {
		return nil, nil
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	if len(r.sortedHashes) == 0 {
		return nil, ErrEmptyRing
	}
	h := r.hash([]byte(key))
	idx := r.search(h)

	seen := make(map[string]bool)
	var result []string
	ringLen := len(r.sortedHashes)
	for i := 0; i < ringLen && len(result) < n; i++ {
		node := r.virtualNodes[r.sortedHashes[(idx+i)%ringLen]]
		if !seen[node] {
			seen[node] = true
			result = append(result, node)
		}
	}
	return result, nil
}

// Nodes returns a sorted list of all physical node names.
func (r *Ring) Nodes() []string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]string, 0, len(r.nodes))
	for node := range r.nodes {
		out = append(out, node)
	}
	sort.Strings(out)
	return out
}

// Size returns the number of physical nodes.
func (r *Ring) Size() int {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return len(r.nodes)
}

// Contains reports whether node is present on the ring.
func (r *Ring) Contains(node string) bool {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.nodes[node]
}

// Distribution returns a map of physical node name -> number of virtual nodes
// currently assigned. The sum across all nodes equals replicas * Size().
func (r *Ring) Distribution() map[string]int {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make(map[string]int, len(r.nodes))
	for _, node := range r.virtualNodes {
		out[node]++
	}
	return out
}

// Snapshot returns an independent copy of the ring suitable for consistent
// point-in-time reads. Mutating the original after creating a snapshot does not
// affect the snapshot, and vice versa.
func (r *Ring) Snapshot() *Ring {
	r.mu.RLock()
	defer r.mu.RUnlock()
	clone := &Ring{
		hash:         r.hash,
		replicas:     r.replicas,
		virtualNodes: make(map[uint32]string, len(r.virtualNodes)),
		sortedHashes: make([]uint32, len(r.sortedHashes)),
		nodes:        make(map[string]bool, len(r.nodes)),
	}
	for k, v := range r.virtualNodes {
		clone.virtualNodes[k] = v
	}
	copy(clone.sortedHashes, r.sortedHashes)
	for k := range r.nodes {
		clone.nodes[k] = true
	}
	return clone
}

// virtualNodeKey builds the string hashed to produce a virtual node identifier.
// Using a separator that cannot appear in a decimal integer keeps the mapping
// unambiguous.
func (r *Ring) virtualNodeKey(node string, idx int) string {
	return node + "#" + itoa(idx)
}

// itoa is a small allocation-free int->string converter for non-negative ints.
func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var buf [20]byte
	pos := len(buf)
	for n > 0 {
		pos--
		buf[pos] = byte('0' + n%10)
		n /= 10
	}
	return string(buf[pos:])
}

// search returns the index in sortedHashes of the first hash >= h, wrapping
// around to 0 when h is greater than every hash on the ring. The caller must
// hold the read lock and ensure sortedHashes is non-empty.
func (r *Ring) search(h uint32) int {
	idx := sort.Search(len(r.sortedHashes), func(i int) bool {
		return r.sortedHashes[i] >= h
	})
	if idx >= len(r.sortedHashes) {
		idx = 0
	}
	return idx
}

// updateSortedHashes rebuilds the sorted slice of virtual-node hashes from the
// map. The caller must hold the write lock.
func (r *Ring) updateSortedHashes() {
	r.sortedHashes = r.sortedHashes[:0]
	if cap(r.sortedHashes) < len(r.virtualNodes) {
		r.sortedHashes = make([]uint32, 0, len(r.virtualNodes))
	}
	for h := range r.virtualNodes {
		r.sortedHashes = append(r.sortedHashes, h)
	}
	sort.Slice(r.sortedHashes, func(i, j int) bool {
		return r.sortedHashes[i] < r.sortedHashes[j]
	})
}
