// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package gin provides a Gin middleware that integrates with the
// parent rbac package for HTTP request authorization.
//
// # Quick start
//
//	mgr, _ := rbac.NewMemory()
//	mgr.AddPolicy("admin", "/api/users", "GET")
//
//	r := gin.New()
//	r.Use(rbacgin.Middleware(mgr, rbacgin.WithSubjectFromContext("userRole")))
package gin

import (
	"net/http"

	"github.com/heathcetide/DietDigiDose/pkg/common/rbac"
	"github.com/gin-gonic/gin"
)

// ──────────────────────────────────────────────
// Config
// ──────────────────────────────────────────────

// Config holds the middleware configuration.
type Config struct {
	// SubjectKey is the Gin context key from which the subject (role/user ID)
	// is extracted. The context value must be a string.
	// Default: "rbac.subject"
	SubjectKey string

	// PathPrefix is stripped from the request path before enforcement.
	// Default: ""
	PathPrefix string

	// DenyHandler is called when access is denied. If nil, a default
	// 403 JSON response is sent.
	DenyHandler func(c *gin.Context, sub, obj, act string)
}

// Option configures the middleware.
type Option func(*Config)

// WithSubjectKey sets the Gin context key for the subject.
func WithSubjectKey(key string) Option {
	return func(c *Config) { c.SubjectKey = key }
}

// WithPathPrefix sets the path prefix to strip.
func WithPathPrefix(prefix string) Option {
	return func(c *Config) { c.PathPrefix = prefix }
}

// WithDenyHandler sets a custom deny handler.
func WithDenyHandler(f func(c *gin.Context, sub, obj, act string)) Option {
	return func(c *Config) { c.DenyHandler = f }
}

// ──────────────────────────────────────────────
// ginCheckContext
// ──────────────────────────────────────────────

type ginCheckContext struct {
	c    *gin.Context
	cfg  *Config
	sub  string
	obj  string
	act  string
}

func (g *ginCheckContext) Subject() string { return g.sub }
func (g *ginCheckContext) Object() string  { return g.obj }
func (g *ginCheckContext) Action() string  { return g.act }

// ──────────────────────────────────────────────
// Middleware
// ──────────────────────────────────────────────

// Middleware returns a Gin middleware that enforces RBAC policies.
// The subject is extracted from the Gin context using the configured
// SubjectKey (default "rbac.subject"). The object is the request path
// (with PathPrefix stripped), and the action is the HTTP method.
func Middleware(mgr *rbac.Manager, opts ...Option) gin.HandlerFunc {
	cfg := &Config{
		SubjectKey: "rbac.subject",
	}
	for _, opt := range opts {
		if opt != nil {
			opt(cfg)
		}
	}

	checker := rbac.NewChecker(mgr,
		rbac.WithSubjectFunc(func(ctx rbac.CheckContext) string {
			if g, ok := ctx.(*ginCheckContext); ok {
				return g.sub
			}
			return ctx.Subject()
		}),
		rbac.WithObjectFunc(func(ctx rbac.CheckContext) string {
			if g, ok := ctx.(*ginCheckContext); ok {
				return g.obj
			}
			return ctx.Object()
		}),
		rbac.WithActionFunc(func(ctx rbac.CheckContext) string {
			if g, ok := ctx.(*ginCheckContext); ok {
				return g.act
			}
			return ctx.Action()
		}),
	)

	return func(c *gin.Context) {
		sub, _ := c.Get(cfg.SubjectKey)
		subject, _ := sub.(string)

		obj := rbac.NormalizePath(c.Request.URL.Path, cfg.PathPrefix)
		act := c.Request.Method

		gctx := &ginCheckContext{c: c, cfg: cfg, sub: subject, obj: obj, act: act}

		ok, err := checker.Check(gctx)
		if err != nil || !ok {
			if cfg.DenyHandler != nil {
				cfg.DenyHandler(c, subject, obj, act)
			} else {
				c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
					"code":    403,
					"message": "permission denied",
					"subject": subject,
					"object":  obj,
					"action":  act,
				})
			}
			return
		}
		c.Next()
	}
}

// SetSubject sets the subject in the Gin context for downstream
// RBAC middleware. Call this from your authentication middleware.
func SetSubject(c *gin.Context, subject string) {
	c.Set("rbac.subject", subject)
}
