// Copyright (c) 2026 heathcetide. All rights reserved.

package catalog

import (
	"crypto/rand"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/heathcetide/DietDigiDose/internal/httpx"
)

var barcodePattern = regexp.MustCompile(`^\d{8,14}$`)

func (h *Handlers) hasTable(name string) bool { return h.DB.HasTable(name) }

func (h *Handlers) hasColumn(table, column string) bool { return h.DB.HasColumn(table, column) }

func emptyNil(v string) any {
	if strings.TrimSpace(v) == "" {
		return nil
	}
	return v
}

func asString(v any) string {
	switch t := v.(type) {
	case string:
		return strings.TrimSpace(t)
	case float64:
		if t == float64(int64(t)) {
			return strconv.FormatInt(int64(t), 10)
		}
		return strconv.FormatFloat(t, 'f', -1, 64)
	default:
		return ""
	}
}

func bindJSONMap(c *gin.Context) (map[string]any, bool) {
	var body map[string]any
	if err := c.ShouldBindJSON(&body); err != nil {
		httpx.SendError(c, http.StatusBadRequest, "请求参数无效", "INVALID_BODY")
		return nil, false
	}
	return body, true
}

func parsePositiveID(c *gin.Context, param string) (int, bool) {
	id, err := strconv.Atoi(c.Param(param))
	if err != nil || id <= 0 {
		httpx.SendError(c, http.StatusBadRequest, "无效的 ID", "INVALID_ID")
		return 0, false
	}
	return id, true
}

func newUUID() (string, error) {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16]), nil
}

func (h *Handlers) foodsTable() string {
	if h.hasTable("ingredients_library") {
		return "ingredients_library"
	}
	if h.hasTable("foods") {
		return "foods"
	}
	return ""
}

func (h *Handlers) kitchenwareCatalogTable() string {
	if h.hasTable("kitchenware_catalog") {
		return "kitchenware_catalog"
	}
	if h.hasTable("kitchenware") {
		return "kitchenware"
	}
	return ""
}

func (h *Handlers) recipePublicWhere(alias string) string {
	parts := []string{}
	if h.hasColumn("recipes", "deleted_at") {
		parts = append(parts, alias+".deleted_at IS NULL")
	}
	if h.hasColumn("recipes", "status") {
		parts = append(parts, alias+".status = 'approved'")
	}
	if h.hasColumn("recipes", "quality_status") {
		parts = append(parts, "COALESCE("+alias+".quality_status, 'trusted') <> 'needs_review'")
	}
	if len(parts) == 0 {
		return "1=1"
	}
	return strings.Join(parts, " AND ")
}

func (h *Handlers) recipeListSelect() string {
	cols := []string{"id", "title"}
	if h.hasColumn("recipes", "summary") {
		cols = append(cols, "COALESCE(summary,'') AS summary")
	} else if h.hasColumn("recipes", "description") {
		cols = append(cols, "COALESCE(description,'') AS summary")
	} else {
		cols = append(cols, "'' AS summary")
	}
	if h.hasColumn("recipes", "cover_image_url") {
		cols = append(cols, "COALESCE(cover_image_url,'') AS cover_image_url")
	} else if h.hasColumn("recipes", "image_url") {
		cols = append(cols, "COALESCE(image_url,'') AS cover_image_url")
	} else {
		cols = append(cols, "'' AS cover_image_url")
	}
	if h.hasColumn("recipes", "cook_time_minutes") {
		cols = append(cols, "COALESCE(cook_time_minutes,0) AS cook_time_minutes")
	} else if h.hasColumn("recipes", "cook_time") {
		cols = append(cols, "COALESCE(cook_time,0) AS cook_time_minutes")
	} else {
		cols = append(cols, "0 AS cook_time_minutes")
	}
	if h.hasColumn("recipes", "difficulty") {
		cols = append(cols, "COALESCE(difficulty,'') AS difficulty")
	} else {
		cols = append(cols, "'' AS difficulty")
	}
	if h.hasColumn("recipes", "status") {
		cols = append(cols, "COALESCE(status,'') AS status")
	}
	return strings.Join(cols, ", ")
}

