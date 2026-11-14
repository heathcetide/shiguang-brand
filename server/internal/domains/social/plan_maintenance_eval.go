// Copyright (c) 2026 heathcetide. All rights reserved.

package social

import (
	"database/sql"
	"encoding/json"
	"strings"
	"time"
)

// Inventory-coverage maintenance evaluator with optional auto-apply when
// plan_maintenance_settings.auto_apply / apply_mode request it.

type maintAssessment struct {
	ItemID               string   `json:"itemId"`
	PlanID               string   `json:"planId"`
	Title                string   `json:"title,omitempty"`
	RecipeID             int      `json:"recipeId,omitempty"`
	Status               string   `json:"status"` // covered | missing | unknown
	MissingIngredients   []string `json:"missingIngredients,omitempty"`
	SuggestedRecipeID    int      `json:"suggestedRecipeId,omitempty"`
	SuggestedTitle       string   `json:"suggestedTitle,omitempty"`
	SuggestedMissingCount int     `json:"suggestedMissingCount,omitempty"`
}

type maintEvalResult struct {
	Assessments         []maintAssessment
	PendingReplacements []map[string]any
	Checks              []string
	Covered             int
	Missing             int
	Unknown             int
}

func (h *Handlers) evaluatePlanMaintenance(userID int) maintEvalResult {
	out := maintEvalResult{
		Assessments:         make([]maintAssessment, 0),
		PendingReplacements: make([]map[string]any, 0),
		Checks:              make([]string, 0),
	}
	if !h.hasTable("meal_plan_items") || !h.hasTable("recipes") {
		out.Checks = append(out.Checks, "meal plan or recipes tables unavailable")
		return out
	}

	invNames := h.loadInventoryFoodNames(userID)
	items := h.loadActivePlanItemsForMaintenance(userID)
	if len(items) == 0 {
		out.Checks = append(out.Checks, "no active upcoming meal plan items")
		return out
	}

	altRecipes := h.loadRecipeCandidates(80)
	for _, item := range items {
		ingRaw := item.ingredients
		if ingRaw == "" || ingRaw == "[]" {
			if item.recipeID > 0 {
				_ = h.DB.QueryRow(`SELECT COALESCE(ingredients_json,'[]') FROM recipes WHERE id=?`, item.recipeID).Scan(&ingRaw)
			}
		}
		if item.recipeID <= 0 && (ingRaw == "" || ingRaw == "[]") {
			out.Unknown++
			out.Assessments = append(out.Assessments, maintAssessment{
				ItemID: item.id, PlanID: item.planID, Title: item.title, Status: "unknown",
			})
			out.Checks = append(out.Checks, "餐次 "+item.id+" 缺少菜谱或原料，保留原安排")
			continue
		}
		missing := ingredientGaps(ingRaw, invNames)
		a := maintAssessment{
			ItemID: item.id, PlanID: item.planID, Title: item.title, RecipeID: item.recipeID,
			MissingIngredients: missing,
		}
		if len(missing) == 0 {
			a.Status = "covered"
			out.Covered++
			out.Assessments = append(out.Assessments, a)
			continue
		}
		a.Status = "missing"
		out.Missing++

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
		if bestID > 0 && bestMissing < len(missing) {
			a.SuggestedRecipeID = bestID
			a.SuggestedTitle = bestTitle
			a.SuggestedMissingCount = bestMissing
			out.PendingReplacements = append(out.PendingReplacements, map[string]any{
				"planId": item.planID, "itemId": item.id, "title": item.title,
				"currentRecipeId": item.recipeID, "missingIngredients": missing,
				"suggestedRecipeId": bestID, "suggestedTitle": bestTitle,
				"suggestedMissingCount": bestMissing, "reason": "inventory_coverage",
				"decision": "suggest",
			})
			out.Checks = append(out.Checks, "餐次 "+item.id+" 有原料缺口，建议替换为「"+bestTitle+"」")
		} else {
			out.Checks = append(out.Checks, "餐次 "+item.id+" 有原料缺口，暂无更优替换")
		}
		out.Assessments = append(out.Assessments, a)
	}
	return out
}

type maintPlanItem struct {
	id, planID, title, ingredients string
	recipeID                       int
}

