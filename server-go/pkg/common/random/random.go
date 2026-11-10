// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package random provides cryptographically secure random utilities:
//
//   - Secure random numbers (crypto/rand): Int, IntRange, Float64, Bytes
//   - Random strings with custom charsets: String, StringWithCharset
//   - Sampling & shuffling: Shuffle, Sample, Choice, Permutation
//   - Random colors: HexColor, RGBColor, HSLColor
//   - UUID v4 (RFC 4122)
//
// All functions use crypto/rand and are safe for concurrent use.
package random

import (
	"crypto/rand"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"math/big"
	mathrand "math/rand/v2"
	"strings"
)

// ──────────────────────────────────────────────
// Character sets
// ──────────────────────────────────────────────

// Predefined character sets for random string generation.
const (
	CharsetAlphaLower = "abcdefghijklmnopqrstuvwxyz"
	CharsetAlphaUpper = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
	CharsetAlpha      = CharsetAlphaLower + CharsetAlphaUpper
	CharsetNumeric    = "0123456789"
	CharsetAlphaNum   = CharsetAlpha + CharsetNumeric
	CharsetHexLower   = "0123456789abcdef"
	CharsetHexUpper   = "0123456789ABCDEF"
	CharsetBase62     = CharsetAlphaNum
	CharsetBase64URL  = CharsetAlphaNum + "-_"
	CharsetSymbol     = "!@#$%^&*()-_=+[]{}|;:,.<>?"
)

// ──────────────────────────────────────────────
// Secure random numbers (crypto/rand)
// ──────────────────────────────────────────────

// Int returns a cryptographically secure random non-negative int.
func Int() int {
	n, err := rand.Int(rand.Reader, big.NewInt(1<<62))
	if err != nil {
		// crypto/rand.Reader should never fail on a healthy system.
		panic(fmt.Sprintf("random: read failed: %v", err))
	}
	return int(n.Int64())
}

// Intn returns a cryptographically secure random int in [0, n).
// Panics if n <= 0.
func Intn(n int) int {
	if n <= 0 {
		panic("random: Intn requires n > 0")
	}
	nb := big.NewInt(int64(n))
	result, err := rand.Int(rand.Reader, nb)
	if err != nil {
		panic(fmt.Sprintf("random: Intn read failed: %v", err))
	}
	return int(result.Int64())
}

// IntRange returns a cryptographically secure random int in [min, max].
// Panics if min > max.
func IntRange(min, max int) int {
	if min > max {
		panic("random: IntRange requires min <= max")
	}
	if min == max {
		return min
	}
	return min + Intn(max-min+1)
}

// Int64 returns a cryptographically secure random int64 in [0, 1<<62).
func Int64() int64 {
	n, err := rand.Int(rand.Reader, big.NewInt(1<<62))
	if err != nil {
		panic(fmt.Sprintf("random: Int64 read failed: %v", err))
	}
	return n.Int64()
}

// Int64n returns a cryptographically secure random int64 in [0, n).
// Panics if n <= 0.
func Int64n(n int64) int64 {
	if n <= 0 {
		panic("random: Int64n requires n > 0")
	}
	result, err := rand.Int(rand.Reader, big.NewInt(n))
	if err != nil {
		panic(fmt.Sprintf("random: Int64n read failed: %v", err))
	}
	return result.Int64()
}

// Int64Range returns a cryptographically secure random int64 in [min, max].
// Panics if min > max.
func Int64Range(min, max int64) int64 {
	if min > max {
		panic("random: Int64Range requires min <= max")
	}
	if min == max {
		return min
	}
	return min + Int64n(max-min+1)
}

// Float64 returns a cryptographically secure random float64 in [0.0, 1.0).
func Float64() float64 {
	// Use 53 bits of randomness for full float64 precision.
	var b [8]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(fmt.Sprintf("random: Float64 read failed: %v", err))
	}
	// Mask the sign bit and exponent to get [0, 1).
	v := binary.LittleEndian.Uint64(b[:])
	// Use bits 0-52 for mantissa, giving [0, 1) with 53-bit precision.
	return float64(v>>11) / (1 << 53)
}

// Float64Range returns a cryptographically secure random float64 in [min, max).
func Float64Range(min, max float64) float64 {
	if min >= max {
		panic("random: Float64Range requires min < max")
	}
	return min + Float64()*(max-min)
}

// Bool returns a cryptographically secure random bool.
func Bool() bool {
	var b [1]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(fmt.Sprintf("random: Bool read failed: %v", err))
	}
	return b[0]&1 == 1
}

// Bytes returns n cryptographically secure random bytes.
func Bytes(n int) []byte {
	if n < 0 {
		panic("random: Bytes requires n >= 0")
	}
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic(fmt.Sprintf("random: Bytes read failed: %v", err))
	}
	return b
}

