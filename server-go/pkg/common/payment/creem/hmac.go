package creem

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
)

func newHMAC(secret string) hashWriter {
	return hmac.New(sha256.New, []byte(secret))
}

type hashWriter interface {
	Write([]byte) (int, error)
	Sum([]byte) []byte
}

func hexEncode(b []byte) string {
	return hex.EncodeToString(b)
}

// hmacEqual reports whether a and b are equal in constant time.
func hmacEqual(a, b string) bool {
	return hmac.Equal([]byte(a), []byte(b))
}
