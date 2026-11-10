// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package middleware

import (
	"net/http"
	"path"
	"strings"
	"sync"

	"github.com/gin-gonic/gin"
)

// ──────────────────────────────────────────────
// URLBlacklist
// ──────────────────────────────────────────────

// URLBlacklist is a configurable URL blacklist matcher for Gin
// middleware. It supports exact path matching, wildcard patterns
// (e.g. "/admin/*"), and path-prefix matching. Patterns are matched
// against the cleaned request path (with trailing slashes removed and
// "." / ".." resolved).
//
// # Quick start
//
//	bl := NewURLBlacklist()
//	bl.Add("/admin/secret")
//	bl.Add("/internal/*")
//	r := gin.New()
//	r.Use(URLBlacklistMiddleware(bl))
//
// # Pattern syntax
//
//   - Exact: "/admin/login" matches only that path.
//   - Wildcard: "/api/*" matches "/api/anything", "/api/a/b", etc.
//     The wildcard matches one or more path segments.
//   - Prefix: "/private" matches "/private", "/private/x", "/private/a/b".
//     Add a trailing "/" to require at least one extra segment:
//     "/private/" matches "/private/x" but not "/private" itself.
type URLBlacklist struct {
	mu       sync.RWMutex
	exact    map[string]struct{}
	wildcard []string // patterns ending with "/*"
	prefix   []string // patterns ending with "/" (prefix match, excluding bare prefix)
}

// NewURLBlacklist creates an empty blacklist.
func NewURLBlacklist() *URLBlacklist {
	return &URLBlacklist{
		exact: make(map[string]struct{}),
	}
}

// Add registers a pattern. Patterns ending with "/*" are treated as
// wildcards; patterns ending with "/" (but not "/*") are treated as
// prefixes (matching that string plus anything after); all others are
// exact matches.
//
// Note: cleanPath strips trailing slashes, so a pattern like "/private/"
// is preserved as a prefix pattern before cleaning is applied to the
// base path.
func (b *URLBlacklist) Add(pattern string) {
	if pattern == "" {
		return
	}
	// Detect pattern type before cleaning (which strips trailing /).
	isWildcard := strings.HasSuffix(pattern, "/*")
	isPrefix := !isWildcard && strings.HasSuffix(pattern, "/") && pattern != "/"
	pattern = cleanPath(pattern)
	if pattern == "" {
		return
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	if isWildcard {
		b.wildcard = append(b.wildcard, pattern)
	} else if isPrefix {
		// Re-add trailing slash that cleanPath stripped, to mark this
		// as a prefix pattern.
		b.prefix = append(b.prefix, pattern+"/")
	} else {
		b.exact[pattern] = struct{}{}
	}
}

// AddAll registers multiple patterns.
func (b *URLBlacklist) AddAll(patterns ...string) {
	for _, p := range patterns {
		b.Add(p)
	}
}

// Remove unregisters a pattern.
func (b *URLBlacklist) Remove(pattern string) {
	if pattern == "" {
		return
	}
	isWildcard := strings.HasSuffix(pattern, "/*")
	isPrefix := !isWildcard && strings.HasSuffix(pattern, "/") && pattern != "/"
	pattern = cleanPath(pattern)
	b.mu.Lock()
	defer b.mu.Unlock()
	if isWildcard {
		b.wildcard = removeStr(b.wildcard, pattern)
	} else if isPrefix {
		b.prefix = removeStr(b.prefix, pattern+"/")
	} else {
		delete(b.exact, pattern)
	}
}

// IsBlocked reports whether the given path matches any blacklist pattern.
func (b *URLBlacklist) IsBlocked(urlPath string) bool {
	urlPath = cleanPath(urlPath)
	if urlPath == "" {
		return false
	}
	b.mu.RLock()
	defer b.mu.RUnlock()

	// Exact match.
	if _, ok := b.exact[urlPath]; ok {
		return true
	}

	// Wildcard: "/api/*" matches "/api/anything".
	for _, w := range b.wildcard {
		base := strings.TrimSuffix(w, "/*")
		if base == "" {
			continue
		}
		if urlPath == base || strings.HasPrefix(urlPath, base+"/") {
			return true
		}
	}

	// Prefix: "/private/" matches "/private/x" but not "/private".
	for _, p := range b.prefix {
		if strings.HasPrefix(urlPath, p) {
			return true
		}
	}

	return false
}

// Count returns the total number of registered patterns.
func (b *URLBlacklist) Count() int {
	b.mu.RLock()
	defer b.mu.RUnlock()
	return len(b.exact) + len(b.wildcard) + len(b.prefix)
}

// ──────────────────────────────────────────────
// Gin middleware
// ──────────────────────────────────────────────

// URLBlacklistMiddleware returns a Gin middleware that blocks requests
// matching any pattern in the blacklist. Blocked requests receive a 403
// Forbidden response with a JSON body {"error": "url blocked"}.
//
// The blacklist is checked at request time, so patterns added after
// the middleware is registered take effect immediately.
func URLBlacklistMiddleware(bl *URLBlacklist) gin.HandlerFunc {
	return func(c *gin.Context) {
		if bl != nil && bl.IsBlocked(c.Request.URL.Path) {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
				"error": "url blocked",
			})
			return
		}
		c.Next()
	}
}

// URLBlacklistMiddlewareWithHandler is like [URLBlacklistMiddleware]
// but allows a custom handler for blocked requests (e.g. for logging
// or custom error formats).
func URLBlacklistMiddlewareWithHandler(bl *URLBlacklist, handler gin.HandlerFunc) gin.HandlerFunc {
	return func(c *gin.Context) {
		if bl != nil && bl.IsBlocked(c.Request.URL.Path) {
			handler(c)
			c.Abort()
			return
		}
		c.Next()
	}
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

// cleanPath normalizes a URL path: resolves "." and "..", removes
// trailing slashes (except for root), and ensures a leading "/".
func cleanPath(p string) string {
	if p == "" {
		return ""
	}
	p = path.Clean(p)
	if !strings.HasPrefix(p, "/") {
		p = "/" + p
	}
	return p
}

func removeStr(slice []string, s string) []string {
	for i, v := range slice {
		if v == s {
			return append(slice[:i], slice[i+1:]...)
		}
	}
	return slice
}
