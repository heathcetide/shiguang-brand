// Copyright (c) 2026 heathcetide. All rights reserved.

package lifestyle

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/heathcetide/DietDigiDose/internal/expressauth"
	"github.com/heathcetide/DietDigiDose/internal/httpx"
)

func (h *Handlers) PlanMaintenanceRuns(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	rows, err := h.DB.Query(`SELECT id, status, COALESCE(attempts,0), COALESCE(created_at,''), COALESCE(updated_at,''),
		COALESCE(available_at,''), COALESCE(result_json,'{}')
		FROM plan_maintenance_jobs WHERE user_id=? ORDER BY created_at DESC, id DESC LIMIT 20`, userID)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"items": []any{}})
		return
	}
	defer rows.Close()
	items := make([]map[string]any, 0)
	for rows.Next() {
		var id, status, created, updated, available, resultRaw string
		var attempts int
		if rows.Scan(&id, &status, &attempts, &created, &updated, &available, &resultRaw) != nil {
			continue
		}
		item := map[string]any{"id": id, "status": status, "attempts": attempts, "created_at": created, "updated_at": updated, "available_at": available}
		var result map[string]any
		if json.Unmarshal([]byte(resultRaw), &result) == nil {
			item["result"] = result
		}
		items = append(items, item)
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

func (h *Handlers) PlanMaintenanceSettings(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	c.JSON(http.StatusOK, h.loadMaintenanceSettings(userID))
}

func (h *Handlers) PatchPlanMaintenanceSettings(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	var body map[string]any
	if err := c.ShouldBindJSON(&body); err != nil {
		httpx.SendError(c, http.StatusBadRequest, "请求参数无效", "INVALID_BODY")
		return
	}
	current := h.loadMaintenanceSettings(userID)
	expected := asInt(body["version"])
	if expected > 0 && expected != asInt(current["version"]) {
		httpx.SendError(c, http.StatusConflict, "检查设置已更新，请刷新后重试", "VERSION_CONFLICT")
		return
	}
	enabled := asBool(body["enabled"])
	timeZone := asString(body["timeZone"])
	if timeZone == "" {
		timeZone = asString(body["time_zone"])
	}
	localTime := asString(body["localTime"])
	if localTime == "" {
		localTime = asString(body["local_time"])
	}
	version := asInt(current["version"]) + 1
	next := map[string]any{
		"enabled": enabled, "timeZone": timeZone, "localTime": localTime,
		"nextCheckAt": current["nextCheckAt"], "nextLocalDate": current["nextLocalDate"],
		"lastCompletedLocalDate": current["lastCompletedLocalDate"], "version": version,
	}
	_, err := h.DB.Exec(`INSERT INTO plan_maintenance_settings (user_id, enabled, time_zone, local_time, version, updated_at)
		VALUES (?, ?, ?, ?, ?, ?)
		ON CONFLICT(user_id) DO UPDATE SET enabled=excluded.enabled, time_zone=excluded.time_zone, local_time=excluded.local_time,
		version=excluded.version, updated_at=excluded.updated_at`,
		userID, boolToInt(enabled), timeZone, localTime, version, nowRFC3339())
	if err != nil {
		_, _ = h.DB.Exec(`INSERT INTO plan_maintenance_settings (user_id, enabled, time_zone, local_time, version, updated_at)
			VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET enabled=excluded.enabled, time_zone=excluded.time_zone, local_time=excluded.local_time, version=excluded.version, updated_at=excluded.updated_at`, userID, boolToInt(enabled), timeZone, localTime, version, nowRFC3339())
	}
	c.JSON(http.StatusOK, next)
}

func (h *Handlers) loadMaintenanceSettings(userID int) map[string]any {
	var enabled int
	var timeZone, localTime, nextCheck, nextLocal, lastCompleted sql.NullString
	var version int
	err := h.DB.QueryRow(`SELECT enabled, time_zone, local_time, next_check_at, next_local_date, last_completed_local_date, COALESCE(version,0)
		FROM plan_maintenance_settings WHERE user_id=?`, userID).Scan(&enabled, &timeZone, &localTime, &nextCheck, &nextLocal, &lastCompleted, &version)
	if err != nil {
		return map[string]any{
			"enabled": false, "timeZone": nil, "localTime": nil,
			"nextCheckAt": nil, "nextLocalDate": nil, "lastCompletedLocalDate": nil, "version": 0,
		}
	}
	return map[string]any{
		"enabled":  enabled != 0,
		"timeZone": nullOptional(timeZone), "localTime": nullOptional(localTime),
		"nextCheckAt": nullOptional(nextCheck), "nextLocalDate": nullOptional(nextLocal),
		"lastCompletedLocalDate": nullOptional(lastCompleted), "version": version,
	}
}

func nullOptional(v sql.NullString) any {
	if v.Valid && v.String != "" {
		return v.String
	}
	return nil
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

func (h *Handlers) PlanMaintenanceStatusGet(c *gin.Context) {
	userID, _ := expressauth.UserID(c)

	replacements := h.computePendingReplacements(userID)
	var id, status, resultRaw, created, updated string
	var attempts int
	err := h.DB.QueryRow(`SELECT id, status, COALESCE(attempts,0), COALESCE(result_json,'{}'),
		COALESCE(created_at,''), COALESCE(updated_at,'')
		FROM plan_maintenance_jobs WHERE user_id=? ORDER BY created_at DESC, id DESC LIMIT 1`, userID).
		Scan(&id, &status, &attempts, &resultRaw, &created, &updated)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"userId": userID, "status": "idle", "jobId": nil,
			"pendingReplacements": replacements, "settings": h.loadMaintenanceSettings(userID),
		})
		return
	}
	var result map[string]any
	_ = json.Unmarshal([]byte(resultRaw), &result)
	c.JSON(http.StatusOK, gin.H{
		"userId": userID, "status": status, "jobId": id, "attempts": attempts,
		"createdAt": created, "updatedAt": updated, "result": result,
		"pendingReplacements": replacements, "settings": h.loadMaintenanceSettings(userID),
	})
}

