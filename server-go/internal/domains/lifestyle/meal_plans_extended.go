// Copyright (c) 2026 heathcetide. All rights reserved.

package lifestyle

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/heathcetide/DietDigiDose/internal/expressauth"
	"github.com/heathcetide/DietDigiDose/internal/httpx"
)

func (h *Handlers) resolvePlanID(c *gin.Context, userID int) (string, bool) {
	raw := strings.TrimSpace(c.Param("id"))
	if raw == "" {
		return "", false
	}
	var title string
	var payload sql.NullString
	err := h.DB.QueryRow(`SELECT title, COALESCE(payload_json,'') FROM meal_plans WHERE id=? AND user_id=?`, raw, userID).Scan(&title, &payload)
	if err == nil {
		return raw, true
	}
	if num, convErr := strconv.Atoi(raw); convErr == nil {
		err = h.DB.QueryRow(`SELECT title, COALESCE(payload_json,'') FROM meal_plans WHERE id=? AND user_id=?`, num, userID).Scan(&title, &payload)
		if err == nil {
			return strconv.Itoa(num), true
		}
	}
	return "", false
}

func (h *Handlers) PatchMealPlan(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	planID, ok := h.resolvePlanID(c, userID)
	if !ok {
		httpx.SendError(c, http.StatusNotFound, "餐计划不存在", "MEAL_PLAN_NOT_FOUND")
		return
	}
	var body map[string]any
	if err := c.ShouldBindJSON(&body); err != nil {
		httpx.SendError(c, http.StatusBadRequest, "请求参数无效", "INVALID_BODY")
		return
	}
	title := strings.TrimSpace(asString(body["title"]))
	if title != "" {
		_, _ = h.DB.Exec(`UPDATE meal_plans SET title=?, updated_at=? WHERE id=? AND user_id=?`, title, nowRFC3339(), planID, userID)
	}
	if status := strings.TrimSpace(asString(body["status"])); status != "" {
		_, _ = h.DB.Exec(`UPDATE meal_plans SET status=?, updated_at=? WHERE id=? AND user_id=?`, status, nowRFC3339(), planID, userID)
	}
	h.GetMealPlan(c)
}

func (h *Handlers) ActivateMealPlan(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	planID, ok := h.resolvePlanID(c, userID)
	if !ok {
		httpx.SendError(c, http.StatusNotFound, "餐计划不存在", "MEAL_PLAN_NOT_FOUND")
		return
	}
	var body map[string]any
	if err := c.ShouldBindJSON(&body); err != nil {
		httpx.SendError(c, http.StatusBadRequest, "请求参数无效", "INVALID_BODY")
		return
	}
	expected := versionFromBody(body)
	if expected <= 0 {
		httpx.SendError(c, http.StatusBadRequest, "请求参数无效", "INVALID_BODY")
		return
	}
	plan, err := h.loadPlan(userID, planID)
	if err != nil {
		httpx.SendError(c, http.StatusNotFound, "餐计划不存在", "MEAL_PLAN_NOT_FOUND")
		return
	}
	if from, ok := plan.Constraints["activatedFromVersion"]; ok && asInt(from) == expected {
		out, err := h.formatPlanResponse(userID, plan)
		if err != nil {
			httpx.SendError(c, http.StatusInternalServerError, "读取餐计划失败", "MEAL_PLAN_FAILED")
			return
		}
		c.JSON(http.StatusOK, gin.H{"plan": out, "repeated": true})
		return
	}
	if plan.Status != "draft" || plan.Version != expected {
		httpx.SendError(c, http.StatusConflict, "草案有未解决餐次、版本变化，或菜谱用量与审核已改变，请重新生成并核对", "MEAL_PLAN_ACTIVATION_CONFLICT")
		return
	}
	itemCount, _ := h.countPlanItems(userID, planID)
	if itemCount > 0 {
		httpx.SendError(c, http.StatusConflict, "草案有未解决餐次、版本变化，或菜谱用量与审核已改变，请重新生成并核对", "MEAL_PLAN_ACTIVATION_CONFLICT")
		return
	}
	draftItems, okDraft := h.materializeItemsFromDraft(plan)
	if !okDraft || len(draftItems) == 0 {
		httpx.SendError(c, http.StatusConflict, "草案有未解决餐次、版本变化，或菜谱用量与审核已改变，请重新生成并核对", "MEAL_PLAN_ACTIVATION_CONFLICT")
		return
	}
	for _, item := range draftItems {
		if err := h.insertMaterializedItem(userID, planID, item); err != nil {
			httpx.SendError(c, http.StatusInternalServerError, "激活餐计划失败", "MEAL_PLAN_FAILED")
			return
		}
	}
	plan.Constraints["activatedFromVersion"] = expected
	constraintsRaw := marshalJSON(plan.Constraints)
	res, err := h.DB.Exec(`UPDATE meal_plans SET status='active', version=version+1, constraints_json=?, updated_at=?
		WHERE id=? AND user_id=? AND version=?`, constraintsRaw, nowRFC3339(), planID, userID, expected)
	if err != nil {
		httpx.SendError(c, http.StatusInternalServerError, "激活餐计划失败", "MEAL_PLAN_FAILED")
		return
	}
	if n, _ := res.RowsAffected(); n != 1 {
		httpx.SendError(c, http.StatusConflict, "草案有未解决餐次、版本变化，或菜谱用量与审核已改变，请重新生成并核对", "MEAL_PLAN_ACTIVATION_CONFLICT")
		return
	}
	plan, _ = h.loadPlan(userID, planID)
	out, err := h.formatPlanResponse(userID, plan)
	if err != nil {
		httpx.SendError(c, http.StatusInternalServerError, "读取餐计划失败", "MEAL_PLAN_FAILED")
		return
	}
	c.JSON(http.StatusOK, gin.H{"plan": out, "repeated": false})
}

