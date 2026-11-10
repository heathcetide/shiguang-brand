// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Anti-counterfeiting (防伪) support for QR codes.
//
// This file provides three layers of protection that can be used
// independently or combined:
//
//  1. **HMAC signing** — Append a cryptographic signature to the QR
//     payload so that tampering or forgery can be detected on scan.
//     The verifier rejects any QR whose signature does not match.
//
//  2. **AES-GCM encryption** — Encrypt the payload so the actual
//     content is opaque to anyone scanning the QR without the key.
//     This provides confidentiality in addition to integrity.
//
//  3. **Secure QR** — A combined helper that encrypts the payload with
//     AES-GCM and then HMAC-signs the ciphertext, providing both
//     confidentiality and tamper detection in a single compact token.
//
// The signed/encrypted token is base64url-encoded and embedded as the
// QR code content. A typical flow:
//
//	// Issuer (e.g. product packaging):
//	token, _ := qrcode.Sign("product-id:12345", secretKey)
//	qrcode.Save(token, "label.png", qrcode.ECLHigh, 400)
//
//	// Verifier (e.g. anti-counterfeit app):
//	text, _ := qrcode.DecodeFile("label.png")
//	payload, err := qrcode.Verify(text, secretKey)
//	if err != nil { /* fake / tampered */ }

package qrcode

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"time"
)

// TokenPrefix is prepended to every signed/encrypted QR token so that
// verifiers can quickly distinguish a secure token from plain text.
const TokenPrefix = "LB1."

// ──────────────────────────────────────────────
// HMAC signing
// ──────────────────────────────────────────────

// signedPayload is the JSON structure embedded in a signed token.
type signedPayload struct {
	Data      string `json:"d"`
	Signature string `json:"s"`
	IssuedAt  int64  `json:"t,omitempty"` // unix seconds; 0 = no expiry check
}

// Sign produces a base64url-encoded token containing the payload and
// its HMAC-SHA256 signature. The token can be embedded in a QR code.
// Anyone with the secret key can later verify the payload's integrity.
func Sign(payload string, secret []byte) (string, error) {
	if payload == "" {
		return "", errors.New("qrcode: payload is empty")
	}
	if len(secret) == 0 {
		return "", errors.New("qrcode: secret is empty")
	}

	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(payload))
	sig := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))

	sp := signedPayload{
		Data:      payload,
		Signature: sig,
		IssuedAt:  time.Now().Unix(),
	}
	body, err := json.Marshal(sp)
	if err != nil {
		return "", fmt.Errorf("qrcode: marshal: %w", err)
	}
	return TokenPrefix + base64.RawURLEncoding.EncodeToString(body), nil
}

// Verify checks a token produced by Sign and returns the original
// payload if the signature is valid. Returns an error if the token is
// malformed, the signature does not match, or (if maxAge > 0) the
// token is older than maxAge.
func Verify(token string, secret []byte, maxAge time.Duration) (string, error) {
	if len(secret) == 0 {
		return "", errors.New("qrcode: secret is empty")
	}
	if len(token) < len(TokenPrefix) || token[:len(TokenPrefix)] != TokenPrefix {
		return "", errors.New("qrcode: not a signed token")
	}

	body, err := base64.RawURLEncoding.DecodeString(token[len(TokenPrefix):])
	if err != nil {
		return "", fmt.Errorf("qrcode: decode token: %w", err)
	}

	var sp signedPayload
	if err := json.Unmarshal(body, &sp); err != nil {
		return "", fmt.Errorf("qrcode: unmarshal: %w", err)
	}

	// Recompute HMAC.
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(sp.Data))
	expectedSig := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	if !hmac.Equal([]byte(sp.Signature), []byte(expectedSig)) {
		return "", errors.New("qrcode: signature mismatch (possible forgery)")
	}

	// Optional expiry check.
	if maxAge > 0 && sp.IssuedAt > 0 {
		age := time.Since(time.Unix(sp.IssuedAt, 0))
		if age > maxAge {
			return "", fmt.Errorf("qrcode: token expired (age %s)", age.Truncate(time.Second))
		}
	}

	return sp.Data, nil
}

// ──────────────────────────────────────────────
// AES-GCM encryption
// ──────────────────────────────────────────────

// Encrypt produces a base64url-encoded token containing the AES-GCM
// encrypted payload. The token can be embedded in a QR code. Only
// someone with the same key can decrypt and read the content.
// The key must be 16, 24, or 32 bytes (AES-128/192/256).
func Encrypt(payload string, key []byte) (string, error) {
	if payload == "" {
		return "", errors.New("qrcode: payload is empty")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", fmt.Errorf("qrcode: aes key: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", fmt.Errorf("qrcode: gcm: %w", err)
	}

	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", fmt.Errorf("qrcode: nonce: %w", err)
	}

	ciphertext := gcm.Seal(nonce, nonce, []byte(payload), nil)
	return TokenPrefix + base64.RawURLEncoding.EncodeToString(ciphertext), nil
}

