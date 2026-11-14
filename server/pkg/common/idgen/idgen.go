// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package idgen provides ID generation utilities:
//
//   - Snowflake: Twitter-style distributed unique IDs (microsecond precision)
//   - UUID v4:   random UUIDs (RFC 4122)
//   - UUID v7:   time-ordered UUIDs (RFC 9562)
//   - ShortID:   Base62-encoded compact IDs from snowflake or random bytes
//   - Ordered UUID: lexicographically sortable UUIDs (ULID-style)
//
// # Quick start
//
//	// Snowflake (distributed, needs MACHINE_ID env)
//	id := idgen.SnowflakeNext()        // int64
//	uid := idgen.SnowflakeNextUint()  // uint (sign-bit cleared)
//
//	// UUID
//	u4 := idgen.UUIDv4()              // "550e8400-e29b-41d4-a716-446655440000"
//	u7 := idgen.UUIDv7()              // "01905c9e-8a1e-7e3e-9c8a-2b4f8a3d1e5a"
//
//	// Short ID (Base62, 10-22 chars)
//	sid := idgen.ShortID()            // "7B3XkQ9m2P"
//
//	// Ordered UUID (sortable, 32 hex chars no dashes)
//	ouid := idgen.OrderedUUID()       // "01905c9e8a1e1d3e9c8a2b4f8a3d1e5a"
//
//	// Random strings
//	text := idgen.RandText(16)        // "a3b9f2e1c8d7..."
//	num  := idgen.RandNumberText(6)   // "384726"
package idgen

import (
	"crypto/rand"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	mathrand "math/rand"
	"os"
	"strconv"
	"sync"
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common/random"
)

// ============================================================
// Snowflake
// ============================================================

// Snowflake epoch: 2021-01-01 00:00:00 UTC in microseconds.
const snowflakeEpoch int64 = 1609459200000000

const (
	machineIDBits uint = 10
	sequenceBits  uint = 9

	maxMachineID   = -1 ^ (-1 << machineIDBits) // 1023
	maxSequence    = -1 ^ (-1 << sequenceBits)  // 511
	machineIDShift = sequenceBits
	timestampShift = machineIDBits + sequenceBits
)

// Snowflake is a Twitter-style snowflake ID generator with microsecond
// precision, 10-bit machine ID, and 9-bit sequence.
type Snowflake struct {
	mu        sync.Mutex
	lastStamp int64
	sequence  int64
	machineID int64
}

// defaultSnowflake is the package-level instance, initialised on load.
var defaultSnowflake *Snowflake

func init() {
	defaultSnowflake, _ = NewSnowflake()
}

// NewSnowflake creates a snowflake generator using the MACHINE_ID env var
// (defaults to 1 when unset or invalid). Machine ID must be in [0, 1023].
func NewSnowflake() (*Snowflake, error) {
	id := getMachineID()
	if id < 0 || id > maxMachineID {
		return nil, fmt.Errorf("idgen: machineID %d out of range [0, %d]", id, maxMachineID)
	}
	return &Snowflake{machineID: id}, nil
}

// NewSnowflakeWithID creates a snowflake generator with an explicit machine ID.
func NewSnowflakeWithID(machineID int64) (*Snowflake, error) {
	if machineID < 0 || machineID > maxMachineID {
		return nil, fmt.Errorf("idgen: machineID %d out of range [0, %d]", machineID, maxMachineID)
	}
	return &Snowflake{machineID: machineID}, nil
}

// NextID returns the next 64-bit snowflake ID. Returns 0 on clock rollback.
func (s *Snowflake) NextID() int64 {
	s.mu.Lock()
	defer s.mu.Unlock()

	now := currentMicro()
	if now < s.lastStamp {
		return 0
	}

	if now == s.lastStamp {
		s.sequence = (s.sequence + 1) & maxSequence
		if s.sequence == 0 {
			for now <= s.lastStamp {
				now = currentMicro()
			}
		}
	} else {
		s.sequence = 0
	}

	s.lastStamp = now

	return ((now - snowflakeEpoch) << timestampShift) |
		(s.machineID << machineIDShift) |
		s.sequence
}

// SnowflakeNext returns the next snowflake ID from the package-level generator.
func SnowflakeNext() int64 {
	if defaultSnowflake == nil {
		return 0
	}
	return defaultSnowflake.NextID()
}

