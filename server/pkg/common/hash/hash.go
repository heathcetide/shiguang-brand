// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package hash provides hashing utilities:
//
//   - Standard hashes: MD5, SHA-1, SHA-256, SHA-512
//   - HMAC: HMAC-SHA1, HMAC-SHA256, HMAC-SHA512
//   - CRC: CRC32, CRC64
//   - MurmurHash3: 32-bit and 128-bit (x64) non-cryptographic hashes
//   - xxHash: xxHash64 and xxHash32 non-cryptographic hashes
//   - Hash file/stream helpers
//
// # Quick start
//
//	hash.MD5Hex([]byte("hello"))           // "5d41402abc4b2a76b9719d911017c592"
//	hash.SHA256Hex([]byte("hello"))
//	hash.HMACSHA256Hex([]byte("data"), key)
//	hash.Murmur3_32Hex([]byte("hello"), 0)
//	hash.XXHash64Hex([]byte("hello"), 0)
package hash

import (
	"crypto/hmac"
	"crypto/md5"
	"crypto/sha1"
	"crypto/sha256"
	"crypto/sha512"
	"encoding/hex"
	"fmt"
	"hash/adler32"
	"hash/crc32"
	"hash/crc64"
	"hash/fnv"
	"io"
	"os"
	"strings"
)

// ──────────────────────────────────────────────
// Standard hashes
// ──────────────────────────────────────────────

// MD5 returns the MD5 hash of data.
func MD5(data []byte) []byte {
	sum := md5.Sum(data)
	return sum[:]
}

// MD5Hex returns the MD5 hash of data as a lowercase hex string.
func MD5Hex(data []byte) string {
	return hex.EncodeToString(MD5(data))
}

// MD5String returns the MD5 hash of a string as a hex string.
func MD5String(s string) string { return MD5Hex([]byte(s)) }

// SHA1 returns the SHA-1 hash of data.
func SHA1(data []byte) []byte {
	sum := sha1.Sum(data)
	return sum[:]
}

// SHA1Hex returns the SHA-1 hash of data as a lowercase hex string.
func SHA1Hex(data []byte) string { return hex.EncodeToString(SHA1(data)) }

// SHA1String returns the SHA-1 hash of a string as a hex string.
func SHA1String(s string) string { return SHA1Hex([]byte(s)) }

// SHA256 returns the SHA-256 hash of data.
func SHA256(data []byte) []byte {
	sum := sha256.Sum256(data)
	return sum[:]
}

// SHA256Hex returns the SHA-256 hash of data as a lowercase hex string.
func SHA256Hex(data []byte) string { return hex.EncodeToString(SHA256(data)) }

// SHA256String returns the SHA-256 hash of a string as a hex string.
func SHA256String(s string) string { return SHA256Hex([]byte(s)) }

// SHA512 returns the SHA-512 hash of data.
func SHA512(data []byte) []byte {
	sum := sha512.Sum512(data)
	return sum[:]
}

// SHA512Hex returns the SHA-512 hash of data as a lowercase hex string.
func SHA512Hex(data []byte) string { return hex.EncodeToString(SHA512(data)) }

// SHA512String returns the SHA-512 hash of a string as a hex string.
func SHA512String(s string) string { return SHA512Hex([]byte(s)) }

// ──────────────────────────────────────────────
// HMAC
// ──────────────────────────────────────────────

// HMACSHA1 returns the HMAC-SHA1 of data using key.
func HMACSHA1(data, key []byte) []byte {
	h := hmac.New(sha1.New, key)
	h.Write(data)
	return h.Sum(nil)
}

// HMACSHA256 returns the HMAC-SHA256 of data using key.
func HMACSHA256(data, key []byte) []byte {
	h := hmac.New(sha256.New, key)
	h.Write(data)
	return h.Sum(nil)
}

// HMACSHA256Hex returns the HMAC-SHA256 of data as a hex string.
func HMACSHA256Hex(data, key []byte) string {
	return hex.EncodeToString(HMACSHA256(data, key))
}

// HMACSHA512 returns the HMAC-SHA512 of data using key.
func HMACSHA512(data, key []byte) []byte {
	h := hmac.New(sha512.New, key)
	h.Write(data)
	return h.Sum(nil)
}

// HMACSHA512Hex returns the HMAC-SHA512 of data as a hex string.
func HMACSHA512Hex(data, key []byte) string {
	return hex.EncodeToString(HMACSHA512(data, key))
}