func (h *Handlers) loadInventoryFoodNames(userID int) []string {
	if !h.hasTable("inventory_items") {
		return nil
	}
	rows, err := h.DB.Query(`SELECT food_name FROM inventory_items
		WHERE user_id=? AND COALESCE(deleted_at,'')='' AND COALESCE(is_available,1)=1`, userID)
	if err != nil {
		return nil
	}
	defer rows.Close()
	names := make([]string, 0)
	for rows.Next() {
		var name string
		if rows.Scan(&name) == nil && strings.TrimSpace(name) != "" {
			names = append(names, name)
		}
	}
	return names
}

func (h *Handlers) loadActivePlanItemsForMaintenance(userID int) []maintPlanItem {
	hasTitle := h.DB.HasColumn("meal_plan_items", "title")
	hasRecipe := h.DB.HasColumn("meal_plan_items", "recipe_id")
	out := make([]maintPlanItem, 0)
	if hasTitle && hasRecipe {
		rows, err := h.DB.Query(`SELECT i.id, CAST(i.plan_id AS TEXT), COALESCE(i.title,''), COALESCE(i.recipe_id,0), COALESCE(i.ingredients_json,'[]')
			FROM meal_plan_items i
			JOIN meal_plans p ON CAST(p.id AS TEXT)=CAST(i.plan_id AS TEXT)
			WHERE i.user_id=? AND p.user_id=? AND p.status='active' AND COALESCE(p.deleted_at,'')=''
			  AND COALESCE(i.deleted_at,'')='' AND COALESCE(i.status,'planned') NOT IN ('completed','cancelled','skipped')
			ORDER BY COALESCE(i.planned_date,''), i.id LIMIT 40`, userID, userID)
		if err == nil {
			defer rows.Close()
			for rows.Next() {
				var item maintPlanItem
				if rows.Scan(&item.id, &item.planID, &item.title, &item.recipeID, &item.ingredients) == nil {
					out = append(out, item)
				}
			}
			return out
		}
	}

	rows, err := h.DB.Query(`SELECT i.id, CAST(i.plan_id AS TEXT), COALESCE(i.payload_json,'{}')
		FROM meal_plan_items i
		JOIN meal_plans p ON CAST(p.id AS TEXT)=CAST(i.plan_id AS TEXT)
		WHERE i.user_id=? AND p.user_id=? AND p.status='active' AND COALESCE(p.deleted_at,'')=''
		  AND COALESCE(i.deleted_at,'')='' AND COALESCE(i.status,'planned') NOT IN ('completed','cancelled','skipped')
		ORDER BY i.id LIMIT 40`, userID, userID)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var id, planID, payload string
		if rows.Scan(&id, &planID, &payload) != nil {
			continue
		}
		item := maintPlanItem{id: id, planID: planID, ingredients: "[]"}
		var m map[string]any
		if json.Unmarshal([]byte(payload), &m) == nil {
			if t, ok := m["title"].(string); ok {
				item.title = t
			}
			switch v := m["recipe_id"].(type) {
			case float64:
				item.recipeID = int(v)
			case int:
				item.recipeID = v
			}
			if ing, ok := m["ingredients"]; ok {
				raw, _ := json.Marshal(ing)
				item.ingredients = string(raw)
			} else if s, ok := m["ingredients_json"].(string); ok {
				item.ingredients = s
			}
		}
		out = append(out, item)
	}
	return out
}

type recipeCandidate struct {
	id    int
	title string
	ings  string
}

