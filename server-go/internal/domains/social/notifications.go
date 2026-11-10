// Copyright (c) 2026 heathcetide. All rights reserved.

package social

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/heathcetide/DietDigiDose/internal/expressauth"
	"github.com/heathcetide/DietDigiDose/internal/httpx"
)

var interventionIDPattern = regexp.MustCompile(`^[a-f0-9]{64}$`)

func (h *Handlers) NotificationUnreadCount(c *gin.Context) {

	userID, _ := expressauth.UserID(c)
	var count int
	if h.inboxTableExists() {
		_ = h.DB.QueryRow(`SELECT COUNT(*) FROM user_notification_inbox WHERE user_id=? AND is_read=0`, userID).Scan(&count)
	} else {
		_ = h.DB.QueryRow(`SELECT COUNT(*) FROM notifications WHERE user_id=? AND (read_at IS NULL OR read_at='') AND COALESCE(is_read,0)=0`, userID).Scan(&count)
	}
	c.JSON(http.StatusOK, gin.H{"count": count})
}

func (h *Handlers) NotificationHistory(c *gin.Context) {

	userID, _ := expressauth.UserID(c)
	cursor, _ := strconv.Atoi(c.Query("cursor"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))
	if limit < 1 {
		limit = 20
	}
	if limit > 50 {
		limit = 50
	}
	list := h.fetchNotifications(userID, cursor, limit, c.Query("filter"))
	c.JSON(http.StatusOK, gin.H{"items": list, "nextCursor": h.nextNotificationCursor(list)})
}

func (h *Handlers) fetchNotifications(userID, cursor, limit int, filter string) []map[string]any {
	if h.inboxTableExists() {
		q := `SELECT id, type, title, body, is_read, COALESCE(action_status,''), COALESCE(created_at,'')
			FROM user_notification_inbox WHERE user_id=?`
		args := []any{userID}
		if cursor > 0 {
			q += ` AND id<?`
			args = append(args, cursor)
		}
		if filter == "pending" {
			q += ` AND COALESCE(action_status,'')='pending'`
		} else if filter == "system" {
			q += ` AND type='system'`
		}
		q += ` ORDER BY id DESC LIMIT ?`
		args = append(args, limit)
		return h.scanNotificationRows(h.DB.Query(q, args...))
	}
	q := `SELECT id, COALESCE(type,''), COALESCE(title,''), COALESCE(body,''), COALESCE(is_read,0), COALESCE(action_status,''), COALESCE(created_at,'')
		FROM notifications WHERE user_id=?`
	args := []any{userID}
	if cursor > 0 {
		q += ` AND id<?`
		args = append(args, cursor)
	}
	q += ` ORDER BY id DESC LIMIT ?`
	args = append(args, limit)
	return h.scanNotificationRows(h.DB.Query(q, args...))
}

func (h *Handlers) scanNotificationRows(rows *sql.Rows, err error) []map[string]any {
	if err != nil {
		return []map[string]any{}
	}
	defer rows.Close()
	list := make([]map[string]any, 0)
	for rows.Next() {
		var id, isRead int
		var typ, title, body, action, created string
		if rows.Scan(&id, &typ, &title, &body, &isRead, &action, &created) == nil {
			list = append(list, map[string]any{
				"id": id, "type": typ, "title": title, "body": body, "isRead": isRead == 1,
				"actionStatus": emptyNil(action), "created_at": created,
			})
		}
	}
	return list
}

func (h *Handlers) nextNotificationCursor(list []map[string]any) any {
	if len(list) == 0 {
		return nil
	}
	last := list[len(list)-1]
	if id, ok := last["id"].(int); ok {
		return id
	}
	return nil
}

func (h *Handlers) inboxTableExists() bool { return h.DB.HasTable("user_notification_inbox") }

func (h *Handlers) NotificationPreferencesGet(c *gin.Context) {

	userID, _ := expressauth.UserID(c)
	c.JSON(http.StatusOK, h.defaultNotificationPreferences(userID))
}

