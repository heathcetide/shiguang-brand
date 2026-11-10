package bloom

import "math"

// Params describes the geometry of a Bloom filter: the number of bits m and
// the number of hash functions k.
type Params struct {
	// M is the number of bits in the bit array.
	M uint64

	// K is the number of hash functions.
	K uint64
}

// Estimate computes the optimal Params for a Bloom filter that should hold up
// to n elements with a target false-positive probability p.
//
// The formulas used are the standard ones:
//
//	m = -n * ln(p) / (ln(2)^2)
//	k = (m / n) * ln(2)
//
// n must be greater than zero and p must be in the open interval (0, 1).
// The returned values are rounded up to the nearest integer and k is clamped
// to at least 1.
func Estimate(n uint64, p float64) (Params, error) {
	if n == 0 {
		return Params{}, ErrInvalidCapacity
	}
	if !(p > 0 && p < 1) {
		return Params{}, ErrInvalidFalsePositiveRate
	}

	m := math.Ceil(float64(n) * -math.Log(p) / (math.Ln2 * math.Ln2))
	k := math.Ceil(math.Ln2 * m / float64(n))
	if k < 1 {
		k = 1
	}
	return Params{M: uint64(m), K: uint64(k)}, nil
}

// BitsToBytes returns the number of bytes required to store m bits.
func BitsToBytes(m uint64) uint64 {
	return (m + 7) / 8
}
