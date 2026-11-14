// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package memory

import (
	"hash/fnv"
	"math"
	"sync"
)

// bloomSet is a Bloom filter-based Set implementation for approximate
// deduplication at scale. It uses fixed memory regardless of element count.
//
// Properties:
//   - Memory: exactly `bitArraySize / 8` bytes.
//   - False positive rate: ~p (configurable, default 0.1%).
//   - No false negatives: if Has() returns false, the element was definitely
//     never added.
//   - Count() returns an estimate based on fill ratio.
//
// Use case: "new user" detection at scale (1M+ users) where exact Set
// would consume 80+ MB. A Bloom filter with 1M capacity and 0.1% FPR
// uses only ~1.4 MB.
//
// Limitations:
//   - Cannot list members.
//   - Cannot be reset without reallocating.
//   - Intersect is not supported (Bloom filters don't support intersection
//     directly; use HLL for approximate intersection instead).
type bloomSet struct {
	mu           sync.RWMutex
	bits         []uint64 // bit array (packed into uint64 words)
	numWords     int      // len(bits)
	numHashes    int      // k
	expectedN    int      // expected number of elements
	count        int64    // number of Add calls
	falsePosRate float64  // target false positive rate
}

// newBloomSet creates a Bloom filter set for `expectedN` elements with
// the given target false positive rate.
func newBloomSet(expectedN int, falsePositiveRate float64) *bloomSet {
	if expectedN < 100 {
		expectedN = 100
	}
	if falsePositiveRate <= 0 || falsePositiveRate >= 1 {
		falsePositiveRate = 0.001 // default 0.1%
	}

	// Optimal bit array size: m = -n * ln(p) / (ln(2))^2
	m := float64(expectedN) * -math.Log(falsePositiveRate) / (math.Ln2 * math.Ln2)
	// Optimal number of hash functions: k = (m/n) * ln(2)
	k := int(math.Ceil(m / float64(expectedN) * math.Ln2))
	if k < 1 {
		k = 1
	}

	numBits := int(math.Ceil(m))
	numWords := (numBits + 63) / 64

	return &bloomSet{
		bits:         make([]uint64, numWords),
		numWords:     numWords,
		numHashes:    k,
		expectedN:    expectedN,
		falsePosRate: falsePositiveRate,
	}
}

// hash computes the i-th hash of element using double hashing:
// h_i(x) = h1(x) + i * h2(x)
func (b *bloomSet) hashes(element string, i int) int {
	h := fnv.New64a()
	h.Write([]byte(element))
	h64 := h.Sum64()

	h1 := int(h64)
	h2 := int(h64 >> 32)
	if h2 < 0 {
		h2 = -h2
	}
	if h1 < 0 {
		h1 = -h1
	}

	bitIndex := (h1 + i*h2) % (b.numWords * 64)
	if bitIndex < 0 {
		bitIndex = -bitIndex
	}
	return bitIndex
}

func (b *bloomSet) Add(element string) bool {
	b.mu.Lock()
	defer b.mu.Unlock()

	// Check if already present (may have false positive).
	alreadyPresent := true
	for i := 0; i < b.numHashes; i++ {
		idx := b.hashes(element, i)
		wordIdx := idx / 64
		bitIdx := uint(idx % 64)
		if b.bits[wordIdx]&(1<<bitIdx) == 0 {
			alreadyPresent = false
			b.bits[wordIdx] |= 1 << bitIdx
		}
	}
	b.count++
	return !alreadyPresent
}

func (b *bloomSet) Has(element string) bool {
	b.mu.RLock()
	defer b.mu.RUnlock()
	for i := 0; i < b.numHashes; i++ {
		idx := b.hashes(element, i)
		wordIdx := idx / 64
		bitIdx := uint(idx % 64)
		if b.bits[wordIdx]&(1<<bitIdx) == 0 {
			return false // definitely not present
		}
	}
	return true // probably present (may be false positive)
}

// Count returns an estimate of the number of unique elements added.
// Uses the formula: n* = -(m/k) * ln(1 - X/m)
// where X is the number of bits set, m is the bit array size, k is the
// number of hash functions.
func (b *bloomSet) Count() int {
	b.mu.RLock()
	defer b.mu.RUnlock()

	// Count set bits.
	setBits := 0
	for _, word := range b.bits {
		setBits += popcount(word)
	}
	if setBits == 0 {
		return 0
	}

	m := float64(b.numWords * 64)
	k := float64(b.numHashes)
	// Swamidass & Baldi (2007) formula.
	n := -m / k * math.Log(1-float64(setBits)/m)
	return int(math.Round(n))
}

// Members returns nil — Bloom filters don't support member enumeration.
func (b *bloomSet) Members() []string {
	return nil
}

// Intersect returns 0 — Bloom filters don't support intersection.
// Use HLL for approximate intersection via Merge + Estimate.
func (b *bloomSet) Intersect(other interface{ Has(string) bool }) int {
	return 0
}

func (b *bloomSet) Reset() error {
	b.mu.Lock()
	for i := range b.bits {
		b.bits[i] = 0
	}
	b.count = 0
	b.mu.Unlock()
	return nil
}

// MemoryBytes returns the exact memory usage in bytes.
func (b *bloomSet) MemoryBytes() int {
	return b.numWords * 8
}

// popcount counts the number of set bits in a uint64.
func popcount(x uint64) int {
	// Software popcount (portable, no hardware dependency).
	x = x - ((x >> 1) & 0x5555555555555555)
	x = (x & 0x3333333333333333) + ((x >> 2) & 0x3333333333333333)
	x = (x + (x >> 4)) & 0x0f0f0f0f0f0f0f0f
	return int((x * 0x0101010101010101) >> 56)
}