// SnowflakeNextUint returns a snowflake ID safe for uint + signed INTEGER
// stores (e.g. SQLite). Clears the sign bit so values never exceed
// math.MaxInt64.
func SnowflakeNextUint() uint {
	if defaultSnowflake == nil {
		return 0
	}
	return uint(uint64(defaultSnowflake.NextID()) & 0x7FFFFFFFFFFFFFFF)
}

// ClampSnowflakeUint clears the sign bit so IDs remain scannable from
// signed INTEGER columns.
func ClampSnowflakeUint(id uint) uint {
	return id & 0x7FFFFFFFFFFFFFFF
}

func currentMicro() int64 {
	return time.Now().UnixNano() / 1e3
}

func getMachineID() int64 {
	val := os.Getenv("MACHINE_ID")
	id, err := strconv.ParseInt(val, 10, 64)
	if err != nil {
		return 1
	}
	return id
}

// ============================================================
// UUID v4 (random)
// ============================================================

// UUIDv4 generates a random UUID v4 string in canonical form:
// "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx" where y is 8, 9, a, or b.
//
// Delegates to random.UUID for the underlying implementation.
func UUIDv4() string {
	return random.UUID()
}

// UUIDv4Bytes generates a random UUID v4 as 16 raw bytes.
//
// Delegates to random.UUIDBytes for the underlying implementation.
func UUIDv4Bytes() [16]byte {
	return random.UUIDBytes()
}

// ============================================================
// UUID v7 (time-ordered, RFC 9562)
// ============================================================

// UUIDv7 generates a time-ordered UUID v7 string. The first 48 bits encode
// a Unix timestamp in milliseconds, making UUIDs lexicographically sortable
// by creation time. The remaining bits are random.
func UUIDv7() string {
	var b [16]byte

	// 48-bit Unix millisecond timestamp.
	ms := time.Now().UnixMilli()
	binary.BigEndian.PutUint64(b[:8], uint64(ms))
	// Shift right 16 bits to fit 48 bits into b[0:6].
	b[0] = byte(ms >> 40)
	b[1] = byte(ms >> 32)
	b[2] = byte(ms >> 24)
	b[3] = byte(ms >> 16)
	b[4] = byte(ms >> 8)
	b[5] = byte(ms)

	// 74 bits of randomness (b[6:16]).
	if _, err := rand.Read(b[6:]); err != nil {
		mathrand.Read(b[6:])
	}
	// Set version (7) and variant (RFC 4122).
	b[6] = (b[6] & 0x0f) | 0x70
	b[8] = (b[8] & 0x3f) | 0x80
	return formatUUID(b[:])
}

// UUIDv7Bytes generates a time-ordered UUID v7 as 16 raw bytes.
func UUIDv7Bytes() [16]byte {
	var b [16]byte
	ms := time.Now().UnixMilli()
	b[0] = byte(ms >> 40)
	b[1] = byte(ms >> 32)
	b[2] = byte(ms >> 24)
	b[3] = byte(ms >> 16)
	b[4] = byte(ms >> 8)
	b[5] = byte(ms)
	if _, err := rand.Read(b[6:]); err != nil {
		mathrand.Read(b[6:])
	}
	b[6] = (b[6] & 0x0f) | 0x70
	b[8] = (b[8] & 0x3f) | 0x80
	return b
}

