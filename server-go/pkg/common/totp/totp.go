// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package totp implements RFC 6238 Time-based One-Time Password (TOTP) and
// RFC 4226 HMAC-based One-Time Password (HOTP) for two-factor authentication
// (2FA) with authenticator apps such as Google Authenticator, Authy, 1Password.
//
// It provides:
//
//   - Secret generation with configurable digits / period / algorithm
//   - otpauth:// URL construction for authenticator app provisioning
//   - QR code rendering (PNG bytes / data URL) for display during 2FA setup
//   - TOTP validation with configurable time-window skew
//   - HOTP validation (counter-based) for use cases that don't have a clock
//   - Current code generation (useful for testing / server-side flows)
//   - Backup / recovery codes generation, validation, and hashing — the
//     standard companion to TOTP so users can regain access if they lose
//     their authenticator device.
//
// # Quick start (2FA enrollment)
//
//	// 1. Generate a TOTP secret + QR code for the user to scan.
//	key, err := totp.Generate(totp.Options{
//	    Issuer:      "MyApp",
//	    AccountName: "alice@example.com",
//	})
//	if err != nil { log.Fatal(err) }
//	// key.Secret()  -> base32 secret string (store this)
//	// key.URL()     -> otpauth://totp/MyApp:alice@example.com?secret=...
//	qrPNG, _ := totp.QRPNG(key.URL(), 256)        // PNG bytes for <img>
//	qrURL, _ := totp.QRDataURL(key.URL(), 256)    // or data: URL directly
//
//	// 2. Generate backup codes to show the user once.
//	codes, hashes, _ := totp.GenerateBackupCodes(totp.BackupOptions{})
//	// Show `codes` to the user; store `hashes` in the database.
//
//	// 3. On login, validate the TOTP code.
//	valid := totp.Validate(code, key.Secret(), nil)
//
//	// 4. If the user lost their device, validate a backup code.
//	idx, ok := totp.ValidateBackupCode(backupCode, hashes)
//	if ok { /* remove hashes[idx] — single use */ }
//
//	// HOTP (counter-based).
//	valid = totp.ValidateHOTP(code, key.Secret(), counter)
package totp

import (
	"bytes"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common/hash"
	"github.com/pquerna/otp"
	"github.com/pquerna/otp/hotp"
	"github.com/pquerna/otp/totp"
	"github.com/skip2/go-qrcode"
)

// ──────────────────────────────────────────────
// Errors
// ──────────────────────────────────────────────

var (
	// ErrInvalidCode is returned when a code is empty or has the wrong length.
	ErrInvalidCode = errors.New("totp: invalid code")
	// ErrInvalidSecret is returned when a secret is empty or not valid base32.
	ErrInvalidSecret = errors.New("totp: invalid secret")
	// ErrInvalidIssuer is returned when the issuer is empty.
	ErrInvalidIssuer = errors.New("totp: issuer must not be empty")
	// ErrInvalidAccount is returned when the account name is empty.
	ErrInvalidAccount = errors.New("totp: account name must not be empty")
	// ErrInvalidCounter is returned when a HOTP counter is negative.
	ErrInvalidCounter = errors.New("totp: counter must not be negative")
)

// ──────────────────────────────────────────────
// Configuration types
// ──────────────────────────────────────────────

// Digits specifies the number of digits in the generated OTP code.
type Digits = otp.Digits

const (
	// DigitsSix produces 6-digit codes (the default for most authenticator apps).
	DigitsSix = otp.DigitsSix
	// DigitsEight produces 8-digit codes.
	DigitsEight = otp.DigitsEight
)

// Algorithm specifies the HMAC algorithm used to generate the OTP.
type Algorithm = otp.Algorithm

const (
	// AlgorithmSHA1 is the default and most widely supported algorithm.
	AlgorithmSHA1 = otp.AlgorithmSHA1
	// AlgorithmSHA256 uses HMAC-SHA256.
	AlgorithmSHA256 = otp.AlgorithmSHA256
	// AlgorithmSHA512 uses HMAC-SHA512.
	AlgorithmSHA512 = otp.AlgorithmSHA512
)

