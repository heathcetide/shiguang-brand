// Copyright (c) 2026 heathcetide. All rights reserved.

package lifestyle

import (
	"encoding/json"

	"github.com/gin-gonic/gin"
	"github.com/heathcetide/DietDigiDose/internal/expressauth"
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

func (h *Handlers) PatchHealthProfile(c *gin.Context) {
	h.PutHealthProfile(c)
}
