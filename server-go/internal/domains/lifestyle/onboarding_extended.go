// Copyright (c) 2026 heathcetide. All rights reserved.

package lifestyle

import (
	"encoding/json"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/heathcetide/DietDigiDose/internal/expressauth"
)

func (h *Handlers) PatchOnboarding(c *gin.Context) {
	h.SaveOnboarding(c)
}

func (h *Handlers) OnboardingSaveFailed(c *gin.Context) {
	EnsureSchema(h.DB)
	userID, _ := expressauth.UserID(c)
	var body map[string]any
	_ = c.ShouldBindJSON(&body)
	if body == nil {
		body = map[string]any{}
	}
	raw, _ := json.Marshal(body)
	_, _ = h.DB.Exec(`CREATE TABLE IF NOT EXISTS onboarding_save_failures (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id INTEGER NOT NULL,
		payload_json TEXT,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	)`)
	_, _ = h.DB.Exec(`INSERT INTO onboarding_save_failures (user_id, payload_json) VALUES (?, ?)`, userID, string(raw))
	c.JSON(http.StatusOK, gin.H{"ok": true, "recorded": true})
}