func (h *Handlers) NotificationPreferencesPut(c *gin.Context) {

	userID, _ := expressauth.UserID(c)
	body, ok := bindJSONMap(c)
	if !ok {
		return
	}
	_, _ = h.DB.Exec(`INSERT INTO user_notification_preferences (user_id) VALUES (?) ON CONFLICT(user_id) DO NOTHING`, userID)
	_, err := h.DB.Exec(`UPDATE user_notification_preferences SET
		expiring_alert=COALESCE(?, expiring_alert),
		meal_reminder=COALESCE(?, meal_reminder),
		water_reminder=COALESCE(?, water_reminder),
		breakfast_time=COALESCE(NULLIF(?,''), breakfast_time),
		lunch_time=COALESCE(NULLIF(?,''), lunch_time),
		dinner_time=COALESCE(NULLIF(?,''), dinner_time),
		updated_at=CURRENT_TIMESTAMP
		WHERE user_id=?`,
		boolField(body, "expiring_alert"), boolField(body, "meal_reminder"), boolField(body, "water_reminder"),
		strField(body, "breakfast_time"), strField(body, "lunch_time"), strField(body, "dinner_time"), userID)
	if err != nil {
		httpx.SendError(c, http.StatusInternalServerError, "保存失败", "PREFERENCES_FAILED")
		return
	}
	c.JSON(http.StatusOK, h.defaultNotificationPreferences(userID))
}

func (h *Handlers) defaultNotificationPreferences(userID int) map[string]any {
	row := map[string]any{
		"expiring_alert": true, "meal_reminder": true, "water_reminder": true,
		"breakfast_time": "08:00", "lunch_time": "12:00", "dinner_time": "18:00",
		"water_start_time": "09:00", "water_end_time": "21:00", "water_interval_minutes": 120,
		"quiet_start_time": "22:00", "quiet_end_time": "07:00", "weekdays_enabled": true, "weekends_enabled": true,
	}
	var exp, meal, water int
	var breakfast, lunch, dinner sql.NullString
	err := h.DB.QueryRow(`SELECT expiring_alert, meal_reminder, water_reminder, breakfast_time, lunch_time, dinner_time
		FROM user_notification_preferences WHERE user_id=?`, userID).Scan(&exp, &meal, &water, &breakfast, &lunch, &dinner)
	if err == nil {
		row["expiring_alert"] = exp == 1
		row["meal_reminder"] = meal == 1
		row["water_reminder"] = water == 1
		row["breakfast_time"] = nullStr(breakfast)
		row["lunch_time"] = nullStr(lunch)
		row["dinner_time"] = nullStr(dinner)
	}
	row["user_id"] = userID
	return row
}

func (h *Handlers) InterventionPreferencesGet(c *gin.Context) {

	userID, _ := expressauth.UserID(c)
	var raw string
	var ver int
	err := h.DB.QueryRow(`SELECT COALESCE(preferences_json,'{}'), COALESCE(version,1) FROM user_intervention_preferences WHERE user_id=?`, userID).Scan(&raw, &ver)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"preferences": map[string]any{}, "version": 1})
		return
	}
	var prefs any
	_ = json.Unmarshal([]byte(raw), &prefs)
	c.JSON(http.StatusOK, gin.H{"preferences": prefs, "version": ver})
}

func (h *Handlers) InterventionPreferencesPut(c *gin.Context) {

	userID, _ := expressauth.UserID(c)
	body, ok := bindJSONMap(c)
	if !ok {
		return
	}
	raw, _ := json.Marshal(body)
	_, _ = h.DB.Exec(`INSERT INTO user_intervention_preferences (user_id, preferences_json) VALUES (?, ?)
		ON CONFLICT(user_id) DO UPDATE SET preferences_json=excluded.preferences_json, version=user_intervention_preferences.version+1, updated_at=CURRENT_TIMESTAMP`,
		userID, string(raw))
	h.InterventionPreferencesGet(c)
}

func (h *Handlers) NotificationDevicePut(c *gin.Context) {

	userID, _ := expressauth.UserID(c)
	body, ok := bindJSONMap(c)
	if !ok {
		return
	}
	token := strField(body, "expo_push_token", "expoPushToken")
	platform := strField(body, "platform")
	if token == "" || platform == "" {
		httpx.SendError(c, http.StatusBadRequest, "请求参数无效", "INVALID_BODY")
		return
	}
	_, _ = h.DB.Exec(`INSERT INTO push_devices (user_id, expo_push_token, platform, is_active, updated_at)
		VALUES (?,?,?,1,CURRENT_TIMESTAMP)
		ON CONFLICT(expo_push_token) DO UPDATE SET user_id=excluded.user_id, platform=excluded.platform, is_active=1, updated_at=CURRENT_TIMESTAMP`,
		userID, token, platform)
	c.Status(http.StatusNoContent)
}