func (h *Handlers) ListMealPlanChanges(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	planID, ok := h.resolvePlanID(c, userID)
	if !ok {
		httpx.SendError(c, http.StatusNotFound, "餐计划不存在", "MEAL_PLAN_NOT_FOUND")
		return
	}
	rows, err := h.DB.Query(`SELECT id, item_id, status, COALESCE(body_json,'{}'), COALESCE(created_at,'')
		FROM meal_plan_changes WHERE user_id=? AND plan_id=? ORDER BY created_at DESC LIMIT 100`, userID, planID)
	if err != nil {
		c.JSON(http.StatusOK, []any{})
		return
	}
	defer rows.Close()
	list := make([]map[string]any, 0)
	for rows.Next() {
		var id, itemID, status, bodyRaw, created string
		if rows.Scan(&id, &itemID, &status, &bodyRaw, &created) == nil {
			item := map[string]any{"id": id, "item_id": itemID, "status": status, "created_at": created}
			var body map[string]any
			if json.Unmarshal([]byte(bodyRaw), &body) == nil {
				item = mergeMaps(item, body)
			}
			list = append(list, item)
		}
	}
	c.JSON(http.StatusOK, list)
}

func (h *Handlers) ReviewMealPlanChange(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	planID, ok := h.resolvePlanID(c, userID)
	if !ok {
		httpx.SendError(c, http.StatusNotFound, "餐计划不存在", "MEAL_PLAN_NOT_FOUND")
		return
	}
	changeID := strings.TrimSpace(c.Param("changeId"))
	var body map[string]any
	if err := c.ShouldBindJSON(&body); err != nil {
		httpx.SendError(c, http.StatusBadRequest, "请求参数无效", "INVALID_BODY")
		return
	}
	action := strings.TrimSpace(asString(body["action"]))
	if action == "" {
		action = "accept"
	}
	var itemID, status, bodyRaw string
	err := h.DB.QueryRow(`SELECT item_id, status, COALESCE(body_json,'{}') FROM meal_plan_changes
		WHERE id=? AND user_id=? AND plan_id=?`, changeID, userID, planID).Scan(&itemID, &status, &bodyRaw)
	if err != nil {
		httpx.SendError(c, http.StatusNotFound, "变更不存在", "MEAL_PLAN_CHANGE_NOT_FOUND")
		return
	}
	nextStatus := status
	switch action {
	case "accept":
		nextStatus = "applied"
	case "reject":
		nextStatus = "rejected"
	case "restore":
		nextStatus = "pending"
	}
	if action == "accept" && status == "pending" && itemID != "" {
		patch := changePatchJSON(bodyRaw, body)
		if len(patch) > 0 {
			_ = h.patchMealPlanItemFields(userID, planID, itemID, patch)
		}
	}
	appliedAt := ""
	if nextStatus == "applied" {
		appliedAt = nowRFC3339()
	}
	_, _ = h.DB.Exec(`UPDATE meal_plan_changes SET status=?, applied_at=? WHERE id=? AND user_id=? AND plan_id=?`,
		nextStatus, nullString(appliedAt), changeID, userID, planID)
	out := map[string]any{"id": changeID, "plan_id": planID, "item_id": itemID, "status": nextStatus, "action": action}
	var extra map[string]any
	if json.Unmarshal([]byte(bodyRaw), &extra) == nil {
		out = mergeMaps(out, extra)
	}
	if itemID != "" {
		if row, err := h.loadPlanItem(userID, planID, itemID); err == nil {
			out["item"] = h.formatItemRow(row)
		}
	}
	c.JSON(http.StatusOK, out)
}

