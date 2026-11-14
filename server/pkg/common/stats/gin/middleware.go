// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package gin provides a Gin middleware for automatic website metrics
// collection (PV, UV, IP, response time, status code, error rate).
//
// The middleware normalizes dynamic route paths to prevent key explosion:
//
//	GET /users/123   → /users/:id
//	GET /posts/456   → /posts/:id
//	GET /api/v1/items/789 → /api/v1/items/:id
//
// This ensures that each unique route pattern generates only one set of
// stats keys, regardless of how many different IDs are accessed.
//
// # Usage
//
//	c := memory.New(
//	    memory.WithReservoirTimer(4096),
//	    memory.WithBloomSet(1000000, 0.001),
//	    memory.WithTTL(memory.TTLConfig{
//	        RetentionDays: 7,
//	        OnExpire:      sqliteStore.OnExpire,
//	    }),
//	)
//	wm := stats.NewWebsiteMetrics(c)
//
//	r := gin.New()
//	r.Use(ginstats.Middleware(wm, ginstats.Config{
//	    GetUserID: func(c *gin.Context) string {
//	        // Extract user ID from JWT, cookie, header, etc.
//	        return c.GetString("userID")
//	    },
//	}))
package gin

import (
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common/stats"
	"github.com/gin-gonic/gin"
)

// Config configures the stats middleware.
type Config struct {
	// GetUserID extracts the user ID from the request context.
	// If nil, UV is not recorded (only PV and IP).
	// Return empty string to skip UV for this request.
	GetUserID func(c *gin.Context) string

	// SkipPaths are paths to skip (e.g. "/health", "/metrics").
	// Matching is exact prefix match.
	SkipPaths []string

	// SkipIf returns true to skip stats for this request.
	// If nil, all requests are recorded (except SkipPaths).
	SkipIf func(c *gin.Context) bool

	// PathNormalizer customizes path normalization.
	// If nil, the default normalizer is used (converts dynamic segments to :id).
	PathNormalizer func(path string) string
}

// Middleware returns a Gin middleware that records PV, UV, IP, response time,
// and error rate for every request.
//
// Keys generated:
//
//	pv:<date>:<normalized-path>          — Counter
//	pv_total:<date>                      — Counter (all paths combined)
//	uv:<date>                            — HLL (if GetUserID is set)
//	ip:<date>                            — HLL
//	vv:<date>                            — Counter (session/visit)
//	requests:<date>                      — Counter
//	errors:<date>                        — Counter (if status >= 500)
//	response_time:<date>                 — Timer (response latency)
//	bounce:<date>                        — Counter (if single-page visit — tracked via session)
//	session_duration:<date>              — Timer (session duration — if session tracking enabled)
func Middleware(wm *stats.WebsiteMetrics, cfg Config) gin.HandlerFunc {
	normalizer := cfg.PathNormalizer
	if normalizer == nil {
		normalizer = NormalizePath
	}

	skipSet := make(map[string]bool, len(cfg.SkipPaths))
	for _, p := range cfg.SkipPaths {
		skipSet[p] = true
	}

	return func(c *gin.Context) {
		// Check skip conditions.
		path := c.Request.URL.Path
		if skipSet[path] {
			c.Next()
			return
		}
		if cfg.SkipIf != nil && cfg.SkipIf(c) {
			c.Next()
			return
		}

		start := time.Now()
		date := start.Format("2006-01-02")

		// Process request.
		c.Next()

		// Record metrics after request completes.
		elapsed := time.Since(start)
		normalizedPath := normalizer(path)
		status := c.Writer.Status()

		// PV (by path + total)
		wm.RecordPV(date, normalizedPath)
		wm.RecordPVTotal(date)

		// UV (if user ID available)
		if cfg.GetUserID != nil {
			if userID := cfg.GetUserID(c); userID != "" {
				wm.RecordUV(date, userID)
				wm.RecordDAU(date, userID)
				wm.RecordMAU(start.Format("2006-01"), userID)
			}
		}

		// IP
		wm.RecordIP(date, c.ClientIP())

		// VV (visit/session — simplified: one per request)
		wm.RecordVV(date)

		// Request + Error
		wm.RecordRequest(date)
		if status >= 500 {
			wm.RecordError(date)
		}

		// Response time
		wm.RecordResponseTime(date, elapsed.Nanoseconds())
	}
}