// Read fills b with cryptographically secure random bytes.
// It is a drop-in replacement for crypto/rand.Read.
func Read(b []byte) (int, error) {
	return rand.Read(b)
}

// ──────────────────────────────────────────────
// Random strings
// ──────────────────────────────────────────────

// String returns a random string of length n using CharsetAlphaNum.
func String(n int) string {
	return StringWithCharset(n, CharsetAlphaNum)
}

// StringWithCharset returns a random string of length n using the
// given charset. Panics if charset is empty or n < 0.
func StringWithCharset(n int, charset string) string {
	if n < 0 {
		panic("random: StringWithCharset requires n >= 0")
	}
	if len(charset) == 0 {
		panic("random: StringWithCharset requires non-empty charset")
	}
	if n == 0 {
		return ""
	}
	// Generate random bytes and map to charset indices.
	// To avoid modulo bias, we reject bytes >= 256-(256%len(charset)).
	maxVal := 256 - (256 % len(charset))
	buf := make([]byte, n)
	generated := 0
	for generated < n {
		chunk := make([]byte, n-generated)
		if _, err := rand.Read(chunk); err != nil {
			panic(fmt.Sprintf("random: StringWithCharset read failed: %v", err))
		}
		for _, b := range chunk {
			if int(b) >= maxVal {
				continue
			}
			buf[generated] = charset[int(b)%len(charset)]
			generated++
			if generated >= n {
				break
			}
		}
	}
	return string(buf)
}

// LowerString returns a random lowercase-alpha string of length n.
func LowerString(n int) string { return StringWithCharset(n, CharsetAlphaLower) }

// UpperString returns a random uppercase-alpha string of length n.
func UpperString(n int) string { return StringWithCharset(n, CharsetAlphaUpper) }

// NumericString returns a random numeric string of length n.
func NumericString(n int) string { return StringWithCharset(n, CharsetNumeric) }

// HexString returns a random lowercase hex string of length n.
func HexString(n int) string { return StringWithCharset(n, CharsetHexLower) }

// Base64URLString returns a random URL-safe base64 string of length n.
func Base64URLString(n int) string { return StringWithCharset(n, CharsetBase64URL) }

// Password returns a random password of length n containing at least
// one lowercase, one uppercase, one digit, and one symbol.
// Panics if n < 4.
func Password(n int) string {
	if n < 4 {
		panic("random: Password requires n >= 4")
	}
	// Guarantee at least one of each required class.
	result := make([]byte, n)
	result[0] = randomChar(CharsetAlphaLower)
	result[1] = randomChar(CharsetAlphaUpper)
	result[2] = randomChar(CharsetNumeric)
	result[3] = randomChar(CharsetSymbol)
	for i := 4; i < n; i++ {
		result[i] = randomChar(CharsetAlphaNum + CharsetSymbol)
	}
	// Shuffle to avoid predictable positions.
	ShuffleBytes(result)
	return string(result)
}

// randomChar returns a single random character from the charset.
func randomChar(charset string) byte {
	return StringWithCharset(1, charset)[0]
}

// ──────────────────────────────────────────────
// Sampling & shuffling
// ──────────────────────────────────────────────

// ShuffleBytes shuffles a byte slice in-place using crypto/rand.
func ShuffleBytes(s []byte) {
	for i := len(s) - 1; i > 0; i-- {
		j := Intn(i + 1)
		s[i], s[j] = s[j], s[i]
	}
}

// ShuffleInts shuffles an int slice in-place using crypto/rand.
func ShuffleInts(s []int) {
	for i := len(s) - 1; i > 0; i-- {
		j := Intn(i + 1)
		s[i], s[j] = s[j], s[i]
	}
}

// Shuffle shuffles a slice in-place using a swap function.
// The swap function is called for indices i and j.
func Shuffle(n int, swap func(i, j int)) {
	for i := n - 1; i > 0; i-- {
		j := Intn(i + 1)
		swap(i, j)
	}
}

// Choice returns a random element from a slice. Panics if the slice is empty.
func Choice[T any](s []T) T {
	if len(s) == 0 {
		panic("random: Choice requires non-empty slice")
	}
	return s[Intn(len(s))]
}

// Choices returns k random elements from a slice (with replacement).
// Panics if the slice is empty or k < 0.
func Choices[T any](s []T, k int) []T {
	if len(s) == 0 {
		panic("random: Choices requires non-empty slice")
	}
	if k < 0 {
		panic("random: Choices requires k >= 0")
	}
	result := make([]T, k)
	for i := range result {
		result[i] = s[Intn(len(s))]
	}
	return result
}