// Decrypt decodes a token produced by Encrypt and returns the original
// plaintext payload.
func Decrypt(token string, key []byte) (string, error) {
	if len(token) < len(TokenPrefix) || token[:len(TokenPrefix)] != TokenPrefix {
		return "", errors.New("qrcode: not an encrypted token")
	}

	raw, err := base64.RawURLEncoding.DecodeString(token[len(TokenPrefix):])
	if err != nil {
		return "", fmt.Errorf("qrcode: decode token: %w", err)
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return "", fmt.Errorf("qrcode: aes key: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", fmt.Errorf("qrcode: gcm: %w", err)
	}

	ns := gcm.NonceSize()
	if len(raw) < ns {
		return "", errors.New("qrcode: ciphertext too short")
	}
	nonce, ciphertext := raw[:ns], raw[ns:]
	plaintext, err := gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return "", fmt.Errorf("qrcode: decrypt: %w", err)
	}
	return string(plaintext), nil
}

// ──────────────────────────────────────────────
// Secure QR (encrypt + sign)
// ──────────────────────────────────────────────

// securePayload is the JSON structure for the combined secure token.
type securePayload struct {
	Ciphertext string `json:"c"`
	Signature  string `json:"s"`
	IssuedAt   int64  `json:"t"`
}

// Secure produces a token that first AES-GCM encrypts the payload
// (confidentiality) and then HMAC-signs the ciphertext (integrity).
// This is the recommended approach for anti-counterfeit labels where
// both secrecy and tamper detection are required.
//
// The encryptKey must be 16/24/32 bytes; the signKey must be non-empty.
func Secure(payload string, encryptKey, signKey []byte) (string, error) {
	if payload == "" {
		return "", errors.New("qrcode: payload is empty")
	}
	if len(signKey) == 0 {
		return "", errors.New("qrcode: sign key is empty")
	}

	encToken, err := Encrypt(payload, encryptKey)
	if err != nil {
		return "", err
	}
	// Encrypt returns a TokenPrefix-prefixed string; sign the full token.
	mac := hmac.New(sha256.New, signKey)
	mac.Write([]byte(encToken))
	sig := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))

	sp := securePayload{
		Ciphertext: encToken,
		Signature:  sig,
		IssuedAt:   time.Now().Unix(),
	}
	body, err := json.Marshal(sp)
	if err != nil {
		return "", fmt.Errorf("qrcode: marshal: %w", err)
	}
	return TokenPrefix + base64.RawURLEncoding.EncodeToString(body), nil
}

// Unseal verifies and decrypts a token produced by Secure, returning
// the original plaintext payload. Returns an error if the signature is
// invalid or decryption fails.
func Unseal(token string, encryptKey, signKey []byte, maxAge time.Duration) (string, error) {
	if len(signKey) == 0 {
		return "", errors.New("qrcode: sign key is empty")
	}
	if len(token) < len(TokenPrefix) || token[:len(TokenPrefix)] != TokenPrefix {
		return "", errors.New("qrcode: not a secure token")
	}

	body, err := base64.RawURLEncoding.DecodeString(token[len(TokenPrefix):])
	if err != nil {
		return "", fmt.Errorf("qrcode: decode token: %w", err)
	}

	var sp securePayload
	if err := json.Unmarshal(body, &sp); err != nil {
		return "", fmt.Errorf("qrcode: unmarshal: %w", err)
	}

	// Verify HMAC over the ciphertext token.
	mac := hmac.New(sha256.New, signKey)
	mac.Write([]byte(sp.Ciphertext))
	expectedSig := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	if !hmac.Equal([]byte(sp.Signature), []byte(expectedSig)) {
		return "", errors.New("qrcode: signature mismatch (possible forgery)")
	}

	// Optional expiry check.
	if maxAge > 0 && sp.IssuedAt > 0 {
		age := time.Since(time.Unix(sp.IssuedAt, 0))
		if age > maxAge {
			return "", fmt.Errorf("qrcode: token expired (age %s)", age.Truncate(time.Second))
		}
	}

	// Decrypt.
	return Decrypt(sp.Ciphertext, encryptKey)
}

// ──────────────────────────────────────────────
// Convenience: generate + sign in one step
// ──────────────────────────────────────────────

// GenerateSigned generates a QR code whose content is a signed token
// (produced by Sign). This is a convenience for anti-counterfeit labels.
func GenerateSigned(payload string, secret []byte, level ErrorCorrectionLevel, size int) (image.Image, error) {
	token, err := Sign(payload, secret)
	if err != nil {
		return nil, err
	}
	return Generate(token, level, size)
}

// GenerateSecure generates a QR code whose content is an encrypted +
// signed token (produced by Secure).
func GenerateSecure(payload string, encryptKey, signKey []byte, level ErrorCorrectionLevel, size int) (image.Image, error) {
	token, err := Secure(payload, encryptKey, signKey)
	if err != nil {
		return nil, err
	}
	return Generate(token, level, size)
}

// IsSecureToken returns true if the string looks like a token produced
// by Sign, Encrypt, or Secure (i.e. it has the TokenPrefix).
func IsSecureToken(s string) bool {
	return len(s) >= len(TokenPrefix) && s[:len(TokenPrefix)] == TokenPrefix
}
