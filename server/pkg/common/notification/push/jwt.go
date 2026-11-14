// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package push

import (
	"crypto"
	"crypto/ecdsa"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"strings"
	"time"
)

// jwtHeader is the JOSE header of a JWT.
type jwtHeader struct {
	Alg string `json:"alg"`
	Typ string `json:"typ"`
	Kid string `json:"kid,omitempty"`
}

// base64URLEncode returns the base64url encoding (no padding) of b.
func base64URLEncode(b []byte) string {
	return base64.RawURLEncoding.EncodeToString(b)
}

// signES256 produces a compact JWT signed with ES256 (ECDSA P-256).
// The ES256 signature is the raw R||S bytes (64 bytes total).
func signES256(headerB64, payloadB64 string, key *ecdsa.PrivateKey) (string, error) {
	signingInput := headerB64 + "." + payloadB64
	sum := sha256.Sum256([]byte(signingInput))
	r, s, err := ecdsa.Sign(rand.Reader, key, sum[:])
	if err != nil {
		return "", fmt.Errorf("push: es256 sign: %w", err)
	}
	sig := make([]byte, 64)
	rb := r.Bytes()
	sb := s.Bytes()
	copy(sig[32-len(rb):32], rb)
	copy(sig[64-len(sb):64], sb)
	return signingInput + "." + base64URLEncode(sig), nil
}

// signRS256 produces a compact JWT signed with RS256 (RSA-SHA256).
func signRS256(headerB64, payloadB64 string, key *rsa.PrivateKey) (string, error) {
	signingInput := headerB64 + "." + payloadB64
	sum := sha256.Sum256([]byte(signingInput))
	sig, err := rsa.SignPKCS1v15(rand.Reader, key, crypto.SHA256, sum[:])
	if err != nil {
		return "", fmt.Errorf("push: rs256 sign: %w", err)
	}
	return signingInput + "." + base64URLEncode(sig), nil
}

// buildJWT constructs a compact JWT with the given header and claims,
// signing it with the provided signer. The signer receives the base64url
// header and payload and returns the complete compact token.
func buildJWT(header jwtHeader, claims any, sign func(headerB64, payloadB64 string) (string, error)) (string, error) {
	hb, err := json.Marshal(header)
	if err != nil {
		return "", fmt.Errorf("push: marshal jwt header: %w", err)
	}
	pb, err := json.Marshal(claims)
	if err != nil {
		return "", fmt.Errorf("push: marshal jwt claims: %w", err)
	}
	headerB64 := base64URLEncode(hb)
	payloadB64 := base64URLEncode(pb)
	return sign(headerB64, payloadB64)
}

// parseECPrivateKey parses a PEM-encoded EC private key (SEC1/PKCS8).
// If authKey looks like a file path it is read from disk.
func parseECPrivateKey(authKey string) (*ecdsa.PrivateKey, error) {
	pemBytes, err := keyBytes(authKey)
	if err != nil {
		return nil, err
	}
	block, _ := pem.Decode(pemBytes)
	if block == nil {
		return nil, fmt.Errorf("push: no PEM block in auth key")
	}
	if key, err := x509.ParseECPrivateKey(block.Bytes); err == nil {
		return key, nil
	}
	parsed, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return nil, fmt.Errorf("push: parse ec private key: %w", err)
	}
	ecKey, ok := parsed.(*ecdsa.PrivateKey)
	if !ok {
		return nil, fmt.Errorf("push: parsed key is not an EC private key")
	}
	return ecKey, nil
}

// parseRSAPrivateKey parses a PEM-encoded RSA private key (PKCS1/PKCS8).
func parseRSAPrivateKey(pemBytes []byte) (*rsa.PrivateKey, error) {
	block, _ := pem.Decode(pemBytes)
	if block == nil {
		return nil, fmt.Errorf("push: no PEM block in rsa key")
	}
	if key, err := x509.ParsePKCS1PrivateKey(block.Bytes); err == nil {
		return key, nil
	}
	parsed, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return nil, fmt.Errorf("push: parse rsa private key: %w", err)
	}
	rsaKey, ok := parsed.(*rsa.PrivateKey)
	if !ok {
		return nil, fmt.Errorf("push: parsed key is not an RSA private key")
	}
	return rsaKey, nil
}

// keyBytes returns the PEM bytes for authKey. If authKey contains a PEM
// header it is returned as-is; otherwise authKey is treated as a file path.
func keyBytes(authKey string) ([]byte, error) {
	s := strings.TrimSpace(authKey)
	if s == "" {
		return nil, fmt.Errorf("push: empty key")
	}
	if strings.Contains(s, "-----BEGIN") {
		return []byte(s), nil
	}
	return readFileBytes(s)
}

// jwtClaims are the standard JWT claims used by APNs and FCM.
type jwtClaims struct {
	Iss   string `json:"iss"`
	Sub   string `json:"sub,omitempty"`
	Iat   int64  `json:"iat"`
	Exp   int64  `json:"exp"`
	Aud   string `json:"aud,omitempty"`
	Scope string `json:"scope,omitempty"`
}

// makeAPNsJWT builds an ES256-signed provider JWT for APNs.
func makeAPNsJWT(teamID, keyID string, key *ecdsa.PrivateKey) (string, error) {
	now := time.Now()
	claims := jwtClaims{
		Iss: teamID,
		Iat: now.Unix(),
		Exp: now.Add(time.Hour).Unix(),
	}
	header := jwtHeader{Alg: "ES256", Typ: "JWT", Kid: keyID}
	return buildJWT(header, claims, func(h, p string) (string, error) {
		return signES256(h, p, key)
	})
}

// makeFCMJWT builds an RS256-signed JWT for the FCM OAuth2 service account
// bearer token flow.
func makeFCMJWT(clientEmail, tokenURI string, key *rsa.PrivateKey) (string, error) {
	now := time.Now()
	claims := jwtClaims{
		Iss:   clientEmail,
		Sub:   clientEmail,
		Aud:   tokenURI,
		Iat:   now.Unix(),
		Exp:   now.Add(time.Hour).Unix(),
		Scope: "https://www.googleapis.com/auth/firebase.messaging",
	}
	header := jwtHeader{Alg: "RS256", Typ: "JWT"}
	return buildJWT(header, claims, func(h, p string) (string, error) {
		return signRS256(h, p, key)
	})
}
