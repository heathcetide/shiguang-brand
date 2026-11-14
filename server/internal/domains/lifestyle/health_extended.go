// Copyright (c) 2026 heathcetide. All rights reserved.

package lifestyle

import (
	"encoding/json"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/heathcetide/DietDigiDose/internal/expressauth"
	"github.com/heathcetide/DietDigiDose/internal/httpx"
)

var measurementKeys = []string{
	"weight", "body_fat", "water_ml", "height_cm", "waist_cm", "hip_cm",
	"resting_heart_rate", "blood_pressure_systolic", "blood_pressure_diastolic",
	"blood_glucose_mmol", "sleep_hours", "steps",
}

func (h *Handlers) CurrentMeasurements(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	out := map[string]any{}
	rows, err := h.DB.Query(`SELECT id, weight, steps, sleep_hours, COALESCE(recorded_date, recorded_at, '') AS recorded_date
		FROM health_logs WHERE user_id=? ORDER BY id DESC LIMIT 60`, userID)
	if err == nil {
		defer rows.Close()
		logs := make([]map[string]any, 0)
		for rows.Next() {
			var id int
			var weight, steps, sleep float64
			var recorded string
			if rows.Scan(&id, &weight, &steps, &sleep, &recorded) == nil {
				logs = append(logs, map[string]any{
					"id": id, "weight": weight, "steps": steps, "sleep_hours": sleep, "recorded_date": recorded,
				})
			}
		}
		for _, key := range measurementKeys {
			for _, row := range logs {
				if v, ok := row[key]; ok && asFloat(v) != 0 {
					out[key] = map[string]any{
						"value": asFloat(v), "recordedDate": asString(row["recorded_date"]), "source": "log",
					}
					break
				}
			}
		}
	}
	var payload string
	if err := h.DB.QueryRow(`SELECT COALESCE(profile_json,'') FROM user_health_profiles WHERE user_id=?`, userID).Scan(&payload); err == nil && payload != "" {
		var profile map[string]any
		if json.Unmarshal([]byte(payload), &profile) == nil {
			for key, legacy := range map[string]string{"weight": "weight", "height_cm": "height"} {
				if out[key] != nil {
					continue
				}
				if v := asFloat(profile[legacy]); v != 0 {
					out[key] = map[string]any{"value": v, "recordedDate": nil, "source": "legacy_profile"}
				}
			}
		}
	}
	c.JSON(200, out)
}

// PatchHealthProfile merges a partial profile update into the stored JSON blob.
// Unlike PUT, section saves must not wipe unrelated fields (allergies, targets, etc.).
func (h *Handlers) PatchHealthProfile(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	var patch map[string]any
	if err := c.ShouldBindJSON(&patch); err != nil {
		httpx.SendError(c, http.StatusBadRequest, "请求参数无效", "INVALID_BODY")
		return
	}
	current := h.loadHealthProfileMap(userID)
	currentVersion := asInt(current["version"])
	expected := asInt(patch["version"])
	if expected > 0 && currentVersion > 0 && expected != currentVersion {
		httpx.SendError(c, http.StatusConflict, "资料已在其他页面更新", "HEALTH_PROFILE_VERSION_CONFLICT", gin.H{
			"currentProfile": normalizeHealthProfile(cloneMap(current), userID),
		})
		return
	}
	nextVersion := currentVersion + 1
	if expected > 0 {
		nextVersion = expected + 1
	}
	if nextVersion < 1 {
		nextVersion = 1
	}
	merged := mergeHealthProfilePatch(current, patch)
	merged = normalizeHealthProfile(merged, userID)
	merged["version"] = nextVersion
	if err := h.saveHealthProfileMap(userID, merged); err != nil {
		httpx.SendError(c, http.StatusInternalServerError, "保存健康档案失败", "HEALTH_PROFILE_FAILED")
		return
	}
	c.JSON(http.StatusOK, merged)
}
