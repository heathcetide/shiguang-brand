// Copyright (c) 2026 heathcetide. All rights reserved.

package social

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/heathcetide/DietDigiDose/internal/expressauth"
	"github.com/heathcetide/DietDigiDose/internal/httpx"
)

func (h *Handlers) FeedbackDetail(c *gin.Context) {
	h.ensureSchema()
	userID, _ := expressauth.UserID(c)
	id, _ := strconv.Atoi(c.Param("id"))
	item, ok := h.feedbackRow(id, userID, false)
	if !ok {
		httpx.SendError(c, http.StatusNotFound, "反馈不存在或无权查看", "FEEDBACK_NOT_FOUND")
		return
	}
	item["messages"] = h.feedbackMessages(id, false)
	c.JSON(http.StatusOK, item)
}

func (h *Handlers) FeedbackReply(c *gin.Context) {
	h.ensureSchema()
	userID, _ := expressauth.UserID(c)
	id, _ := strconv.Atoi(c.Param("id"))
	body, ok := bindJSONMap(c)
	if !ok {
		return
	}
	content := strField(body, "content")
	if content == "" {
		httpx.SendError(c, http.StatusBadRequest, "反馈请求格式无效", "VALIDATION_ERROR")
		return
	}
	if _, ok := h.feedbackRow(id, userID, false); !ok {
		httpx.SendError(c, http.StatusNotFound, "反馈不存在或无权查看", "FEEDBACK_NOT_FOUND")
		return
	}
	requestKey := strField(body, "requestKey", "request_key")
	if requestKey == "" {
		requestKey = newUUID()
	}
	_, _ = h.DB.Exec(`INSERT INTO feedback_messages (feedback_id, author_id, author_role, visibility, content, status, request_key)
		VALUES (?,?,?,?,?,?,?)`, id, userID, "user", "public", content, "processing", requestKey)
	_, _ = h.DB.Exec(`UPDATE user_feedback SET status='processing', version=version+1, updated_at=CURRENT_TIMESTAMP WHERE id=?`, id)
	c.JSON(http.StatusOK, gin.H{"feedbackId": id, "status": "processing", "requestKey": requestKey})
}

func (h *Handlers) FeedbackAdminList(c *gin.Context) {
	h.ensureSchema()
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))
	if limit < 1 || limit > 50 {
		limit = 20
	}
	c.JSON(http.StatusOK, h.feedbackList(0, limit, c))
}

func (h *Handlers) FeedbackAdminDetail(c *gin.Context) {
	h.ensureSchema()
	id, _ := strconv.Atoi(c.Param("id"))
	item, ok := h.feedbackRow(id, 0, true)
	if !ok {
		httpx.SendError(c, http.StatusNotFound, "反馈不存在或无权查看", "FEEDBACK_NOT_FOUND")
		return
	}
	item["messages"] = h.feedbackMessages(id, true)
	c.JSON(http.StatusOK, item)
}

func (h *Handlers) FeedbackAdminReply(c *gin.Context) {
	h.ensureSchema()
	adminID, _ := expressauth.UserID(c)
	id, _ := strconv.Atoi(c.Param("id"))
	body, ok := bindJSONMap(c)
	if !ok {
		return
	}
	content := strField(body, "content")
	if content == "" {
		httpx.SendError(c, http.StatusBadRequest, "反馈请求格式无效", "VALIDATION_ERROR")
		return
	}
	if _, ok := h.feedbackRow(id, 0, true); !ok {
		httpx.SendError(c, http.StatusNotFound, "反馈不存在或无权查看", "FEEDBACK_NOT_FOUND")
		return
	}
	visibility := strField(body, "visibility")
	if visibility == "" {
		visibility = "public"
	}
	status := strField(body, "status")
	if status == "" {
		status = "waiting_user"
	}
	requestKey := strField(body, "requestKey", "request_key")
	if requestKey == "" {
		requestKey = newUUID()
	}
	_, _ = h.DB.Exec(`INSERT INTO feedback_messages (feedback_id, author_id, author_role, visibility, content, status, request_key)
		VALUES (?,?,?,?,?,?,?)`, id, adminID, "admin", visibility, content, status, requestKey)
	_, _ = h.DB.Exec(`UPDATE user_feedback SET status=?, version=version+1, updated_at=CURRENT_TIMESTAMP WHERE id=?`, status, id)
	c.JSON(http.StatusOK, gin.H{"feedbackId": id, "status": status, "visibility": visibility})
}

