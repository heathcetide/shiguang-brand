// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package gin provides Gin middleware that extracts the identity from
// each request and stores it in the request context.
//
// Usage:
//
//	import (
//	    "github.com/gin-gonic/gin"
//	    authctxgin "github.com/LingByte/ling-base/common/authcontext/gin"
//	    "github.com/heathcetide/DietDigiDose/pkg/common/authcontext"
//	)
//
//	r := gin.New()
//	r.Use(authctxgin.Middleware(extractor))
//
//	r.GET("/me", func(c *gin.Context) {
//	    id := authcontext.FromContext(c.Request.Context())
//	    c.JSON(200, gin.H{"user": id.UserID})
//	})
package gin

import (
	"net/http"

	"github.com/heathcetide/DietDigiDose/pkg/common/authcontext"
	"github.com/gin-gonic/gin"
)

// Middleware returns a Gin middleware that runs the [AuthExtractor] on
// each request and stores the resulting [Identity] in the request
// context.
//
// If the extractor returns a non-nil identity, it is stored and the
// chain continues. If it returns a nil identity (no credentials
// present), the chain continues with no identity — handlers that need
// authentication should check [authcontext.FromContext] and reject
// accordingly.
//
// If the extractor returns an error (e.g. invalid token), the
// middleware responds with 401 Unauthorized unless onExtractError is
// set, in which case it is called instead.
func Middleware(extractor authcontext.AuthExtractor, opts ...Option) gin.HandlerFunc {
	o := applyOptions(opts...)
	return func(c *gin.Context) {
		id, err := extractor.Extract(c.Request)
		if err != nil {
			if o.onExtractError != nil {
				o.onExtractError(c, err)
			} else {
				c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
					"error": "unauthorized",
				})
			}
			return
		}
		if id != nil {
			c.Request = c.Request.WithContext(
				authcontext.WithIdentity(c.Request.Context(), id),
			)
		}
		c.Next()
	}
}

// RequireAuth is a Gin middleware that rejects requests without an
// authenticated identity. It should be used after [Middleware].
//
//	r.Use(authctxgin.Middleware(extractor))
//	r.GET("/profile", authctxgin.RequireAuth(), handler)
func RequireAuth() gin.HandlerFunc {
	return func(c *gin.Context) {
		id := authcontext.FromContext(c.Request.Context())
		if id == nil || !id.IsAuthenticated() {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error": "authentication required",
			})
			return
		}
		c.Next()
	}
}

// RequireRole returns a Gin middleware that rejects requests where the
// identity does not have the given role. Must be used after
// [Middleware].
func RequireRole(role string) gin.HandlerFunc {
	return func(c *gin.Context) {
		id := authcontext.FromContext(c.Request.Context())
		if id == nil || !id.IsAuthenticated() {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error": "authentication required",
			})
			return
		}
		if !id.HasRole(role) {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
				"error":  "insufficient role",
				"required": role,
			})
			return
		}
		c.Next()
	}
}

// RequirePermission returns a Gin middleware that rejects requests
// where the identity does not have the given permission. Supports
// wildcard matching (e.g. "user:*" matches "user:read").
func RequirePermission(perm string) gin.HandlerFunc {
	return func(c *gin.Context) {
		id := authcontext.FromContext(c.Request.Context())
		if id == nil || !id.IsAuthenticated() {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error": "authentication required",
			})
			return
		}
		if !id.HasPermission(perm) {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
				"error":    "insufficient permission",
				"required": perm,
			})
			return
		}
		c.Next()
	}
}
