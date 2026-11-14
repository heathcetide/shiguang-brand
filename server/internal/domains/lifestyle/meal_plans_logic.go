// Copyright (c) 2026 heathcetide. All rights reserved.

package lifestyle

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/heathcetide/DietDigiDose/internal/httpx"
)

type planRow struct {
	ID             string
	Title          string
	Status         string
	Version        int
	Constraints    map[string]any
	DraftJSON      map[string]any
	StartDate      string
	EndDate        string
	ConstraintsRaw string
}

type mealPlanItemRow struct {
	ID           string
	PlanID       string
	UserID       int
	Status       string
	Version      int
	Title        string
	MealType     string
	PlannedDate  string
	RecipeID     sql.NullInt64
	Ingredients  string
	QueueItemID  sql.NullString
	PayloadJSON  string
	ConfirmedAt  sql.NullString
	DietRecordID sql.NullInt64
}

func mealTypeLabel(v string) string {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "breakfast":
		return "早餐"
	case "lunch":
		return "午餐"
	case "dinner":
		return "晚餐"
	case "snack":
		return "加餐"
	default:
		return v
	}
}

func (h *Handlers) loadPlan(userID int, planID string) (*planRow, error) {
	cols := "id, COALESCE(title,''), COALESCE(status,'draft'), COALESCE(version,1), COALESCE(constraints_json,'{}'), COALESCE(draft_json,'{}')"
	if h.hasColumn("meal_plans", "start_date") {
		cols += ", COALESCE(start_date,''), COALESCE(end_date,'')"
	} else {
		cols += ", '', ''"
	}
	q := `SELECT ` + cols + ` FROM meal_plans WHERE id=? AND user_id=? AND ` + coalesceDeletedFilter("meal_plans")
	var id any
	var title, status, constraintsRaw, draftRaw, start, end string
	var version int
	err := h.DB.QueryRow(q, planID, userID).Scan(&id, &title, &status, &version, &constraintsRaw, &draftRaw, &start, &end)
	if err != nil {
		return nil, err
	}
	plan := &planRow{
		ID:             fmt.Sprint(id),
		Title:          title,
		Status:         status,
		Version:        version,
		Constraints:    parseJSONObject(sql.NullString{String: constraintsRaw, Valid: true}),
		DraftJSON:      parseJSONObject(sql.NullString{String: draftRaw, Valid: true}),
		StartDate:      start,
		EndDate:        end,
		ConstraintsRaw: constraintsRaw,
	}
	return plan, nil
}

func coalesceDeletedFilter(table string) string {
	return `COALESCE(deleted_at,'')=''`
}

func (h *Handlers) countPlanItems(userID int, planID string) (int, error) {
	var n int
	err := h.DB.QueryRow(`SELECT COUNT(*) FROM meal_plan_items WHERE plan_id=? AND user_id=? AND `+coalesceDeletedFilter("meal_plan_items"), planID, userID).Scan(&n)
	return n, err
}

