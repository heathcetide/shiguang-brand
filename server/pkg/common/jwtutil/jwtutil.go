// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package jwtutil provides a reusable, library-friendly JWT authentication
// layer built on top of the `common/crypto` JWT primitives.
//
// It adds the pieces needed for real-world auth flows that the low-level
// crypto.JWT type does not cover:
//
//   - Token pairs: short-lived access token + long-lived refresh token.
//   - Refresh flow: issue a new access token from a valid refresh token.
//   - Revocation / blacklist: pluggable TokenStore for invalidating tokens
//     before their natural expiry (logout, password change, etc.).
//   - Claims builder: fluent API for constructing common claim sets.
//   - HTTP helpers: extract bearer tokens, context-based claim retrieval,
//     and a generic auth middleware wrapper.
//
// # Quick start
//
//	auth, err := jwtutil.New(jwtutil.Config{
//	    Secret:      []byte("my-32-byte-secret-1234567890123456"),
//	    Issuer:      "my-app",
//	    AccessTTL:   15 * time.Minute,
//	    RefreshTTL:  7 * 24 * time.Hour,
//	})
//	if err != nil {
//	    log.Fatal(err)
//	}
//
//	// Issue a token pair at login.
//	pair, err := auth.Login("user-123", jwtutil.Roles("admin"))
//	// pair.AccessToken, pair.RefreshToken
//
//	// Verify an access token (from Authorization: Bearer <token>).
//	claims, err := auth.Verify(pair.AccessToken)
//
//	// Refresh.
//	pair, err = auth.Refresh(pair.RefreshToken)
//
//	// Revoke (logout).
//	auth.Revoke(context.Background(), pair.AccessToken)
package jwtutil

import (
	"context"
	"crypto/rsa"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common/crypto"
)

// ──────────────────────────────────────────────
// Errors
// ──────────────────────────────────────────────

var (
	// ErrInvalidToken is returned when a token is malformed or has an invalid signature.
	ErrInvalidToken = errors.New("jwtutil: invalid token")
	// ErrTokenExpired is returned when a token has passed its expiry time.
	ErrTokenExpired = errors.New("jwtutil: token expired")
	// ErrTokenNotYetValid is returned when a token's nbf claim is in the future.
	ErrTokenNotYetValid = errors.New("jwtutil: token not yet valid")
	// ErrTokenRevoked is returned when a token has been revoked via the TokenStore.
	ErrTokenRevoked = errors.New("jwtutil: token revoked")
	// ErrWrongTokenType is returned when a refresh token is used where an access
	// token is expected, or vice versa.
	ErrWrongTokenType = errors.New("jwtutil: wrong token type")
)

// ──────────────────────────────────────────────
// Token types
// ──────────────────────────────────────────────

// TokenType distinguishes access tokens from refresh tokens.
type TokenType string

const (
	// TokenTypeAccess is the short-lived token used for API authentication.
	TokenTypeAccess TokenType = "access"
	// TokenTypeRefresh is the long-lived token used to obtain new access tokens.
	TokenTypeRefresh TokenType = "refresh"
)

// ──────────────────────────────────────────────
// Claims
// ──────────────────────────────────────────────

// Claims represents the decoded JWT claims with auth-specific fields.
type Claims struct {
	// Standard JWT claims.
	Issuer    string `json:"iss,omitempty"`
	Subject   string `json:"sub,omitempty"`
	Audience  string `json:"aud,omitempty"`
	ExpiresAt int64  `json:"exp,omitempty"`
	NotBefore int64  `json:"nbf,omitempty"`
	IssuedAt  int64  `json:"iat,omitempty"`
	ID        string `json:"jti,omitempty"`

	// Auth-specific claims.
	TokenType   TokenType `json:"type,omitempty"`
	Roles       []string  `json:"roles,omitempty"`
	Permissions []string  `json:"perms,omitempty"`

	// Extra holds any additional non-standard claims.
	Extra map[string]any `json:"-"`
}

// HasRole returns true if the claims include the given role.
func (c *Claims) HasRole(role string) bool {
	for _, r := range c.Roles {
		if r == role {
			return true
		}
	}
	return false
}