func (h *Handlers) loadRecipeCandidates(limit int) []recipeCandidate {
	q := `SELECT id, title, COALESCE(ingredients_json,'[]') FROM recipes`
	if h.DB.HasColumn("recipes", "deleted_at") {
		q += ` WHERE COALESCE(deleted_at,'')=''`
	}
	if h.DB.HasColumn("recipes", "status") {
		if strings.Contains(q, "WHERE") {
			q += ` AND COALESCE(status,'approved')='approved'`
		} else {
			q += ` WHERE COALESCE(status,'approved')='approved'`
		}
	}
	q += ` ORDER BY id DESC LIMIT ?`
	rows, err := h.DB.Query(q, limit)
	if err != nil {
		return nil
	}
	defer rows.Close()
	out := make([]recipeCandidate, 0)
	for rows.Next() {
		var c recipeCandidate
		if rows.Scan(&c.id, &c.title, &c.ings) == nil {
			out = append(out, c)
		}
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
			if name == "" {
				name, _ = v["foodName"].(string)
			}
			if name == "" {
				name, _ = v["food_name"].(string)
			}
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

func (h *Handlers) planMaintenanceAutoApplyEnabled(userID int) bool {
	if !h.hasTable("plan_maintenance_settings") {
		return false
	}
	var autoApply int
	var applyMode sql.NullString
	err := h.DB.QueryRow(`SELECT COALESCE(auto_apply,0), COALESCE(apply_mode,'suggest')
		FROM plan_maintenance_settings WHERE user_id=?`, userID).Scan(&autoApply, &applyMode)
	if err != nil {
		return false
	}
	if autoApply == 1 {
		return true
	}
	mode := strings.ToLower(strings.TrimSpace(applyMode.String))
	return mode == "apply" || mode == "auto" || mode == "auto_apply"
}

func (h *Handlers) applyPendingMaintenanceSuggestions(userID int, replacements []map[string]any, now time.Time) (int, []any) {
	if !h.hasTable("meal_plan_items") || len(replacements) == 0 {
		return 0, []any{}
	}
	applied := 0
	changes := make([]any, 0)
	nowStr := now.UTC().Format(time.RFC3339Nano)
	for _, rep := range replacements {
		itemID, _ := rep["itemId"].(string)
		planID, _ := rep["planId"].(string)
		suggestedID := 0
		switch v := rep["suggestedRecipeId"].(type) {
		case float64:
			suggestedID = int(v)
		case int:
			suggestedID = v
		case int64:
			suggestedID = int(v)
		}
		if itemID == "" || suggestedID == 0 {
			continue
		}
		title, _ := rep["suggestedTitle"].(string)
		res, err := h.DB.Exec(`UPDATE meal_plan_items SET recipe_id=?, title=COALESCE(NULLIF(?,''), title), updated_at=?
			WHERE id=? AND user_id=?`, suggestedID, title, nowStr, itemID, userID)
		if err != nil {
			// Some schemas use plan ownership without user_id on items.
			res, err = h.DB.Exec(`UPDATE meal_plan_items SET recipe_id=?, title=COALESCE(NULLIF(?,''), title)
				WHERE id=?`, suggestedID, title, itemID)
		}
		if err != nil {
			continue
		}
		if n, _ := res.RowsAffected(); n == 0 {
			continue
		}
		applied++
		change := map[string]any{
			"itemId": itemID, "planId": planID, "recipeId": suggestedID, "title": title, "decision": "applied",
		}
		changes = append(changes, change)
		if h.hasTable("meal_plan_changes") {
			body, _ := json.Marshal(change)
			_, _ = h.DB.Exec(`UPDATE meal_plan_changes SET status='applied', applied_at=?, body_json=?
				WHERE user_id=? AND plan_id=? AND item_id=? AND status='pending'`,
				nowStr, string(body), userID, planID, itemID)
		}
	}
	return applied, changes
}

func (h *Handlers) recordPendingMaintenanceSuggestions(userID int, replacements []map[string]any) int {
	if !h.hasTable("meal_plan_changes") || len(replacements) == 0 {
		return 0
	}
	recorded := 0
	for _, rep := range replacements {
		itemID, _ := rep["itemId"].(string)
		planID, _ := rep["planId"].(string)
		if itemID == "" || planID == "" {
			continue
		}
		var existing string
		_ = h.DB.QueryRow(`SELECT id FROM meal_plan_changes
			WHERE user_id=? AND plan_id=? AND item_id=? AND status='pending' LIMIT 1`,
			userID, planID, itemID).Scan(&existing)
		if existing != "" {
			continue
		}
		body, _ := json.Marshal(rep)
		id := randomTokenHex(16)
		_, err := h.DB.Exec(`INSERT INTO meal_plan_changes (id, user_id, plan_id, item_id, status, fingerprint, body_json)
			VALUES (?, ?, ?, ?, 'pending', ?, ?)`,
			id, userID, planID, itemID, "inventory_coverage", string(body))
		if err == nil {
			recorded++
		}
	}
	return recorded
}