func (h *Handlers) NotificationReadAll(c *gin.Context) {

	userID, _ := expressauth.UserID(c)
	now := nowRFC3339()
	var res sql.Result
	var err error
	if h.inboxTableExists() {
		res, err = h.DB.Exec(`UPDATE user_notification_inbox SET is_read=1 WHERE user_id=? AND is_read=0`, userID)
	} else {
		res, err = h.DB.Exec(`UPDATE notifications SET is_read=1, read_at=? WHERE user_id=? AND (read_at IS NULL OR read_at='')`, now, userID)
	}
	if err != nil {
		httpx.SendError(c, http.StatusInternalServerError, "更新失败", "READ_ALL_FAILED")
		return
	}
	n, _ := res.RowsAffected()
	c.JSON(http.StatusOK, gin.H{"updated": n})
}

func (h *Handlers) ReadNotificationPut(c *gin.Context) {
	h.markNotificationRead(c)
}

func (h *Handlers) markNotificationRead(c *gin.Context) {

	userID, _ := expressauth.UserID(c)
	id, _ := strconv.Atoi(c.Param("id"))
	if id <= 0 {
		httpx.SendError(c, http.StatusBadRequest, "通知 ID 无效", "INVALID_ID")
		return
	}
	now := nowRFC3339()
	var found bool
	if h.inboxTableExists() {
		res, _ := h.DB.Exec(`UPDATE user_notification_inbox SET is_read=1 WHERE id=? AND user_id=?`, id, userID)
		found = mustRows(res) == 1
	} else {
		res, _ := h.DB.Exec(`UPDATE notifications SET read_at=?, is_read=1 WHERE id=? AND user_id=?`, now, id, userID)
		found = mustRows(res) == 1
	}
	if !found {
		httpx.SendError(c, http.StatusNotFound, "通知不存在", "NOT_FOUND")
		return
	}
	c.JSON(http.StatusOK, gin.H{"id": id, "isRead": true, "read": true})
}

func (h *Handlers) NotificationAction(c *gin.Context) {

	userID, _ := expressauth.UserID(c)
	id, _ := strconv.Atoi(c.Param("id"))
	body, ok := bindJSONMap(c)
	if !ok {
		return
	}
	action := strField(body, "action")
	var found bool
	if h.inboxTableExists() {
		res, _ := h.DB.Exec(`UPDATE user_notification_inbox SET action_status=? WHERE id=? AND user_id=?`,
			mapActionStatus(action), id, userID)
		found = mustRows(res) == 1
	} else {
		res, _ := h.DB.Exec(`UPDATE notifications SET action_status=? WHERE id=? AND user_id=?`, mapActionStatus(action), id, userID)
		found = mustRows(res) == 1
	}
	if !found {
		httpx.SendError(c, http.StatusNotFound, "通知不存在", "NOT_FOUND")
		return
	}
	status := "pending"
	if action == "complete" {
		status = "completed"
	}
	c.JSON(http.StatusOK, gin.H{"id": id, "action": action, "actionStatus": status})
}

func mapActionStatus(action string) string {
	if action == "complete" {
		return "completed"
	}
	return "pending"
}

func (h *Handlers) NotificationLocalEvent(c *gin.Context) {

	userID, _ := expressauth.UserID(c)
	body, ok := bindJSONMap(c)
	if !ok {
		return
	}
	title := strField(body, "title")
	bodyText := strField(body, "body")
	kind := strField(body, "kind")
	if title == "" {
		title = "本地提醒"
	}
	var id int64
	var err error
	if h.inboxTableExists() {
		id, err = h.DB.InsertID(`INSERT INTO user_notification_inbox (user_id, type, title, body) VALUES (?,?,?,?)`,
			userID, kindOrDefault(kind), title, bodyText)
	} else {
		id, err = h.DB.InsertID(`INSERT INTO notifications (user_id, type, title, body) VALUES (?,?,?,?)`,
			userID, kindOrDefault(kind), title, bodyText)
	}
	if err != nil {
		httpx.SendError(c, http.StatusInternalServerError, "创建通知失败", "LOCAL_EVENT_FAILED")
		return
	}
	c.JSON(http.StatusCreated, gin.H{"id": id})
}

