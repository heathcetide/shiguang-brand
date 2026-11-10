package lock

import (
	"crypto/rand"
	"encoding/hex"
)

// NewToken generates a random ownership token.
func NewToken() (string, error) {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(b[:]), nil
}

// ResolveValue returns opts.Value or a newly generated token.
func ResolveValue(opts *Options) (string, error) {
	if opts.Value != "" {
		return opts.Value, nil
	}
	v, err := NewToken()
	if err != nil {
		return "", err
	}
	opts.Value = v
	return v, nil
}
