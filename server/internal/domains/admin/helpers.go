// Copyright (c) 2026 heathcetide. All rights reserved.

package admin

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/heathcetide/DietDigiDose/internal/httpx"
)

func nullStr(v sql.NullString) any {
	if !v.Valid {
		return nil
	}
	return v.String
}

func nullFloat(v sql.NullFloat64) any {
	if !v.Valid {
		return nil
	}
	return v.Float64
}

func boolNum(v int) bool {
	return v != 0
}

func (h *Handlers) hasTable(name string) bool { return h.DB.HasTable(name) }

func (h *Handlers) hasColumn(table, column string) bool { return h.DB.HasColumn(table, column) }

func (h *Handlers) upsertSetting(key, value string) {
	_, err := h.DB.Exec(`INSERT INTO system_settings(key, value) VALUES(?, ?)
		ON CONFLICT(key) DO UPDATE SET value=excluded.value`, key, value)
	if err != nil {
		_, _ = h.DB.Exec(`INSERT INTO system_settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, key, value)
	}
}

func (h *Handlers) getSetting(key string) (string, bool) {
	var v string
	err := h.DB.QueryRow(`SELECT value FROM system_settings WHERE key=?`, key).Scan(&v)
	return v, err == nil
}

func (h *Handlers) settingsByPrefix(prefix string) map[string]string {
	rows, err := h.DB.Query(`SELECT key, value FROM system_settings WHERE key LIKE ?`, prefix+"%")
	if err != nil {
		return map[string]string{}
	}
	defer rows.Close()
	out := map[string]string{}
	for rows.Next() {
		var k, v string
		if err := rows.Scan(&k, &v); err == nil {
			out[k] = v
		}
	}
	return out
}

func parseIDParam(c *gin.Context) (int, bool) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		httpx.SendError(c, http.StatusBadRequest, "无效的 ID", "INVALID_ID")
		return 0, false
	}
	return id, true
}

func bindJSON(c *gin.Context, dst any) bool {
	if err := c.ShouldBindJSON(dst); err != nil {
		httpx.SendError(c, http.StatusBadRequest, "请求参数无效", "INVALID_BODY")
		return false
	}
	return true
}

func okJSON(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func emptyJSONArray(c *gin.Context, key string) {
	c.JSON(http.StatusOK, gin.H{key: []any{}})
}

func parseJSONMap(raw string) map[string]any {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return map[string]any{}
	}
	var m map[string]any
	if err := json.Unmarshal([]byte(raw), &m); err != nil {
		return map[string]any{}
	}
	return m
}

// parsePageParams reads page/pageSize query params with safe defaults.
func parsePageParams(c *gin.Context, defaultSize, maxSize int) (page, pageSize, offset int) {
	if defaultSize <= 0 {
		defaultSize = 50
	}
	if maxSize <= 0 {
		maxSize = 200
	}
	page = 1
	pageSize = defaultSize
	if p := strings.TrimSpace(c.Query("page")); p != "" {
		if n, err := strconv.Atoi(p); err == nil && n > 0 {
			page = n
		}
	}
	if ps := strings.TrimSpace(c.Query("pageSize")); ps != "" {
		if n, err := strconv.Atoi(ps); err == nil && n > 0 {
			pageSize = n
		}
	}
	if pageSize > maxSize {
		pageSize = maxSize
	}
	offset = (page - 1) * pageSize
	return page, pageSize, offset
}
