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

func (h *Handlers) cookingQueueRow(userID int, id string) (map[string]any, error) {
	var recipeID, version, position int
	var status, bodyRaw, created string
	var sourcePlan sql.NullString
	q := `SELECT COALESCE(recipe_id,0), COALESCE(status,'waiting'), COALESCE(version,1),
		COALESCE(position,0), COALESCE(body_json,''), COALESCE(created_at,'')`
	if h.hasColumn("cooking_queue_items", "source_plan_item_id") {
		q += `, source_plan_item_id`
	}
	q += ` FROM cooking_queue_items WHERE id=? AND user_id=?`
	if h.hasColumn("cooking_queue_items", "source_plan_item_id") {
		err := h.DB.QueryRow(q, id, userID).Scan(&recipeID, &status, &version, &position, &bodyRaw, &created, &sourcePlan)
		if err != nil {
			return nil, err
		}
		item := map[string]any{"id": id, "recipe_id": recipeID, "status": status, "version": version, "position": position, "created_at": created}
		if sourcePlan.Valid && sourcePlan.String != "" {
			item["source_plan_item_id"] = sourcePlan.String
		}
		if bodyRaw != "" {
			var extra map[string]any
			if json.Unmarshal([]byte(bodyRaw), &extra) == nil {
				item = mergeMaps(item, extra)
			}
		}
		return item, nil
	}
	err := h.DB.QueryRow(q, id, userID).Scan(&recipeID, &status, &version, &position, &bodyRaw, &created)
	if err != nil {
		return nil, err
	}
	item := map[string]any{"id": id, "recipe_id": recipeID, "status": status, "version": version, "position": position, "created_at": created}
	if bodyRaw != "" {
		var extra map[string]any
		if json.Unmarshal([]byte(bodyRaw), &extra) == nil {
			item = mergeMaps(item, extra)
		}
	}
	return item, nil
}

func (h *Handlers) PatchCookingQueue(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	id := strings.TrimSpace(c.Param("id"))
	var body map[string]any
	if err := c.ShouldBindJSON(&body); err != nil {
		httpx.SendError(c, http.StatusBadRequest, "请求参数无效", "INVALID_BODY")
		return
	}
	item, err := h.cookingQueueRow(userID, id)
	if err != nil {
		httpx.SendError(c, http.StatusNotFound, "队列项不存在", "COOKING_QUEUE_NOT_FOUND")
		return
	}
	if v := asInt(body["version"]); v > 0 && v != asInt(item["version"]) {
		httpx.SendError(c, http.StatusConflict, "队列已更新，请刷新后重试", "VERSION_CONFLICT")
		return
	}
	status := strings.TrimSpace(asString(body["status"]))
	if status != "" {
		item["status"] = status
	}
	if mt := asString(body["meal_type"]); mt != "" {
		item["meal_type"] = mt
	}
	version := asInt(item["version"]) + 1
	item["version"] = version
	raw := marshalJSON(item)
	_, _ = h.DB.Exec(`UPDATE cooking_queue_items SET status=?, version=?, body_json=?, updated_at=? WHERE id=? AND user_id=?`,
		asString(item["status"]), version, raw, nowRFC3339(), id, userID)
	c.JSON(http.StatusOK, item)
}

