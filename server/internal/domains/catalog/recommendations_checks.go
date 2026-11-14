// Copyright (c) 2026 heathcetide. All rights reserved.

package catalog

import (
	"encoding/json"
)

func baseRecommendationChecksPending() []string {
	return []string{
		"prepared_meal_storage_and_food_safety",
		"allergies_and_reheating",
		"recipe_quantities",
		"whole_plan_time",
	}
}

func extendedCookingChecksPending() []string {
	out := append(baseRecommendationChecksPending(),
		"storage_and_carry_suitability",
		"substitution_validation",
		"execution_stock_refresh",
	)
	return capStringChecks(out, 50)
}

func capStringChecks(items []string, max int) []string {
	seen := map[string]struct{}{}
	out := make([]string, 0, len(items))
	for _, item := range items {
		if item == "" {
			continue
		}
		if _, dup := seen[item]; dup {
			continue
		}
		seen[item] = struct{}{}
		out = append(out, item)
		if len(out) >= max {
			break
		}
	}
	return out
}

func prefsAvoidSpicy(prefs map[string]any) bool {
	if prefs == nil {
		return false
	}
	if v, ok := prefs["avoid_spicy"].(bool); ok && v {
		return true
	}
	if kitchen, ok := prefs["kitchen"].(map[string]any); ok {
		if v, ok := kitchen["avoid_spicy"].(bool); ok && v {
			return true
		}
	}
	if overrides, ok := prefs["overrides"].(map[string]any); ok {
		if v, ok := overrides["avoid_spicy"].(bool); ok && v {
			return true
		}
	}
	return false
}

func prefsCarryMeals(prefs map[string]any) bool {
	if prefs == nil {
		return false
	}
	if v, ok := prefs["carry_meals"].(bool); ok && v {
		return true
	}
	if kitchen, ok := prefs["kitchen"].(map[string]any); ok {
		if v, ok := kitchen["carry_meals"].(bool); ok && v {
			return true
		}
	}
	return false
}

func (h *Handlers) inventoryMissingExpiration(userID int) bool {
	if !h.hasTable("inventory_items") {
		return false
	}
	var n int
	_ = h.DB.QueryRow(`SELECT COUNT(*) FROM inventory_items
		WHERE user_id=? AND deleted_at IS NULL AND COALESCE(is_available,1)=1
			AND (expiration_date IS NULL OR expiration_date='')`, userID).Scan(&n)
	return n > 0
}

func (h *Handlers) userHasPreparedMeals(userID int) bool {
	if !h.hasTable("prepared_meals") {
		return false
	}
	var n int
	_ = h.DB.QueryRow(`SELECT COUNT(*) FROM prepared_meals WHERE user_id=? AND COALESCE(remaining_servings,0)>0`, userID).Scan(&n)
	return n > 0
}

func (h *Handlers) enrichRecommendationChecks(userID int, prefs map[string]any, recipeIDs []int, gate *recKitchenwareGate, base []string) []string {
	checks := append([]string{}, base...)
	if h.inventoryMissingExpiration(userID) {
		checks = append(checks, "部分库存缺少可用期限，未来餐次使用前需核对")
	}
	if prefsAvoidSpicy(prefs) && h.userHasPreparedMeals(userID) {
		checks = append(checks, "待吃餐辣度未核实，本次不自动分配")
	}
	if prefsCarryMeals(prefs) {
		checks = append(checks, "携带餐的冷藏与复热适用性需要逐餐核对")
	}
	if gate != nil {
		seen := map[string]struct{}{}
		for _, id := range recipeIDs {
			for _, name := range gate.blockingForRecipe(id) {
				msg := "缺少厨具：" + name
				if _, ok := seen[msg]; ok {
					continue
				}
				seen[msg] = struct{}{}
				checks = append(checks, msg)
			}
		}
	}
	return capStringChecks(checks, 50)
}

func extractPrefsFromBody(body map[string]any) map[string]any {
	if body == nil {
		return map[string]any{}
	}
	if p, ok := body["preferences"].(map[string]any); ok {
		return p
	}
	if p, ok := body["effectivePreferences"].(map[string]any); ok {
		return p
	}
	return map[string]any{}
}

func mealHasPreparedAllocation(meal map[string]any) bool {
	if v, ok := meal["preparedServings"].(float64); ok && v > 0 {
		return true
	}
	if raw, ok := meal["allocations"].([]any); ok && len(raw) > 0 {
		return true
	}
	if raw, ok := meal["allocations"].([]map[string]any); ok && len(raw) > 0 {
		return true
	}
	return false
}

func buildHandlingChecks(meals []map[string]any) []map[string]any {
	out := make([]map[string]any, 0)
	for _, meal := range meals {
		if meal == nil || !mealHasPreparedAllocation(meal) {
			continue
		}
		status := "pending"
		if s := asString(meal["handlingStatus"]); s != "" {
			status = s
		} else if s := asString(meal["status"]); s == "conditions_match" || s == "conflict" {
			status = s
		}
		out = append(out, map[string]any{
			"targetMealId": asString(meal["id"]),
			"recipeId":     meal["recipeId"],
			"status":       status,
			"reasons":      []string{"预制餐存放与复热条件需确认"},
		})
	}
	return out
}

func recipeIDsFromMeals(meals []map[string]any) []int {
	ids := make([]int, 0, len(meals))
	for _, meal := range meals {
		if id, ok := numBodyInt(meal, "recipeId"); ok && id > 0 {
			ids = append(ids, id)
		}
	}
	return ids
}

func checksPendingJSON(checks []string) []any {
	out := make([]any, len(checks))
	for i, c := range checks {
		out[i] = c
	}
	return out
}

func decodeMealsFromBody(body map[string]any) []map[string]any {
	raw, ok := body["meals"].([]any)
	if !ok {
		return nil
	}
	out := make([]map[string]any, 0, len(raw))
	for _, item := range raw {
		if m, ok := item.(map[string]any); ok {
			out = append(out, m)
		}
	}
	return out
}

func kitchenConstraintsFromPrefs(state map[string]any) map[string]any {
	if state == nil {
		return map[string]any{}
	}
	if k, ok := state["kitchen"].(map[string]any); ok {
		return k
	}
	if o, ok := state["overrides"].(map[string]any); ok {
		return o
	}
	raw, _ := json.Marshal(state)
	var flat map[string]any
	_ = json.Unmarshal(raw, &flat)
	return flat
}