// HMACEqual compares two HMAC values in constant time.
func HMACEqual(a, b []byte) bool {
	return hmac.Equal(a, b)
}

// ──────────────────────────────────────────────
// CRC
// ──────────────────────────────────────────────

// CRC32 returns the CRC32 checksum of data (IEEE polynomial).
func CRC32(data []byte) uint32 {
	return crc32.ChecksumIEEE(data)
}

// CRC32Hex returns the CRC32 checksum as a hex string.
func CRC32Hex(data []byte) string {
	return fmt.Sprintf("%08x", CRC32(data))
}

// CRC64 returns the CRC64 checksum of data (ISO polynomial).
func CRC64(data []byte) uint64 {
	return crc64.Checksum(data, crc64.MakeTable(crc64.ISO))
}

// CRC64Hex returns the CRC64 checksum as a hex string.
func CRC64Hex(data []byte) string {
	return fmt.Sprintf("%016x", CRC64(data))
}

// CRC16CCITT returns the CRC16-CCITT checksum of data (poly 0x1021).
func CRC16CCITT(data []byte) uint16 {
	var crc uint16
	for _, b := range data {
		idx := byte((crc >> 8) ^ uint16(b))
		crc = (crc << 8) ^ crc16Tab[idx]
	}
	return crc
}

// CRC16 returns the CRC16-CCITT checksum of data.
func CRC16(data []byte) uint16 { return CRC16CCITT(data) }

// CRC16Hex returns the CRC16-CCITT checksum as a hex string.
func CRC16Hex(data []byte) string {
	return fmt.Sprintf("%04x", CRC16CCITT(data))
}

var crc16Tab = makeCRC16Table(0x1021)

func makeCRC16Table(poly uint16) [256]uint16 {
	var tab [256]uint16
	for i := 0; i < 256; i++ {
		var crc uint16 = uint16(i) << 8
		for j := 0; j < 8; j++ {
			if crc&0x8000 != 0 {
				crc = (crc << 1) ^ poly
			} else {
				crc <<= 1
			}
		}
		tab[i] = crc
	}
	return tab
}

// Adler32 returns the Adler-32 checksum of data.
func Adler32(data []byte) uint32 {
	return adler32.Checksum(data)
}

// FNV1a32 returns the FNV-1a 32-bit hash of data.
func FNV1a32(data []byte) uint32 {
	h := fnv.New32a()
	h.Write(data)
	return h.Sum32()
}

// FNV1a64 returns the FNV-1a 64-bit hash of data.
func FNV1a64(data []byte) uint64 {
	h := fnv.New64a()
	h.Write(data)
	return h.Sum64()
}

// ──────────────────────────────────────────────
// MurmurHash3
// ──────────────────────────────────────────────

// Murmur3_32 returns the MurmurHash3 32-bit hash of data with the given seed.
func Murmur3_32(data []byte, seed uint32) uint32 {
	return murmur3_32_impl(data, seed)
}

// Murmur3_32Hex returns the MurmurHash3 32-bit hash as a hex string.
func Murmur3_32Hex(data []byte, seed uint32) string {
	return fmt.Sprintf("%08x", Murmur3_32(data, seed))
}

// Murmur3_128 returns the MurmurHash3 128-bit hash (x64) as two uint64 values.
func Murmur3_128(data []byte, seed uint32) (uint64, uint64) {
	return murmur3_128_x64(data, seed)
}

// Murmur3_128Hex returns the MurmurHash3 128-bit hash as a hex string.
func Murmur3_128Hex(data []byte, seed uint32) string {
	h1, h2 := Murmur3_128(data, seed)
	return fmt.Sprintf("%016x%016x", h1, h2)
}

// murmur3_32_impl is the MurmurHash3 x86 32-bit implementation.
func murmur3_32_impl(data []byte, seed uint32) uint32 {
	const c1 uint32 = 0xcc9e2d51
	const c2 uint32 = 0x1b873593

	h := seed
	nblocks := len(data) / 4

	for i := 0; i < nblocks; i++ {
		k := uint32(data[i*4]) | uint32(data[i*4+1])<<8 | uint32(data[i*4+2])<<16 | uint32(data[i*4+3])<<24
		k *= c1
		k = k<<15 | k>>17 // ROTL32(k, 15)
		k *= c2
		h ^= k
		h = h<<13 | h>>19 // ROTL32(h, 13)
		h = h*5 + 0xe6546b64
	}

	tail := data[nblocks*4:]
	var k1 uint32
	switch len(tail) {
	case 3:
		k1 ^= uint32(tail[2]) << 16
		fallthrough
	case 2:
		k1 ^= uint32(tail[1]) << 8
		fallthrough
	case 1:
		k1 ^= uint32(tail[0])
		k1 *= c1
		k1 = k1<<15 | k1>>17
		k1 *= c2
		h ^= k1
	}

	h ^= uint32(len(data))
	h ^= h >> 16
	h *= 0x85ebca6b
	h ^= h >> 13
	h *= 0xc2b2ae35
	h ^= h >> 16
	return h
}