// Options configures secret/key generation.
type Options struct {
	// Issuer is the organization or application name shown in the
	// authenticator app (e.g. "MyApp"). Required.
	Issuer string
	// AccountName is the user identifier shown in the authenticator app
	// (e.g. "alice@example.com"). Required.
	AccountName string
	// Period is the time step in seconds. Defaults to 30 if <= 0.
	Period uint
	// Digits is the code length. Defaults to DigitsSix if 0.
	Digits Digits
	// Algorithm is the HMAC algorithm. Defaults to AlgorithmSHA1 if 0.
	Algorithm Algorithm
	// SecretSize is the byte length of the generated secret.
	// Defaults to 32 (256 bits) if 0.
	SecretSize uint
}

// ValidateOptions configures TOTP validation behavior.
type ValidateOptions struct {
	// Skew is the number of time periods (before and after the current one)
	// to accept. Defaults to 1 (±30s with a 30s period). Set to 0 for strict
	// single-window validation.
	Skew uint
	// Period overrides the key's period. Use 0 to use the key's configured
	// period (recommended).
	Period uint
	// Digits overrides the key's digit count. Use 0 to use the key's
	// configured digits (recommended).
	Digits Digits
	// Algorithm overrides the key's algorithm. Use 0 to use the key's
	// configured algorithm (recommended).
	Algorithm Algorithm
}

// ──────────────────────────────────────────────
// Defaults
// ──────────────────────────────────────────────

const (
	// DefaultPeriod is the standard TOTP time step (30 seconds).
	DefaultPeriod = 30
	// DefaultSecretSize is the default secret byte length (256 bits).
	DefaultSecretSize = 32
)

// ──────────────────────────────────────────────
// Key
// ──────────────────────────────────────────────

// Key wraps an otp.Key and exposes the values needed for storage and
// authenticator provisioning.
type Key struct {
	key *otp.Key
}

// Secret returns the base32-encoded secret string.
func (k *Key) Secret() string { return k.key.Secret() }

// URL returns the otpauth:// provisioning URL.
func (k *Key) URL() string { return k.key.URL() }

// Issuer returns the issuer name.
func (k *Key) Issuer() string { return k.key.Issuer() }

// AccountName returns the account name.
func (k *Key) AccountName() string { return k.key.AccountName() }

// Period returns the time step in seconds.
func (k *Key) Period() uint64 { return k.key.Period() }

// Digits returns the code digit count.
func (k *Key) Digits() Digits { return k.key.Digits() }

// Algorithm returns the HMAC algorithm.
func (k *Key) Algorithm() Algorithm { return k.key.Algorithm() }

// ──────────────────────────────────────────────
// Generation
// ──────────────────────────────────────────────

// Generate creates a new TOTP key (secret + otpauth URL) suitable for
// provisioning an authenticator app.
//
// Issuer and AccountName are required. Zero-value numeric fields are replaced
// with safe defaults (period 30s, 6 digits, SHA-1, 32-byte secret).
func Generate(opts Options) (*Key, error) {
	if strings.TrimSpace(opts.Issuer) == "" {
		return nil, ErrInvalidIssuer
	}
	if strings.TrimSpace(opts.AccountName) == "" {
		return nil, ErrInvalidAccount
	}
	if opts.Period == 0 {
		opts.Period = DefaultPeriod
	}
	if opts.Digits == 0 {
		opts.Digits = DigitsSix
	}
	if opts.Algorithm == 0 {
		opts.Algorithm = AlgorithmSHA1
	}
	if opts.SecretSize == 0 {
		opts.SecretSize = DefaultSecretSize
	}
	key, err := totp.Generate(totp.GenerateOpts{
		Issuer:      opts.Issuer,
		AccountName: opts.AccountName,
		Period:      opts.Period,
		Digits:      opts.Digits,
		Algorithm:   opts.Algorithm,
		SecretSize:  opts.SecretSize,
	})
	if err != nil {
		return nil, err
	}
	return &Key{key: key}, nil
}