func kindOrDefault(kind string) string {
	if strings.TrimSpace(kind) == "" {
		return "local"
	}
	return kind
}

func (h *Handlers) ensureInterventionColumns() {
	cols := []struct{ name, ddl string }{
		{"intervention_type", `ALTER TABLE notification_interventions ADD COLUMN intervention_type TEXT`},
		{"payload_json", `ALTER TABLE notification_interventions ADD COLUMN payload_json TEXT`},
		{"feedback_json", `ALTER TABLE notification_interventions ADD COLUMN feedback_json TEXT`},
		{"status", `ALTER TABLE notification_interventions ADD COLUMN status TEXT DEFAULT 'inbox'`},
	}
	for _, col := range cols {
		if !h.hasColumn("notification_interventions", col.name) {
			_, _ = h.DB.Exec(col.ddl)
		}
	}
}

func interventionIDFromSeed(seed string) string {
	sum := sha256.Sum256([]byte(seed))
	return hex.EncodeToString(sum[:])
}

func (h *Handlers) synthesizeInventoryIntervention(userID int, requestedID string) (string, string, string, map[string]any, error) {
	if !h.hasTable("inventory_items") {
		return "", "", "", nil, sql.ErrNoRows
	}
	interventionID := requestedID
	if interventionID == "" {
		interventionID = interventionIDFromSeed(fmt.Sprintf("inventory_expiry:%d:%s", userID, todayDateKey()))
	}
	horizon := time.Now().UTC().AddDate(0, 0, 3).Format("2006-01-02")
	today := todayDateKey()
	rows, err := h.DB.Query(`SELECT id, food_name, category, COALESCE(expiration_date,''), COALESCE(quantity,'')
		FROM inventory_items
		WHERE user_id=? AND deleted_at IS NULL AND COALESCE(is_available,1)=1
			AND expiration_date IS NOT NULL AND expiration_date != ''
			AND expiration_date >= ? AND expiration_date <= ?
		ORDER BY expiration_date ASC LIMIT 20`, userID, today, horizon)
	if err != nil {
		return "", "", "", nil, err
	}
	defer rows.Close()
	items := make([]map[string]any, 0)
	for rows.Next() {
		var id int
		var name, category, expiry, qty string
		if rows.Scan(&id, &name, &category, &expiry, &qty) == nil {
			items = append(items, map[string]any{
				"id": id, "foodName": name, "category": category, "expirationDate": expiry, "quantity": qty,
			})
		}
	}
	if len(items) == 0 {
		return "", "", "", nil, sql.ErrNoRows
	}
	title := "临期食材提醒"
	body := fmt.Sprintf("你有 %d 项食材即将过期，建议优先安排餐次", len(items))
	card := map[string]any{
		"id": interventionID, "kind": "inventory_expiry", "status": "inbox",
		"title": title, "body": body, "inventoryIds": pluckIntIDs(items),
		"items": items, "policyVersion": "go-synth-1",
	}
	payload, _ := json.Marshal(map[string]any{"type": "inventory_expiry", "items": items})
	cardRaw, _ := json.Marshal(card)
	_, _ = h.DB.Exec(`INSERT INTO notification_interventions
		(id, user_id, intervention_type, title, body, card_json, payload_json, status, created_at)
		VALUES (?, ?, 'inventory_expiry', ?, ?, ?, ?, 'inbox', CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET user_id=excluded.user_id, intervention_type=excluded.intervention_type, title=excluded.title, body=excluded.body, card_json=excluded.card_json, payload_json=excluded.payload_json, status=excluded.status, created_at=excluded.created_at`,
		interventionID, userID, title, body, string(cardRaw), string(payload))
	return interventionID, title, body, card, nil
}

