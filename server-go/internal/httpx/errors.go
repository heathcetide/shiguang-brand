// Copyright (c) 2026 heathcetide. All rights reserved.

package httpx

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// ErrorBody matches Express sendError JSON shape.
type ErrorBody struct {
	Message   string `json:"message"`
	Code      string `json:"code,omitempty"`
	Details   any    `json:"details,omitempty"`
	RequestID string `json:"requestId,omitempty"`
}

// SendError writes an Express-compatible error response.
func SendError(c *gin.Context, status int, message, code string, details ...any) {
	body := ErrorBody{Message: message, Code: code}
	if len(details) > 0 {
		body.Details = details[0]
	}
	if rid := c.GetString("request_id"); rid != "" {
		body.RequestID = rid
	} else if rid := c.GetHeader("X-Request-Id"); rid != "" {
		body.RequestID = rid
	}
	c.AbortWithStatusJSON(status, body)
}

// AbortAuth is a shorthand for 401 AUTH_REQUIRED.
func AbortAuth(c *gin.Context) {
	SendError(c, http.StatusUnauthorized, "未登录，请先登录", "AUTH_REQUIRED")
}