func (h *Handlers) ReorderCookingQueue(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	var body struct {
		Items []struct {
			ID       string `json:"id"`
			Position int    `json:"position"`
		} `json:"items"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || len(body.Items) == 0 {
		httpx.SendError(c, http.StatusBadRequest, "请求参数无效", "INVALID_BODY")
		return
	}
	for _, row := range body.Items {
		_, _ = h.DB.Exec(`UPDATE cooking_queue_items SET position=?, updated_at=? WHERE id=? AND user_id=?`,
			row.Position, nowRFC3339(), row.ID, userID)
	}
	h.ListCookingQueue(c)
}

func (h *Handlers) StartCookingQueue(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	id := strings.TrimSpace(c.Param("id"))
	var body map[string]any
	_ = c.ShouldBindJSON(&body)
	item, err := h.cookingQueueRow(userID, id)
	if err != nil {
		httpx.SendError(c, http.StatusNotFound, "队列项不存在", "COOKING_QUEUE_NOT_FOUND")
		return
	}
	if v := asInt(body["version"]); v > 0 && v != asInt(item["version"]) {
		httpx.SendError(c, http.StatusConflict, "队列已更新，请刷新后重试", "VERSION_CONFLICT")
		return
	}
	item["status"] = "cooking"
	item["version"] = asInt(item["version"]) + 1
	_, _ = h.DB.Exec(`UPDATE cooking_queue_items SET status='cooking', version=?, updated_at=? WHERE id=? AND user_id=?`,
		item["version"], nowRFC3339(), id, userID)
	c.JSON(http.StatusOK, item)
}

func (h *Handlers) CompleteCookingQueue(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	id := strings.TrimSpace(c.Param("id"))
	var body map[string]any
	_ = c.ShouldBindJSON(&body)
	item, err := h.cookingQueueRow(userID, id)
	if err != nil {
		httpx.SendError(c, http.StatusNotFound, "队列项不存在", "COOKING_QUEUE_NOT_FOUND")
		return
	}
	if v := asInt(body["version"]); v > 0 && v != asInt(item["version"]) {
		httpx.SendError(c, http.StatusConflict, "队列已更新，请刷新后重试", "VERSION_CONFLICT")
		return
	}
	version := asInt(item["version"]) + 1
	completedAt := nowRFC3339()
	expectedVersion := asInt(item["version"])
	if h.hasColumn("cooking_queue_items", "completed_at") {
		_, _ = h.DB.Exec(`UPDATE cooking_queue_items SET status='completed', version=?, completed_at=?, updated_at=? WHERE id=? AND user_id=? AND version=?`,
			version, completedAt, completedAt, id, userID, expectedVersion)
	} else {
		_, _ = h.DB.Exec(`UPDATE cooking_queue_items SET status='completed', version=?, updated_at=? WHERE id=? AND user_id=? AND version=?`,
			version, completedAt, id, userID, expectedVersion)
	}
	item["status"] = "completed"
	item["version"] = version
	item["completed_at"] = completedAt
	planItemID := strings.TrimSpace(asString(item["source_plan_item_id"]))
	if planItemID == "" {
		planItemID = strings.TrimSpace(asString(item["planItemId"]))
	}
	if planItemID != "" {
		if h.hasColumn("meal_plan_items", "completed_at") {
			_, _ = h.DB.Exec(`UPDATE meal_plan_items SET status='completed', completed_at=?, version=version+1, updated_at=?
				WHERE id=? AND user_id=?`, completedAt, completedAt, planItemID, userID)
		} else {
			_, _ = h.DB.Exec(`UPDATE meal_plan_items SET status='completed', version=version+1, updated_at=?
				WHERE id=? AND user_id=?`, completedAt, planItemID, userID)
		}
	} else if recipeID := asInt(item["recipe_id"]); recipeID > 0 {
		_, _ = h.DB.Exec(`UPDATE meal_plan_items SET status='completed', version=version+1, updated_at=?
			WHERE user_id=? AND queue_item_id=?`, completedAt, userID, id)
	}
	updated, err := h.cookingQueueRow(userID, id)
	if err == nil {
		item = updated
	}
	c.JSON(http.StatusOK, item)
}

func (h *Handlers) ClearCookingQueue(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	_, _ = h.DB.Exec(`DELETE FROM cooking_queue_items WHERE user_id=? AND COALESCE(status,'') NOT IN ('completed')`, userID)
	var count int
	_ = h.DB.QueryRow(`SELECT COUNT(*) FROM cooking_queue_items WHERE user_id=?`, userID).Scan(&count)
	c.JSON(http.StatusOK, gin.H{"cleared": true, "remaining": count})
}

func (h *Handlers) enqueueCookingCompat(userID int, recipeID int) (map[string]any, int) {
	id := newUUID()
	_, err := h.DB.Exec(`INSERT INTO cooking_queue_items (id, user_id, recipe_id, status, position, version) VALUES (?, ?, ?, 'waiting', 0, 1)`,
		id, userID, recipeID)
	if err != nil {
		// Legacy integer-id table from handlers bootstrap
		res, err2 := h.DB.Exec(`INSERT INTO cooking_queue_items (user_id, recipe_id, status) VALUES (?, ?, 'queued')`, userID, recipeID)
		if err2 != nil {
			return nil, http.StatusInternalServerError
		}
		lid, _ := res.LastInsertId()
		return map[string]any{"id": lid, "recipe_id": recipeID, "status": "queued"}, http.StatusCreated
	}
	var pos int
	_ = h.DB.QueryRow(`SELECT COALESCE(MAX(position), -1) + 1 FROM cooking_queue_items WHERE user_id=?`, userID).Scan(&pos)
	_, _ = h.DB.Exec(`UPDATE cooking_queue_items SET position=? WHERE id=?`, pos, id)
	return map[string]any{"id": id, "recipe_id": recipeID, "status": "waiting", "position": pos, "version": 1}, http.StatusCreated
}
