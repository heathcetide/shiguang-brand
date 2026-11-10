// Copyright (c) 2026 heathcetide. All rights reserved.

package ops

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"os"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/heathcetide/DietDigiDose/internal/expressauth"
	"github.com/heathcetide/DietDigiDose/internal/httpx"
)

// Handlers covers public app-updates checks (non-admin).
type Handlers struct {
	DB   *sql.DB
	Auth *expressauth.Auth
}

func (h *Handlers) RegisterOn(engine *gin.Engine) {
	engine.GET("/api/v1/app-updates", h.AppUpdates)
}

func (h *Handlers) AppUpdates(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	manifestPath := strings.TrimSpace(os.Getenv("APP_UPDATE_MANIFEST_PATH"))
	if manifestPath == "" {
		httpx.SendError(c, http.StatusServiceUnavailable, "暂时无法检查更新，请稍后重试", "APP_UPDATES_UNAVAILABLE")
		return
	}
	raw, err := os.ReadFile(manifestPath)
	if err != nil || len(raw) == 0 {
		httpx.SendError(c, http.StatusServiceUnavailable, "暂时无法检查更新，请稍后重试", "APP_UPDATES_UNAVAILABLE")
		return
	}
	var manifest struct {
		Releases []map[string]any `json:"releases"`
	}
	if err := json.Unmarshal(raw, &manifest); err != nil {
		httpx.SendError(c, http.StatusServiceUnavailable, "暂时无法检查更新，请稍后重试", "APP_UPDATES_UNAVAILABLE")
		return
	}
	applicationID := c.Query("applicationId")
	channel := c.Query("channel")
	buildNumber, _ := strconv.Atoi(c.Query("buildNumber"))
	var update any
	for _, release := range manifest.Releases {
		if asString(release["applicationId"]) == applicationID && asString(release["channel"]) == channel {
			bn := int(asFloat(release["buildNumber"]))
			if bn > buildNumber {
				update = release
				break
			}
		}
	}
	c.JSON(http.StatusOK, gin.H{"update": update})
}

func asString(v any) string {
	s, _ := v.(string)
	return s
}

func asFloat(v any) float64 {
	switch t := v.(type) {
	case float64:
		return t
	case int:
		return float64(t)
	default:
		return 0
	}
}