// HasPermission returns true if the claims include the given permission.
func (c *Claims) HasPermission(perm string) bool {
	for _, p := range c.Permissions {
		if p == perm {
			return true
		}
	}
	return false
}

// IsAccess returns true if this is an access token.
func (c *Claims) IsAccess() bool { return c.TokenType == TokenTypeAccess }

// IsRefresh returns true if this is a refresh token.
func (c *Claims) IsRefresh() bool { return c.TokenType == TokenTypeRefresh }

// ──────────────────────────────────────────────
// Token pair
// ──────────────────────────────────────────────

// TokenPair holds an access token and its associated refresh token.
type TokenPair struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int64  `json:"expires_in"` // access token TTL in seconds
	TokenType    string `json:"token_type"` // always "Bearer"
}

// ──────────────────────────────────────────────
// TokenStore (revocation / blacklist)
// ──────────────────────────────────────────────

// TokenStore is a pluggable store for tracking revoked tokens.
// Implementations can be in-memory (for single-instance), Redis, etc.
//
// A token is considered revoked if IsRevoked returns true for its jti.
// The store is also used to track refresh tokens that have been used
// (to prevent replay attacks).
type TokenStore interface {
	// Revoke marks the token ID (jti) as revoked until the given expiry.
	Revoke(ctx context.Context, jti string, expiry time.Time) error

	// IsRevoked returns true if the token ID has been revoked.
	IsRevoked(ctx context.Context, jti string) (bool, error)

	// MarkUsed marks a refresh token ID as used (for one-time refresh tokens).
	// Returns true if it was not previously used, false if already used.
	MarkUsed(ctx context.Context, jti string, expiry time.Time) (bool, error)
}

// ──────────────────────────────────────────────
// Config
// ──────────────────────────────────────────────

// Config configures the JWT auth manager.
type Config struct {
	// Secret is the HMAC secret key (for HS256/HS512). Required if using HMAC.
	Secret []byte
	// Algorithm is the signing algorithm. Default: HS256.
	Algorithm crypto.JWTAlgorithm
	// RSAPriv is the RSA private key for RS256 signing. Required if using RS256.
	RSAPriv *rsa.PrivateKey
	// RSAPub is the RSA public key for RS256 verification. Required if using RS256.
	RSAPub *rsa.PublicKey
	// Issuer is the iss claim. Optional.
	Issuer string
	// Audience is the aud claim. Optional.
	Audience string
	// AccessTTL is the access token lifetime. Default: 15m.
	AccessTTL time.Duration
	// RefreshTTL is the refresh token lifetime. Default: 168h (7 days).
	RefreshTTL time.Duration
	// Store is the optional token revocation store. If nil, revocation is
	// not enforced (tokens remain valid until expiry).
	Store TokenStore
	// Leeway is the clock skew tolerance for exp/nbf checks. Default: 0.
	Leeway time.Duration
}

// DefaultConfig returns a Config with sensible defaults.
func DefaultConfig() Config {
	return Config{
		Algorithm:  crypto.JWTAlgHS256,
		AccessTTL:  15 * time.Minute,
		RefreshTTL: 168 * time.Hour,
	}
}

// ──────────────────────────────────────────────
// Auth (the main manager)
// ──────────────────────────────────────────────

// Auth is the JWT authentication manager. It signs, verifies, refreshes,
// and revokes tokens.
type Auth struct {
	cfg    Config
	signer *crypto.JWT

	// signer for refresh tokens — same key, different TTL.
	refreshSigner *crypto.JWT

	// idGen generates unique token IDs (jti).
	idGen IDGenerator
}

