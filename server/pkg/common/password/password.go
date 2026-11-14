// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package password provides secure password hashing and verification using
// bcrypt and Argon2id, the two algorithms recommended by OWASP for password
// storage.
//
// # Algorithm selection
//
// Argon2id is the primary recommendation (memory-hard, GPU-resistant).
// Bcrypt is provided as a widely-compatible alternative. Both produce
// self-describing hash strings that encode the algorithm, parameters, salt,
// and digest, so a stored hash carries everything needed to verify it.
//
// # Quick start
//
//	// Hash a password with Argon2id (recommended).
//	hashed, err := password.Hash("my-secret-password", nil)
//	if err != nil { return err }
//
//	// Verify.
//	if password.Verify("my-secret-password", hashed) {
//	    // access granted
//	}
//
//	// Check if a hash needs rehashing (e.g. params are outdated).
//	if password.NeedsRehash(hashed, nil) {
//	    newHash, _ := password.Hash("my-secret-password", nil)
//	    // persist newHash
//	}
//
// # Migrating from bcrypt to Argon2id
//
//	// On next login:
//	if password.Verify(plain, stored) {
//	    if password.NeedsRehash(stored, nil) {
//	        newHash, _ := password.Hash(plain, nil)
//	        // save newHash
//	    }
//	}
package password

import (
	"errors"
	"fmt"
	"strings"

	"golang.org/x/crypto/argon2"
	"golang.org/x/crypto/bcrypt"
)

// ──────────────────────────────────────────────
// Errors
// ──────────────────────────────────────────────

var (
	// ErrEmptyPassword is returned when hashing an empty password.
	ErrEmptyPassword = errors.New("password: password must not be empty")
	// ErrInvalidHash is returned when a stored hash is malformed or uses an
	// unknown algorithm.
	ErrInvalidHash = errors.New("password: invalid hash format")
	// ErrPasswordTooLong is returned when the password exceeds 72 bytes
	// (bcrypt limitation).
	ErrPasswordTooLong = errors.New("password: password exceeds 72 bytes for bcrypt")
)

// ──────────────────────────────────────────────
// Algorithm types
// ──────────────────────────────────────────────

// Algorithm identifies a password hashing algorithm.
type Algorithm string

const (
	// AlgorithmArgon2id is the Argon2id algorithm (recommended).
	AlgorithmArgon2id Algorithm = "argon2id"
	// AlgorithmBcrypt is the bcrypt algorithm.
	AlgorithmBcrypt Algorithm = "bcrypt"
)

// ──────────────────────────────────────────────
// Defaults
// ──────────────────────────────────────────────

const (
	// DefaultBcryptCost is the default bcrypt cost factor.
	// OWASP recommends a minimum of 10; 12 provides ~250ms per hash on
	// modern hardware. Adjust based on your hardware and latency budget.
	DefaultBcryptCost = 12

	// DefaultArgon2Time is the default Argon2id time cost (iterations).
	DefaultArgon2Time = 3
	// DefaultArgon2Memory is the default Argon2id memory cost in KiB.
	// 64 * 1024 = 64 MB. OWASP recommends a minimum of 19 MiB; 64 MiB
	// provides strong resistance. Adjust based on your hardware.
	DefaultArgon2Memory = 64 * 1024
	// DefaultArgon2Threads is the default Argon2id parallelism (threads).
	DefaultArgon2Threads = 2
	// DefaultArgon2KeyLen is the default Argon2id output key length in bytes.
	DefaultArgon2KeyLen = 32
	// DefaultArgon2SaltLen is the default Argon2id salt length in bytes.
	DefaultArgon2SaltLen = 16
)

// ──────────────────────────────────────────────
// Options
// ──────────────────────────────────────────────

// Options configures password hashing. Zero values use safe defaults.
type Options struct {
	// Algorithm selects the hashing algorithm. Defaults to AlgorithmArgon2id.
	Algorithm Algorithm

	// BcryptCost is the bcrypt cost factor (4-31). Defaults to 12.
	// Only used when Algorithm == AlgorithmBcrypt.
	BcryptCost int

	// Argon2Time is the Argon2id time cost (iterations). Defaults to 3.
	// Only used when Algorithm == AlgorithmArgon2id.
	Argon2Time uint32
	// Argon2Memory is the Argon2id memory cost in KiB. Defaults to 65536 (64MB).
	// Only used when Algorithm == AlgorithmArgon2id.
	Argon2Memory uint32
	// Argon2Threads is the Argon2id parallelism. Defaults to 2.
	// Only used when Algorithm == AlgorithmArgon2id.
	Argon2Threads uint8
	// Argon2KeyLen is the output key length in bytes. Defaults to 32.
	// Only used when Algorithm == AlgorithmArgon2id.
	Argon2KeyLen uint32
	// Argon2SaltLen is the salt length in bytes. Defaults to 16.
	// Only used when Algorithm == AlgorithmArgon2id.
	Argon2SaltLen uint32
}