// Sample returns k unique random elements from a slice (without replacement).
// Panics if k > len(s) or k < 0 or s is empty.
func Sample[T any](s []T, k int) []T {
	if k < 0 {
		panic("random: Sample requires k >= 0")
	}
	if k > len(s) {
		panic("random: Sample requires k <= len(s)")
	}
	if k == 0 {
		return []T{}
	}
	// Fisher-Yates partial shuffle: pick k elements.
	indices := make([]int, len(s))
	for i := range indices {
		indices[i] = i
	}
	for i := 0; i < k; i++ {
		j := Intn(len(indices)-i) + i
		indices[i], indices[j] = indices[j], indices[i]
	}
	result := make([]T, k)
	for i := 0; i < k; i++ {
		result[i] = s[indices[i]]
	}
	return result
}

// Permutation returns a random permutation of [0, n) using crypto/rand.
func Permutation(n int) []int {
	if n < 0 {
		panic("random: Permutation requires n >= 0")
	}
	result := make([]int, n)
	for i := range result {
		result[i] = i
	}
	ShuffleInts(result)
	return result
}

// ──────────────────────────────────────────────
// Random colors
// ──────────────────────────────────────────────

// RGB represents an RGB color with values 0-255.
type RGB struct{ R, G, B uint8 }

// Hex returns the hex color string (e.g. "#a3b9f2").
func (c RGB) Hex() string {
	return fmt.Sprintf("#%02x%02x%02x", c.R, c.G, c.B)
}

// HSL represents an HSL color with H in [0, 360), S/L in [0, 1].
type HSL struct{ H, S, L float64 }

// RGBColor returns a random RGB color.
func RGBColor() RGB {
	b := Bytes(3)
	return RGB{R: b[0], G: b[1], B: b[2]}
}

// HexColor returns a random hex color string (e.g. "#a3b9f2").
func HexColor() string {
	return RGBColor().Hex()
}

// HSLColor returns a random HSL color with good visual distribution.
// Hue is uniform [0, 360), saturation and lightness are in comfortable
// ranges for pleasing colors.
func HSLColor() HSL {
	return HSL{
		H: Float64() * 360,
		S: 0.5 + Float64()*0.4, // 0.5 - 0.9
		L: 0.4 + Float64()*0.4, // 0.4 - 0.8
	}
}

// HSLToRGB converts an HSL color to RGB.
func HSLToRGB(hsl HSL) RGB {
	h, s, l := hsl.H/360, hsl.S, hsl.L
	if s == 0 {
		v := uint8(l * 255)
		return RGB{R: v, G: v, B: v}
	}
	var q float64
	if l < 0.5 {
		q = l * (1 + s)
	} else {
		q = l + s - l*s
	}
	p := 2*l - q
	return RGB{
		R: hueToRGB(p, q, h+1.0/3),
		G: hueToRGB(p, q, h),
		B: hueToRGB(p, q, h-1.0/3),
	}
}

func hueToRGB(p, q, t float64) uint8 {
	if t < 0 {
		t += 1
	}
	if t > 1 {
		t -= 1
	}
	switch {
	case t < 1.0/6:
		return uint8((p + (q-p)*6*t) * 255)
	case t < 0.5:
		return uint8(q * 255)
	case t < 2.0/3:
		return uint8((p + (q-p)*(2.0/3-t)*6) * 255)
	default:
		return uint8(p * 255)
	}
}

// ──────────────────────────────────────────────
// UUID v4 (RFC 4122)
// ──────────────────────────────────────────────

// UUID returns a random UUID v4 string in canonical form
// (e.g. "550e8400-e29b-41d4-a716-446655440000").
func UUID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(fmt.Sprintf("random: UUID read failed: %v", err))
	}
	// Set version (4) and variant (RFC 4122).
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	dst := make([]byte, 36)
	hex.Encode(dst[0:8], b[0:4])
	dst[8] = '-'
	hex.Encode(dst[9:13], b[4:6])
	dst[13] = '-'
	hex.Encode(dst[14:18], b[6:8])
	dst[18] = '-'
	hex.Encode(dst[19:23], b[8:10])
	dst[23] = '-'
	hex.Encode(dst[24:36], b[10:16])
	return string(dst)
}

// UUIDBytes returns 16 random bytes formatted as a UUID v4.
// The returned bytes have the version and variant bits set.
func UUIDBytes() [16]byte {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(fmt.Sprintf("random: UUIDBytes read failed: %v", err))
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return b
}

// UUIDNoDashes returns a random UUID v4 string without dashes
// (32 hex characters).
func UUIDNoDashes() string {
	return strings.ReplaceAll(UUID(), "-", "")
}

// ──────────────────────────────────────────────
// Convenience: math/rand/v2 seeded source (for non-crypto use)
// ──────────────────────────────────────────────

// MathShuffle shuffles a slice using math/rand/v2 (faster, non-crypto).
// Useful when cryptographic security is not required.
func MathShuffle[T any](s []T) {
	mathrand.Shuffle(len(s), func(i, j int) {
		s[i], s[j] = s[j], s[i]
	})
}

// MathIntn returns a non-cryptographic random int in [0, n) using
// math/rand/v2. Faster than Intn but not secure.
func MathIntn(n int) int {
	return mathrand.IntN(n)
}