func (h *Handlers) feedbackList(userID, limit int, c *gin.Context) []map[string]any {
	q := `SELECT id, user_id, category, content, status, COALESCE(version,1), COALESCE(created_at,''), COALESCE(updated_at, created_at,'')
		FROM user_feedback WHERE 1=1`
	args := make([]any, 0)
	if userID > 0 {
		q += ` AND user_id=?`
		args = append(args, userID)
	}
	if before, err := strconv.Atoi(c.Query("before")); err == nil && before > 0 {
		q += ` AND id<?`
		args = append(args, before)
	}
	if st := strings.TrimSpace(c.Query("status")); st != "" {
		q += ` AND status=?`
		args = append(args, st)
	}
	if cat := strings.TrimSpace(c.Query("category")); cat != "" {
		q += ` AND category=?`
		args = append(args, cat)
	}
	q += ` ORDER BY id DESC LIMIT ?`
	args = append(args, limit)
	rows, err := h.DB.Query(q, args...)
	if err != nil {
		return []map[string]any{}
	}
	defer rows.Close()
	list := make([]map[string]any, 0)
	for rows.Next() {
		var id, uid, ver int
		var cat, content, status, created, updated string
		if rows.Scan(&id, &uid, &cat, &content, &status, &ver, &created, &updated) == nil {
			if status == "open" {
				status = "received"
			}
			list = append(list, map[string]any{
				"id": id, "userId": uid, "category": cat, "content": content, "status": status,
				"version": ver, "createdAt": created, "updatedAt": updated,
			})
		}
	}
	return list
}

func (h *Handlers) feedbackRow(id, userID int, admin bool) (map[string]any, bool) {
	q := `SELECT id, user_id, category, content, status, COALESCE(version,1), COALESCE(created_at,''), COALESCE(updated_at, created_at,'')
		FROM user_feedback WHERE id=?`
	args := []any{id}
	if !admin {
		q += ` AND user_id=?`
		args = append(args, userID)
	}
	var uid, ver int
	var cat, content, status, created, updated string
	err := h.DB.QueryRow(q, args...).Scan(&id, &uid, &cat, &content, &status, &ver, &created, &updated)
	if err != nil {
		return nil, false
	}
	if status == "open" {
		status = "received"
	}
	return map[string]any{
		"id": id, "userId": uid, "category": cat, "content": content, "status": status,
		"version": ver, "createdAt": created, "updatedAt": updated,
	}, true
}

func (h *Handlers) feedbackMessages(feedbackID int, admin bool) []map[string]any {
	q := `SELECT id, author_role, visibility, content, COALESCE(status,''), COALESCE(created_at,'')
		FROM feedback_messages WHERE feedback_id=?`
	if !admin {
		q += ` AND visibility='public'`
	}
	q += ` ORDER BY id`
	rows, err := h.DB.Query(q, feedbackID)
	if err != nil {
		return []map[string]any{}
	}
	defer rows.Close()
	list := make([]map[string]any, 0)
	for rows.Next() {
		var id int
		var role, visibility, content, status, created string
		if rows.Scan(&id, &role, &visibility, &content, &status, &created) == nil {
			list = append(list, map[string]any{
				"id": id, "authorRole": role, "visibility": visibility, "content": content,
				"status": emptyNil(status), "createdAt": created,
			})
		}
	}
	return list
}
