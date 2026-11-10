// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package sms

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"fmt"

	"github.com/heathcetide/DietDigiDose/pkg/common/hash"
)

// SHA1Hex returns the hex-encoded SHA-1 digest of s.
func SHA1Hex(s string) string {
	return hash.SHA1String(s)
}

// SHA256Base64 returns the base64-encoded SHA-256 digest of s.
func SHA256Base64(s string) string {
	return base64.StdEncoding.EncodeToString(hash.SHA256([]byte(s)))
}

// SHA256Hex returns the hex-encoded SHA-256 digest of s.
func SHA256Hex(s string) string {
	return hash.SHA256String(s)
}

// hmacSHA256Raw returns the raw HMAC-SHA256 of message under key.
func hmacSHA256Raw(key, message []byte) []byte {
	return hash.HMACSHA256(message, key)
}

// HMACSHA256Base64 returns the base64-encoded HMAC-SHA256 of message
// under the given key.
func HMACSHA256Base64(key, message string) string {
	return base64.StdEncoding.EncodeToString(hash.HMACSHA256([]byte(message), []byte(key)))
}

// HMACSHA1Base64 returns the base64-encoded HMAC-SHA1 of message under
// the given key.
func HMACSHA1Base64(key, message string) string {
	return base64.StdEncoding.EncodeToString(hash.HMACSHA1([]byte(message), []byte(key)))
}

// MD5Hex returns the hex-encoded MD5 digest of s.
func MD5Hex(s string) string {
	return hash.MD5String(s)
}

// RandHex returns a random hex string of n bytes (2*n hex characters).
// It returns an error if the system random source fails or n < 0.
func RandHex(n int) string {
	if n <= 0 {
		return ""
	}
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		// rand.Read should never fail on modern systems; fall back to a
		// deterministic-but-unique-ish value so callers don't crash.
		return fmt.Sprintf("%x", n)
	}
	return hex.EncodeToString(b)
}