func pluckIntIDs(items []map[string]any) []int {
	out := make([]int, 0, len(items))
	for _, item := range items {
		switch v := item["id"].(type) {
		case int:
			out = append(out, v)
		case float64:
			out = append(out, int(v))
		}
	}
	return out
}

func (h *Handlers) InterventionGet(c *gin.Context) {

	h.ensureInterventionColumns()
	userID, _ := expressauth.UserID(c)
	id := c.Param("id")
	if !interventionIDPattern.MatchString(id) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "干预 ID 无效"})
		return
	}
	if h.hasTable("proactive_interventions") {
		if card, ok := h.proactiveInterventionCard(userID, id); ok {
			c.JSON(http.StatusOK, card)
			return
		}
	}
	var title, body, card, interventionType, status string
	err := h.DB.QueryRow(`SELECT COALESCE(title,''), COALESCE(body,''), COALESCE(card_json,'{}'),
		COALESCE(intervention_type,''), COALESCE(status,'inbox')
		FROM notification_interventions WHERE id=? AND user_id=?`, id, userID).Scan(&title, &body, &card, &interventionType, &status)
	if errors.Is(err, sql.ErrNoRows) {
		sid, st, sb, parsed, synErr := h.synthesizeInventoryIntervention(userID, id)
		if synErr != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "干预通知不存在"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"id": sid, "title": st, "body": sb, "card": parsed, "type": "inventory_expiry", "status": "inbox"})
		return
	}
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "干预通知不存在"})
		return
	}
	var parsed any
	_ = json.Unmarshal([]byte(card), &parsed)
	c.JSON(http.StatusOK, gin.H{"id": id, "title": title, "body": body, "card": parsed, "type": interventionType, "status": status})
}

func (h *Handlers) proactiveInterventionCard(userID int, id string) (map[string]any, bool) {
	var kind, status, candidateJSON string
	var notificationID sql.NullInt64
	var expiresAt sql.NullString
	err := h.DB.QueryRow(`SELECT kind, status, COALESCE(candidate_json,'{}'), notification_id, expires_at
		FROM proactive_interventions WHERE user_id=? AND id=?`, userID, id).
		Scan(&kind, &status, &candidateJSON, &notificationID, &expiresAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, false
	}
	if err != nil {
		return nil, false
	}
	var candidate map[string]any
	_ = json.Unmarshal([]byte(candidateJSON), &candidate)
	title := strField(candidate, "title")
	body := strField(candidate, "body")
	whyNow := strField(candidate, "whyNow", "why_now")
	expiresLabel := strField(candidate, "expiresLabel", "expires_label")
	localDate := strField(candidate, "localDate", "local_date")
	if h.hasColumn("proactive_interventions", "title") {
		var rowTitle string
		_ = h.DB.QueryRow(`SELECT COALESCE(title,'') FROM proactive_interventions WHERE user_id=? AND id=?`, userID, id).Scan(&rowTitle)
		if rowTitle != "" {
			title = rowTitle
		}
	}
	if h.hasColumn("proactive_interventions", "body") {
		var rowBody string
		_ = h.DB.QueryRow(`SELECT COALESCE(body,'') FROM proactive_interventions WHERE user_id=? AND id=?`, userID, id).Scan(&rowBody)
		if rowBody != "" {
			body = rowBody
		}
	}
	inventoryIDs := jsonIntSlice(candidate["inventoryIds"])
	recipeIDs := jsonIntSlice(candidate["recipeIds"])
	if h.hasColumn("proactive_interventions", "inventory_ids_json") {
		var invJSON string
		_ = h.DB.QueryRow(`SELECT COALESCE(inventory_ids_json,'[]') FROM proactive_interventions WHERE user_id=? AND id=?`, userID, id).Scan(&invJSON)
		_ = json.Unmarshal([]byte(invJSON), &inventoryIDs)
	}
	if h.hasColumn("proactive_interventions", "recipe_ids_json") {
		var recJSON string
		_ = h.DB.QueryRow(`SELECT COALESCE(recipe_ids_json,'[]') FROM proactive_interventions WHERE user_id=? AND id=?`, userID, id).Scan(&recJSON)
		_ = json.Unmarshal([]byte(recJSON), &recipeIDs)
	}
	actions := []string{"plan_recipe", "view_alternatives", "not_helpful"}
	if raw, ok := candidate["actions"].([]any); ok {
		actions = make([]string, 0, len(raw))
		for _, item := range raw {
			if s := asInterventionString(item); s != "" {
				actions = append(actions, s)
			}
		}
	}
	if status == "acted" {
		actions = []string{}
	}
	card := map[string]any{
		"id": id, "notificationId": nullInt(notificationID), "kind": kind, "status": status,
		"title": title, "body": body, "whyNow": whyNow, "expiresLabel": expiresLabel,
		"expiresAt": nullStr(expiresAt), "localDate": localDate, "inventoryIds": inventoryIDs,
		"recipeIds": recipeIDs, "actions": actions, "policyVersion": strField(candidate, "policyVersion"),
	}
	if card["policyVersion"] == "" {
		card["policyVersion"] = "go-proactive-v1"
	}
	return card, true
}

