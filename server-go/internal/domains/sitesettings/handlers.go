// Copyright (c) 2026 heathcetide. All rights reserved.

package sitesettings

import (
	"github.com/heathcetide/DietDigiDose/internal/dbx"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/heathcetide/DietDigiDose/internal/httpx"
)

type Handlers struct {
	DB *dbx.DB
}

func (h *Handlers) RegisterOn(engine *gin.Engine) {
	engine.GET("/api/v1/site-settings", h.Get)
}

func (h *Handlers) Get(c *gin.Context) {
	settings := map[string]string{}
	rows, err := h.DB.Query(`SELECT key, value FROM system_settings WHERE key IN (?, ?, ?)`,
		"SITE_FILING_ENABLED", "SITE_FILING_TEXT", "SITE_FILING_URL")
	if err != nil {
		// Table may not exist yet — return empty filing.
		c.JSON(http.StatusOK, gin.H{"filing": gin.H{"enabled": false, "text": "", "url": ""}})
		return
	}
	defer rows.Close()
	for rows.Next() {
		var key, value string
		if err := rows.Scan(&key, &value); err != nil {
			httpx.SendError(c, http.StatusInternalServerError, "读取站点设置失败", "SITE_SETTINGS_FAILED")
			return
		}
		settings[key] = value
	}
	text := settings["SITE_FILING_TEXT"]
	c.JSON(http.StatusOK, gin.H{
		"filing": gin.H{
			"enabled": settings["SITE_FILING_ENABLED"] == "true" && len(text) > 0,
			"text":    text,
			"url":     settings["SITE_FILING_URL"],
		},
	})
}