// New creates a new Auth manager from the given Config.
func New(cfg Config) (*Auth, error) {
	if cfg.Algorithm == "" {
		cfg.Algorithm = crypto.JWTAlgHS256
	}
	if cfg.AccessTTL <= 0 {
		cfg.AccessTTL = 15 * time.Minute
	}
	if cfg.RefreshTTL <= 0 {
		cfg.RefreshTTL = 168 * time.Hour
	}

	// Validate key material.
	switch cfg.Algorithm {
	case crypto.JWTAlgHS256, crypto.JWTAlgHS512:
		if len(cfg.Secret) == 0 {
			return nil, errors.New("jwtutil: Secret is required for HMAC algorithms")
		}
	case crypto.JWTAlgRS256:
		if cfg.RSAPriv == nil {
			return nil, errors.New("jwtutil: RSAPriv is required for RS256")
		}
		if cfg.RSAPub == nil {
			return nil, errors.New("jwtutil: RSAPub is required for RS256")
		}
	default:
		return nil, fmt.Errorf("jwtutil: unsupported algorithm %q", cfg.Algorithm)
	}

	accessJWT := crypto.NewJWT(crypto.JWTConfig{
		Algorithm: cfg.Algorithm,
		Secret:    cfg.Secret,
		RSAPriv:   cfg.RSAPriv,
		RSAPub:    cfg.RSAPub,
		Issuer:    cfg.Issuer,
		Audience:  cfg.Audience,
		ExpiresIn: cfg.AccessTTL,
	})

	refreshJWT := crypto.NewJWT(crypto.JWTConfig{
		Algorithm: cfg.Algorithm,
		Secret:    cfg.Secret,
		RSAPriv:   cfg.RSAPriv,
		RSAPub:    cfg.RSAPub,
		Issuer:    cfg.Issuer,
		Audience:  cfg.Audience,
		ExpiresIn: cfg.RefreshTTL,
	})

	return &Auth{
		cfg:           cfg,
		signer:        accessJWT,
		refreshSigner: refreshJWT,
		idGen:         defaultIDGenerator{},
	}, nil
}

// SetIDGenerator overrides the default jti generator.
func (a *Auth) SetIDGenerator(g IDGenerator) {
	if g != nil {
		a.idGen = g
	}
}

// SetStore overrides the token store (can also be set via Config.Store).
func (a *Auth) SetStore(s TokenStore) {
	a.cfg.Store = s
}

// ──────────────────────────────────────────────
// Token issuance
// ──────────────────────────────────────────────

// IssueOption modifies the claims during token issuance.
type IssueOption func(*Claims)

// WithRoles sets the roles claim.
func WithRoles(roles ...string) IssueOption {
	return func(c *Claims) { c.Roles = roles }
}

// WithPermissions sets the permissions claim.
func WithPermissions(perms ...string) IssueOption {
	return func(c *Claims) { c.Permissions = perms }
}

// WithExtra sets an extra claim key-value pair.
func WithExtra(key string, value any) IssueOption {
	return func(c *Claims) {
		if c.Extra == nil {
			c.Extra = make(map[string]any)
		}
		c.Extra[key] = value
	}
}

// WithAudience overrides the audience claim for this token.
func WithAudience(aud string) IssueOption {
	return func(c *Claims) { c.Audience = aud }
}

// Login issues a token pair (access + refresh) for the given subject.
// Additional claims can be set via options.
func (a *Auth) Login(subject string, opts ...IssueOption) (*TokenPair, error) {
	if subject == "" {
		return nil, errors.New("jwtutil: subject is required")
	}

	base := &Claims{
		Subject: subject,
	}
	for _, opt := range opts {
		opt(base)
	}

	accessToken, accessJTI, err := a.issueToken(base, TokenTypeAccess, a.cfg.AccessTTL)
	if err != nil {
		return nil, fmt.Errorf("jwtutil: issue access token: %w", err)
	}

	refreshToken, _, err := a.issueToken(base, TokenTypeRefresh, a.cfg.RefreshTTL)
	if err != nil {
		return nil, fmt.Errorf("jwtutil: issue refresh token: %w", err)
	}

	_ = accessJTI // currently not used externally

	return &TokenPair{
		AccessToken:  accessToken,
		RefreshToken: refreshToken,
		ExpiresIn:    int64(a.cfg.AccessTTL.Seconds()),
		TokenType:    "Bearer",
	}, nil
}

// IssueAccess issues a standalone access token (without a refresh token).
func (a *Auth) IssueAccess(subject string, opts ...IssueOption) (string, error) {
	if subject == "" {
		return "", errors.New("jwtutil: subject is required")
	}
	base := &Claims{Subject: subject}
	for _, opt := range opts {
		opt(base)
	}
	token, _, err := a.issueToken(base, TokenTypeAccess, a.cfg.AccessTTL)
	return token, err
}

