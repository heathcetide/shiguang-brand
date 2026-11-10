// Copyright (c) 2026 heathcetide. All rights reserved.

package lifestyle

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/heathcetide/DietDigiDose/internal/expressauth"
	"github.com/heathcetide/DietDigiDose/internal/httpx"
)

func (h *Handlers) CompleteCooking(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	var body map[string]any
	if err := c.ShouldBindJSON(&body); err != nil {
		httpx.SendError(c, http.StatusBadRequest, "请求参数无效", "INVALID_BODY")
		return
	}
	result, status, err := h.completeCookingCore(userID, body)
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
	c.JSON(status, result)
}

func (h *Handlers) ListPreparedMeals(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	rows, err := h.DB.Query(`SELECT id, food_name, produced_servings, remaining_servings, COALESCE(version,1), COALESCE(result_json,'')
		FROM prepared_meals WHERE user_id=? ORDER BY produced_at DESC, id DESC LIMIT 200`, userID)
	if err != nil {
		c.JSON(http.StatusOK, []any{})
		return
	}
	defer rows.Close()
	list := make([]map[string]any, 0)
	for rows.Next() {
		var id, foodName string
		var produced, remaining float64
		var version int
		var resultRaw string
		if err := rows.Scan(&id, &foodName, &produced, &remaining, &version, &resultRaw); err != nil {
			continue
		}
		item := map[string]any{
			"id": id, "food_name": foodName, "produced_servings": produced,
			"remaining_servings": remaining, "version": version, "allocations": []any{},
		}
		if resultRaw != "" {
			var parsed map[string]any
			if json.Unmarshal([]byte(resultRaw), &parsed) == nil {
				if pm, ok := parsed["prepared_meal"].(map[string]any); ok {
					item = mergeMaps(item, pm)
				}
			}
		}
		list = append(list, item)
	}
	c.JSON(http.StatusOK, list)
}

func (h *Handlers) CreatePreparedMeal(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	var body map[string]any
	if err := c.ShouldBindJSON(&body); err != nil {
		httpx.SendError(c, http.StatusBadRequest, "请求参数无效", "INVALID_BODY")
		return
	}
	key := strings.TrimSpace(asString(body["idempotency_key"]))
	if key == "" {
		key = newUUID()
	}
	var existing sql.NullString
	if err := h.DB.QueryRow(`SELECT result_json FROM prepared_meals WHERE user_id=? AND idempotency_key=?`, userID, key).Scan(&existing); err == nil && existing.Valid {
		var parsed map[string]any
		if json.Unmarshal([]byte(existing.String), &parsed) == nil {
			c.JSON(http.StatusOK, parsed)
			return
		}
	}
	foodName := strings.TrimSpace(asString(body["food_name"]))
	if foodName == "" {
		foodName = "备餐"
	}
	produced := asFloat(body["produced_servings"])
	if produced <= 0 {
		produced = 1
	}
	remaining := asFloat(body["remaining_servings"])
	if remaining <= 0 {
		remaining = produced
	}
	mealID := newUUID()
	meal := map[string]any{
		"id": mealID, "food_name": foodName, "produced_servings": produced,
		"remaining_servings": remaining, "version": 1, "allocations": []any{},
	}
	raw, _ := json.Marshal(meal)
	_, err := h.DB.Exec(`INSERT INTO prepared_meals (id, user_id, idempotency_key, food_name, produced_servings, remaining_servings, version, result_json)
		VALUES (?, ?, ?, ?, ?, ?, 1, ?)`, mealID, userID, key, foodName, produced, remaining, string(raw))
	if err != nil {
		httpx.SendError(c, http.StatusInternalServerError, "创建备餐失败", "PREPARED_MEAL_FAILED")
		return
	}
	c.JSON(http.StatusCreated, meal)
}