// ──────────────────────────────────────────────
// TOTP validation
// ──────────────────────────────────────────────

// validateOpts builds a totp.ValidateOpts from the user-facing ValidateOptions,
// filling in defaults (period 30s, 6 digits, SHA-1) for zero values. The
// underlying pquerna/otp library does NOT default these fields internally when
// calling ValidateCustom, so we must always set them.
func validateOpts(opts *ValidateOptions) totp.ValidateOpts {
	vo := totp.ValidateOpts{
		Period:    DefaultPeriod,
		Digits:    DigitsSix,
		Algorithm: AlgorithmSHA1,
	}
	if opts != nil {
		vo.Skew = uint(opts.Skew)
		if opts.Period != 0 {
			vo.Period = opts.Period
		}
		if opts.Digits != 0 {
			vo.Digits = opts.Digits
		}
		if opts.Algorithm != 0 {
			vo.Algorithm = opts.Algorithm
		}
	}
	return vo
}

// Validate checks whether code is a valid TOTP for the given base32 secret
// at the current time. It accepts codes within ±opts.Skew time windows.
//
// Pass nil for opts to use the default skew of 0 (strict current window only).
// Empty code or secret returns false without error.
func Validate(code, secret string, opts *ValidateOptions) bool {
	code = strings.TrimSpace(code)
	secret = strings.TrimSpace(secret)
	if code == "" || secret == "" {
		return false
	}
	vo := validateOpts(opts)
	valid, _ := totp.ValidateCustom(code, secret, time.Now().UTC(), vo)
	return valid
}

// ValidateAt is like Validate but validates against a specific timestamp
// instead of the current time. Useful for testing and replay-detection flows.
func ValidateAt(code, secret string, t time.Time, opts *ValidateOptions) bool {
	code = strings.TrimSpace(code)
	secret = strings.TrimSpace(secret)
	if code == "" || secret == "" {
		return false
	}
	vo := validateOpts(opts)
	valid, _ := totp.ValidateCustom(code, secret, t.UTC(), vo)
	return valid
}

// CurrentCode generates the TOTP code for the current time window. This is
// primarily useful for testing and server-side verification flows (e.g.
// phone-based 2FA where the server displays the code).
func CurrentCode(secret string, opts *ValidateOptions) (string, error) {
	secret = strings.TrimSpace(secret)
	if secret == "" {
		return "", ErrInvalidSecret
	}
	vo := validateOpts(opts)
	return totp.GenerateCodeCustom(secret, time.Now().UTC(), vo)
}

// ──────────────────────────────────────────────
// HOTP (counter-based)
// ──────────────────────────────────────────────

// GenerateHOTP creates a new HOTP key (counter-based, RFC 4226).
// The initial counter is 0; the caller is responsible for tracking and
// persisting the counter on each successful validation.
func GenerateHOTP(opts Options) (*Key, error) {
	if strings.TrimSpace(opts.Issuer) == "" {
		return nil, ErrInvalidIssuer
	}
	if strings.TrimSpace(opts.AccountName) == "" {
		return nil, ErrInvalidAccount
	}
	if opts.Digits == 0 {
		opts.Digits = DigitsSix
	}
	if opts.Algorithm == 0 {
		opts.Algorithm = AlgorithmSHA1
	}
	if opts.SecretSize == 0 {
		opts.SecretSize = DefaultSecretSize
	}
	key, err := hotp.Generate(hotp.GenerateOpts{
		Issuer:      opts.Issuer,
		AccountName: opts.AccountName,
		Digits:      opts.Digits,
		Algorithm:   opts.Algorithm,
		SecretSize:  opts.SecretSize,
	})
	if err != nil {
		return nil, err
	}
	return &Key{key: key}, nil
}

// ValidateHOTP checks whether code is a valid HOTP for the given secret
// at the specified counter value.
//
// The caller must persist the counter and increment it after a successful
// validation to prevent replay. Empty code or secret returns false.
func ValidateHOTP(code, secret string, counter uint64) bool {
	code = strings.TrimSpace(code)
	secret = strings.TrimSpace(secret)
	if code == "" || secret == "" {
		return false
	}
	return hotp.Validate(code, counter, secret)
}