func changePatchJSON(saved string, body map[string]any) map[string]any {
	patch := map[string]any{}
	var savedMap map[string]any
	if json.Unmarshal([]byte(saved), &savedMap) == nil {
		if after, ok := savedMap["after_json"].(map[string]any); ok {
			patch = mergeMaps(patch, after)
		}
		if proposal, ok := savedMap["proposal"].(map[string]any); ok {
			patch = mergeMaps(patch, proposal)
		}
	}
	for _, key := range []string{"title", "meal_type", "planned_date", "recipe_id", "status", "ingredients"} {
		if v, ok := body[key]; ok && v != nil {
			patch[key] = v
		}
	}
	if patchJSON, ok := body["patch"].(map[string]any); ok {
		patch = mergeMaps(patch, patchJSON)
	}
	return patch
}

func (h *Handlers) patchMealPlanItemFields(userID int, planID, itemID string, patch map[string]any) error {
	row, err := h.loadPlanItem(userID, planID, itemID)
	if err != nil {
		return err
	}
	if h.hasColumn("meal_plan_items", "title") {
		title := asString(patch["title"])
		if title == "" {
			title = row.Title
		}
		mealType := asString(patch["meal_type"])
		if mealType == "" {
			mealType = row.MealType
		}
		plannedDate := asString(patch["planned_date"])
		if plannedDate == "" {
			plannedDate = row.PlannedDate
		}
		ingredients := row.Ingredients
		if raw, ok := patch["ingredients"]; ok {
			ingredients = marshalJSON(raw)
		}
		recipeID := row.RecipeID
		if v, ok := patch["recipe_id"]; ok {
			rid := asInt(v)
			if rid > 0 {
				recipeID = sql.NullInt64{Int64: int64(rid), Valid: true}
			}
		}
		status := row.Status
		if s := strings.TrimSpace(asString(patch["status"])); s != "" {
			status = s
		}
		rid := any(nil)
		if recipeID.Valid {
			rid = recipeID.Int64
		}
		_, err = h.DB.Exec(`UPDATE meal_plan_items SET title=?, meal_type=?, planned_date=?, recipe_id=?, ingredients_json=?, status=?, version=version+1, updated_at=?
			WHERE id=? AND user_id=? AND plan_id=?`, title, mealType, plannedDate, rid, ingredients, status, nowRFC3339(), itemID, userID, planID)
		return err
	}
	payload := map[string]any{}
	_ = json.Unmarshal([]byte(row.PayloadJSON), &payload)
	payload = mergeMaps(payload, patch)
	_, err = h.DB.Exec(`UPDATE meal_plan_items SET payload_json=?, version=version+1, updated_at=? WHERE id=? AND user_id=? AND plan_id=?`,
		marshalJSON(payload), nowRFC3339(), itemID, userID, planID)
	return err
}