func (h *Handlers) PreparedMealEvent(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	mealID := strings.TrimSpace(c.Param("id"))
	var body map[string]any
	if err := c.ShouldBindJSON(&body); err != nil {
		httpx.SendError(c, http.StatusBadRequest, "请求参数无效", "INVALID_BODY")
		return
	}
	key := strings.TrimSpace(asString(body["idempotency_key"]))
	if key != "" {
		var prev sql.NullString
		if err := h.DB.QueryRow(`SELECT result_json FROM prepared_meal_events WHERE user_id=? AND idempotency_key=?`, userID, key).Scan(&prev); err == nil && prev.Valid {
			var parsed map[string]any
			if json.Unmarshal([]byte(prev.String), &parsed) == nil {
				parsed["repeated"] = true
				c.JSON(http.StatusOK, parsed)
				return
			}
		}
	}
	var foodName string
	var produced, remaining float64
	var version int
	err := h.DB.QueryRow(`SELECT food_name, produced_servings, remaining_servings, COALESCE(version,1) FROM prepared_meals WHERE id=? AND user_id=?`,
		mealID, userID).Scan(&foodName, &produced, &remaining, &version)
	if err != nil {
		httpx.SendError(c, http.StatusNotFound, "待吃餐不存在", "PREPARED_MEAL_NOT_FOUND")
		return
	}
	expected := asInt(body["version"])
	if expected > 0 && expected != version {
		httpx.SendError(c, http.StatusConflict, "待吃餐已变化，请刷新后重试", "PREPARED_MEAL_VERSION_CONFLICT")
		return
	}
	eventType := strings.TrimSpace(asString(body["type"]))
	servings := asFloat(body["servings"])
	if servings <= 0 {
		servings = 1
	}
	switch eventType {
	case "eat", "discard":
		if servings > remaining {
			httpx.SendError(c, http.StatusConflict, "待吃餐剩余份数不足", "PREPARED_MEAL_INSUFFICIENT")
			return
		}
		remaining -= servings
	case "reschedule":
		// no serving change
	default:
		httpx.SendError(c, http.StatusBadRequest, "请求参数无效", "INVALID_BODY")
		return
	}
	version++
	meal := map[string]any{
		"id": mealID, "food_name": foodName, "produced_servings": produced,
		"remaining_servings": remaining, "version": version, "allocations": []any{},
	}
	tx, err := h.DB.Begin()
	if err != nil {
		httpx.SendError(c, 500, "保存待吃餐失败", "PREPARED_MEAL_FAILED")
		return
	}
	defer tx.Rollback()
	// A version predicate protects concurrent requests on PostgreSQL as well as SQLite.
	res, err := tx.Exec(`UPDATE prepared_meals SET remaining_servings=?, version=?, updated_at=? WHERE id=? AND user_id=? AND version=?`, remaining, version, nowRFC3339(), mealID, userID, version-1)
	if err != nil {
		httpx.SendError(c, 500, "保存待吃餐失败", "PREPARED_MEAL_FAILED")
		return
	}
	n, err := res.RowsAffected()
	if err != nil || n != 1 {
		httpx.SendError(c, 409, "待吃餐已变化，请刷新后重试", "PREPARED_MEAL_VERSION_CONFLICT")
		return
	}
	var dietRecord any
	if eventType == "eat" {
		amount := strconv.FormatFloat(servings, 'f', -1, 64) + "份"
		recorded := strings.TrimSpace(asString(body["recorded_at"]))
		if recorded == "" {
			recorded = todayDateKey()
		}
		id, derr := tx.InsertID(`INSERT INTO diet_records (user_id, meal_type, food_name, calories, recorded_at, amount) VALUES (?, ?, ?, NULL, ?, ?)`, userID, asString(body["meal_type"]), foodName, recorded, amount)
		if derr != nil {
			httpx.SendError(c, 500, "保存饮食记录失败", "DIET_FAILED")
			return
		}
		dietRecord = map[string]any{"id": id, "food_name": foodName, "amount": amount, "calories": nil}
	}
	result := map[string]any{"prepared_meal": meal, "diet_record": dietRecord, "repeated": false}
	raw, _ := json.Marshal(result)
	if _, err := tx.Exec(`UPDATE prepared_meals SET result_json=? WHERE id=? AND user_id=?`, string(raw), mealID, userID); err != nil {
		httpx.SendError(c, 500, "保存待吃餐失败", "PREPARED_MEAL_FAILED")
		return
	}
	eventID := newUUID()
	if key == "" {
		key = eventID
	}
	if _, err := tx.Exec(`INSERT INTO prepared_meal_events (id, user_id, prepared_meal_id, idempotency_key, event_type, result_json)
		VALUES (?, ?, ?, ?, ?, ?)`, eventID, userID, mealID, key, eventType, string(raw)); err != nil {
		httpx.SendError(c, 500, "保存待吃餐事件失败", "PREPARED_MEAL_FAILED")
		return
	}
	if err := tx.Commit(); err != nil {
		httpx.SendError(c, 500, "保存待吃餐失败", "PREPARED_MEAL_FAILED")
		return
	}
	c.JSON(http.StatusCreated, result)
}
