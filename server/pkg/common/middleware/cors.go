// Copyright (c) 2026 LingByte
// SPDX-License-Identifier: MIT

package middleware

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
)

// CORSConfig 配置 CORS 中间件。
type CORSConfig struct {
	// AllowOrigins 允许的来源列表。"*" 表示允许所有。
	AllowOrigins []string
	// AllowMethods 允许的 HTTP 方法。默认 GET/POST/PUT/DELETE/PATCH/OPTIONS/HEAD。
	AllowMethods []string
	// AllowHeaders 允许的请求头。默认 Content-Type/Authorization/X-Reqid。
	AllowHeaders []string
	// ExposeHeaders 暴露给浏览器的响应头。
	ExposeHeaders []string
	// AllowCredentials 是否允许携带凭证（Cookie 等）。
	AllowCredentials bool
	// MaxAge 预检请求缓存时间（秒）。
	MaxAge int
}

// DefaultCORSConfig 返回默认的 CORS 配置（允许所有来源）。
func DefaultCORSConfig() CORSConfig {
	return CORSConfig{
		AllowOrigins: []string{"*"},
		AllowMethods: []string{http.MethodGet, http.MethodPost, http.MethodPut, http.MethodDelete, http.MethodPatch, http.MethodOptions, http.MethodHead},
		AllowHeaders: []string{"Content-Type", "Authorization", "X-Reqid"},
		MaxAge:       86400,
	}
}

// CORS 返回一个 CORS 中间件，使用默认配置（允许所有来源）。
func CORS() gin.HandlerFunc {
	return CORSWithConfig(DefaultCORSConfig())
}

// CORSWithConfig 返回一个自定义配置的 CORS 中间件。
func CORSWithConfig(cfg CORSConfig) gin.HandlerFunc {
	allowMethods := strings.Join(cfg.AllowMethods, ", ")
	allowHeaders := strings.Join(cfg.AllowHeaders, ", ")
	exposeHeaders := strings.Join(cfg.ExposeHeaders, ", ")
	maxAge := cfg.MaxAge
	if maxAge <= 0 {
		maxAge = 86400
	}

	return func(c *gin.Context) {
		origin := c.GetHeader("Origin")
		// 如果没有 Origin 头（非浏览器请求），直接放行
		if origin == "" {
			c.Next()
			return
		}

		// 检查 Origin 是否允许
		allowed := false
		for _, o := range cfg.AllowOrigins {
			if o == "*" || o == origin {
				allowed = true
				break
			}
		}
		if !allowed {
			c.AbortWithStatus(http.StatusForbidden)
			return
		}

		// 如果 AllowOrigins 是 "*"，且不允许凭证，用 *；否则回显 Origin
		if len(cfg.AllowOrigins) == 1 && cfg.AllowOrigins[0] == "*" && !cfg.AllowCredentials {
			c.Header("Access-Control-Allow-Origin", "*")
		} else {
			c.Header("Access-Control-Allow-Origin", origin)
			c.Header("Vary", "Origin")
		}

		if allowMethods != "" {
			c.Header("Access-Control-Allow-Methods", allowMethods)
		}
		if allowHeaders != "" {
			c.Header("Access-Control-Allow-Headers", allowHeaders)
		}
		if exposeHeaders != "" {
			c.Header("Access-Control-Expose-Headers", exposeHeaders)
		}
		if cfg.AllowCredentials {
			c.Header("Access-Control-Allow-Credentials", "true")
		}
		c.Header("Access-Control-Max-Age", strconv.Itoa(maxAge))

		// 预检请求直接返回 204
		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}

		c.Next()
	}
}