// issueToken signs a token with the given type and TTL.
func (a *Auth) issueToken(base *Claims, tt TokenType, ttl time.Duration) (string, string, error) {
	now := time.Now()
	jti, err := a.idGen.NewID()
	if err != nil {
		return "", "", fmt.Errorf("jwtutil: generate jti: %w", err)
	}

	claims := crypto.JWTClaims{
		Issuer:    a.cfg.Issuer,
		Subject:   base.Subject,
		Audience:  base.Audience,
		ExpiresAt: now.Add(ttl).Unix(),
		NotBefore: now.Unix(),
		IssuedAt:  now.Unix(),
		ID:        jti,
		Extra:     map[string]interface{}{},
	}

	// Add auth-specific claims.
	claims.Extra["type"] = string(tt)
	if len(base.Roles) > 0 {
		claims.Extra["roles"] = base.Roles
	}
	if len(base.Permissions) > 0 {
		claims.Extra["perms"] = base.Permissions
	}
	for k, v := range base.Extra {
		claims.Extra[k] = v
	}

	var signer *crypto.JWT
	if tt == TokenTypeRefresh {
		signer = a.refreshSigner
	} else {
		signer = a.signer
	}

	token, err := signer.Sign(claims)
	if err != nil {
		return "", "", err
	}
	return token, jti, nil
}

// ──────────────────────────────────────────────
// Token verification
// ──────────────────────────────────────────────

// Verify validates an access token and returns the claims.
// It checks signature, expiry, nbf, token type, and revocation status.
func (a *Auth) Verify(token string) (*Claims, error) {
	return a.verifyToken(token, TokenTypeAccess)
}

// VerifyRefresh validates a refresh token and returns the claims.
func (a *Auth) VerifyRefresh(token string) (*Claims, error) {
	return a.verifyToken(token, TokenTypeRefresh)
}

func (a *Auth) verifyToken(token string, expectedType TokenType) (*Claims, error) {
	cryptoClaims, err := a.signer.Parse(token)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalidToken, err)
	}

	// Verify signature is valid (Parse already verifies, but let's double-check
	// by calling Verify which also checks exp/nbf).
	if _, err := a.signer.Verify(token); err != nil {
		if strings.Contains(err.Error(), "expired") {
			return nil, ErrTokenExpired
		}
		if strings.Contains(err.Error(), "not valid yet") {
			return nil, ErrTokenNotYetValid
		}
		return nil, fmt.Errorf("%w: %v", ErrInvalidToken, err)
	}

	claims := cryptoClaimsToClaims(cryptoClaims)

	// Check token type.
	if claims.TokenType != expectedType {
		return nil, fmt.Errorf("%w: expected %s, got %s", ErrWrongTokenType, expectedType, claims.TokenType)
	}

	// Check revocation.
	if a.cfg.Store != nil && claims.ID != "" {
		revoked, err := a.cfg.Store.IsRevoked(context.Background(), claims.ID)
		if err != nil {
			return nil, fmt.Errorf("jwtutil: check revocation: %w", err)
		}
		if revoked {
			return nil, ErrTokenRevoked
		}
	}

	return claims, nil
}

// ──────────────────────────────────────────────
// Refresh flow
// ──────────────────────────────────────────────

// Refresh validates a refresh token and issues a new token pair.
// If the TokenStore supports MarkUsed, the old refresh token is marked
// as used to prevent replay attacks.
func (a *Auth) Refresh(refreshToken string) (*TokenPair, error) {
	claims, err := a.VerifyRefresh(refreshToken)
	if err != nil {
		return nil, err
	}

	// Mark the refresh token as used (one-time use).
	if a.cfg.Store != nil && claims.ID != "" {
		expiry := time.Unix(claims.ExpiresAt, 0)
		fresh, err := a.cfg.Store.MarkUsed(context.Background(), claims.ID, expiry)
		if err != nil {
			return nil, fmt.Errorf("jwtutil: mark refresh used: %w", err)
		}
		if !fresh {
			return nil, ErrTokenRevoked // refresh token already used
		}
	}

	// Issue a new pair with the same subject and roles.
	opts := []IssueOption{
		WithRoles(claims.Roles...),
		WithPermissions(claims.Permissions...),
	}
	for k, v := range claims.Extra {
		opts = append(opts, WithExtra(k, v))
	}

	return a.Login(claims.Subject, opts...)
}