// murmur3_128_x64 is the MurmurHash3 x64 128-bit implementation.
func murmur3_128_x64(data []byte, seed uint32) (uint64, uint64) {
	const c1 uint64 = 0x87c37b91114253d5
	const c2 uint64 = 0x4cf5ad432745937f

	h1 := uint64(seed)
	h2 := uint64(seed)
	nblocks := len(data) / 16

	for i := 0; i < nblocks; i++ {
		k1 := uint64(data[i*16]) | uint64(data[i*16+1])<<8 | uint64(data[i*16+2])<<16 | uint64(data[i*16+3])<<24 |
			uint64(data[i*16+4])<<32 | uint64(data[i*16+5])<<40 | uint64(data[i*16+6])<<48 | uint64(data[i*16+7])<<56
		k2 := uint64(data[i*16+8]) | uint64(data[i*16+9])<<8 | uint64(data[i*16+10])<<16 | uint64(data[i*16+11])<<24 |
			uint64(data[i*16+12])<<32 | uint64(data[i*16+13])<<40 | uint64(data[i*16+14])<<48 | uint64(data[i*16+15])<<56

		k1 *= c1
		k1 = k1<<31 | k1>>33 // ROTL64(k1, 31)
		k1 *= c2
		h1 ^= k1
		h1 = h1<<27 | h1>>37 // ROTL64(h1, 27)
		h1 += h2
		h1 = h1*5 + 0x52dce729

		k2 *= c2
		k2 = k2<<33 | k2>>31 // ROTL64(k2, 33)
		k2 *= c1
		h2 ^= k2
		h2 = h2<<31 | h2>>33 // ROTL64(h2, 31)
		h2 += h1
		h2 = h2*5 + 0x38495ab5
	}

	tail := data[nblocks*16:]
	var k1, k2 uint64
	switch len(tail) {
	case 15:
		k2 ^= uint64(tail[14]) << 48
		fallthrough
	case 14:
		k2 ^= uint64(tail[13]) << 40
		fallthrough
	case 13:
		k2 ^= uint64(tail[12]) << 32
		fallthrough
	case 12:
		k2 ^= uint64(tail[11]) << 24
		fallthrough
	case 11:
		k2 ^= uint64(tail[10]) << 16
		fallthrough
	case 10:
		k2 ^= uint64(tail[9]) << 8
		fallthrough
	case 9:
		k2 ^= uint64(tail[8])
		k2 *= c2
		k2 = k2<<33 | k2>>31
		k2 *= c1
		h2 ^= k2
		fallthrough
	case 8:
		k1 ^= uint64(tail[7]) << 56
		fallthrough
	case 7:
		k1 ^= uint64(tail[6]) << 48
		fallthrough
	case 6:
		k1 ^= uint64(tail[5]) << 40
		fallthrough
	case 5:
		k1 ^= uint64(tail[4]) << 32
		fallthrough
	case 4:
		k1 ^= uint64(tail[3]) << 24
		fallthrough
	case 3:
		k1 ^= uint64(tail[2]) << 16
		fallthrough
	case 2:
		k1 ^= uint64(tail[1]) << 8
		fallthrough
	case 1:
		k1 ^= uint64(tail[0])
		k1 *= c1
		k1 = k1<<31 | k1>>33
		k1 *= c2
		h1 ^= k1
	}

	h1 ^= uint64(len(data))
	h2 ^= uint64(len(data))
	h1 += h2
	h2 += h1
	h1 = fmix64(h1)
	h2 = fmix64(h2)
	h1 += h2
	h2 += h1
	return h1, h2
}

func fmix64(k uint64) uint64 {
	k ^= k >> 33
	k *= 0xff51afd7ed558ccd
	k ^= k >> 33
	k *= 0xc4ceb9fe1a85ec53
	k ^= k >> 33
	return k
}

// ──────────────────────────────────────────────
// xxHash
// ──────────────────────────────────────────────