// ──────────────────────────────────────────────
// Hashing
// ──────────────────────────────────────────────

// Hash produces a self-describing password hash string.
//
// By default, Argon2id is used. The returned string encodes the algorithm
// and all parameters so that Verify can reconstruct the computation without
// external configuration:
//
//	"$argon2id$v=19$m=65536,t=3,p=2$<base64-salt>$<base64-key>"
//	"$bcrypt$<bcrypt-hash>"
//
// Pass nil for opts to use secure defaults.
func Hash(plain string, opts *Options) (string, error) {
	if plain == "" {
		return "", ErrEmptyPassword
	}
	o := defaults(opts)
	switch o.Algorithm {
	case AlgorithmBcrypt:
		return hashBcrypt(plain, o)
	case AlgorithmArgon2id:
		return hashArgon2id(plain, o)
	default:
		return hashArgon2id(plain, o)
	}
}

// MustHash is like Hash but panics on error. Use only in tests or
// initialization where a hash failure is unrecoverable.
func MustHash(plain string, opts *Options) string {
	h, err := Hash(plain, opts)
	if err != nil {
		panic(err)
	}
	return h
}

// ──────────────────────────────────────────────
// Verification
// ──────────────────────────────────────────────

// Verify checks whether plain matches the given stored hash.
// The hash format determines the algorithm used; no external config is needed.
// Returns false (not an error) if the password doesn't match.
func Verify(plain, stored string) bool {
	if plain == "" || stored == "" {
		return false
	}
	switch {
	case strings.HasPrefix(stored, "$argon2id$"):
		return verifyArgon2id(plain, stored)
	case strings.HasPrefix(stored, "$2a$"), strings.HasPrefix(stored, "$2b$"), strings.HasPrefix(stored, "$2y$"):
		return verifyBcrypt(plain, stored)
	case strings.HasPrefix(stored, "$bcrypt$"):
		return verifyBcrypt(plain, strings.TrimPrefix(stored, "$bcrypt$"))
	default:
		return false
	}
}

// ──────────────────────────────────────────────
// Rehash detection
// ──────────────────────────────────────────────

// NeedsRehash reports whether a stored hash should be recomputed with
// current parameters. This is true when:
//   - The algorithm differs from the target (default: Argon2id).
//   - The bcrypt cost is lower than the target.
//   - The Argon2id time/memory/threads are lower than the target.
//
// Use this on login to transparently upgrade hashes to stronger params.
// Pass nil for opts to compare against defaults.
func NeedsRehash(stored string, opts *Options) bool {
	if stored == "" {
		return true
	}
	o := defaults(opts)
	switch {
	case strings.HasPrefix(stored, "$argon2id$"):
		return needsRehashArgon2id(stored, o)
	case strings.HasPrefix(stored, "$2a$"), strings.HasPrefix(stored, "$2b$"), strings.HasPrefix(stored, "$2y$"), strings.HasPrefix(stored, "$bcrypt$"):
		return needsRehashBcrypt(stored, o)
	default:
		return true
	}
}

// ──────────────────────────────────────────────
// Algorithm detection
// ──────────────────────────────────────────────

// AlgorithmOf returns the algorithm used by a stored hash, or
// Algorithm("") if the hash is unrecognized.
func AlgorithmOf(stored string) Algorithm {
	switch {
	case strings.HasPrefix(stored, "$argon2id$"):
		return AlgorithmArgon2id
	case strings.HasPrefix(stored, "$2a$"), strings.HasPrefix(stored, "$2b$"), strings.HasPrefix(stored, "$2y$"), strings.HasPrefix(stored, "$bcrypt$"):
		return AlgorithmBcrypt
	default:
		return ""
	}
}

// ──────────────────────────────────────────────
// Internal: bcrypt
// ──────────────────────────────────────────────

func hashBcrypt(plain string, o Options) (string, error) {
	if len(plain) > 72 {
		return "", ErrPasswordTooLong
	}
	cost := o.BcryptCost
	if cost < bcrypt.MinCost {
		cost = DefaultBcryptCost
	}
	h, err := bcrypt.GenerateFromPassword([]byte(plain), cost)
	if err != nil {
		return "", fmt.Errorf("password: bcrypt hash: %w", err)
	}
	return string(h), nil
}

func verifyBcrypt(plain, stored string) bool {
	if len(plain) > 72 {
		return false
	}
	return bcrypt.CompareHashAndPassword([]byte(stored), []byte(plain)) == nil
}

func needsRehashBcrypt(stored string, o Options) bool {
	raw := strings.TrimPrefix(stored, "$bcrypt$")
	cost, err := bcrypt.Cost([]byte(raw))
	if err != nil {
		return true
	}
	target := o.BcryptCost
	if target < bcrypt.MinCost {
		target = DefaultBcryptCost
	}
	// If the target algorithm is Argon2id, always rehash.
	if o.Algorithm == AlgorithmArgon2id {
		return true
	}
	return cost < target
}