func (h *Handlers) PlanMaintenanceRecalcPost(c *gin.Context) {
	userID, _ := expressauth.UserID(c)

	activePlans := 0
	_ = h.DB.QueryRow(`SELECT COUNT(*) FROM meal_plans WHERE user_id=? AND deleted_at IS NULL AND status='active'`, userID).
		Scan(&activePlans)
	inventoryCount := 0
	if h.hasTable("inventory_items") {
		_ = h.DB.QueryRow(`SELECT COUNT(*) FROM inventory_items WHERE user_id=? AND deleted_at IS NULL AND COALESCE(is_available,1)=1`, userID).
			Scan(&inventoryCount)
	}
	replacements := h.computePendingReplacements(userID)
	jobID := newUUID()
	now := nowRFC3339()
	result := map[string]any{
		"activeMealPlans": activePlans, "inventoryCount": inventoryCount,
		"pendingReplacementCount": len(replacements),
		"recalculated":            true, "completedAt": now,
	}
	resultRaw := marshalJSON(result)
	_, err := h.DB.Exec(`INSERT INTO plan_maintenance_jobs (id, user_id, status, attempts, result_json, created_at, updated_at, available_at)
		VALUES (?, ?, 'completed', 1, ?, ?, ?, ?)`, jobID, userID, resultRaw, now, now, now)
	if err != nil {
		httpx.SendError(c, http.StatusInternalServerError, "维护任务失败", "PLAN_MAINTENANCE_FAILED")
		return
	}
	eventID := newUUID()
	_, _ = h.DB.Exec(`INSERT INTO plan_maintenance_events (id, user_id, event_type, source_id, subject_id, created_at)
		VALUES (?, ?, 'manual_recalc', ?, ?, ?)`, eventID, userID, "manual_recalc", jobID, now)
	c.JSON(http.StatusOK, gin.H{
		"userId": userID, "jobId": jobID, "status": "completed",
		"result": result, "recalculated": true, "pendingReplacements": replacements,
	})
}