func (h *Handlers) PatchMealPlanDraft(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	planID, ok := h.resolvePlanID(c, userID)
	if !ok {
		httpx.SendError(c, http.StatusNotFound, "餐计划不存在", "MEAL_PLAN_NOT_FOUND")
		return
	}
	var body map[string]any
	if err := c.ShouldBindJSON(&body); err != nil {
		httpx.SendError(c, http.StatusBadRequest, "请求参数无效", "INVALID_BODY")
		return
	}
	raw := marshalJSON(body)
	_, _ = h.DB.Exec(`UPDATE meal_plans SET draft_json=?, constraints_json=?, updated_at=? WHERE id=? AND user_id=?`,
		raw, raw, nowRFC3339(), planID, userID)
	c.JSON(http.StatusOK, gin.H{"id": planID, "draft": body})
}

func (h *Handlers) PatchMealPlanItem(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	planID, ok := h.resolvePlanID(c, userID)
	if !ok {
		httpx.SendError(c, http.StatusNotFound, "餐计划不存在", "MEAL_PLAN_NOT_FOUND")
		return
	}
	itemID := strings.TrimSpace(c.Param("itemId"))
	var body map[string]any
	if err := c.ShouldBindJSON(&body); err != nil {
		httpx.SendError(c, http.StatusBadRequest, "请求参数无效", "INVALID_BODY")
		return
	}
	raw := marshalJSON(body)
	var exists int
	_ = h.DB.QueryRow(`SELECT COUNT(*) FROM meal_plan_items WHERE id=? AND user_id=? AND plan_id=?`, itemID, userID, planID).Scan(&exists)
	if exists == 0 {
		_, _ = h.DB.Exec(`INSERT INTO meal_plan_items (id, plan_id, user_id, payload_json, status, version) VALUES (?, ?, ?, ?, 'planned', 1)`,
			itemID, planID, userID, raw)
	} else {
		_, _ = h.DB.Exec(`UPDATE meal_plan_items SET payload_json=?, version=version+1, updated_at=? WHERE id=? AND user_id=? AND plan_id=?`,
			raw, nowRFC3339(), itemID, userID, planID)
	}
	c.JSON(http.StatusOK, mergeMaps(map[string]any{"id": itemID, "plan_id": planID}, body))
}

func (h *Handlers) MealPlanItemChangePreview(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	planID, ok := h.resolvePlanID(c, userID)
	if !ok {
		httpx.SendError(c, http.StatusNotFound, "餐计划不存在", "MEAL_PLAN_NOT_FOUND")
		return
	}
	itemID := strings.TrimSpace(c.Param("itemId"))
	var body map[string]any
	if err := c.ShouldBindJSON(&body); err != nil {
		httpx.SendError(c, http.StatusBadRequest, "请求参数无效", "INVALID_BODY")
		return
	}
	row, err := h.loadPlanItem(userID, planID, itemID)
	if err != nil {
		httpx.SendError(c, http.StatusNotFound, "餐次不存在", "MEAL_PLAN_ITEM_NOT_FOUND")
		return
	}
	expected := versionFromBody(body)
	if expected > 0 && expected != row.Version {
		httpx.SendError(c, http.StatusConflict, "餐次已变化，请刷新后重试", "MEAL_PLAN_VERSION_CONFLICT")
		return
	}
	current := h.formatItemRow(row)
	proposed := mergeMaps(map[string]any{}, current)
	if patch := changePatchJSON("{}", body); len(patch) > 0 {
		proposed = mergeMaps(proposed, patch)
	}
	preview := map[string]any{
		"item_id":     itemID,
		"plan_id":     planID,
		"version":     row.Version,
		"current":     current,
		"proposed":    proposed,
		"fingerprint": marshalJSON(proposed),
	}
	c.JSON(http.StatusOK, preview)
}

