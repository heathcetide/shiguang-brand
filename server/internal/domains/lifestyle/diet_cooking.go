// Copyright (c) 2026 heathcetide. All rights reserved.

package lifestyle

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/heathcetide/DietDigiDose/internal/dbx"
	"github.com/heathcetide/DietDigiDose/internal/domains/inventory"
)

func (h *Handlers) completeCookingCore(userID int, body map[string]any) (map[string]any, int, error) {
	if err := inventory.CheckRecipeExecution(h.DB, asInt(body["recipe_id"])); err != nil {
		return nil, 409, err
	}
	key := strings.TrimSpace(asString(body["idempotency_key"]))
	if key == "" {
		return nil, 400, errors.New("INVALID_BODY")
	}
	if existing, err := h.loadCookingCompletionRepeat(userID, key); err != nil {
		return nil, 500, err
	} else if existing != nil {
		return existing, 200, nil
	}

	production, hasProd := body["production"].(map[string]any)
	dietRecord, hasDiet := body["diet_record"].(map[string]any)
	if hasProd == hasDiet {
		return nil, 400, errors.New("INVALID_BODY")
	}

	lines, err := h.resolveConsumptionLines(userID, body)
	if err != nil {
		return nil, 409, err
	}

	var consumedIDs []int
	var changes []any
	if len(lines) > 0 {
		consumptionItems := make([]any, len(lines))
		for i, line := range lines {
			consumptionItems[i] = line
		}
		consumeBody := map[string]any{
			"idempotency_key": "cooking:" + key,
			"source":          "cooking",
			"items":           consumptionItems,
		}
		if rid := asInt(body["recipe_id"]); rid > 0 {
			consumeBody["recipe_id"] = rid
		}
		consumeResult, cerr := h.inventorySvc().Consume(userID, consumeBody)
		if cerr != nil {
			return nil, 0, cerr
		}
		if raw, ok := consumeResult["changes"].([]any); ok {
			changes = raw
		} else if raw, ok := consumeResult["changes"].([]map[string]any); ok {
			for _, change := range raw {
				changes = append(changes, change)
			}
		}
		for _, line := range lines {
			consumedIDs = append(consumedIDs, asInt(line["item_id"]))
		}
	}

	// Re-check after consume: a concurrent request may have finished the same key.
	if existing, err := h.loadCookingCompletionRepeat(userID, key); err != nil {
		return nil, 500, err
	} else if existing != nil {
		return existing, 200, nil
	}

	if hasProd {
		result, err := h.savePreparedProduction(userID, key, body, production, consumedIDs, changes)
		if err != nil {
			if existing, _ := h.loadCookingCompletionRepeat(userID, key); existing != nil {
				return existing, 200, nil
			}
			return nil, 0, err
		}
		return result, 201, nil
	}

	result, err := h.saveDietOnlyCompletion(userID, key, body, dietRecord, consumedIDs, changes)
	if err != nil {
		if existing, _ := h.loadCookingCompletionRepeat(userID, key); existing != nil {
			return existing, 200, nil
		}
		return nil, 500, err
	}
	return result, 201, nil
}

func (h *Handlers) saveDietOnlyCompletion(userID int, key string, body, dietRecord map[string]any, consumedIDs []int, changes []any) (map[string]any, error) {
	tx, err := h.DB.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	record, err := h.insertDietRecordWith(tx, userID, dietRecord, "自制餐食")
	if err != nil {
		return nil, err
	}
	response := map[string]any{
		"diet_record":                   record,
		"consumed_inventory_item_ids":   consumedIDs,
		"inventory_consumption_changes": changes,
		"repeated":                      false,
	}
	raw, _ := json.Marshal(response)
	recipeID := asInt(body["recipe_id"])
	if err := h.insertCookingCompletionTx(tx, userID, key, recipeID, record["id"], consumedIDs, string(raw)); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return response, nil
}

func (h *Handlers) insertCookingCompletionTx(tx *dbx.Tx, userID int, key string, recipeID int, dietRecordID any, consumedIDs []int, resultJSON string) error {
	var err error
	if h.hasColumn("cooking_completions", "recipe_id") {
		_, err = tx.Exec(`INSERT INTO cooking_completions (user_id, idempotency_key, recipe_id, diet_record_id, consumed_inventory_ids_json, result_json)
			VALUES (?, ?, ?, ?, ?, ?)`, userID, key, nullRecipe(recipeID), dietRecordID, marshalJSON(consumedIDs), resultJSON)
	} else {
		_, err = tx.Exec(`INSERT INTO cooking_completions (user_id, idempotency_key, result_json) VALUES (?, ?, ?)`, userID, key, resultJSON)
	}
	return err
}