// computePendingReplacements finds active plan items whose recipe ingredients are
// mostly missing from inventory and suggests an alternate recipe with better coverage.
func (h *Handlers) computePendingReplacements(userID int) []map[string]any {
	if !h.hasTable("meal_plan_items") || !h.hasTable("recipes") {
		return []map[string]any{}
	}
	invNames := make([]string, 0)
	if h.hasTable("inventory_items") {
		rows, err := h.DB.Query(`SELECT food_name FROM inventory_items
			WHERE user_id=? AND deleted_at IS NULL AND COALESCE(is_available,1)=1`, userID)
		if err == nil {
			for rows.Next() {
				var name string
				if rows.Scan(&name) == nil && name != "" {
					invNames = append(invNames, name)
				}
			}
			_ = rows.Close()
		}
	}
	type itemRow struct {
		itemID, planID, title string
		recipeID              int
	}
	pending := make([]itemRow, 0)
	rows, err := h.DB.Query(`SELECT i.id, i.plan_id, COALESCE(i.title,''), COALESCE(i.recipe_id,0)
		FROM meal_plan_items i
		JOIN meal_plans p ON p.id=i.plan_id
		WHERE i.user_id=? AND p.user_id=? AND p.status='active' AND COALESCE(p.deleted_at,'')=''
		AND COALESCE(i.status,'planned') NOT IN ('completed','cancelled')
		AND COALESCE(i.recipe_id,0)>0
		ORDER BY i.id LIMIT 40`, userID, userID)
	if err != nil {
		return []map[string]any{}
	}
	for rows.Next() {
		var r itemRow
		if rows.Scan(&r.itemID, &r.planID, &r.title, &r.recipeID) == nil {
			pending = append(pending, r)
		}
	}
	_ = rows.Close()

	altRecipes := make([]struct {
		id    int
		title string
		ings  string
	}, 0)
	rrows, err := h.DB.Query(`SELECT id, title, COALESCE(ingredients_json,'[]') FROM recipes ORDER BY id DESC LIMIT 80`)
	if err == nil {
		for rrows.Next() {
			var id int
			var title, ings string
			if rrows.Scan(&id, &title, &ings) == nil {
				altRecipes = append(altRecipes, struct {
					id    int
					title string
					ings  string
				}{id, title, ings})
			}
		}
		_ = rrows.Close()
	}

	out := make([]map[string]any, 0)
	for _, item := range pending {
		var ingRaw string
		_ = h.DB.QueryRow(`SELECT COALESCE(ingredients_json,'[]') FROM recipes WHERE id=?`, item.recipeID).Scan(&ingRaw)
		missing := ingredientGaps(ingRaw, invNames)
		if len(missing) == 0 {
			continue
		}
		bestID, bestTitle, bestMissing := 0, "", len(missing)
		for _, alt := range altRecipes {
			if alt.id == item.recipeID {
				continue
			}
			altMissing := ingredientGaps(alt.ings, invNames)
			if len(altMissing) < bestMissing {
				bestMissing = len(altMissing)
				bestID = alt.id
				bestTitle = alt.title
			}
		}
		if bestID == 0 || bestMissing >= len(missing) {
			continue
		}
		out = append(out, map[string]any{
			"planId": item.planID, "itemId": item.itemID, "title": item.title,
			"currentRecipeId": item.recipeID, "missingIngredients": missing,
			"suggestedRecipeId": bestID, "suggestedTitle": bestTitle,
			"suggestedMissingCount": bestMissing, "reason": "inventory_coverage",
		})
	}
	return out
}

func ingredientGaps(ingredientsJSON string, inventory []string) []string {
	var parsed any
	_ = json.Unmarshal([]byte(ingredientsJSON), &parsed)
	list, _ := parsed.([]any)
	missing := make([]string, 0)
	for _, item := range list {
		name := ""
		switch v := item.(type) {
		case string:
			name = v
		case map[string]any:
			name, _ = v["name"].(string)
		}
		name = strings.TrimSpace(name)
		if name == "" {
			continue
		}
		found := false
		ln := strings.ToLower(name)
		for _, inv := range inventory {
			iv := strings.ToLower(strings.TrimSpace(inv))
			if iv == "" {
				continue
			}
			if strings.Contains(iv, ln) || strings.Contains(ln, iv) {
				found = true
				break
			}
		}
		if !found {
			missing = append(missing, name)
		}
	}
	return missing
}

func (h *Handlers) hasTable(name string) bool { return h.DB.HasTable(name) }