// ──────────────────────────────────────────────
// Revocation
// ──────────────────────────────────────────────

// Revoke marks an access token as revoked. Requires a TokenStore.
func (a *Auth) Revoke(ctx context.Context, accessToken string) error {
	if a.cfg.Store == nil {
		return errors.New("jwtutil: no token store configured")
	}
	claims, err := a.signer.Parse(accessToken)
	if err != nil {
		return fmt.Errorf("jwtutil: parse token for revocation: %w", err)
	}
	if claims.ID == "" {
		return errors.New("jwtutil: token has no jti, cannot revoke")
	}
	expiry := time.Unix(claims.ExpiresAt, 0)
	return a.cfg.Store.Revoke(ctx, claims.ID, expiry)
}

// RevokeRefresh marks a refresh token as revoked. Requires a TokenStore.
func (a *Auth) RevokeRefresh(ctx context.Context, refreshToken string) error {
	if a.cfg.Store == nil {
		return errors.New("jwtutil: no token store configured")
	}
	claims, err := a.refreshSigner.Parse(refreshToken)
	if err != nil {
		return fmt.Errorf("jwtutil: parse refresh token for revocation: %w", err)
	}
	if claims.ID == "" {
		return errors.New("jwtutil: token has no jti, cannot revoke")
	}
	expiry := time.Unix(claims.ExpiresAt, 0)
	return a.cfg.Store.Revoke(ctx, claims.ID, expiry)
}

// ──────────────────────────────────────────────
// HTTP helpers
// ──────────────────────────────────────────────

// ExtractBearer extracts the token from an "Authorization: Bearer <token>"
// header value. Returns the token and nil if successful.
func ExtractBearer(authHeader string) (string, error) {
	if authHeader == "" {
		return "", errors.New("jwtutil: missing Authorization header")
	}
	const prefix = "Bearer "
	if !strings.HasPrefix(authHeader, prefix) {
		return "", errors.New("jwtutil: invalid Authorization header format")
	}
	token := strings.TrimPrefix(authHeader, prefix)
	if token == "" {
		return "", errors.New("jwtutil: empty bearer token")
	}
	return token, nil
}

// contextKey is an unexported type for context keys in this package.
type contextKey int

const claimsKey contextKey = iota

// ContextWithClaims stores claims in a context.
func ContextWithClaims(ctx context.Context, claims *Claims) context.Context {
	return context.WithValue(ctx, claimsKey, claims)
}

// ClaimsFromContext retrieves claims from a context, or nil if not present.
func ClaimsFromContext(ctx context.Context) *Claims {
	c, _ := ctx.Value(claimsKey).(*Claims)
	return c
}

// ──────────────────────────────────────────────
// Internal helpers
// ──────────────────────────────────────────────

// cryptoClaimsToClaims converts crypto.JWTClaims to jwtutil.Claims.
func cryptoClaimsToClaims(c *crypto.JWTClaims) *Claims {
	claims := &Claims{
		Issuer:    c.Issuer,
		Subject:   c.Subject,
		Audience:  c.Audience,
		ExpiresAt: c.ExpiresAt,
		NotBefore: c.NotBefore,
		IssuedAt:  c.IssuedAt,
		ID:        c.ID,
		Extra:     make(map[string]any),
	}
	if v, ok := c.Extra["type"].(string); ok {
		claims.TokenType = TokenType(v)
	}
	claims.Roles = toStringSlice(c.Extra["roles"])
	claims.Permissions = toStringSlice(c.Extra["perms"])
	// Copy remaining extra claims (excluding type/roles/perms which are
	// already extracted).
	for k, v := range c.Extra {
		switch k {
		case "type", "roles", "perms":
			continue
		default:
			claims.Extra[k] = v
		}
	}
	return claims
}

// toStringSlice converts a value that may be []string or []interface{}
// (from JSON round-trip) to []string.
func toStringSlice(v any) []string {
	if v == nil {
		return nil
	}
	switch s := v.(type) {
	case []string:
		return s
	case []interface{}:
		result := make([]string, 0, len(s))
		for _, item := range s {
			if str, ok := item.(string); ok {
				result = append(result, str)
			}
		}
		return result
	default:
		return nil
	}
}
