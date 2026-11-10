// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package authcontext provides a unified security-context propagation
// layer for HTTP services and inter-service calls.
//
// It solves three problems that arise in every multi-layer backend:
//
//  1. **Extract** — read identity information (user ID, roles,
//     permissions, tenant) from an incoming HTTP request, whether it
//     arrives as a JWT bearer token, a signed cookie, or trusted
//     headers forwarded by a gateway.
//  2. **Store** — place the identity into a request-scoped
//     [context.Context] so downstream handlers, services, and
//     repositories can access it without passing it through every
//     function signature.
//  3. **Propagate** — when the service makes outbound HTTP calls to
//     other internal services, automatically forward the identity
//     headers so the downstream service can re-extract the same
//     context.
//
// # Architecture
//
//	      Incoming Request
//	             │
//	             ▼
//	   ┌───────────────────┐
//	   │  Extractor        │  ← JWT / headers / custom
//	   │  (AuthExtractor)  │
//	   └────────┬──────────┘
//	            │ Identity
//	            ▼
//	   ┌───────────────────┐
//	   │  Context          │  ← context.WithValue
//	   │  (WithIdentity)   │
//	   └────────┬──────────┘
//	            │ ctx
//	            ▼
//	   ┌───────────────────┐
//	   │  Propagator       │  ← outbound http.RoundTripper
//	   │  (PropagatingRT)  │
//	   └───────────────────┘
//	            │
//	            ▼
//	      Downstream Service
//
// # Quick start
//
//	// 1. Configure an extractor (JWT-based by default).
//	extractor := authcontext.NewJWTExtractor(auth)
//
//	// 2. Gin middleware that extracts and stores identity in ctx.
//	r.Use(authcontext.GinMiddleware(extractor))
//
//	// 3. Read identity anywhere.
//	id := authcontext.FromContext(c.Request.Context())
//	fmt.Println(id.UserID, id.Roles)
//
//	// 4. Propagate to downstream calls.
//	client := &http.Client{
//	    Transport: authcontext.NewPropagatingTransport(nil),
//	}
//	req, _ := http.NewRequestWithContext(ctx, "GET", "http://downstream/api", nil)
//	resp, _ := client.Do(req) // identity headers auto-injected
package authcontext

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
)

// ──────────────────────────────────────────────
// Errors
// ──────────────────────────────────────────────

var (
	// ErrNoIdentity is returned when no identity is found in the context.
	ErrNoIdentity = errors.New("authcontext: no identity in context")

	// ErrInvalidToken is returned when the token cannot be parsed.
	ErrInvalidToken = errors.New("authcontext: invalid token")
)

// ──────────────────────────────────────────────
// Identity
// ──────────────────────────────────────────────

// Identity represents the security principal associated with a request.
// It is the unified shape that flows through context and is propagated
// to downstream services.
type Identity struct {
	// UserID is the unique identifier of the authenticated user.
	UserID string `json:"user_id,omitempty"`

	// UserName is the human-readable login name.
	UserName string `json:"user_name,omitempty"`

	// NickName is an optional display name.
	NickName string `json:"nick_name,omitempty"`

	// TenantID is an optional multi-tenant scope identifier.
	TenantID string `json:"tenant_id,omitempty"`

	// Roles is the set of role names assigned to the user.
	Roles []string `json:"roles,omitempty"`

	// Permissions is the set of permission strings granted to the user.
	Permissions []string `json:"permissions,omitempty"`

	// Token is the raw token string (JWT, opaque, etc.) used for
	// authentication. Populated by extractors so it can be forwarded.
	Token string `json:"-"`

	// Source indicates how the identity was established: "jwt",
	// "header", "custom".
	Source string `json:"source,omitempty"`

	// Extra holds extractor-specific metadata not covered by the
	// fields above.
	Extra map[string]any `json:"extra,omitempty"`
}

// HasRole reports whether the identity has the given role.
func (i *Identity) HasRole(role string) bool {
	if i == nil {
		return false
	}
	for _, r := range i.Roles {
		if r == role {
			return true
		}
	}
	return false
}

// HasPermission reports whether the identity has the given permission.
// Supports wildcard matching: "user:*" matches "user:read".
func (i *Identity) HasPermission(perm string) bool {
	if i == nil {
		return false
	}
	for _, p := range i.Permissions {
		if p == perm {
			return true
		}
		if strings.HasSuffix(p, ":*") {
			prefix := p[:len(p)-1] // "user:*" → "user:"
			if strings.HasPrefix(perm, prefix) {
				return true
			}
		}
		if p == "*" {
			return true
		}
	}
	return false
}

