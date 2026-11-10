// Copyright (c) 2026 LingByte
// SPDX-License-Identifier: MIT

package middleware

import (
	"net/http"
	"os"
	"strings"

	"github.com/gin-gonic/gin"
)

const (
	EnvMaintenanceMode    = "MAINTENANCE_MODE"
	EnvMaintenanceMessage = "MAINTENANCE_MESSAGE"
)

// maintenanceAllowedPaths are paths that stay open during maintenance.
// Empty by default; configure via SetMaintenanceAllowedPaths at startup.
var maintenanceAllowedPaths []string

// maintenanceAllowedPrefixes are path prefixes that stay open during maintenance.
// Empty by default; configure via SetMaintenanceAllowedPaths at startup.
var maintenanceAllowedPrefixes []string

// SetMaintenanceAllowedPaths configures which paths/prefixes stay open
// during maintenance mode. Pass nil/empty to clear. Must be called
// before the middleware is first invoked.
func SetMaintenanceAllowedPaths(paths, prefixes []string) {
	maintenanceAllowedPaths = paths
	maintenanceAllowedPrefixes = prefixes
}

// MaintenanceBypassFunc returns true if the request should bypass maintenance.
// Apps can plug in their own admin-token check here; nil means no bypass.
type MaintenanceBypassFunc func(c *gin.Context) bool

// MaintenanceMode returns 503 for non-probe routes when MAINTENANCE_MODE=true.
// bypass (optional) lets specific requests (e.g. platform admins) through.
func MaintenanceMode(bypass MaintenanceBypassFunc) gin.HandlerFunc {
	return func(c *gin.Context) {
		if !maintenanceEnabled() {
			c.Next()
			return
		}
		if maintenancePathAllowed(c.Request.URL.Path) {
			c.Next()
			return
		}
		if bypass != nil && bypass(c) {
			c.Next()
			return
		}
		msg := strings.TrimSpace(os.Getenv(EnvMaintenanceMessage))
		if msg == "" {
			msg = "Service is under maintenance. Please try again later."
		}
		c.AbortWithStatusJSON(http.StatusServiceUnavailable, gin.H{
			"code":    503,
			"msg":     msg,
			"data":    gin.H{"maintenance": true},
			"status":  "maintenance",
			"message": msg,
		})
	}
}

func maintenanceEnabled() bool {
	v := strings.TrimSpace(strings.ToLower(os.Getenv(EnvMaintenanceMode)))
	return v == "1" || v == "true" || v == "yes" || v == "on"
}

func maintenancePathAllowed(path string) bool {
	p := strings.TrimSpace(path)
	for _, allowed := range maintenanceAllowedPaths {
		if p == allowed {
			return true
		}
	}
	for _, prefix := range maintenanceAllowedPrefixes {
		if strings.HasPrefix(p, prefix) {
			return true
		}
	}
	return false
}
