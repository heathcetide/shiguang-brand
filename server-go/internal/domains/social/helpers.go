// Copyright (c) 2026 heathcetide. All rights reserved.

package social

import (
	"crypto/rand"
	"encoding/hex"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/heathcetide/DietDigiDose/internal/expressauth"
	"github.com/heathcetide/DietDigiDose/internal/httpx"
)

func newInviteCode() string {
	b := make([]byte, 4)
	_, _ = rand.Read(b)
	return strings.ToUpper(hex.EncodeToString(b))
}

func newUUID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return hex.EncodeToString(b[0:4]) + "-" + hex.EncodeToString(b[4:6]) + "-" +
		hex.EncodeToString(b[6:8]) + "-" + hex.EncodeToString(b[8:10]) + "-" + hex.EncodeToString(b[10:])
}

func nowRFC3339() string {
	return time.Now().UTC().Format(time.RFC3339Nano)
}

func todayDateKey() string {
	loc, _ := time.LoadLocation("Asia/Shanghai")
	return time.Now().In(loc).Format("2006-01-02")
}

func (h *Handlers) requireAdmin() gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, ok := expressauth.UserID(c)
		if !ok {
			httpx.AbortAuth(c)
			return
		}
		var role string
		if err := h.DB.QueryRow(`SELECT COALESCE(role,'user') FROM users WHERE id=?`, userID).Scan(&role); err != nil || role != "admin" {
			httpx.SendError(c, http.StatusForbidden, "需要管理员权限", "ADMIN_REQUIRED")
			c.Abort()
			return
		}
		c.Next()
	}
}

func parseHouseholdID(c *gin.Context) (int, bool) {
	id, err := strconv.Atoi(c.Param("id"))
	return id, err == nil && id > 0
}

func bindJSONMap(c *gin.Context) (map[string]any, bool) {
	var body map[string]any
	if err := c.ShouldBindJSON(&body); err != nil {
		httpx.SendError(c, http.StatusBadRequest, "请求参数无效", "INVALID_BODY")
		return nil, false
	}
	return body, true
}

func strField(body map[string]any, keys ...string) string {
	for _, k := range keys {
		if v, ok := body[k]; ok && v != nil {
			return strings.TrimSpace(anyString(v))
		}
	}
	return ""
}

func anyString(v any) string {
	switch t := v.(type) {
	case string:
		return t
	case float64:
		return strconv.FormatInt(int64(t), 10)
	default:
		return ""
	}
}

func numField(body map[string]any, keys ...string) (int, bool) {
	for _, k := range keys {
		v, ok := body[k]
		if !ok || v == nil {
			continue
		}
		switch t := v.(type) {
		case float64:
			return int(t), true
		case string:
			n, err := strconv.Atoi(t)
			if err == nil {
				return n, true
			}
		}
	}
	return 0, false
}
