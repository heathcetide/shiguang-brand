// Copyright (c) 2026 LingByte
// SPDX-License-Identifier: MIT

package middleware

import (
	"net/http"

	"github.com/heathcetide/DietDigiDose/pkg/common/logger"
	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
)

// PanicRecovery logs panics and returns 500.
func PanicRecovery() gin.HandlerFunc {
	return gin.CustomRecovery(func(c *gin.Context, recovered any) {
		logger.Error("panic recovered",
			zap.Any("panic", recovered),
			zap.String("path", c.Request.URL.Path),
			zap.String("method", c.Request.Method),
		)
		c.AbortWithStatus(http.StatusInternalServerError)
	})
}