func (h *Handlers) MealPlanItemConfirm(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	planID, ok := h.resolvePlanID(c, userID)
	if !ok {
		httpx.SendError(c, http.StatusNotFound, "餐计划不存在", "MEAL_PLAN_NOT_FOUND")
		return
	}
	itemID := strings.TrimSpace(c.Param("itemId"))
	var body map[string]any
	if err := c.ShouldBindJSON(&body); err != nil {
		httpx.SendError(c, http.StatusBadRequest, "请求参数无效", "INVALID_BODY")
		return
	}
	row, err := h.loadPlanItem(userID, planID, itemID)
	if err != nil {
		httpx.SendError(c, http.StatusNotFound, "餐次不存在", "MEAL_PLAN_ITEM_NOT_FOUND")
		return
	}
	expected := versionFromBody(body)
	if expected > 0 && expected != row.Version {
		httpx.SendError(c, http.StatusConflict, "餐次已变化，请刷新后重试", "MEAL_PLAN_VERSION_CONFLICT")
		return
	}
	if h.hasColumn("meal_plan_items", "confirmed_at") {
		_, _ = h.DB.Exec(`UPDATE meal_plan_items SET confirmed_at=?, version=version+1, updated_at=? WHERE id=? AND user_id=?`,
			nowRFC3339(), nowRFC3339(), itemID, userID)
	} else {
		_, _ = h.DB.Exec(`UPDATE meal_plan_items SET status='planned', version=version+1, updated_at=? WHERE id=? AND user_id=? AND plan_id=?`,
			nowRFC3339(), itemID, userID, planID)
	}
	row, _ = h.loadPlanItem(userID, planID, itemID)
	c.JSON(http.StatusOK, h.formatItemRow(row))
}

func (h *Handlers) MealPlanItemComplete(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	planID, ok := h.resolvePlanID(c, userID)
	if !ok {
		httpx.SendError(c, http.StatusNotFound, "餐计划不存在", "MEAL_PLAN_NOT_FOUND")
		return
	}
	itemID := strings.TrimSpace(c.Param("itemId"))
	var body map[string]any
	if err := c.ShouldBindJSON(&body); err != nil {
		httpx.SendError(c, http.StatusBadRequest, "请求参数无效", "INVALID_BODY")
		return
	}
	h.ensureExecutionTable()
	key := idempotencyFromBody(body)
	if key != "" {
		if repeated, err := h.mealExecutionRepeated(userID, key, "complete", itemID); err != nil {
			httpx.SendError(c, http.StatusConflict, "此提交编号已用于其他餐次或操作，请核对原提交后重试", "MEAL_PLAN_KEY_CONFLICT")
			return
		} else if repeated != nil {
			c.JSON(http.StatusOK, repeated)
			return
		}
	}
	row, err := h.loadPlanItem(userID, planID, itemID)
	if err != nil {
		httpx.SendError(c, http.StatusNotFound, "餐次不存在", "MEAL_PLAN_ITEM_NOT_FOUND")
		return
	}
	if production, ok := body["production"].(map[string]any); ok {
		if production["plan_item_id"] == nil {
			production["plan_item_id"] = itemID
		}
		production["plan_version"] = versionFromBody(body)
		completeBody := map[string]any{
			"idempotency_key": key,
			"production":      production,
			"recipe_id":       row.RecipeID.Int64,
		}
		if consumptions, ok := body["inventory_consumptions"]; ok {
			completeBody["inventory_consumptions"] = consumptions
		}
		result, status, err := h.completeCookingCore(userID, completeBody)
		if err != nil {
			if err.Error() == "INVALID_BODY" {
				httpx.SendError(c, http.StatusBadRequest, "请求参数无效", "INVALID_BODY")
				return
			}
			if err.Error() == "INVENTORY_CONFLICT" {
				httpx.SendError(c, http.StatusConflict, "部分库存食材不存在、已用完或不属于当前账号", "INVENTORY_CONFLICT")
				return
			}
			writeInventoryErr(c, err)
			return
		}
		if key != "" {
			h.saveMealExecution(userID, key, "complete", itemID, result)
		}
		c.JSON(status, result)
		return
	}
	expected := versionFromBody(body)
	if row.Status == "completed" || (expected > 0 && expected != row.Version) {
		httpx.SendError(c, http.StatusConflict, "餐次已变化，请刷新后重试", "MEAL_PLAN_VERSION_CONFLICT")
		return
	}
	foodName := row.Title
	if foodName == "" {
		foodName = "计划餐次"
	}
	recordedAt := row.PlannedDate
	if recordedAt == "" {
		recordedAt = todayDateKey()
	}
	record, err := h.insertDietRecord(userID, map[string]any{
		"meal_type": row.MealType, "food_name": foodName, "recorded_at": recordedAt,
	}, foodName)
	if err != nil {
		httpx.SendError(c, http.StatusInternalServerError, "完成餐次失败", "MEAL_PLAN_FAILED")
		return
	}
	var res sql.Result
	var err2 error
	if h.hasColumn("meal_plan_items", "diet_record_id") {
		res, err2 = h.DB.Exec(`UPDATE meal_plan_items SET status='completed', version=version+1, updated_at=?, diet_record_id=?
			WHERE id=? AND user_id=? AND plan_id=? AND version=?`, nowRFC3339(), record["id"], itemID, userID, planID, expected)
	} else if h.hasColumn("meal_plan_items", "completed_at") {
		res, err2 = h.DB.Exec(`UPDATE meal_plan_items SET status='completed', version=version+1, updated_at=?, completed_at=?
			WHERE id=? AND user_id=? AND plan_id=? AND version=?`, nowRFC3339(), nowRFC3339(), itemID, userID, planID, expected)
	} else {
		res, err2 = h.DB.Exec(`UPDATE meal_plan_items SET status='completed', version=version+1, updated_at=?
			WHERE id=? AND user_id=? AND plan_id=? AND version=?`, nowRFC3339(), itemID, userID, planID, expected)
	}
	err = err2
	if err != nil || !h.rowsChanged(res) {
		httpx.SendError(c, http.StatusConflict, "餐次已变化，请刷新后重试", "MEAL_PLAN_VERSION_CONFLICT")
		return
	}
	value := map[string]any{"dietRecordId": record["id"], "repeated": false}
	if key != "" {
		h.saveMealExecution(userID, key, "complete", itemID, value)
	}
	c.JSON(http.StatusOK, value)
}