// XXHash64 returns the xxHash64 hash of data with the given seed.
func XXHash64(data []byte, seed uint64) uint64 {
	return xxhash64Impl(data, seed)
}

// XXHash64Hex returns the xxHash64 hash as a hex string.
func XXHash64Hex(data []byte, seed uint64) string {
	return fmt.Sprintf("%016x", XXHash64(data, seed))
}

// XXHash32 returns the xxHash32 hash of data with the given seed.
func XXHash32(data []byte, seed uint32) uint32 {
	return xxhash32Impl(data, seed)
}

// XXHash32Hex returns the xxHash32 hash as a hex string.
func XXHash32Hex(data []byte, seed uint32) string {
	return fmt.Sprintf("%08x", XXHash32(data, seed))
}

const (
	xxh64Prime1 uint64 = 11400714785074694791
	xxh64Prime2 uint64 = 14029467366897019727
	xxh64Prime3 uint64 = 1609587929392839161
	xxh64Prime4 uint64 = 9650029242287828579
	xxh64Prime5 uint64 = 2870177450012600261
)

func xxhash64Impl(data []byte, seed uint64) uint64 {
	var h uint64
	length := uint64(len(data))

	if length >= 32 {
		v1 := seed + xxh64Prime1 + xxh64Prime2
		v2 := seed + xxh64Prime2
		v3 := seed
		v4 := seed - xxh64Prime1

		for len(data) >= 32 {
			v1 = xxh64Round(v1, le64(data[0:8]))
			v2 = xxh64Round(v2, le64(data[8:16]))
			v3 = xxh64Round(v3, le64(data[16:24]))
			v4 = xxh64Round(v4, le64(data[24:32]))
			data = data[32:]
		}

		h = rotl64(v1, 1) + rotl64(v2, 7) + rotl64(v3, 12) + rotl64(v4, 18)
		h = xxh64MergeRound(h, v1)
		h = xxh64MergeRound(h, v2)
		h = xxh64MergeRound(h, v3)
		h = xxh64MergeRound(h, v4)
	} else {
		h = seed + xxh64Prime5
	}

	h += length

	for len(data) >= 8 {
		k := le64(data[:8])
		k *= xxh64Prime2
		k = rotl64(k, 31)
		k *= xxh64Prime1
		h ^= k
		h = rotl64(h, 27)*xxh64Prime1 + xxh64Prime4
		data = data[8:]
	}

	if len(data) >= 4 {
		k := uint64(le32(data[:4]))
		k *= xxh64Prime1
		h ^= k
		h = rotl64(h, 23)*xxh64Prime2 + xxh64Prime3
		data = data[4:]
	}

	for _, b := range data {
		h ^= uint64(b) * xxh64Prime5
		h = rotl64(h, 11) * xxh64Prime1
	}

	h ^= h >> 33
	h *= xxh64Prime2
	h ^= h >> 29
	h *= xxh64Prime3
	h ^= h >> 32
	return h
}

func xxh64Round(acc, input uint64) uint64 {
	acc += input * xxh64Prime2
	acc = rotl64(acc, 31)
	acc *= xxh64Prime1
	return acc
}

func xxh64MergeRound(acc, val uint64) uint64 {
	val = xxh64Round(0, val)
	acc ^= val
	acc = acc*xxh64Prime1 + xxh64Prime4
	return acc
}

const (
	xxh32Prime1 uint32 = 2654435761
	xxh32Prime2 uint32 = 2246822519
	xxh32Prime3 uint32 = 3266489917
	xxh32Prime4 uint32 = 668265263
	xxh32Prime5 uint32 = 374761393
)

func xxhash32Impl(data []byte, seed uint32) uint32 {
	var h uint32
	length := uint32(len(data))

	if length >= 16 {
		v1 := seed + xxh32Prime1 + xxh32Prime2
		v2 := seed + xxh32Prime2
		v3 := seed
		v4 := seed - xxh32Prime1

		for len(data) >= 16 {
			v1 = xxh32Round(v1, le32(data[0:4]))
			v2 = xxh32Round(v2, le32(data[4:8]))
			v3 = xxh32Round(v3, le32(data[8:12]))
			v4 = xxh32Round(v4, le32(data[12:16]))
			data = data[16:]
		}

		h = rotl32(v1, 1) + rotl32(v2, 7) + rotl32(v3, 12) + rotl32(v4, 18)
	} else {
		h = seed + xxh32Prime5
	}

	h += length

	for len(data) >= 4 {
		h += le32(data[:4]) * xxh32Prime3
		h = rotl32(h, 17) * xxh32Prime4
		data = data[4:]
	}

	for _, b := range data {
		h += uint32(b) * xxh32Prime5
		h = rotl32(h, 11) * xxh32Prime1
	}

	h ^= h >> 15
	h *= xxh32Prime2
	h ^= h >> 13
	h *= xxh32Prime3
	h ^= h >> 16
	return h
}