// HOTPCode generates the HOTP code for the given secret and counter.
func HOTPCode(secret string, counter uint64) (string, error) {
	secret = strings.TrimSpace(secret)
	if secret == "" {
		return "", ErrInvalidSecret
	}
	return hotp.GenerateCode(secret, counter)
}

// ──────────────────────────────────────────────
// QR code rendering
// ──────────────────────────────────────────────

// QR errors.
var (
	// ErrEmptyURL is returned when the otpauth URL is empty.
	ErrEmptyURL = errors.New("totp: otpauth URL must not be empty")
)

// DefaultQRSize is the default QR code PNG edge length in pixels.
const DefaultQRSize = 256

// QRPNG renders the given otpauth URL as a QR code PNG image.
// size is the edge length in pixels; use 0 for DefaultQRSize.
// The PNG bytes can be served directly or base64-encoded for an <img> tag.
func QRPNG(url string, size int) ([]byte, error) {
	if url == "" {
		return nil, ErrEmptyURL
	}
	if size <= 0 {
		size = DefaultQRSize
	}
	qr, err := qrcode.New(url, qrcode.Medium)
	if err != nil {
		return nil, fmt.Errorf("totp: qr generate: %w", err)
	}
	return qr.PNG(size)
}

// QRDataURL renders the given otpauth URL as a base64-encoded PNG data URL
// suitable for use directly in an <img src="..."> tag.
// size is the edge length in pixels; use 0 for DefaultQRSize.
func QRDataURL(url string, size int) (string, error) {
	png, err := QRPNG(url, size)
	if err != nil {
		return "", err
	}
	var buf bytes.Buffer
	enc := base64.NewEncoder(base64.StdEncoding, &buf)
	_, _ = enc.Write(png)
	_ = enc.Close()
	return "data:image/png;base64," + buf.String(), nil
}

// ──────────────────────────────────────────────
// Backup / recovery codes
// ──────────────────────────────────────────────
//
// Backup codes are short, human-readable strings (e.g. "A1B2-C3D4") presented
// to the user once at 2FA enrollment. The server stores only their SHA-256
// hashes; each code is single-use and must be consumed (deleted) after a
// successful validation.

// Backup errors.
var (
	// ErrInvalidBackupCount is returned when the requested backup code count is < 0.
	ErrInvalidBackupCount = errors.New("totp: backup code count must not be negative")
	// ErrInvalidBackupLength is returned when the requested backup code length is < 4.
	ErrInvalidBackupLength = errors.New("totp: backup code length must be at least 4")
)

// Backup defaults.
const (
	// DefaultBackupCount is the default number of backup codes to generate.
	DefaultBackupCount = 10
	// DefaultBackupLength is the default character length of each backup code
	// (excluding the separator dash).
	DefaultBackupLength = 8
	// DefaultBackupCharset is the default character set for backup codes:
	// uppercase letters and digits, excluding ambiguous chars (O/0/I/1).
	DefaultBackupCharset = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
)

// BackupOptions configures backup code generation.
type BackupOptions struct {
	// Count is the number of codes to generate. Defaults to 10 if 0.
	// Must not be negative.
	Count int
	// Length is the character length of each code (excluding the separator).
	// Must be >= 4. Defaults to 8 if 0.
	Length int
	// Charset is the character set to draw from. Defaults to DefaultBackupCharset
	// (unambiguous uppercase + digits) if empty.
	Charset string
	// Separator is inserted in the middle of the code for readability
	// (e.g. "A1B2-C3D4"). Defaults to "-". Set to " " for no visible separator.
	Separator string
}

// GenerateBackupCode produces a single backup code string.
func GenerateBackupCode(opts BackupOptions) (string, error) {
	applyBackupDefaults(&opts)
	if opts.Length < 4 {
		return "", ErrInvalidBackupLength
	}
	charset := opts.Charset
	if charset == "" {
		charset = DefaultBackupCharset
	}
	code := make([]byte, opts.Length)
	for i := range code {
		var b [1]byte
		if _, err := rand.Read(b[:]); err != nil {
			return "", fmt.Errorf("totp: backup code random: %w", err)
		}
		code[i] = charset[int(b[0])%len(charset)]
	}
	return formatBackupCode(string(code), opts), nil
}

