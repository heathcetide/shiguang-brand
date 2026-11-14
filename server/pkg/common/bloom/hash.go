package bloom

import "hash/fnv"

// doubleHash returns two independent-ish 64-bit hash values for key, used to
// synthesize k hash functions via the Kirsch-Mitzenmacher technique:
//
//	g_i(key) = (h1 + i*h2) mod m
//
// Using a single primitive (FNV-1a) with a salted second pass keeps the
// implementation dependency-free while producing well-distributed values.
func doubleHash(key string) (h1, h2 uint64) {
	f1 := fnv.New64a()
	_, _ = f1.Write([]byte(key))
	h1 = f1.Sum64()

	f2 := fnv.New64a()
	// Distinct salt so h2 is uncorrelated with h1.
	_, _ = f2.Write([]byte{0x5a, 0xc3, 0x91, 0xd7})
	_, _ = f2.Write([]byte(key))
	h2 = f2.Sum64()

	// A zero h2 would collapse all k indices to the same value; perturb it.
	if h2 == 0 {
		h2 = 0x9e3779b97f4a7c15
	}
	return h1, h2
}

// Indices returns the k bit positions for key within a filter of m bits.
// The returned slice reuses buf's capacity when possible; callers must copy it
// if they need to retain it across calls.
func Indices(key string, m, k uint64, buf []uint64) []uint64 {
	if cap(buf) < int(k) {
		buf = make([]uint64, k)
	} else {
		buf = buf[:k]
	}
	h1, h2 := doubleHash(key)
	for i := uint64(0); i < k; i++ {
		buf[i] = (h1 + i*h2) % m
	}
	return buf
}