func xxh32Round(acc, input uint32) uint32 {
	acc += input * xxh32Prime2
	acc = rotl32(acc, 13)
	acc *= xxh32Prime1
	return acc
}

// ──────────────────────────────────────────────
// Bit helpers
// ──────────────────────────────────────────────

func rotl32(x uint32, r uint) uint32 { return (x << r) | (x >> (32 - r)) }
func rotl64(x uint64, r uint) uint64 { return (x << r) | (x >> (64 - r)) }

func le32(b []byte) uint32 {
	return uint32(b[0]) | uint32(b[1])<<8 | uint32(b[2])<<16 | uint32(b[3])<<24
}

func le64(b []byte) uint64 {
	return uint64(b[0]) | uint64(b[1])<<8 | uint64(b[2])<<16 | uint64(b[3])<<24 |
		uint64(b[4])<<32 | uint64(b[5])<<40 | uint64(b[6])<<48 | uint64(b[7])<<56
}

// ──────────────────────────────────────────────
// File/stream hashing
// ──────────────────────────────────────────────

// MD5File returns the MD5 hash of a file.
func MD5File(path string) ([]byte, error) {
	return hashFile(path, md5.New())
}

// MD5FileHex returns the MD5 hash of a file as a hex string.
func MD5FileHex(path string) (string, error) {
	h, err := MD5File(path)
	if err != nil {
		return "", err
	}
	return hex.EncodeToString(h), nil
}

// SHA256File returns the SHA-256 hash of a file.
func SHA256File(path string) ([]byte, error) {
	return hashFile(path, sha256.New())
}

// SHA256FileHex returns the SHA-256 hash of a file as a hex string.
func SHA256FileHex(path string) (string, error) {
	h, err := SHA256File(path)
	if err != nil {
		return "", err
	}
	return hex.EncodeToString(h), nil
}

// hashFile computes a hash of a file using the given hash.Hash.
func hashFile(path string, h interface {
	Write([]byte) (int, error)
	Sum([]byte) []byte
}) ([]byte, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("hash: open file %s: %w", path, err)
	}
	defer f.Close()
	if _, err := io.Copy(h.(io.Writer), f); err != nil {
		return nil, fmt.Errorf("hash: read file %s: %w", path, err)
	}
	return h.Sum(nil), nil
}

// MD5Reader returns the MD5 hash of a reader.
func MD5Reader(r io.Reader) ([]byte, error) {
	h := md5.New()
	if _, err := io.Copy(h, r); err != nil {
		return nil, fmt.Errorf("hash: read: %w", err)
	}
	return h.Sum(nil), nil
}

// SHA256Reader returns the SHA-256 hash of a reader.
func SHA256Reader(r io.Reader) ([]byte, error) {
	h := sha256.New()
	if _, err := io.Copy(h, r); err != nil {
		return nil, fmt.Errorf("hash: read: %w", err)
	}
	return h.Sum(nil), nil
}

// ──────────────────────────────────────────────
// Generic hash helper
// ──────────────────────────────────────────────

// HashType represents a hash algorithm type.
type HashType string

const (
	HashMD5    HashType = "md5"
	HashSHA1   HashType = "sha1"
	HashSHA256 HashType = "sha256"
	HashSHA512 HashType = "sha512"
)

// Hex returns the hex hash of data using the specified algorithm.
func Hex(ht HashType, data []byte) (string, error) {
	switch ht {
	case HashMD5:
		return MD5Hex(data), nil
	case HashSHA1:
		return SHA1Hex(data), nil
	case HashSHA256:
		return SHA256Hex(data), nil
	case HashSHA512:
		return SHA512Hex(data), nil
	default:
		return "", fmt.Errorf("hash: unknown type %q", ht)
	}
}

// HexUpper returns the uppercase hex hash of data.
func HexUpper(ht HashType, data []byte) (string, error) {
	h, err := Hex(ht, data)
	if err != nil {
		return "", err
	}
	return strings.ToUpper(h), nil
}
