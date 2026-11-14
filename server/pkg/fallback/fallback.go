// Copyright (c) 2026 heathcetide. All rights reserved.

// Package fallback provides service degradation helper functions.
//
// When the circuit breaker is open (circuitbreaker.ErrCircuitOpen),
// rate limited (limiter.ErrLimited), or a remote call fails,
// use this package to return a fallback response (cached data /
// default value / friendly message) instead of a 5xx error.
//
// Usage:
//
//	// Initialize at startup in main.go
//	pkgfallback.Init(cfg.Fallback)
//
//	// In handler / service
//	val, err := callRemote(ctx)
//	if err != nil {
//	    if pkgfallback.ShouldDegrade(err) {
//	        return pkgfallback.JSON(c, "service_degraded", "service degraded, returning default")
//	    }
//	    return err
//	}
//
//	// Or return cached fallback data
//	cached, _ := pkgcache.Get(ctx, "user:123")
//	return pkgfallback.Data(c, cached)
package fallback

import (
	"errors"
	"net/http"

	"github.com/heathcetide/DietDigiDose/pkg/common/circuitbreaker"
	"github.com/gin-gonic/gin"
)

// Global configuration.
var (
	// Enabled controls whether degradation is active (global switch).
	Enabled bool

	// DefaultMessage is the default fallback message.
	DefaultMessage string

	// DefaultCode is the default fallback HTTP status code.
	DefaultCode int
)

// Init initializes the fallback singleton from configuration.
func Init(enabled bool, defaultMessage string, defaultCode int) {
	Enabled = enabled
	DefaultMessage = defaultMessage
	if DefaultMessage == "" {
		DefaultMessage = "service temporarily unavailable"
	}
	DefaultCode = defaultCode
	if DefaultCode == 0 {
		DefaultCode = http.StatusServiceUnavailable // 503
	}
}

// ShouldDegrade determines whether the error should trigger degradation.
// Matches circuit breaker open, rate limited, and other degradable errors.
func ShouldDegrade(err error) bool {
	if !Enabled || err == nil {
		return false
	}
	if errors.Is(err, circuitbreaker.ErrCircuitOpen) {
		return true
	}
	if errors.Is(err, circuitbreaker.ErrTooManyRequests) {
		return true
	}
	// Extensible: limiter.ErrLimited, timeout, etc.
	return false
}

// JSON returns a fallback JSON response.
// code is a business error code string, message is the human-readable message.
func JSON(c *gin.Context, code, message string) {
	if message == "" {
		message = DefaultMessage
	}
	c.JSON(DefaultCode, gin.H{
		"code":     code,
		"message":  message,
		"fallback": true,
	})
	c.Abort()
}

// Data returns fallback data (e.g. cached content).
// HTTP status is 200 (valid data returned), but fallback=true is flagged.
func Data(c *gin.Context, data interface{}) {
	c.JSON(http.StatusOK, gin.H{
		"code":     0,
		"data":     data,
		"fallback": true,
		"message":  "degraded response (returning cached/default data)",
	})
	c.Abort()
}

// Message returns the default fallback message (uses DefaultMessage and DefaultCode).
func Message(c *gin.Context) {
	JSON(c, "service_degraded", DefaultMessage)
}