func (h *Handlers) loadCookingCompletionRepeat(userID int, key string) (map[string]any, error) {
	var existing sql.NullString
	_ = h.DB.QueryRow(`SELECT result_json FROM cooking_completions WHERE user_id=? AND idempotency_key=?`, userID, key).Scan(&existing)
	if existing.Valid && existing.String != "" {
		var parsed map[string]any
		if json.Unmarshal([]byte(existing.String), &parsed) == nil {
			parsed["repeated"] = true
			return parsed, nil
		}
	}
	_ = h.DB.QueryRow(`SELECT result_json FROM prepared_meals WHERE user_id=? AND idempotency_key=?`, userID, key).Scan(&existing)
	if existing.Valid && existing.String != "" {
		var parsed map[string]any
		if json.Unmarshal([]byte(existing.String), &parsed) == nil {
			parsed["repeated"] = true
			return parsed, nil
		}
	}
	return nil, nil
}

func (h *Handlers) resolveConsumptionLines(userID int, body map[string]any) ([]map[string]any, error) {
	if raw, ok := body["inventory_consumptions"].([]any); ok && len(raw) > 0 {
		return mapConsumptionLines(raw), nil
	}
	if alloc, ok := body["allocations"].([]any); ok && len(alloc) > 0 {
		return mapConsumptionLines(alloc), nil
	}
	if ids, ok := body["inventory_item_ids"].([]any); ok && len(ids) > 0 {
		lines := make([]map[string]any, 0, len(ids))
		seen := map[int]bool{}
		for _, raw := range ids {
			id := asInt(raw)
			if id <= 0 || seen[id] {
				continue
			}
			seen[id] = true
			var version int
			err := h.DB.QueryRow(`SELECT COALESCE(version,1) FROM inventory_items
				WHERE id=? AND user_id=? AND is_available=1 AND COALESCE(deleted_at,'')=''`, id, userID).Scan(&version)
			if err != nil {
				return nil, fmt.Errorf("INVENTORY_CONFLICT")
			}
			lines = append(lines, map[string]any{"item_id": id, "version": version, "mode": "all"})
		}
		return lines, nil
	}
	recipeID := asInt(body["recipe_id"])
	if recipeID <= 0 {
		return nil, nil
	}
	servings := asFloat(body["servings"])
	if servings <= 0 {
		servings = 1
	}
	return h.consumptionsFromRecipe(userID, recipeID, servings)
}

func mapConsumptionLines(raw []any) []map[string]any {
	lines := make([]map[string]any, 0, len(raw))
	for _, item := range raw {
		m, _ := item.(map[string]any)
		if m == nil {
			continue
		}
		line := map[string]any{
			"item_id": asInt(m["item_id"]),
			"version": asInt(m["version"]),
			"mode":    strings.TrimSpace(asString(m["mode"])),
		}
		if line["mode"] == "" {
			line["mode"] = "all"
		}
		if av, ok := m["amount_value"]; ok && av != nil {
			line["amount_value"] = asFloat(av)
		}
		if u := strings.TrimSpace(asString(m["unit"])); u != "" {
			line["unit"] = u
		}
		lines = append(lines, line)
	}
	return lines
}

func (h *Handlers) consumptionsFromRecipe(userID, recipeID int, servings float64) ([]map[string]any, error) {
	if !h.hasColumn("recipes", "ingredients_json") {
		return nil, nil
	}
	var ingredientsRaw sql.NullString
	err := h.DB.QueryRow(`SELECT COALESCE(ingredients_json,'[]') FROM recipes WHERE id=?`, recipeID).Scan(&ingredientsRaw)
	if err != nil || !ingredientsRaw.Valid {
		return nil, nil
	}
	var ingredients []map[string]any
	if json.Unmarshal([]byte(ingredientsRaw.String), &ingredients) != nil {
		return nil, nil
	}
	requests := make([]map[string]any, 0, len(ingredients))
	for _, ing := range ingredients {
		name := strings.TrimSpace(asString(ing["food_name"]))
		if name == "" {
			name = strings.TrimSpace(asString(ing["name"]))
		}
		if name == "" {
			continue
		}
		amount := asFloat(ing["amount_value"])
		if amount <= 0 {
			amount = asFloat(ing["amount"])
		}
		if amount <= 0 {
			amount = 1
		}
		unit := strings.TrimSpace(asString(ing["unit"]))
		if unit == "" {
			unit = "g"
		}
		requests = append(requests, map[string]any{
			"food_name":    name,
			"amount_value": amount * servings,
			"unit":         unit,
		})
	}
	if len(requests) == 0 {
		return nil, nil
	}
	preview, err := h.inventorySvc().ConsumptionPreview(userID, map[string]any{"items": requests})
	if err != nil {
		return nil, err
	}
	rawItems, _ := preview["items"].([]any)
	lines := make([]map[string]any, 0)
	for _, raw := range rawItems {
		block, _ := raw.(map[string]any)
		if block == nil || !asBool(block["fully_covered"]) {
			continue
		}
		for _, d := range asSlice(block["deductions"]) {
			ded, _ := d.(map[string]any)
			if ded == nil {
				continue
			}
			line := map[string]any{
				"item_id": asInt(ded["item_id"]),
				"version": asInt(ded["version"]),
				"mode":    strings.TrimSpace(asString(ded["mode"])),
			}
			if line["mode"] == "" {
				line["mode"] = "all"
			}
			if mode := line["mode"]; mode == "amount" {
				line["amount_value"] = asFloat(ded["amount_value"])
				line["unit"] = strings.TrimSpace(asString(ded["unit"]))
			}
			lines = append(lines, line)
		}
	}
	return lines, nil
}