func (h *Handlers) MealPlanItemQueue(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	planID, ok := h.resolvePlanID(c, userID)
	if !ok {
		httpx.SendError(c, http.StatusNotFound, "餐计划不存在", "MEAL_PLAN_NOT_FOUND")
		return
	}
	itemID := strings.TrimSpace(c.Param("itemId"))
	var body map[string]any
	if err := c.ShouldBindJSON(&body); err != nil {
		httpx.SendError(c, http.StatusBadRequest, "请求参数无效", "INVALID_BODY")
		return
	}
	h.ensureExecutionTable()
	key := idempotencyFromBody(body)
	if key != "" {
		if repeated, err := h.mealExecutionRepeated(userID, key, "queue", itemID); err != nil {
			httpx.SendError(c, http.StatusConflict, "此提交编号已用于其他餐次或操作，请核对原提交后重试", "MEAL_PLAN_KEY_CONFLICT")
			return
		} else if repeated != nil {
			c.JSON(http.StatusOK, repeated)
			return
		}
	}
	row, err := h.loadPlanItem(userID, planID, itemID)
	if err != nil {
		httpx.SendError(c, http.StatusNotFound, "餐次不存在", "MEAL_PLAN_ITEM_NOT_FOUND")
		return
	}
	expected := versionFromBody(body)
	if row.Status == "completed" || row.Status == "skipped" || (expected > 0 && expected != row.Version) {
		httpx.SendError(c, http.StatusConflict, "餐次已变化，请刷新后重试", "MEAL_PLAN_VERSION_CONFLICT")
		return
	}
	queueItemID := ""
	if row.QueueItemID.Valid {
		queueItemID = row.QueueItemID.String
	}
	added := false
	if queueItemID == "" {
		count, _ := h.activeQueueCount(userID)
		if count >= 30 {
			httpx.SendError(c, http.StatusConflict, "烹饪队列最多保留 30 道菜", "COOKING_QUEUE_FULL")
			return
		}
		queueItemID = newUUID()
		pos := h.nextQueuePosition(userID)
		recipeID := 0
		if row.RecipeID.Valid {
			recipeID = int(row.RecipeID.Int64)
		}
		snapshot := map[string]any{
			"title": row.Title, "ingredients": ingredientList(row), "planItemId": itemID, "plannedDate": row.PlannedDate,
		}
		if h.hasColumn("cooking_queue_items", "source_plan_item_id") {
			_, err = h.DB.Exec(`INSERT INTO cooking_queue_items
				(id, user_id, recipe_id, position, meal_type, recipe_snapshot_json, source_plan_item_id, status, version)
				VALUES (?, ?, ?, ?, ?, ?, ?, 'waiting', 1)`,
				queueItemID, userID, nullRecipe(recipeID), pos, h.queueMealType(row.MealType), marshalJSON(snapshot), itemID)
		} else {
			bodyJSON := marshalJSON(mergeMaps(snapshot, map[string]any{"source_plan_item_id": itemID, "meal_type": row.MealType}))
			_, err = h.DB.Exec(`INSERT INTO cooking_queue_items (id, user_id, recipe_id, position, status, version, body_json)
				VALUES (?, ?, ?, ?, 'waiting', 1, ?)`, queueItemID, userID, recipeID, pos, bodyJSON)
		}
		if err != nil {
			httpx.SendError(c, http.StatusInternalServerError, "加入烹饪队列失败", "COOKING_QUEUE_FAILED")
			return
		}
		added = true
	}
	var res sql.Result
	if h.hasColumn("meal_plan_items", "queue_item_id") {
		res, err = h.DB.Exec(`UPDATE meal_plan_items SET queue_item_id=?, status='queued', version=version+1, updated_at=?
			WHERE id=? AND user_id=? AND plan_id=? AND version=?`, queueItemID, nowRFC3339(), itemID, userID, planID, expected)
	} else {
		payload := mergeMaps(parseJSONObject(sql.NullString{String: row.PayloadJSON, Valid: true}), map[string]any{
			"queue_item_id": queueItemID, "status": "queued",
		})
		res, err = h.DB.Exec(`UPDATE meal_plan_items SET status='queued', payload_json=?, version=version+1, updated_at=?
			WHERE id=? AND user_id=? AND plan_id=? AND version=?`, marshalJSON(payload), nowRFC3339(), itemID, userID, planID, expected)
	}
	if err != nil || !h.rowsChanged(res) {
		httpx.SendError(c, http.StatusConflict, "餐次已变化，请刷新后重试", "MEAL_PLAN_VERSION_CONFLICT")
		return
	}
	value := map[string]any{
		"queueItemId": queueItemID, "added": added, "combineSameRecipe": asBool(body["combineSameRecipe"]), "repeated": false,
	}
	if key != "" {
		h.saveMealExecution(userID, key, "queue", itemID, value)
	}
	c.JSON(http.StatusOK, value)
}