func jsonIntSlice(v any) []int {
	raw, ok := v.([]any)
	if !ok {
		return nil
	}
	out := make([]int, 0, len(raw))
	for _, item := range raw {
		switch n := item.(type) {
		case float64:
			out = append(out, int(n))
		case int:
			out = append(out, n)
		}
	}
	return out
}

func asInterventionString(v any) string {
	if s, ok := v.(string); ok {
		return strings.TrimSpace(s)
	}
	return ""
}

func nullInt(v sql.NullInt64) any {
	if !v.Valid {
		return nil
	}
	return v.Int64
}

func (h *Handlers) InterventionFeedback(c *gin.Context) {

	h.ensureInterventionColumns()
	userID, _ := expressauth.UserID(c)
	id := c.Param("id")
	if !interventionIDPattern.MatchString(id) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "干预 ID 无效"})
		return
	}
	body, ok := bindJSONMap(c)
	if !ok {
		return
	}
	proactiveRow := false
	if h.hasTable("proactive_interventions") {
		var one int
		if h.DB.QueryRow(`SELECT 1 FROM proactive_interventions WHERE user_id=? AND id=?`, userID, id).Scan(&one) == nil {
			proactiveRow = true
		}
	}
	if !proactiveRow {
		var currentStatus string
		err := h.DB.QueryRow(`SELECT COALESCE(status,'inbox') FROM notification_interventions WHERE id=? AND user_id=?`, id, userID).
			Scan(&currentStatus)
		if errors.Is(err, sql.ErrNoRows) {
			if _, _, _, _, synErr := h.synthesizeInventoryIntervention(userID, id); synErr != nil {
				c.JSON(http.StatusNotFound, gin.H{"error": "干预通知不存在", "code": "NOT_FOUND"})
				return
			}
		} else if err != nil {
			httpx.SendError(c, http.StatusInternalServerError, "保存反馈失败", "INTERVENTION_FEEDBACK_FAILED")
			return
		}
	}
	feedbackRaw, _ := json.Marshal(body)
	action := strings.TrimSpace(strField(body, "action"))
	nextStatus := "acted"
	if action == "not_helpful" || action == "dismiss" || action == "disable" {
		nextStatus = "dismissed"
	}
	if h.hasTable("proactive_interventions") {
		if h.recordProactiveInterventionFeedback(userID, id, action, body, string(feedbackRaw), nextStatus) {
			h.applyProactiveFeedbackPreferences(userID, action)
			c.JSON(http.StatusOK, gin.H{
				"ok": true, "interventionId": id, "status": nextStatus, "feedback": body,
				"result": map[string]any{
					"interventionId": id, "action": action,
					"idempotencyKey": strField(body, "idempotencyKey", "idempotency_key"),
					"snoozedUntil":   nil, "notCookingDate": nil, "repeated": false,
				},
			})
			return
		}
	}
	_, err := h.DB.Exec(`UPDATE notification_interventions SET feedback_json=?, status=? WHERE id=? AND user_id=?`,
		string(feedbackRaw), nextStatus, id, userID)
	if err != nil {
		httpx.SendError(c, http.StatusInternalServerError, "保存反馈失败", "INTERVENTION_FEEDBACK_FAILED")
		return
	}
	if action == "not_helpful" || action == "disable" {
		h.mergeInterventionPreferences(userID, map[string]any{"enabled": false})
	} else if action == "dismiss" {
		h.mergeInterventionPreferences(userID, map[string]any{"expiry_rescue": false, "dinner_window": false})
	}
	c.JSON(http.StatusOK, gin.H{
		"ok": true, "interventionId": id, "status": nextStatus, "feedback": body,
		"result": map[string]any{
			"interventionId": id, "action": action,
			"idempotencyKey": strField(body, "idempotencyKey", "idempotency_key"),
			"snoozedUntil":   nil, "notCookingDate": nil, "repeated": false,
		},
	})
}