func (h *Handlers) appendRecipeCard(list *[]map[string]any, rows *sql.Rows) error {
	for rows.Next() {
		var id, cook int
		var title, summary, cover, difficulty, status string
		scan := []any{&id, &title, &summary, &cover, &cook, &difficulty}
		if h.hasColumn("recipes", "status") {
			scan = append(scan, &status)
		}
		if err := rows.Scan(scan...); err != nil {
			return err
		}
		item := map[string]any{
			"id": id, "title": title, "summary": summary, "cover_image_url": emptyNil(cover),
			"cook_time_minutes": cook, "difficulty": difficulty,
		}
		if status != "" {
			item["status"] = status
		}
		*list = append(*list, item)
	}
	return rows.Err()
}

func (h *Handlers) upsertUserJSONPref(userID int, value map[string]any) error {
	raw, _ := json.Marshal(value)
	if h.hasTable("user_recommendation_preferences") {
		_, err := h.DB.Exec(`
			INSERT INTO user_recommendation_preferences (user_id, preferences_json, updated_at)
			VALUES (?, ?, CURRENT_TIMESTAMP)
			ON CONFLICT(user_id) DO UPDATE SET preferences_json=excluded.preferences_json, updated_at=CURRENT_TIMESTAMP`, userID, string(raw))
		if err == nil {
			return nil
		}
	}
	settingKey := fmt.Sprintf("recommendation.preferences.%d", userID)
	_, err := h.DB.Exec(`INSERT INTO system_settings(key, value) VALUES(?, ?)
		ON CONFLICT(key) DO UPDATE SET value=excluded.value`, settingKey, string(raw))
	if err != nil {
		_, _ = h.DB.Exec(`INSERT INTO system_settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, settingKey, string(raw))
	}
	return nil
}

func (h *Handlers) loadUserJSONPref(userID int) map[string]any {
	if h.hasTable("user_recommendation_preferences") {
		var raw sql.NullString
		if err := h.DB.QueryRow(`SELECT preferences_json FROM user_recommendation_preferences WHERE user_id=?`, userID).Scan(&raw); err == nil && raw.Valid {
			var out map[string]any
			_ = json.Unmarshal([]byte(raw.String), &out)
			if out != nil {
				return out
			}
		}
	}
	settingKey := fmt.Sprintf("recommendation.preferences.%d", userID)
	var raw string
	if err := h.DB.QueryRow(`SELECT value FROM system_settings WHERE key=?`, settingKey).Scan(&raw); err == nil {
		var out map[string]any
		_ = json.Unmarshal([]byte(raw), &out)
		if out != nil {
			return out
		}
	}
	if h.hasTable("recommendation_learning_settings") {
		var enabled int
		var overrides sql.NullString
		var version int
		if err := h.DB.QueryRow(`SELECT COALESCE(enabled,1), overrides_json, COALESCE(version,1) FROM recommendation_learning_settings WHERE user_id=?`, userID).
			Scan(&enabled, &overrides, &version); err == nil {
			out := map[string]any{"version": version, "enabled": enabled != 0, "ruleVersion": "internal-evidence-v1", "items": []any{}, "overrides": map[string]any{}}
			if overrides.Valid && overrides.String != "" {
				var parsed map[string]any
				_ = json.Unmarshal([]byte(overrides.String), &parsed)
				out["overrides"] = parsed
			}
			return out
		}
	}
	return map[string]any{
		"version":      1,
		"enabled":      true,
		"ruleVersion":  "internal-evidence-v1",
		"items":        []any{},
		"observations": []any{},
	}
}

func (h *Handlers) fetchRecipeCandidates(limit int) []map[string]any {
	if limit <= 0 || limit > 50 {
		limit = 20
	}
	where := h.recipePublicWhere("r")
	query := `SELECT ` + h.recipeListSelect() + ` FROM recipes r WHERE ` + where + ` ORDER BY r.id DESC LIMIT ?`
	rows, err := h.DB.Query(query, limit)
	if err != nil {
		rows, err = h.DB.Query(`SELECT id, title, COALESCE(summary,''), COALESCE(cover_image_url,''), COALESCE(cook_time_minutes,0), COALESCE(difficulty,'')
			FROM recipes ORDER BY id DESC LIMIT ?`, limit)
		if err != nil {
			return []map[string]any{}
		}
	}
	defer rows.Close()
	list := make([]map[string]any, 0, limit)
	_ = h.appendRecipeCard(&list, rows)
	return list
}
