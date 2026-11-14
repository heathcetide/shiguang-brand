// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package gin provides Gin middleware for JWT authentication.
//
// 用法：
//
//	auth, _ := jwtutil.New(jwtutil.Config{Secret: []byte("..."), ...})
//	r := gin.New()
//	r.Use(jwtingin.Middleware(auth, jwtingin.WithPublicPaths("/health", "/api/v1/auth/login")))
//	// 受保护的路由...
//	r.GET("/api/v1/me", jwtingin.RequireRole(auth, "admin"), h.GetMe)
//
// i18n: 默认消息为英文。如需本地化，用 WithErrorHandler 配合 i18n manager：
//
//	r.Use(jwtingin.Middleware(auth,
//	    jwtingin.WithPublicPaths("/health"),
//	    jwtingin.WithErrorHandler(func(c *gin.Context, code int, msg string) {
//	        // 用 i18n key 替换默认消息
//	        respgin.FailI18n(c, jwtingin.ErrKeyFromMsg(msg), nil)
//	    }),
//	))
package gin

import (
	"net/http"
	"strings"

	"github.com/heathcetide/DietDigiDose/pkg/common/jwtutil"
	gin "github.com/gin-gonic/gin"
)

// ContextKey 是 gin.Context 中存储 claims 的 key。
const ContextKeyClaims = "jwt_claims"
const ContextKeyUserID = "user_id"

// i18n message key 常量。可在 WithErrorHandler 中用这些 key
// 配合 i18n.Manager 做本地化。
const (
	MsgKeyMissingToken = "auth.missing_token" // 缺少 Authorization 头
	MsgKeyInvalidToken = "auth.invalid_token" // token 无效或已过期
	MsgKeyUnauthorized = "common.unauthorized" // 未授权（无 claims）
	MsgKeyForbidden    = "common.forbidden"    // 权限不足
)

// 默认英文消息（无 i18n 时使用）。
const (
	defaultMsgMissingToken = "Missing valid Authorization header"
	defaultMsgInvalidToken = "Invalid or expired token"
	defaultMsgUnauthorized = "Unauthorized"
	defaultMsgForbidden    = "Forbidden: insufficient permissions"
)

// Options 配置中间件行为。
type Options struct {
	// PublicPaths 是不需要鉴权的路径前缀列表。
	// 例如: ["/health", "/api/v1/auth/login", "/docs"]
	PublicPaths []string
	// ErrorHandler 自定义鉴权失败时的响应。如果为 nil，使用默认 JSON 响应。
	// message 参数是默认英文消息，可用 ErrKeyFromMsg 转换为 i18n key。
	ErrorHandler func(c *gin.Context, code int, message string)
}

// Option 是配置函数。
type Option func(*Options)

// WithPublicPaths 设置公开路径前缀列表。
func WithPublicPaths(paths ...string) Option {
	return func(o *Options) {
		o.PublicPaths = paths
	}
}

// WithErrorHandler 设置自定义错误处理。
// handler 的 message 参数是默认英文消息，可用 ErrKeyFromMsg 转换为 i18n key。
func WithErrorHandler(h func(c *gin.Context, code int, msg string)) Option {
	return func(o *Options) {
		o.ErrorHandler = h
	}
}

// ErrKeyFromMsg 将默认英文消息转换为 i18n key。
// 在 WithErrorHandler 中使用：
//
//	jwtingin.WithErrorHandler(func(c *gin.Context, code int, msg string) {
//	    key := jwtingin.ErrKeyFromMsg(msg)
//	    // 用 key 做 i18n 翻译
//	})
func ErrKeyFromMsg(msg string) string {
	switch msg {
	case defaultMsgMissingToken:
		return MsgKeyMissingToken
	case defaultMsgInvalidToken:
		return MsgKeyInvalidToken
	case defaultMsgUnauthorized:
		return MsgKeyUnauthorized
	case defaultMsgForbidden:
		return MsgKeyForbidden
	default:
		return msg
	}
}

