// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package password

import (
	"crypto/rand"
	"encoding/base64"
)

// readRandom fills b with cryptographically secure random bytes.
func readRandom(b []byte) (int, error) {
	return rand.Read(b)
}

// base64Encode returns the standard base64 (no padding) encoding of b.
// Argon2 PHC format uses raw base64 without padding.
func base64Encode(b []byte) string {
	return base64.RawStdEncoding.EncodeToString(b)
}

// base64Decode decodes a raw (unpadded) standard base64 string.
func base64Decode(s string) ([]byte, error) {
	return base64.RawStdEncoding.DecodeString(s)
}