func (h *Handlers) MealPlanItemShopping(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	planID, ok := h.resolvePlanID(c, userID)
	if !ok {
		httpx.SendError(c, http.StatusNotFound, "餐计划不存在", "MEAL_PLAN_NOT_FOUND")
		return
	}
	itemID := strings.TrimSpace(c.Param("itemId"))
	var body map[string]any
	if err := c.ShouldBindJSON(&body); err != nil {
		httpx.SendError(c, http.StatusBadRequest, "请求参数无效", "INVALID_BODY")
		return
	}
	h.ensureExecutionTable()
	key := idempotencyFromBody(body)
	if key != "" {
		if repeated, err := h.mealExecutionRepeated(userID, key, "shopping", itemID); err != nil {
			httpx.SendError(c, http.StatusConflict, "此提交编号已用于其他餐次或操作，请核对原提交后重试", "MEAL_PLAN_KEY_CONFLICT")
			return
		} else if repeated != nil {
			c.JSON(http.StatusOK, repeated)
			return
		}
	}
	plan, err := h.loadPlan(userID, planID)
	if err != nil {
		httpx.SendError(c, http.StatusNotFound, "餐计划不存在", "MEAL_PLAN_NOT_FOUND")
		return
	}
	row, err := h.loadPlanItem(userID, planID, itemID)
	if err != nil {
		httpx.SendError(c, http.StatusNotFound, "餐次不存在", "MEAL_PLAN_ITEM_NOT_FOUND")
		return
	}
	expected := versionFromBody(body)
	if expected > 0 && expected != row.Version {
		httpx.SendError(c, http.StatusConflict, "餐次已变化，请刷新后重试", "MEAL_PLAN_VERSION_CONFLICT")
		return
	}
	if plan.Status != "active" || row.Status == "completed" || row.Status == "skipped" {
		httpx.SendError(c, http.StatusConflict, "餐次已变化，请刷新后重试", "MEAL_PLAN_VERSION_CONFLICT")
		return
	}
	itemIDs := make([]string, 0)
	for i, ing := range ingredientList(row) {
		name := strings.TrimSpace(asString(ing["name"]))
		if name == "" {
			continue
		}
		amount := strings.TrimSpace(asString(ing["amount"]))
		if amount == "" {
			amount = "适量"
		}
		clientID := fmt.Sprintf("meal-plan:%s:%s:%d", itemID, key, i)
		if key == "" {
			clientID = fmt.Sprintf("meal-plan:%s:%d", itemID, i)
		}
		id := newUUID()
		if h.hasColumn("shopping_list_items", "client_id") {
			_, _ = h.DB.Exec(`INSERT OR IGNORE INTO shopping_list_items (id, user_id, client_id, name, amount, category, checked, version)
				VALUES (?, ?, ?, ?, ?, '餐单', 0, 1)`, id, userID, clientID, name, amount)
		} else {
			_, _ = h.DB.Exec(`INSERT INTO shopping_list_items (user_id, name, quantity, checked, version) VALUES (?, ?, ?, 0, 1)`,
				userID, name, amount)
			id = ""
		}
		if id != "" {
			itemIDs = append(itemIDs, id)
		}
	}
	value := map[string]any{"added": len(itemIDs), "itemIds": itemIDs, "repeated": false, "scope": "current_plan"}
	if key != "" {
		h.saveMealExecution(userID, key, "shopping", itemID, value)
	}
	c.JSON(http.StatusOK, value)
}