func (h *Handlers) listPlanItems(userID int, planID string) ([]map[string]any, error) {
	hasTitle := h.hasColumn("meal_plan_items", "title")
	q := `SELECT id, COALESCE(status,'planned'), COALESCE(version,1), COALESCE(payload_json,'{}')`
	if hasTitle {
		q += `, COALESCE(title,''), COALESCE(meal_type,''), COALESCE(planned_date,''),
			recipe_id, COALESCE(ingredients_json,'[]'), queue_item_id, confirmed_at`
	}
	q += ` FROM meal_plan_items WHERE plan_id=? AND user_id=? AND ` + coalesceDeletedFilter("meal_plan_items") + ` ORDER BY id`
	rows, err := h.DB.Query(q, planID, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := make([]map[string]any, 0)
	for rows.Next() {
		var id, status, payloadRaw string
		var version int
		var title, mealType, plannedDate string
		var recipeID sql.NullInt64
		var ingredients, queueID, confirmed sql.NullString
		var scanErr error
		if hasTitle {
			scanErr = rows.Scan(&id, &status, &version, &payloadRaw, &title, &mealType, &plannedDate,
				&recipeID, &ingredients, &queueID, &confirmed)
		} else {
			scanErr = rows.Scan(&id, &status, &version, &payloadRaw)
		}
		if scanErr != nil {
			continue
		}
		item := map[string]any{"id": id, "plan_id": planID, "status": status, "version": version}
		var payload map[string]any
		if json.Unmarshal([]byte(payloadRaw), &payload) == nil && payload != nil {
			item = mergeMaps(item, payload)
		}
		if hasTitle {
			if title != "" {
				item["title"] = title
			}
			if mealType != "" {
				item["meal_type"] = mealType
			}
			if plannedDate != "" {
				item["planned_date"] = plannedDate
			}
			if recipeID.Valid {
				item["recipe_id"] = recipeID.Int64
			}
			if ingredients.Valid && ingredients.String != "" {
				var ing any
				if json.Unmarshal([]byte(ingredients.String), &ing) == nil {
					item["ingredients"] = ing
				}
			}
			if queueID.Valid && queueID.String != "" {
				item["queue_item_id"] = queueID.String
			}
			if confirmed.Valid && confirmed.String != "" {
				item["confirmed_at"] = confirmed.String
			}
		}
		list = append(list, item)
	}
	return list, nil
}

func (h *Handlers) formatPlanResponse(userID int, plan *planRow) (map[string]any, error) {
	items, err := h.listPlanItems(userID, plan.ID)
	if err != nil {
		return nil, err
	}
	out := map[string]any{
		"id":      plan.ID,
		"title":   plan.Title,
		"status":  plan.Status,
		"version": plan.Version,
		"items":   items,
	}
	if plan.StartDate != "" {
		out["start_date"] = plan.StartDate
	}
	if plan.EndDate != "" {
		out["end_date"] = plan.EndDate
	}
	if len(plan.Constraints) > 0 {
		out["constraints"] = plan.Constraints
	}
	return out, nil
}

func (h *Handlers) respondMealPlan(c *gin.Context, userID int, planID string) {
	plan, err := h.loadPlan(userID, planID)
	if err != nil {
		httpx.SendError(c, http.StatusNotFound, "餐计划不存在", "MEAL_PLAN_NOT_FOUND")
		return
	}
	out, err := h.formatPlanResponse(userID, plan)
	if err != nil {
		httpx.SendError(c, http.StatusInternalServerError, "读取餐计划失败", "MEAL_PLAN_FAILED")
		return
	}
	c.JSON(http.StatusOK, out)
}

func draftCookingRoot(plan *planRow) map[string]any {
	if v, ok := plan.Constraints["currentCookingDraft"].(map[string]any); ok {
		return v
	}
	if saved, ok := plan.Constraints["savedCookingDraft"].(map[string]any); ok {
		if d, ok := saved["draft"].(map[string]any); ok {
			return d
		}
	}
	if len(plan.DraftJSON) > 0 {
		if d, ok := plan.DraftJSON["draft"].(map[string]any); ok {
			return d
		}
		// SaveMealPlanDraft may persist the whole request body, with nested draft_json.
		if d, ok := plan.DraftJSON["draft_json"].(map[string]any); ok {
			return d
		}
		return plan.DraftJSON
	}
	return nil
}

type draftMaterializedItem struct {
	ID          string
	RecipeID    int
	Title       string
	Date        string
	MealType    string
	Ingredients string
}

func (h *Handlers) materializeItemsFromDraft(plan *planRow) ([]draftMaterializedItem, bool) {
	root := draftCookingRoot(plan)
	if root == nil {
		return nil, false
	}
	if unresolved, ok := root["unresolved"].([]any); ok && len(unresolved) > 0 {
		return nil, false
	}
	if rawItems, ok := root["items"].([]any); ok && len(rawItems) > 0 {
		out := make([]draftMaterializedItem, 0, len(rawItems))
		for _, raw := range rawItems {
			m, _ := raw.(map[string]any)
			if m == nil {
				continue
			}
			id := strings.TrimSpace(asString(m["id"]))
			if id == "" {
				id = newUUID()
			}
			ing, _ := json.Marshal(m["ingredients"])
			out = append(out, draftMaterializedItem{
				ID: id, RecipeID: asInt(m["recipeId"]), Title: asString(m["title"]),
				Date: asString(m["date"]), MealType: mealTypeLabel(asString(m["mealType"])),
				Ingredients: string(ing),
			})
		}
		return out, len(out) > 0
	}
	mealsByID := map[string]map[string]any{}
	for _, raw := range asSlice(root["meals"]) {
		m, _ := raw.(map[string]any)
		if m == nil {
			continue
		}
		mealsByID[asString(m["id"])] = m
	}
	units := map[string]string{"piece": "个", "serving": "份", "bag": "袋", "box": "盒", "bottle": "瓶", "can": "罐"}
	out := make([]draftMaterializedItem, 0)
	for _, raw := range asSlice(root["cooking"]) {
		cooking, _ := raw.(map[string]any)
		if cooking == nil {
			continue
		}
		target := mealsByID[asString(cooking["targetMealId"])]
		if target == nil {
			// Allow cooking entries that themselves carry date/mealType (simplified drafts).
			if asString(cooking["date"]) == "" && asString(cooking["mealType"]) == "" {
				continue
			}
			target = cooking
		}
		ingredients := make([]map[string]any, 0)
		for _, d := range asSlice(cooking["demands"]) {
			demand, _ := d.(map[string]any)
			if demand == nil {
				continue
			}
			unit := asString(demand["unit"])
			label := units[unit]
			if label == "" {
				label = unit
			}
			amount := asFloat(demand["amount_value"])
			ingredients = append(ingredients, map[string]any{
				"name":   asString(demand["food_name"]),
				"amount": fmt.Sprintf("%g%s", amount, label),
			})
		}
		for _, d := range asSlice(cooking["ingredients"]) {
			switch demand := d.(type) {
			case string:
				if strings.TrimSpace(demand) != "" {
					ingredients = append(ingredients, map[string]any{"name": demand, "amount": ""})
				}
			case map[string]any:
				name := asString(demand["name"])
				if name == "" {
					name = asString(demand["food_name"])
				}
				if name != "" {
					ingredients = append(ingredients, map[string]any{"name": name, "amount": asString(demand["amount"])})
				}
			}
		}
		ingJSON, _ := json.Marshal(ingredients)
		out = append(out, draftMaterializedItem{
			ID: newUUID(), RecipeID: asInt(cooking["recipeId"]), Title: asString(cooking["title"]),
			Date: asString(target["date"]), MealType: mealTypeLabel(asString(target["mealType"])),
			Ingredients: string(ingJSON),
		})
	}
	// Simplified draft: meals[] already include recipeId/title (no separate cooking[]).
	if len(out) == 0 {
		for _, raw := range asSlice(root["meals"]) {
			m, _ := raw.(map[string]any)
			if m == nil {
				continue
			}
			recipeID := asInt(m["recipeId"])
			title := asString(m["title"])
			if recipeID <= 0 && title == "" {
				continue
			}
			ing, _ := json.Marshal(m["ingredients"])
			out = append(out, draftMaterializedItem{
				ID: newUUID(), RecipeID: recipeID, Title: title,
				Date: asString(m["date"]), MealType: mealTypeLabel(asString(m["mealType"])),
				Ingredients: string(ing),
			})
		}
	}
	return out, len(out) > 0
}

func asSlice(v any) []any {
	s, _ := v.([]any)
	return s
}

func (h *Handlers) insertMaterializedItem(userID int, planID string, item draftMaterializedItem) error {
	confirmed := nowRFC3339()
	if h.hasColumn("meal_plan_items", "planned_date") {
		cols := `id, plan_id, user_id, planned_date, meal_type, title, recipe_id, ingredients_json, status, version, confirmed_at`
		_, err := h.DB.Exec(`INSERT INTO meal_plan_items (`+cols+`) VALUES (?,?,?,?,?,?,?,?,'planned',1,?)`,
			item.ID, planID, userID, item.Date, item.MealType, item.Title, nullRecipe(item.RecipeID), item.Ingredients, confirmed)
		return err
	}
	payload, _ := json.Marshal(map[string]any{
		"title": item.Title, "meal_type": item.MealType, "planned_date": item.Date,
		"recipe_id": item.RecipeID, "ingredients": json.RawMessage(item.Ingredients),
	})
	_, err := h.DB.Exec(`INSERT INTO meal_plan_items (id, plan_id, user_id, payload_json, status, version) VALUES (?,?,?,?, 'planned', 1)`,
		item.ID, planID, userID, string(payload))
	return err
}

func nullRecipe(id int) any {
	if id <= 0 {
		return nil
	}
	return id
}

func (h *Handlers) loadPlanItem(userID int, planID, itemID string) (*mealPlanItemRow, error) {
	if h.hasColumn("meal_plan_items", "title") {
		var row mealPlanItemRow
		q := `SELECT id, plan_id, user_id, COALESCE(status,'planned'), COALESCE(version,1),
			COALESCE(title,''), COALESCE(meal_type,''), COALESCE(planned_date,''), recipe_id,
			COALESCE(ingredients_json,'[]'), queue_item_id, COALESCE(payload_json,'{}'), confirmed_at`
		if h.hasColumn("meal_plan_items", "diet_record_id") {
			q += `, diet_record_id FROM meal_plan_items WHERE id=? AND plan_id=? AND user_id=? AND ` + coalesceDeletedFilter("meal_plan_items")
			err := h.DB.QueryRow(q, itemID, planID, userID).Scan(&row.ID, &row.PlanID, &row.UserID, &row.Status, &row.Version, &row.Title, &row.MealType,
				&row.PlannedDate, &row.RecipeID, &row.Ingredients, &row.QueueItemID, &row.PayloadJSON, &row.ConfirmedAt, &row.DietRecordID)
			if err != nil {
				return nil, err
			}
			return &row, nil
		}
		q += ` FROM meal_plan_items WHERE id=? AND plan_id=? AND user_id=? AND ` + coalesceDeletedFilter("meal_plan_items")
		err := h.DB.QueryRow(q, itemID, planID, userID).Scan(&row.ID, &row.PlanID, &row.UserID, &row.Status, &row.Version, &row.Title, &row.MealType,
			&row.PlannedDate, &row.RecipeID, &row.Ingredients, &row.QueueItemID, &row.PayloadJSON, &row.ConfirmedAt)
		if err != nil {
			return nil, err
		}
		return &row, nil
	}
	var status, payload string
	var version int
	err := h.DB.QueryRow(`SELECT COALESCE(status,'planned'), COALESCE(version,1), COALESCE(payload_json,'{}')
		FROM meal_plan_items WHERE id=? AND plan_id=? AND user_id=? AND `+coalesceDeletedFilter("meal_plan_items"),
		itemID, planID, userID).Scan(&status, &version, &payload)
	if err != nil {
		return nil, err
	}
	row := &mealPlanItemRow{ID: itemID, PlanID: planID, UserID: userID, Status: status, Version: version, PayloadJSON: payload, Ingredients: "[]"}
	var payloadMap map[string]any
	if json.Unmarshal([]byte(payload), &payloadMap) == nil {
		row.Title = asString(payloadMap["title"])
		row.MealType = asString(payloadMap["meal_type"])
		row.PlannedDate = asString(payloadMap["planned_date"])
		if rid := asInt(payloadMap["recipe_id"]); rid > 0 {
			row.RecipeID = sql.NullInt64{Int64: int64(rid), Valid: true}
		}
		if ing, ok := payloadMap["ingredients"]; ok {
			raw, _ := json.Marshal(ing)
			row.Ingredients = string(raw)
		}
	}
	return row, nil
}

func (h *Handlers) formatItemRow(row *mealPlanItemRow) map[string]any {
	item := map[string]any{"id": row.ID, "plan_id": row.PlanID, "status": row.Status, "version": row.Version}
	if row.Title != "" {
		item["title"] = row.Title
	}
	if row.MealType != "" {
		item["meal_type"] = row.MealType
	}
	if row.PlannedDate != "" {
		item["planned_date"] = row.PlannedDate
	}
	if row.RecipeID.Valid {
		item["recipe_id"] = row.RecipeID.Int64
	}
	if row.Ingredients != "" && row.Ingredients != "[]" {
		var ing any
		if json.Unmarshal([]byte(row.Ingredients), &ing) == nil {
			item["ingredients"] = ing
		}
	}
	if row.QueueItemID.Valid && row.QueueItemID.String != "" {
		item["queue_item_id"] = row.QueueItemID.String
	}
	if row.ConfirmedAt.Valid && row.ConfirmedAt.String != "" {
		item["confirmed_at"] = row.ConfirmedAt.String
	}
	return item
}

func (h *Handlers) mealExecutionRepeated(userID int, key, action, itemID string) (map[string]any, error) {
	if key == "" || !hasTable(h.DB, "meal_plan_execution_requests") {
		return nil, nil
	}
	var act, savedItem, resultRaw string
	err := h.DB.QueryRow(`SELECT action, meal_plan_item_id, result_json FROM meal_plan_execution_requests
		WHERE user_id=? AND idempotency_key=?`, userID, key).Scan(&act, &savedItem, &resultRaw)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if act != action || savedItem != itemID {
		return nil, fmt.Errorf("MEAL_PLAN_KEY_CONFLICT")
	}
	var parsed map[string]any
	if json.Unmarshal([]byte(resultRaw), &parsed) != nil {
		return nil, nil
	}
	parsed["repeated"] = true
	return parsed, nil
}

func (h *Handlers) saveMealExecution(userID int, key, action, itemID string, result map[string]any) {
	if key == "" || !hasTable(h.DB, "meal_plan_execution_requests") {
		return
	}
	raw := marshalJSON(result)
	_, _ = h.DB.Exec(`INSERT INTO meal_plan_execution_requests
		(user_id, idempotency_key, action, meal_plan_item_id, result_json) VALUES (?,?,?,?,?) ON CONFLICT DO NOTHING`,
		userID, key, action, itemID, raw)
}

func ingredientList(row *mealPlanItemRow) []map[string]any {
	list := make([]map[string]any, 0)
	if row.Ingredients != "" {
		var parsed []map[string]any
		if json.Unmarshal([]byte(row.Ingredients), &parsed) == nil {
			return parsed
		}
	}
	var payload map[string]any
	if json.Unmarshal([]byte(row.PayloadJSON), &payload) == nil {
		if raw, ok := payload["ingredients"].([]any); ok {
			for _, item := range raw {
				if m, ok := item.(map[string]any); ok {
					list = append(list, m)
				}
			}
		}
	}
	return list
}

func (h *Handlers) queueMealType(mealType string) string {
	mt := strings.TrimSpace(mealType)
	if mt == "" {
		return ""
	}
	return mt
}

func (h *Handlers) activeQueueCount(userID int) (int, error) {
	var n int
	q := `SELECT COUNT(*) FROM cooking_queue_items WHERE user_id=? AND COALESCE(status,'') IN ('waiting','preparing','ready','cooking','queued')`
	if h.hasColumn("cooking_queue_items", "deleted_at") {
		q += ` AND COALESCE(deleted_at,'')=''`
	}
	err := h.DB.QueryRow(q, userID).Scan(&n)
	return n, err
}

func (h *Handlers) nextQueuePosition(userID int) int {
	var pos int
	_ = h.DB.QueryRow(`SELECT COALESCE(MAX(position), -1) + 1 FROM cooking_queue_items WHERE user_id=?`, userID).Scan(&pos)
	return pos
}

func (h *Handlers) ensureExecutionTable() {

}