// IsAuthenticated reports whether this identity represents an
// authenticated user (UserID is non-empty).
func (i *Identity) IsAuthenticated() bool {
	return i != nil && i.UserID != ""
}

// ──────────────────────────────────────────────
// Context storage
// ──────────────────────────────────────────────

type ctxKey struct{}

// WithIdentity stores id in ctx. Passing a nil identity clears the
// value (returns ctx without the key).
func WithIdentity(ctx context.Context, id *Identity) context.Context {
	if id == nil {
		return ctx
	}
	return context.WithValue(ctx, ctxKey{}, id)
}

// FromContext retrieves the identity from ctx. Returns nil if no
// identity is present.
func FromContext(ctx context.Context) *Identity {
	id, _ := ctx.Value(ctxKey{}).(*Identity)
	return id
}

// MustFromContext retrieves the identity from ctx or panics if absent.
// Use in handlers where the middleware guarantees an identity exists.
func MustFromContext(ctx context.Context) *Identity {
	id := FromContext(ctx)
	if id == nil {
		panic(ErrNoIdentity)
	}
	return id
}

// ──────────────────────────────────────────────
// Extractor
// ──────────────────────────────────────────────

// AuthExtractor extracts an [Identity] from an HTTP request. Different
// implementations parse JWT tokens, trusted headers, cookies, etc.
type AuthExtractor interface {
	Extract(r *http.Request) (*Identity, error)
}

// The ExtractFunc type is an adapter to allow the use of ordinary
// functions as [AuthExtractor]s.
type ExtractFunc func(r *http.Request) (*Identity, error)

// Extract implements [AuthExtractor].
func (f ExtractFunc) Extract(r *http.Request) (*Identity, error) {
	return f(r)
}

// ──────────────────────────────────────────────
// Header-based extractor (trusted gateway / internal calls)
// ──────────────────────────────────────────────

// HeaderExtractor builds an Identity from trusted HTTP headers. This is
// used when an upstream gateway has already authenticated the request
// and forwards identity via headers (e.g. X-User-ID, X-User-Roles).
//
// It does NOT verify any token — only use behind a trusted gateway or
// for internal service-to-service calls.
type HeaderExtractor struct {
	// HeaderUserID is the header containing the user ID.
	// Defaults to "X-User-ID".
	HeaderUserID string
	// HeaderUserName defaults to "X-User-Name".
	HeaderUserName string
	// HeaderNickName defaults to "X-Nick-Name".
	HeaderNickName string
	// HeaderTenantID defaults to "X-Tenant-ID".
	HeaderTenantID string
	// HeaderRoles is a comma-separated list. Defaults to "X-User-Roles".
	HeaderRoles string
	// HeaderPermissions is a comma-separated list. Defaults to "X-User-Permissions".
	HeaderPermissions string
	// HeaderToken defaults to "X-Forwarded-Token".
	HeaderToken string
}

// NewHeaderExtractor returns a HeaderExtractor with default header names.
func NewHeaderExtractor() *HeaderExtractor {
	return &HeaderExtractor{
		HeaderUserID:       "X-User-ID",
		HeaderUserName:     "X-User-Name",
		HeaderNickName:     "X-Nick-Name",
		HeaderTenantID:     "X-Tenant-ID",
		HeaderRoles:        "X-User-Roles",
		HeaderPermissions:  "X-User-Permissions",
		HeaderToken:        "X-Forwarded-Token",
	}
}

// Extract implements [AuthExtractor].
func (h *HeaderExtractor) Extract(r *http.Request) (*Identity, error) {
	get := func(name string) string {
		return strings.TrimSpace(r.Header.Get(name))
	}
	id := &Identity{
		UserID:      get(h.HeaderUserID),
		UserName:    get(h.HeaderUserName),
		NickName:    get(h.HeaderNickName),
		TenantID:    get(h.HeaderTenantID),
		Token:       get(h.HeaderToken),
		Source:      "header",
	}
	if roles := get(h.HeaderRoles); roles != "" {
		id.Roles = splitCSV(roles)
	}
	if perms := get(h.HeaderPermissions); perms != "" {
		id.Permissions = splitCSV(perms)
	}
	if !id.IsAuthenticated() {
		return nil, nil
	}
	return id, nil
}