// Middleware 返回 JWT 鉴权 Gin 中间件。
// 从 Authorization: Bearer <token> 提取 token，验证后将 claims 存入 context。
// publicPaths 中的路径前缀自动跳过鉴权。
func Middleware(auth *jwtutil.Auth, opts ...Option) gin.HandlerFunc {
	o := &Options{}
	for _, opt := range opts {
		opt(o)
	}

	return func(c *gin.Context) {
		// 跳过公开路径
		path := c.Request.URL.Path
		if isPublicPath(path, o.PublicPaths) {
			c.Next()
			return
		}

		// 提取 Bearer token
		authHeader := c.GetHeader("Authorization")
		token, err := jwtutil.ExtractBearer(authHeader)
		if err != nil {
			respondError(c, o, http.StatusUnauthorized, defaultMsgMissingToken)
			return
		}

		// 验证 token
		claims, err := auth.Verify(token)
		if err != nil {
			respondError(c, o, http.StatusUnauthorized, defaultMsgInvalidToken)
			return
		}

		// 存入 context
		c.Set(ContextKeyClaims, claims)
		c.Set(ContextKeyUserID, claims.Subject)
		c.Next()
	}
}

// RequireRole 返回一个要求指定角色的中间件。
// 必须在 Middleware 之后使用。
func RequireRole(auth *jwtutil.Auth, role string) gin.HandlerFunc {
	return func(c *gin.Context) {
		claimsVal, exists := c.Get(ContextKeyClaims)
		if !exists {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized", "message": defaultMsgUnauthorized})
			c.Abort()
			return
		}
		claims, ok := claimsVal.(*jwtutil.Claims)
		if !ok || !claims.HasRole(role) {
			c.JSON(http.StatusForbidden, gin.H{
				"error":   "forbidden",
				"message": defaultMsgForbidden,
			})
			c.Abort()
			return
		}
		c.Next()
	}
}

// RequirePermission 返回一个要求指定权限的中间件。
// 必须在 Middleware 之后使用。
func RequirePermission(auth *jwtutil.Auth, perm string) gin.HandlerFunc {
	return func(c *gin.Context) {
		claimsVal, exists := c.Get(ContextKeyClaims)
		if !exists {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized", "message": defaultMsgUnauthorized})
			c.Abort()
			return
		}
		claims, ok := claimsVal.(*jwtutil.Claims)
		if !ok || !claims.HasPermission(perm) {
			c.JSON(http.StatusForbidden, gin.H{
				"error":   "forbidden",
				"message": defaultMsgForbidden,
			})
			c.Abort()
			return
		}
		c.Next()
	}
}

// ClaimsFromGin 从 gin.Context 中提取 claims。
// 必须在 Middleware 之后调用。
func ClaimsFromGin(c *gin.Context) *jwtutil.Claims {
	v, ok := c.Get(ContextKeyClaims)
	if !ok {
		return nil
	}
	claims, _ := v.(*jwtutil.Claims)
	return claims
}

// UserIDFromGin 从 gin.Context 中提取 user ID。
// 必须在 Middleware 之后调用。
func UserIDFromGin(c *gin.Context) string {
	v, ok := c.Get(ContextKeyUserID)
	if !ok {
		return ""
	}
	s, _ := v.(string)
	return s
}

// isPublicPath 判断路径是否为公开路径。
func isPublicPath(path string, prefixes []string) bool {
	for _, prefix := range prefixes {
		if strings.HasPrefix(path, prefix) {
			return true
		}
	}
	return false
}

// respondError 根据配置发送错误响应。
func respondError(c *gin.Context, o *Options, code int, message string) {
	if o.ErrorHandler != nil {
		o.ErrorHandler(c, code, message)
		return
	}
	c.JSON(code, gin.H{
		"error":   http.StatusText(code),
		"message": message,
	})
	c.Abort()
}