// formatUUID formats 16 bytes into "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx".
func formatUUID(b []byte) string {
	return fmt.Sprintf("%x-%x-%x-%x-%x",
		b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

// ============================================================
// Ordered UUID (ULID-style, lexicographically sortable)
// ============================================================

// OrderedUUID generates a 32-character hex string (no dashes) that is
// lexicographically sortable by creation time. The first 12 hex chars
// encode a 48-bit millisecond timestamp; the remaining 20 hex chars are
// random. This is similar to ULID but uses hex encoding for simplicity.
//
// Example: "01905c9e8a1e-1d3e9c8a2b4f8a3d1e5a" (without the dash)
func OrderedUUID() string {
	var b [16]byte

	ms := time.Now().UnixMilli()
	b[0] = byte(ms >> 40)
	b[1] = byte(ms >> 32)
	b[2] = byte(ms >> 24)
	b[3] = byte(ms >> 16)
	b[4] = byte(ms >> 8)
	b[5] = byte(ms)

	if _, err := rand.Read(b[6:]); err != nil {
		mathrand.Read(b[6:])
	}
	return hex.EncodeToString(b[:])
}

// ============================================================
// Short ID (Base62)
// ============================================================

const base62Chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"

// ShortID generates a short Base62-encoded ID from a snowflake ID.
// The result is typically 10-12 characters, URL-safe, and sortable.
func ShortID() string {
	id := SnowflakeNext()
	if id <= 0 {
		// Fallback to random if snowflake isn't ready.
		return RandomShortID(12)
	}
	return encodeBase62(uint64(id))
}

// ShortIDFromInt encodes an arbitrary uint64 into a Base62 short ID.
func ShortIDFromInt(id uint64) string {
	return encodeBase62(id)
}

// RandomShortID generates a random Base62 string of the given length.
// Use length >= 10 for reasonable collision resistance.
//
// Delegates to random.StringWithCharset with CharsetBase62, which uses
// rejection sampling to avoid modulo bias.
func RandomShortID(length int) string {
	return random.StringWithCharset(length, random.CharsetBase62)
}

// encodeBase62 encodes a uint64 into a Base62 string.
func encodeBase62(n uint64) string {
	if n == 0 {
		return "0"
	}
	var buf [22]byte // uint64 max = 18446744073709551615 → 22 chars in base62
	idx := len(buf)
	for n > 0 {
		idx--
		buf[idx] = base62Chars[n%62]
		n /= 62
	}
	return string(buf[idx:])
}

// decodeBase62 decodes a Base62 string back to uint64.
func decodeBase62(s string) (uint64, error) {
	var result uint64
	for _, c := range s {
		idx := -1
		switch {
		case c >= '0' && c <= '9':
			idx = int(c - '0')
		case c >= 'A' && c <= 'Z':
			idx = int(c-'A') + 10
		case c >= 'a' && c <= 'z':
			idx = int(c-'a') + 36
		default:
			return 0, fmt.Errorf("idgen: invalid base62 character %q", c)
		}
		result = result*62 + uint64(idx)
	}
	return result, nil
}

// ShortIDToInt decodes a Base62 short ID back to uint64.
func ShortIDToInt(s string) (uint64, error) {
	return decodeBase62(s)
}

// ============================================================
// Random strings
// ============================================================

// letterCharset is the lowercase-alphanumeric charset used by RandText.
// It matches "0123456789abcdefghijklmnopqrstuvwxyz" (digits + lowercase).
var letterCharset = random.CharsetNumeric + random.CharsetAlphaLower

// RandText generates a random lowercase-alphanumeric string of length n.
//
// Delegates to random.StringWithCharset with the digits+lowercase charset.
func RandText(n int) string {
	return random.StringWithCharset(n, letterCharset)
}

// RandNumberText generates a random numeric string of length n.
//
// Delegates to random.NumericString.
func RandNumberText(n int) string {
	return random.NumericString(n)
}

// RandTextWithCharset generates a random string of length n using the
// provided character set.
//
// Delegates to random.StringWithCharset.
func RandTextWithCharset(n int, charset string) string {
	return random.StringWithCharset(n, charset)
}

// ============================================================
// ULID (Universally Unique Lexicographically Sortable Identifier)
// ============================================================

// crockfordBase32 is the Crockford Base32 encoding alphabet used by
// ULID. It excludes the letters I, L, O and U to avoid confusion.
const crockfordBase32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

// ulidTime is the timestamp captured at package init, used to detect
// clock rollback in ULID generation.
var ulidMu sync.Mutex
var ulidLastMs int64

// ULID generates a 26-character Crockford Base32 encoded ULID
// (Universally Unique Lexicographically Sortable Identifier).
//
// The first 10 characters encode a 48-bit Unix millisecond timestamp,
// making ULIDs lexicographically sortable by creation time. The
// remaining 16 characters are 80 bits of cryptographic randomness.
//
// Example: "01ARZ3NDEKTSV4RRFFQ69G5FAV"
func ULID() string {
	return ulIDFromTime(time.Now().UnixMilli())
}

// ulIDFromTime builds a ULID string from the given millisecond
// timestamp. It guards against clock rollback so that timestamps are
// monotonically non-decreasing within a single process.
func ulIDFromTime(ms int64) string {
	ulidMu.Lock()
	defer ulidMu.Unlock()

	if ms < ulidLastMs {
		ms = ulidLastMs
	}
	ulidLastMs = ms

	var b [16]byte
	// 48-bit timestamp (big-endian) into b[0:6].
	b[0] = byte(ms >> 40)
	b[1] = byte(ms >> 32)
	b[2] = byte(ms >> 24)
	b[3] = byte(ms >> 16)
	b[4] = byte(ms >> 8)
	b[5] = byte(ms)

	// 80 bits of randomness into b[6:16].
	if _, err := rand.Read(b[6:]); err != nil {
		mathrand.Read(b[6:])
	}

	return encodeCrockfordBase32(b[:])
}

// encodeCrockfordBase32 encodes 16 bytes into a 26-character Crockford
// Base32 string. The encoding processes the 128 bits in 5-bit groups
// from the most-significant bit, padding the final group with zero
// bits as needed.
func encodeCrockfordBase32(b []byte) string {
	// 128 bits → 26 groups of 5 bits (with 2 padding bits at the end).
	var result [26]byte

	// Bit buffer approach: read bits from the most-significant end.
	// We process 5 bits at a time.
	bitIdx := 0
	totalBits := len(b) * 8
	for i := 0; i < 26; i++ {
		var val byte
		bitsNeeded := 5
		for bitsNeeded > 0 && bitIdx < totalBits {
			byteIdx := bitIdx / 8
			bitInByte := 7 - (bitIdx % 8) // MSB first
			bit := (b[byteIdx] >> bitInByte) & 1
			val = (val << 1) | bit
			bitIdx++
			bitsNeeded--
		}
		// Pad remaining bits with zeros.
		val <<= bitsNeeded
		if bitsNeeded > 0 {
			val <<= 0 // already shifted above
		}
		result[i] = crockfordBase32[val]
	}

	return string(result[:])
}

// ============================================================
// NanoID
// ============================================================

// nanoIDDefaultAlphabet is the default URL-safe alphabet used by
// NanoID. It contains 64 characters (A-Za-z0-9_-) which maps cleanly
// to 6-bit values.
const nanoIDDefaultAlphabet = "_-0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"

// nanoIDDefaultSize is the default NanoID length.
const nanoIDDefaultSize = 21

// NanoID generates a NanoID string of the given size using the default
// URL-safe alphabet. If size <= 0 the default size (21) is used.
//
// Example: "V1StGXR8_Z5jdHi6B-myT"
func NanoID(size int) string {
	if size <= 0 {
		size = nanoIDDefaultSize
	}
	return NanoIDWithAlphabet(size, nanoIDDefaultAlphabet)
}

// NanoIDWithAlphabet generates a NanoID string of the given size using
// a custom alphabet. The alphabet must be non-empty; if it is empty
// the default alphabet is used instead.
//
// The implementation uses crypto/rand to securely select characters
// from the alphabet, avoiding modulo bias by masking random bytes.
func NanoIDWithAlphabet(size int, alphabet string) string {
	if size <= 0 {
		size = nanoIDDefaultSize
	}
	if alphabet == "" {
		alphabet = nanoIDDefaultAlphabet
	}

	abcLen := len(alphabet)
	// Calculate the mask: smallest power of 2 minus 1 that is >= abcLen.
	// This reduces the rejection rate in the unbiased selection loop.
	mask := 1
	for mask < abcLen {
		mask <<= 1
	}
	mask-- // e.g. 63 for a 64-char alphabet

	result := make([]byte, size)
	// step is how many random bytes to fetch per batch; we use a
	// reasonable batch size to amortise rand.Read calls.
	step := (size*6 + 7) / 8
	if step < 4 {
		step = 4
	}

	idx := 0
	for idx < size {
		randBuf := make([]byte, step)
		if _, err := rand.Read(randBuf); err != nil {
			mathrand.Read(randBuf)
		}

		for _, b := range randBuf {
			val := int(b) & mask
			if val < abcLen {
				result[idx] = alphabet[val]
				idx++
				if idx >= size {
					break
				}
			}
		}
	}

	return string(result)
}

// ============================================================
// Errors
// ============================================================

// ErrInvalidMachineID is returned when the machine ID is out of range.
var ErrInvalidMachineID = errors.New("idgen: machineID out of range")
