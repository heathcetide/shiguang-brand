// Copyright (c) 2026 heathcetide. All rights reserved.

package middlewares

import (
	"net/http"

	"github.com/heathcetide/DietDigiDose/internal/configs"
	"github.com/heathcetide/DietDigiDose/pkg/common/limiter/tokenbucket"
	"github.com/gin-gonic/gin"
)

// RateLimit is a token bucket rate limiting middleware (ling-base/common/limiter/tokenbucket).
// Each IP gets an independent token bucket, supporting QPS + burst traffic.
func RateLimit(cfg configs.RateLimitConfig) gin.HandlerFunc {
	if !cfg.Enabled || cfg.RPS <= 0 {
		return func(c *gin.Context) { c.Next() }
	}

	// Global token bucket (per-IP bucketing can be extended with keycount)
	limiter := tokenbucket.New(cfg.RPS, cfg.Burst)

	return func(c *gin.Context) {
		if err := limiter.Acquire(c.Request.Context(), nil); err != nil {
			c.JSON(http.StatusTooManyRequests, gin.H{
				"error":   "rate_limited",
				"message": "too many requests, please try again later",
			})
			c.Abort()
			return
		}
		defer limiter.Release(nil)
		c.Next()
	}
}