// GenerateBackupCodes generates count backup codes and their SHA-256 hashes.
// The plaintext codes are returned so they can be shown to the user once;
// the hashes are what should be persisted.
//
// Duplicate codes within a set are filtered out; if fewer unique codes than
// requested can be generated after reasonable attempts, an error is returned.
func GenerateBackupCodes(opts BackupOptions) (codes, hashes []string, err error) {
	if opts.Count < 0 {
		return nil, nil, ErrInvalidBackupCount
	}
	applyBackupDefaults(&opts)
	codes = make([]string, 0, opts.Count)
	seen := make(map[string]struct{}, opts.Count)
	maxAttempts := opts.Count * 10
	for attempts := 0; len(codes) < opts.Count && attempts < maxAttempts; attempts++ {
		c, err := GenerateBackupCode(opts)
		if err != nil {
			return nil, nil, err
		}
		norm := normalizeBackupCode(c)
		if _, dup := seen[norm]; dup {
			continue
		}
		seen[norm] = struct{}{}
		codes = append(codes, c)
	}
	if len(codes) < opts.Count {
		return nil, nil, fmt.Errorf("totp: could not generate %d unique backup codes after %d attempts", opts.Count, maxAttempts)
	}
	hashes = make([]string, len(codes))
	for i, c := range codes {
		hashes[i] = HashBackupCode(c)
	}
	return codes, hashes, nil
}

// ValidateBackupCode checks a user-submitted code against a single stored hash.
// Comparison is case-insensitive and separator-insensitive.
func ValidateBackupCode(code, storedHash string) bool {
	code = strings.TrimSpace(code)
	if code == "" || storedHash == "" {
		return false
	}
	return HashBackupCode(code) == storedHash
}

// ValidateBackupCodeSet checks a user-submitted code against a set of stored
// hashes and returns the index of the matching hash. Returns (-1, false) if
// no match. The caller should remove the consumed hash at the returned index
// (single-use).
func ValidateBackupCodeSet(code string, storedHashes []string) (int, bool) {
	code = strings.TrimSpace(code)
	if code == "" || len(storedHashes) == 0 {
		return -1, false
	}
	h := HashBackupCode(code)
	for i, sh := range storedHashes {
		if h == sh {
			return i, true
		}
	}
	return -1, false
}

// HashBackupCode returns the SHA-256 hex hash of a normalized backup code.
// Normalization removes separators and uppercases the code before hashing
// so that "a1b2-c3d4" and "A1B2C3D4" produce the same hash.
func HashBackupCode(code string) string {
	return hash.SHA256String(normalizeBackupCode(code))
}

// NormalizeBackupCode removes all separators/spaces and uppercases the code.
// This is the canonical form used for hashing and comparison.
func NormalizeBackupCode(code string) string {
	return normalizeBackupCode(code)
}

func normalizeBackupCode(code string) string {
	var b strings.Builder
	b.Grow(len(code))
	for _, r := range code {
		if r == '-' || r == ' ' || r == '_' {
			continue
		}
		if r >= 'a' && r <= 'z' {
			r -= 32
		}
		b.WriteRune(r)
	}
	return b.String()
}

func formatBackupCode(code string, opts BackupOptions) string {
	if opts.Separator == "" {
		return code
	}
	half := len(code) / 2
	return code[:half] + opts.Separator + code[half:]
}

func applyBackupDefaults(opts *BackupOptions) {
	if opts.Count <= 0 {
		opts.Count = DefaultBackupCount
	}
	if opts.Length == 0 {
		opts.Length = DefaultBackupLength
	}
	if opts.Charset == "" {
		opts.Charset = DefaultBackupCharset
	}
	if opts.Separator == "" {
		opts.Separator = "-"
	}
}