func (h *Handlers) buildEatenDietPayload(body, production map[string]any, foodName string, eaten float64) map[string]any {
	calories, protein, carbs, fat := nutritionFromPerServing(production["nutrition_per_serving"], eaten)
	if calories == nil && protein == nil && carbs == nil && fat == nil {
		recipeID := asInt(body["recipe_id"])
		rc, rp, rcarb, rf := h.loadRecipeNutrition(recipeID)
		calories, protein, carbs, fat = scaleNutrition(rc, eaten), scaleNutrition(rp, eaten), scaleNutrition(rcarb, eaten), scaleNutrition(rf, eaten)
	}
	payload := map[string]any{
		"meal_type": production["meal_type"], "food_name": foodName, "amount": fmt.Sprintf("%g份", eaten),
		"recorded_at": production["eaten_at"], "recorded_time": production["eaten_time"],
	}
	if calories != nil {
		payload["calories"] = *calories
	}
	if protein != nil {
		payload["protein"] = *protein
	}
	if carbs != nil {
		payload["carbs"] = *carbs
	}
	if fat != nil {
		payload["fat"] = *fat
	}
	return payload
}

func (h *Handlers) savePreparedProduction(userID int, key string, body, production map[string]any, consumedIDs []int, changes []any) (map[string]any, error) {
	foodName := strings.TrimSpace(asString(production["food_name"]))
	if foodName == "" {
		foodName = "自制餐食"
	}
	produced := asFloat(production["produced_servings"])
	if produced <= 0 {
		produced = 1
	}
	eaten := asFloat(production["eaten_servings"])
	remaining := produced - eaten
	if remaining < 0 {
		remaining = 0
	}
	mealID := newUUID()
	meal := map[string]any{
		"id": mealID, "food_name": foodName, "produced_servings": produced,
		"remaining_servings": remaining, "version": 1, "meal_type": asString(production["meal_type"]),
		"allocations": []any{},
	}

	tx, err := h.DB.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	var dietRecord map[string]any
	if eaten > 0 {
		payload := h.buildEatenDietPayload(body, production, foodName, eaten)
		dietRecord, err = h.insertDietRecordWith(tx, userID, payload, foodName)
		if err != nil {
			return nil, err
		}
	}
	response := map[string]any{
		"prepared_meal":                 meal,
		"diet_record":                   dietRecord,
		"consumed_inventory_item_ids":   consumedIDs,
		"inventory_consumption_changes": changes,
		"repeated":                      false,
	}
	raw, _ := json.Marshal(response)

	queueID := strings.TrimSpace(asString(production["queue_item_id"]))
	planItemID := strings.TrimSpace(asString(production["plan_item_id"]))
	recipeID := asInt(body["recipe_id"])

	if h.hasColumn("prepared_meals", "queue_item_id") {
		_, err = tx.Exec(`INSERT INTO prepared_meals
			(id, user_id, idempotency_key, recipe_id, food_name, produced_servings, remaining_servings, meal_type, queue_item_id, plan_item_id, version, result_json)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
			mealID, userID, key, nullRecipe(recipeID), foodName, produced, remaining,
			asString(production["meal_type"]), nullString(queueID), nullString(planItemID), string(raw))
	} else {
		_, err = tx.Exec(`INSERT INTO prepared_meals (id, user_id, idempotency_key, food_name, produced_servings, remaining_servings, version, result_json)
			VALUES (?, ?, ?, ?, ?, ?, 1, ?)`, mealID, userID, key, foodName, produced, remaining, string(raw))
	}
	if err != nil {
		return nil, err
	}

	var dietID any
	if dietRecord != nil {
		dietID = dietRecord["id"]
	}
	if err := h.insertCookingCompletionTx(tx, userID, key, recipeID, dietID, consumedIDs, string(raw)); err != nil {
		return nil, err
	}

	if queueID != "" {
		_, _ = tx.Exec(`UPDATE cooking_queue_items SET status='completed', version=version+1, updated_at=? WHERE id=? AND user_id=?`,
			nowRFC3339(), queueID, userID)
	}
	if planItemID != "" {
		_, _ = tx.Exec(`UPDATE meal_plan_items SET status='completed', version=version+1, completed_at=?, updated_at=?
			WHERE id=? AND user_id=?`, nowRFC3339(), nowRFC3339(), planItemID, userID)
	} else if queueID != "" {
		_, _ = tx.Exec(`UPDATE meal_plan_items SET status='completed', version=version+1, completed_at=?, updated_at=?
			WHERE user_id=? AND queue_item_id=?`, nowRFC3339(), nowRFC3339(), userID, queueID)
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return response, nil
}

func nullString(v string) any {
	if v == "" {
		return nil
	}
	return v
}