// ──────────────────────────────────────────────
// JWT extractor (adapter over jwtutil.Auth)
// ──────────────────────────────────────────────

// JWTVerifier is the minimal subset of jwtutil.Auth needed by
// [JWTExtractor]. Defining it here avoids a hard dependency on
// jwtutil, keeping authcontext usable standalone.
type JWTVerifier interface {
	// Verify parses and validates a token string, returning the
	// claims or an error.
	Verify(token string) (*JWTClaims, error)
}

// JWTClaims is the claims shape expected by [JWTExtractor].
type JWTClaims struct {
	Subject   string         // sub
	Issuer    string         // iss
	Audience  []string       // aud
	ExpiresAt int64          // exp (unix)
	Extra     map[string]any // custom claims
}

// JWTExtractor extracts identity from a Bearer JWT token in the
// Authorization header.
type JWTExtractor struct {
	verifier JWTVerifier
	// ClaimsUserID is the extra-claims key for the user ID.
	// Defaults to "user_id".
	ClaimsUserID string
	// ClaimsUserName defaults to "user_name".
	ClaimsUserName string
	// ClaimsNickName defaults to "nick_name".
	ClaimsNickName string
	// ClaimsTenantID defaults to "tenant_id".
	ClaimsTenantID string
	// ClaimsRoles defaults to "roles" (expects []any or []string).
	ClaimsRoles string
	// ClaimsPermissions defaults to "permissions".
	ClaimsPermissions string
}

// NewJWTExtractor creates a JWT-based extractor. The verifier must
// implement [JWTVerifier] (jwtutil.Auth already satisfies this via
// an adapter, or you can wrap it).
func NewJWTExtractor(verifier JWTVerifier) *JWTExtractor {
	return &JWTExtractor{
		verifier:          verifier,
		ClaimsUserID:      "user_id",
		ClaimsUserName:    "user_name",
		ClaimsNickName:    "nick_name",
		ClaimsTenantID:    "tenant_id",
		ClaimsRoles:       "roles",
		ClaimsPermissions: "permissions",
	}
}

// Extract implements [AuthExtractor].
func (j *JWTExtractor) Extract(r *http.Request) (*Identity, error) {
	token := BearerFromHeader(r)
	if token == "" {
		return nil, nil
	}
	claims, err := j.verifier.Verify(token)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalidToken, err)
	}
	id := &Identity{
		UserID:   stringFromExtra(claims.Extra, j.ClaimsUserID, claims.Subject),
		UserName: stringFromExtra(claims.Extra, j.ClaimsUserName, ""),
		NickName: stringFromExtra(claims.Extra, j.ClaimsNickName, ""),
		TenantID: stringFromExtra(claims.Extra, j.ClaimsTenantID, ""),
		Roles:    stringSliceFromExtra(claims.Extra, j.ClaimsRoles),
		Permissions: stringSliceFromExtra(claims.Extra, j.ClaimsPermissions),
		Token:    token,
		Source:   "jwt",
	}
	if !id.IsAuthenticated() {
		return nil, nil
	}
	return id, nil
}

// BearerFromHeader extracts a bearer token from the Authorization
// header ("Bearer <token>"). Returns "" if absent or malformed.
func BearerFromHeader(r *http.Request) string {
	auth := r.Header.Get("Authorization")
	if auth == "" {
		return ""
	}
	const prefix = "Bearer "
	if len(auth) < len(prefix) || !strings.EqualFold(auth[:len(prefix)], prefix) {
		return ""
	}
	return strings.TrimSpace(auth[len(prefix):])
}

// ──────────────────────────────────────────────
// Propagation (outbound)
// ──────────────────────────────────────────────

// PropagationHeaders defines the header names used when forwarding an
// identity to a downstream service. These match the defaults in
// [HeaderExtractor], so a downstream service using HeaderExtractor
// will reconstitute the same identity.
type PropagationHeaders struct {
	UserID       string
	UserName     string
	NickName     string
	TenantID     string
	Roles        string
	Permissions  string
	Token        string
}

// DefaultPropagationHeaders returns the standard header names matching
// [HeaderExtractor] defaults.
func DefaultPropagationHeaders() PropagationHeaders {
	return PropagationHeaders{
		UserID:      "X-User-ID",
		UserName:    "X-User-Name",
		NickName:    "X-Nick-Name",
		TenantID:    "X-Tenant-ID",
		Roles:       "X-User-Roles",
		Permissions: "X-User-Permissions",
		Token:       "X-Forwarded-Token",
	}
}

