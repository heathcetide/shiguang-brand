// Copyright (c) 2026 LingByte
// SPDX-License-Identifier: MIT

package middleware

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

const (
	HeaderAPIVersion = "X-API-Version"
	APIVersionV1     = "v1"
)

// APIVersionMiddleware accepts X-API-Version (default v1), echoes it on the
// response, and returns 400 for unsupported versions (only v1 today).
func APIVersionMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		raw := strings.TrimSpace(c.GetHeader(HeaderAPIVersion))
		if raw == "" {
			raw = APIVersionV1
		}
		// Normalize: "1" / "V1" → "v1"
		v := strings.ToLower(raw)
		if !strings.HasPrefix(v, "v") {
			v = "v" + v
		}
		if v != APIVersionV1 {
			c.Header(HeaderAPIVersion, APIVersionV1)
			c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{
				"code": http.StatusBadRequest,
				"msg":  "unsupported X-API-Version; only v1 is supported",
				"data": gin.H{"supported": []string{APIVersionV1}, "requested": raw},
			})
			return
		}
		c.Header(HeaderAPIVersion, APIVersionV1)
		c.Set("api_version", APIVersionV1)
		c.Next()
	}
}

// DeprecationHeaders sets RFC 8594-style Deprecation / Sunset response headers
// on marked routes. sunset is an HTTP-date or opaque token (e.g. "2027-01-01").
func DeprecationHeaders(sunset string) gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("Deprecation", "true")
		if s := strings.TrimSpace(sunset); s != "" {
			c.Header("Sunset", s)
		}
		c.Next()
	}
}