// ──────────────────────────────────────────────
// Internal: Argon2id
// ──────────────────────────────────────────────

func hashArgon2id(plain string, o Options) (string, error) {
	salt := make([]byte, o.Argon2SaltLen)
	if _, err := readRandom(salt); err != nil {
		return "", fmt.Errorf("password: generate salt: %w", err)
	}
	key := argon2.IDKey([]byte(plain), salt, o.Argon2Time, o.Argon2Memory, o.Argon2Threads, o.Argon2KeyLen)
	return encodeArgon2id(o, salt, key), nil
}

func verifyArgon2id(plain, stored string) bool {
	o, salt, key, err := decodeArgon2id(stored)
	if err != nil {
		return false
	}
	computed := argon2.IDKey([]byte(plain), salt, o.Argon2Time, o.Argon2Memory, o.Argon2Threads, o.Argon2KeyLen)
	return constantTimeEqual(key, computed)
}

func needsRehashArgon2id(stored string, o Options) bool {
	storedOpts, _, _, err := decodeArgon2id(stored)
	if err != nil {
		return true
	}
	if o.Algorithm == AlgorithmBcrypt {
		return true
	}
	return storedOpts.Argon2Time < o.Argon2Time ||
		storedOpts.Argon2Memory < o.Argon2Memory ||
		storedOpts.Argon2Threads < o.Argon2Threads
}

// encodeArgon2id builds the standard Argon2id PHC string format:
//   $argon2id$v=19$m=<memory>,t=<time>,p=<threads>$<base64-salt>$<base64-key>
func encodeArgon2id(o Options, salt, key []byte) string {
	return fmt.Sprintf("$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s",
		argon2.Version,
		o.Argon2Memory,
		o.Argon2Time,
		o.Argon2Threads,
		base64Encode(salt),
		base64Encode(key),
	)
}

// decodeArgon2id parses an Argon2id PHC string.
func decodeArgon2id(stored string) (Options, []byte, []byte, error) {
	parts := strings.Split(stored, "$")
	// Expected: ["", "argon2id", "v=19", "m=..,t=..,p=..", "<salt>", "<key>"]
	if len(parts) != 6 || parts[1] != "argon2id" {
		return Options{}, nil, nil, ErrInvalidHash
	}
	o := Options{Algorithm: AlgorithmArgon2id}
	// Parse params: m=65536,t=3,p=2
	for _, p := range strings.Split(parts[3], ",") {
		kv := strings.SplitN(p, "=", 2)
		if len(kv) != 2 {
			return Options{}, nil, nil, ErrInvalidHash
		}
		var val uint32
		for _, c := range kv[1] {
			if c < '0' || c > '9' {
				return Options{}, nil, nil, ErrInvalidHash
			}
			val = val*10 + uint32(c-'0')
		}
		switch kv[0] {
		case "m":
			o.Argon2Memory = val
		case "t":
			o.Argon2Time = val
		case "p":
			o.Argon2Threads = uint8(val)
		}
	}
	salt, err := base64Decode(parts[4])
	if err != nil {
		return Options{}, nil, nil, ErrInvalidHash
	}
	key, err := base64Decode(parts[5])
	if err != nil {
		return Options{}, nil, nil, ErrInvalidHash
	}
	o.Argon2SaltLen = uint32(len(salt))
	o.Argon2KeyLen = uint32(len(key))
	return o, salt, key, nil
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

func defaults(opts *Options) Options {
	o := Options{
		Algorithm:     AlgorithmArgon2id,
		BcryptCost:    DefaultBcryptCost,
		Argon2Time:    DefaultArgon2Time,
		Argon2Memory:  DefaultArgon2Memory,
		Argon2Threads: DefaultArgon2Threads,
		Argon2KeyLen:  DefaultArgon2KeyLen,
		Argon2SaltLen: DefaultArgon2SaltLen,
	}
	if opts != nil {
		if opts.Algorithm != "" {
			o.Algorithm = opts.Algorithm
		}
		if opts.BcryptCost != 0 {
			o.BcryptCost = opts.BcryptCost
		}
		if opts.Argon2Time != 0 {
			o.Argon2Time = opts.Argon2Time
		}
		if opts.Argon2Memory != 0 {
			o.Argon2Memory = opts.Argon2Memory
		}
		if opts.Argon2Threads != 0 {
			o.Argon2Threads = opts.Argon2Threads
		}
		if opts.Argon2KeyLen != 0 {
			o.Argon2KeyLen = opts.Argon2KeyLen
		}
		if opts.Argon2SaltLen != 0 {
			o.Argon2SaltLen = opts.Argon2SaltLen
		}
	}
	return o
}

func constantTimeEqual(a, b []byte) bool {
	if len(a) != len(b) {
		return false
	}
	var diff byte
	for i := range a {
		diff |= a[i] ^ b[i]
	}
	return diff == 0
}