// PropagatingTransport is an [http.RoundTripper] that injects identity
// headers from the request's context into outbound requests.
//
// If the context has no identity, the request passes through unchanged.
// If the underlying transport is nil, [http.DefaultTransport] is used.
type PropagatingTransport struct {
	base    http.RoundTripper
	headers PropagationHeaders
}

// NewPropagatingTransport wraps base (or [http.DefaultTransport] if nil)
// with identity-header propagation using the default header names.
func NewPropagatingTransport(base http.RoundTripper) *PropagatingTransport {
	return &PropagatingTransport{
		base:    base,
		headers: DefaultPropagationHeaders(),
	}
}

// NewPropagatingTransportWithHeaders is like NewPropagatingTransport
// but allows custom header names.
func NewPropagatingTransportWithHeaders(base http.RoundTripper, h PropagationHeaders) *PropagatingTransport {
	return &PropagatingTransport{base: base, headers: h}
}

// RoundTrip implements [http.RoundTripper].
func (t *PropagatingTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	id := FromContext(req.Context())
	if id != nil {
		// Clone the request to avoid mutating the caller's headers.
		req = req.Clone(req.Context())
		setHeaderIfNotEmpty(req, t.headers.UserID, id.UserID)
		setHeaderIfNotEmpty(req, t.headers.UserName, id.UserName)
		setHeaderIfNotEmpty(req, t.headers.NickName, id.NickName)
		setHeaderIfNotEmpty(req, t.headers.TenantID, id.TenantID)
		if len(id.Roles) > 0 {
			setHeaderIfNotEmpty(req, t.headers.Roles, strings.Join(id.Roles, ","))
		}
		if len(id.Permissions) > 0 {
			setHeaderIfNotEmpty(req, t.headers.Permissions, strings.Join(id.Permissions, ","))
		}
		setHeaderIfNotEmpty(req, t.headers.Token, id.Token)
	}
	base := t.base
	if base == nil {
		base = http.DefaultTransport
	}
	return base.RoundTrip(req)
}

// InjectHeaders writes identity headers onto an existing request. This
// is useful when you build the request manually and don't want to use
// a custom transport.
func InjectHeaders(req *http.Request, id *Identity, h PropagationHeaders) {
	if id == nil || req == nil {
		return
	}
	setHeaderIfNotEmpty(req, h.UserID, id.UserID)
	setHeaderIfNotEmpty(req, h.UserName, id.UserName)
	setHeaderIfNotEmpty(req, h.NickName, id.NickName)
	setHeaderIfNotEmpty(req, h.TenantID, id.TenantID)
	if len(id.Roles) > 0 {
		setHeaderIfNotEmpty(req, h.Roles, strings.Join(id.Roles, ","))
	}
	if len(id.Permissions) > 0 {
		setHeaderIfNotEmpty(req, h.Permissions, strings.Join(id.Permissions, ","))
	}
	setHeaderIfNotEmpty(req, h.Token, id.Token)
}

// ──────────────────────────────────────────────
// Serialization (for caching / Redis storage)
// ──────────────────────────────────────────────

// MarshalIdentity serializes id to JSON bytes.
func MarshalIdentity(id *Identity) ([]byte, error) {
	return json.Marshal(id)
}

// UnmarshalIdentity deserializes id from JSON bytes.
func UnmarshalIdentity(data []byte) (*Identity, error) {
	var id Identity
	if err := json.Unmarshal(data, &id); err != nil {
		return nil, err
	}
	return &id, nil
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

func splitCSV(s string) []string {
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

func setHeaderIfNotEmpty(req *http.Request, key, value string) {
	if value != "" {
		req.Header.Set(key, value)
	}
}

func stringFromExtra(extra map[string]any, key, fallback string) string {
	if v, ok := extra[key]; ok {
		switch s := v.(type) {
		case string:
			if s != "" {
				return s
			}
		case fmt.Stringer:
			return s.String()
		}
	}
	return fallback
}

func stringSliceFromExtra(extra map[string]any, key string) []string {
	v, ok := extra[key]
	if !ok {
		return nil
	}
	switch s := v.(type) {
	case []string:
		return s
	case []any:
		out := make([]string, 0, len(s))
		for _, item := range s {
			if str, ok := item.(string); ok {
				out = append(out, str)
			}
		}
		return out
	}
	return nil
}