func (h *Handlers) recordProactiveInterventionFeedback(userID int, id, action string, request map[string]any, feedback string, status string) bool {
	var exists int
	if err := h.DB.QueryRow(`SELECT 1 FROM proactive_interventions WHERE user_id=? AND id=?`, userID, id).Scan(&exists); err != nil {
		return false
	}
	_, _ = h.DB.Exec(`UPDATE proactive_interventions SET status=?, updated_at=CURRENT_TIMESTAMP WHERE user_id=? AND id=?`,
		status, userID, id)
	if h.hasTable("proactive_intervention_actions") {
		idem := strField(request, "idempotencyKey", "idempotency_key")
		if idem == "" {
			idem = id + ":" + action
		}
		reqJSON, _ := json.Marshal(request)
		_, _ = h.DB.Exec(`INSERT INTO proactive_intervention_actions
			(id, intervention_id, user_id, idempotency_key, action, request_json, result_json)
			VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
			newUUID(), id, userID, idem, action, string(reqJSON), feedback)
	}
	_, _ = h.DB.Exec(`UPDATE notification_interventions SET feedback_json=?, status=? WHERE id=? AND user_id=?`,
		feedback, status, id, userID)
	return true
}

func (h *Handlers) applyProactiveFeedbackPreferences(userID int, action string) {
	if !h.hasTable("proactive_intervention_preferences") {
		h.mergeInterventionPreferences(userID, map[string]any{})
		return
	}
	switch action {
	case "not_helpful", "disable":
		_, _ = h.DB.Exec(`UPDATE proactive_intervention_preferences SET enabled=0, updated_at=CURRENT_TIMESTAMP WHERE user_id=?`, userID)
		h.mergeInterventionPreferences(userID, map[string]any{"enabled": false})
	case "snooze":
		_, _ = h.DB.Exec(`UPDATE proactive_intervention_preferences SET expiry_rescue=0, updated_at=CURRENT_TIMESTAMP WHERE user_id=?`, userID)
	case "not_cooking_today":
		today := todayDateKey()
		extras, _ := json.Marshal(map[string]any{"not_cooking_date": today})
		_, _ = h.DB.Exec(`UPDATE proactive_intervention_preferences SET extras_json=?, updated_at=CURRENT_TIMESTAMP WHERE user_id=?`,
			string(extras), userID)
	case "dismiss":
		_, _ = h.DB.Exec(`UPDATE proactive_intervention_preferences SET expiry_rescue=0, dinner_window=0, updated_at=CURRENT_TIMESTAMP WHERE user_id=?`, userID)
		h.mergeInterventionPreferences(userID, map[string]any{"expiry_rescue": false, "dinner_window": false})
	}
}

func (h *Handlers) mergeInterventionPreferences(userID int, patch map[string]any) {
	var raw string
	var ver int
	err := h.DB.QueryRow(`SELECT COALESCE(preferences_json,'{}'), COALESCE(version,1) FROM user_intervention_preferences WHERE user_id=?`, userID).
		Scan(&raw, &ver)
	prefs := map[string]any{}
	if err == nil {
		_ = json.Unmarshal([]byte(raw), &prefs)
	}
	for k, v := range patch {
		prefs[k] = v
	}
	prefs["version"] = ver + 1
	next, _ := json.Marshal(prefs)
	_, _ = h.DB.Exec(`INSERT INTO user_intervention_preferences (user_id, preferences_json, version, updated_at)
		VALUES (?, ?, ?, CURRENT_TIMESTAMP)
		ON CONFLICT(user_id) DO UPDATE SET preferences_json=excluded.preferences_json, version=excluded.version, updated_at=CURRENT_TIMESTAMP`,
		userID, string(next), ver+1)
}