func (h *Handlers) rowsChanged(res sql.Result) bool {
	if res == nil {
		return false
	}
	n, _ := res.RowsAffected()
	return n == 1
}

func (h *Handlers) SaveMealPlanDraft(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	var body map[string]any
	if err := c.ShouldBindJSON(&body); err != nil {
		httpx.SendError(c, http.StatusBadRequest, "请求参数无效", "INVALID_BODY")
		return
	}
	key := strings.TrimSpace(asString(body["idempotency_key"]))
	title := strings.TrimSpace(asString(body["title"]))
	if title == "" {
		title = "未命名计划"
	}
	if key != "" {
		var existing sql.NullString
		if err := h.DB.QueryRow(`SELECT payload_json FROM meal_plans WHERE user_id=? AND title=? AND status='draft' ORDER BY id DESC LIMIT 1`,
			userID, title).Scan(&existing); err == nil && existing.Valid {
			var parsed map[string]any
			if json.Unmarshal([]byte(existing.String), &parsed) == nil {
				parsed["repeated"] = true
				c.JSON(http.StatusOK, parsed)
				return
			}
		}
		_ = key
	}
	draft := body["draft_json"]
	if draft == nil {
		draft = body["draft"]
	}
	if draft == nil {
		draft = body
	}
	draftRaw, _ := json.Marshal(draft)
	payloadRaw, _ := json.Marshal(body)
	constraints := map[string]any{}
	if craw, ok := body["constraints"].(map[string]any); ok {
		constraints = craw
	}
	constraintsRaw, _ := json.Marshal(constraints)
	res, err := h.DB.Exec(`INSERT INTO meal_plans (user_id, title, status, version, payload_json, draft_json, constraints_json)
		VALUES (?, ?, 'draft', 1, ?, ?, ?)`, userID, title, string(payloadRaw), string(draftRaw), string(constraintsRaw))
	if err != nil {
		httpx.SendError(c, http.StatusInternalServerError, "创建餐计划失败", "MEAL_PLAN_FAILED")
		return
	}
	id, _ := res.LastInsertId()
	out := gin.H{"id": id, "title": title, "status": "draft", "version": 1, "repeated": false}
	c.JSON(http.StatusCreated, out)
}
