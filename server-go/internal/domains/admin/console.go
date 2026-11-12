// Copyright (c) 2026 heathcetide. All rights reserved.

package admin

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/heathcetide/DietDigiDose/internal/expressauth"
	"github.com/heathcetide/DietDigiDose/internal/httpx"
)

func (h *Handlers) tableCount(table, extraWhere string) int {
	if !h.hasTable(table) {
		return 0
	}
	q := `SELECT COUNT(*) FROM ` + table
	if extraWhere != "" {
		q += ` WHERE ` + extraWhere
	}
	var n int
	if h.DB.QueryRow(q).Scan(&n) != nil {
		return 0
	}
	return n
}

func (h *Handlers) StatsGet(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"users":              h.tableCount("users", ""),
		"posts":              h.tableCount("community_posts", "deleted_at IS NULL"),
		"recipes":            h.tableCount("recipes", h.deletedAtClause("recipes")),
		"inventory":          h.tableCount("inventory_items", ""),
		"ingredients":        h.tableCount("ingredients_library", ""),
		"kitchenware":        h.tableCount("kitchenware_items", h.deletedAtClause("kitchenware_items")),
		"kitchenwareCatalog": h.tableCount("kitchenware_catalog", ""),
	})
}

func (h *Handlers) deletedAtClause(table string) string {
	if h.hasColumn(table, "deleted_at") {
		return "deleted_at IS NULL"
	}
	return ""
}

func (h *Handlers) StatsTrends(c *gin.Context) {
	days := 30
	if raw := strings.TrimSpace(c.Query("days")); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n >= 7 && n <= 90 {
			days = n
		}
	}
	loc := time.FixedZone("CST", 8*3600)
	now := time.Now().In(loc)
	rows := make([]map[string]any, 0, days)
	for offset := days - 1; offset >= 0; offset-- {
		date := now.AddDate(0, 0, -offset).Format("2006-01-02")
		countOn := func(table, dateCol, extra string) int {
			if !h.hasTable(table) || !h.hasColumn(table, dateCol) {
				return 0
			}
			// Match both "YYYY-MM-DD …" and ISO "YYYY-MM-DDT…" prefixes.
			q := `SELECT COUNT(*) FROM ` + table + ` WHERE substr(replace(` + dateCol + `, 'T', ' '),1,10)=?`
			if extra != "" {
				q += ` AND ` + extra
			}
			var n int
			_ = h.DB.QueryRow(q, date).Scan(&n)
			return n
		}
		postsExtra := h.deletedAtClause("community_posts")
		userDate := "created_at"
		if !h.hasColumn("users", "created_at") {
			userDate = "id"
		}
		rows = append(rows, map[string]any{
			"date":        date,
			"users":       countOn("users", userDate, ""),
			"records":     countOn("diet_records", "created_at", ""),
			"posts":       countOn("community_posts", "created_at", postsExtra),
			"comments":    countOn("community_comments", "created_at", ""),
			"ingredients": countOn("ingredients_library", "created_at", ""),
			"recipes":     countOn("recipes", "created_at", h.deletedAtClause("recipes")),
			"kitchenware": countOn("kitchenware_catalog", "created_at", ""),
		})
	}
	c.JSON(http.StatusOK, rows)
}

func (h *Handlers) StatsRecent(c *gin.Context) {
	recentUsers := h.queryRows(`SELECT id, username, avatar_url, created_at FROM users ORDER BY created_at DESC LIMIT 5`)
	recentPosts := []map[string]any{}
	if h.hasTable("community_posts") {
		extra := ""
		if h.hasColumn("community_posts", "deleted_at") {
			extra = "WHERE deleted_at IS NULL "
		}
		recentPosts = h.queryRows(`SELECT id, username, content, image_url, category, created_at FROM community_posts ` + extra + `ORDER BY created_at DESC LIMIT 5`)
	}
	pendingFoods := []map[string]any{}
	if h.hasTable("user_custom_foods") {
		pendingFoods = h.queryRows(`SELECT f.id, f.name, f.calories_100g, f.created_at, u.username AS author_name
			FROM user_custom_foods f LEFT JOIN users u ON u.id=f.user_id WHERE f.status='pending' ORDER BY f.created_at DESC LIMIT 5`)
	}
	c.JSON(http.StatusOK, gin.H{
		"recentUsers":  recentUsers,
		"recentPosts":  recentPosts,
		"pendingFoods": pendingFoods,
	})
}

func (h *Handlers) queryRows(q string, args ...any) []map[string]any {
	rows, err := h.DB.Query(q, args...)
	if err != nil {
		return []map[string]any{}
	}
	defer rows.Close()
	cols, _ := rows.Columns()
	types, _ := rows.ColumnTypes()
	aliases := map[string]string{}
	for _, match := range regexp.MustCompile(`(?i)\bAS\s+([a-z_][a-z_0-9]*)`).FindAllStringSubmatch(q, -1) {
		aliases[strings.ToLower(match[1])] = match[1]
	}
	for i, name := range cols {
		if alias, ok := aliases[strings.ToLower(name)]; ok {
			cols[i] = alias
		}
	}
	out := make([]map[string]any, 0)
	for rows.Next() {
		dest := make([]any, len(cols))
		ptrs := make([]any, len(cols))
		for i := range dest {
			ptrs[i] = &dest[i]
		}
		if rows.Scan(ptrs...) != nil {
			continue
		}
		item := map[string]any{}
		for i, name := range cols {
			if i < len(types) && types[i].DatabaseTypeName() == "NUMERIC" {
				if v, err := strconv.ParseFloat(fmt.Sprint(dest[i]), 64); err == nil {
					item[name] = v
					continue
				}
			}
			switch v := dest[i].(type) {
			case []byte:
				item[name] = string(v)
			default:
				item[name] = v
			}
		}
		out = append(out, item)
	}
	return out
}

func (h *Handlers) AuditLogsList(c *gin.Context) {
	page := 1
	pageSize := 20
	if p := strings.TrimSpace(c.Query("page")); p != "" {
		if n, err := strconv.Atoi(p); err == nil && n > 0 {
			page = n
		}
	}
	if ps := strings.TrimSpace(c.Query("pageSize")); ps != "" {
		if n, err := strconv.Atoi(ps); err == nil && n >= 10 && n <= 100 {
			pageSize = n
		}
	}
	if !h.hasTable("admin_audit_logs") {
		c.JSON(http.StatusOK, gin.H{"items": []any{}, "total": 0, "page": page, "pageSize": pageSize})
		return
	}
	filters := []string{}
	args := []any{}
	if a := strings.TrimSpace(c.Query("action")); a != "" {
		filters = append(filters, "l.action=?")
		args = append(args, a)
	}
	if rt := strings.TrimSpace(c.Query("resourceType")); rt != "" {
		filters = append(filters, "l.resource_type=?")
		args = append(args, rt)
	}
	where := ""
	if len(filters) > 0 {
		where = "WHERE " + strings.Join(filters, " AND ")
	}
	var total int
	_ = h.DB.QueryRow(`SELECT COUNT(*) FROM admin_audit_logs l `+where, args...).Scan(&total)
	q := `SELECT l.id, l.admin_user_id, COALESCE(u.username,'已删除管理员') AS admin_name,
		l.action, l.resource_type, l.resource_id, l.summary, l.details_json,
		COALESCE(l.ip_address,''), COALESCE(l.user_agent,''), COALESCE(l.created_at,'')
		FROM admin_audit_logs l LEFT JOIN users u ON u.id=l.admin_user_id ` + where +
		` ORDER BY l.id DESC LIMIT ? OFFSET ?`
	args = append(args, pageSize, (page-1)*pageSize)
	rows, err := h.DB.Query(q, args...)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"items": []any{}, "total": 0, "page": page, "pageSize": pageSize})
		return
	}
	defer rows.Close()
	items := make([]map[string]any, 0)
	for rows.Next() {
		var id, adminID int
		var adminName, action, rtype, rid, summary, details, ip, ua, created string
		if rows.Scan(&id, &adminID, &adminName, &action, &rtype, &rid, &summary, &details, &ip, &ua, &created) != nil {
			continue
		}
		var detailsJSON any = details
		if details != "" {
			detailsJSON = details
		}
		items = append(items, map[string]any{
			"id": id, "adminUserId": adminID, "adminName": adminName, "action": action,
			"resourceType": rtype, "resourceId": rid, "summary": summary, "detailsJson": detailsJSON,
			"ipAddress": ip, "userAgent": ua, "createdAt": created,
		})
	}
	c.JSON(http.StatusOK, gin.H{"items": items, "total": total, "page": page, "pageSize": pageSize})
}

func (h *Handlers) ChatConversationsList(c *gin.Context) {
	if !h.hasTable("ai_chat_messages") {
		c.JSON(http.StatusOK, gin.H{"items": []any{}})
		return
	}
	search := strings.TrimSpace(c.Query("query"))
	q := `
		SELECT m.user_id AS userId, m.session_id AS sessionId, u.username,
			SUM(CASE WHEN m.role='user' THEN 1 ELSE 0 END) AS turnCount,
			SUM(CASE WHEN m.role IN ('user','assistant') THEN 1 ELSE 0 END) AS messageCount,
			ROUND(AVG(CASE WHEN m.role='assistant' AND COALESCE(m.status,'completed')='completed' THEN COALESCE(m.response_time_ms,0) END)) AS avgResponseTimeMs,
			SUM(CASE WHEN m.role='assistant' AND m.status='failed' THEN 1 ELSE 0 END) AS failedCount,
			GROUP_CONCAT(DISTINCT COALESCE(m.source,'')) AS sources, MAX(m.created_at) AS updatedAt,
			(SELECT content FROM ai_chat_messages x WHERE x.user_id=m.user_id AND x.session_id=m.session_id AND x.role='user' ORDER BY x.id DESC LIMIT 1) AS lastUserMessage
		FROM ai_chat_messages m JOIN users u ON u.id=m.user_id`
	args := []any{}
	if search != "" {
		q += ` WHERE u.username LIKE ? OR CAST(u.id AS TEXT) LIKE ?`
		like := "%" + search + "%"
		args = append(args, like, like)
	}
	if h.DB.Dialect == "postgresql" {
		q = strings.Replace(q, "GROUP_CONCAT(DISTINCT COALESCE(m.source,''))", "STRING_AGG(DISTINCT COALESCE(m.source,''), ',')", 1)
	}
	q += ` GROUP BY m.user_id, m.session_id, u.username ORDER BY MAX(m.id) DESC LIMIT 100`
	rows, err := h.DB.Query(q, args...)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"items": []any{}})
		return
	}
	defer rows.Close()
	items := make([]map[string]any, 0)
	for rows.Next() {
		var userID, turnCount, messageCount, avgRT, failedCount int
		var sessionID, username, sources, updatedAt, lastUser string
		if rows.Scan(&userID, &sessionID, &username, &turnCount, &messageCount, &avgRT, &failedCount, &sources, &updatedAt, &lastUser) == nil {
			items = append(items, map[string]any{
				"userId": userID, "sessionId": sessionID, "username": username,
				"turnCount": turnCount, "messageCount": messageCount, "avgResponseTimeMs": avgRT,
				"failedCount": failedCount, "sources": sources, "updatedAt": updatedAt, "lastUserMessage": lastUser,
			})
		}
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

func (h *Handlers) ChatConversationDetail(c *gin.Context) {
	userID, err := strconv.Atoi(c.Param("userId"))
	sessionID := strings.TrimSpace(c.Param("sessionId"))
	if err != nil || userID <= 0 || sessionID == "" {
		httpx.SendError(c, http.StatusBadRequest, "会话参数无效", "INVALID_PARAMS")
		return
	}
	var username string
	err = h.DB.QueryRow(`SELECT username FROM users WHERE id=?`, userID).Scan(&username)
	if err == sql.ErrNoRows {
		httpx.SendError(c, http.StatusNotFound, "用户不存在", "USER_NOT_FOUND")
		return
	}
	if !h.hasTable("ai_chat_messages") {
		httpx.SendError(c, http.StatusNotFound, "对话不存在", "CONVERSATION_NOT_FOUND")
		return
	}
	rows, err := h.DB.Query(`SELECT m.id, m.role, m.content, COALESCE(m.response_time_ms,0), COALESCE(m.source,''),
		COALESCE(m.status,'completed'), COALESCE(m.payload_json,''), m.created_at, COALESCE(c.status,'')
		FROM ai_chat_messages m LEFT JOIN ai_write_confirmations c ON c.id=m.confirmation_id
		WHERE m.user_id=? AND m.session_id=? ORDER BY m.id`, userID, sessionID)
	if err != nil {
		httpx.SendError(c, http.StatusNotFound, "对话不存在", "CONVERSATION_NOT_FOUND")
		return
	}
	defer rows.Close()
	messages := make([]map[string]any, 0)
	for rows.Next() {
		var id, rt int
		var role, content, source, status, payload, created, confirm string
		if rows.Scan(&id, &role, &content, &rt, &source, &status, &payload, &created, &confirm) != nil {
			continue
		}
		var parsed any
		if strings.TrimSpace(payload) != "" {
			if json.Unmarshal([]byte(payload), &parsed) != nil {
				parsed = payload
			}
		}
		messages = append(messages, map[string]any{
			"id": id, "role": role, "content": content, "responseTimeMs": rt, "source": source,
			"status": status, "payload": parsed, "createdAt": created, "confirmationStatus": nullIfEmpty(confirm),
		})
	}
	if len(messages) == 0 {
		httpx.SendError(c, http.StatusNotFound, "对话不存在", "CONVERSATION_NOT_FOUND")
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"user":      map[string]any{"id": userID, "username": username},
		"sessionId": sessionID,
		"messages":  messages,
	})
}

func (h *Handlers) TrashList(c *gin.Context) {
	trashTable := func(table, titleCol string) []map[string]any {
		if !h.hasTable(table) || !h.hasColumn(table, "deleted_at") {
			return []map[string]any{}
		}
		return h.queryRows(`SELECT id, ` + titleCol + ` AS title, deleted_at AS deletedAt FROM ` + table + ` WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC`)
	}
	c.JSON(http.StatusOK, gin.H{
		"community":   trashTable("community_posts", "content"),
		"recipes":     trashTable("recipes", "title"),
		"ingredients": trashTable("ingredients_library", "name"),
		"kitchenware": trashTable("kitchenware_items", "name"),
	})
}

var trashTables = map[string]string{
	"community":   "community_posts",
	"recipes":     "recipes",
	"ingredients": "ingredients_library",
	"kitchenware": "kitchenware_items",
}

func (h *Handlers) TrashRestore(c *gin.Context) {
	resource := c.Param("resource")
	table, ok := trashTables[resource]
	if !ok {
		httpx.SendError(c, http.StatusBadRequest, "无效的回收站资源", "INVALID_TRASH_RESOURCE")
		return
	}
	id, ok := parseIDParam(c)
	if !ok {
		return
	}
	if !h.hasTable(table) || !h.hasColumn(table, "deleted_at") {
		httpx.SendError(c, http.StatusNotFound, "回收站中未找到该记录", "TRASH_NOT_FOUND")
		return
	}
	set := `deleted_at=NULL`
	if h.hasColumn(table, "deleted_by") {
		set += `, deleted_by=NULL`
	}
	res, err := h.DB.Exec(`UPDATE `+table+` SET `+set+` WHERE id=? AND deleted_at IS NOT NULL`, id)
	if err != nil || mustRows(res) == 0 {
		httpx.SendError(c, http.StatusNotFound, "回收站中未找到该记录", "TRASH_NOT_FOUND")
		return
	}
	h.recordAudit(c, resource+".restore", resource, strconv.Itoa(id), "从回收站恢复")
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "已恢复"})
}

func (h *Handlers) AIUsageGet(c *gin.Context) {
	rangeKey := strings.TrimSpace(c.Query("range"))
	if rangeKey == "" {
		rangeKey = "30d"
	}
	ranges := map[string]*int{"7d": ptr(7), "30d": ptr(30), "90d": ptr(90), "all": nil}
	rangeDays, ok := ranges[rangeKey]
	if !ok {
		rangeKey = "30d"
		rangeDays = ptr(30)
	}
	var selectedUserID any = nil
	if u := strings.TrimSpace(c.Query("userId")); u != "" {
		if uid, err := strconv.Atoi(u); err == nil && uid > 0 {
			selectedUserID = uid
		}
	}
	emptySummary := map[string]any{
		"requests": 0, "promptTokens": 0, "completionTokens": 0, "totalTokens": 0,
		"estimatedCostUsd": 0, "avgLatencyMs": 0, "successRate": 0, "activeUsers": 0,
	}
	if !h.hasTable("ai_usage_logs") {
		c.JSON(http.StatusOK, gin.H{
			"range": rangeKey, "selectedUserId": selectedUserID, "summary": emptySummary,
			"trend": []any{}, "models": []any{}, "endpoints": []any{}, "users": []any{}, "failures": []any{},
		})
		return
	}
	where := []string{}
	args := []any{}
	if rangeDays != nil {
		where = append(where, "created_at >= ?")
		args = append(args, time.Now().UTC().AddDate(0, 0, -*rangeDays).Format("2006-01-02"))
	}
	if selectedUserID != nil {
		where = append(where, "user_id=?")
		args = append(args, selectedUserID)
	}
	whereSQL := ""
	if len(where) > 0 {
		whereSQL = "WHERE " + strings.Join(where, " AND ")
	}
	summary := h.queryOne(`SELECT COUNT(*) AS requests, COALESCE(SUM(prompt_tokens),0) AS promptTokens,
		COALESCE(SUM(completion_tokens),0) AS completionTokens, COALESCE(SUM(total_tokens),0) AS totalTokens,
		COALESCE(ROUND(CAST(SUM(estimated_cost_usd) AS NUMERIC),6),0) AS estimatedCostUsd, COALESCE(ROUND(AVG(latency_ms)),0) AS avgLatencyMs,
		COALESCE(ROUND(100.0*SUM(CASE WHEN success=1 THEN 1 ELSE 0 END)/NULLIF(COUNT(*),0),1),0) AS successRate,
		COUNT(DISTINCT user_id) AS activeUsers FROM ai_usage_logs `+whereSQL, args...)
	trend := h.queryRows(`SELECT substr(created_at,1,10) AS date, COUNT(*) AS requests, COALESCE(SUM(prompt_tokens),0) AS promptTokens,
		COALESCE(SUM(completion_tokens),0) AS completionTokens, COALESCE(SUM(total_tokens),0) AS totalTokens
		FROM ai_usage_logs `+whereSQL+` GROUP BY substr(created_at,1,10) ORDER BY substr(created_at,1,10)`, args...)
	failWhere := whereSQL
	if failWhere == "" {
		failWhere = "WHERE success=0"
	} else {
		failWhere += " AND success=0"
	}
	failures := h.queryRows(`SELECT endpoint, model, failure_reason AS failureReason, latency_ms AS latencyMs, created_at AS createdAt
		FROM ai_usage_logs `+failWhere+` ORDER BY created_at DESC LIMIT 20`, args...)
	models := h.queryRows(`SELECT model, COUNT(*) AS requests, COALESCE(SUM(total_tokens),0) AS totalTokens
		FROM ai_usage_logs `+whereSQL+` GROUP BY model ORDER BY totalTokens DESC, requests DESC`, args...)
	endpoints := h.queryRows(`SELECT endpoint, COUNT(*) AS requests, COALESCE(SUM(total_tokens),0) AS totalTokens
		FROM ai_usage_logs `+whereSQL+` GROUP BY endpoint ORDER BY totalTokens DESC, requests DESC`, args...)
	userJoin := ""
	userArgs := []any{}
	if rangeDays != nil {
		userJoin = "AND l.created_at >= ?"
		userArgs = append(userArgs, time.Now().UTC().AddDate(0, 0, -*rangeDays).Format("2006-01-02"))
	}
	users := h.queryRows(`SELECT u.id, u.username, u.avatar_url AS avatarUrl, COUNT(l.id) AS requests,
		COALESCE(SUM(l.prompt_tokens),0) AS promptTokens, COALESCE(SUM(l.completion_tokens),0) AS completionTokens,
		COALESCE(SUM(l.total_tokens),0) AS totalTokens, COALESCE(ROUND(AVG(l.latency_ms)),0) AS avgLatencyMs,
		COALESCE(ROUND(100.0*SUM(CASE WHEN l.success=1 THEN 1 ELSE 0 END)/NULLIF(COUNT(l.id),0),1),0) AS successRate,
		MAX(l.created_at) AS lastUsedAt FROM users u LEFT JOIN ai_usage_logs l ON l.user_id=u.id `+userJoin+`
		GROUP BY u.id ORDER BY totalTokens DESC, requests DESC, u.id`, userArgs...)
	if summary == nil {
		summary = emptySummary
	}
	c.JSON(http.StatusOK, gin.H{
		"range": rangeKey, "selectedUserId": selectedUserID, "summary": summary,
		"trend": trend, "models": models, "endpoints": endpoints, "users": users, "failures": failures,
	})
}

func (h *Handlers) queryOne(q string, args ...any) map[string]any {
	rows := h.queryRows(q, args...)
	if len(rows) == 0 {
		return nil
	}
	return rows[0]
}

func ptr(n int) *int {
	return &n
}

func (h *Handlers) MediaCleanupRetry(c *gin.Context) {
	id := c.Param("id")
	if h.hasTable("media_cleanup_jobs") {
		_, _ = h.DB.Exec(`UPDATE media_cleanup_jobs SET status='pending', attempts=0, last_error=NULL, updated_at=CURRENT_TIMESTAMP WHERE id=?`, id)
	}
	h.recordAudit(c, "media_cleanup.retry", "media_cleanup", id, "重试媒体清理")
	okJSON(c)
}

func (h *Handlers) CoreLoopsList(c *gin.Context) {
	date := strings.TrimSpace(c.Query("date"))
	if date == "" {
		date = shanghaiDate()
	}
	details := strings.TrimSpace(c.Query("details")) == "1"
	c.JSON(http.StatusOK, h.projectCoreLoopWeek(date, details))
}

func coreLoopNotCollected(date string, details bool) map[string]any {
	start, end := weekBounds(date)
	out := map[string]any{
		"startDate": start, "endDate": end, "timeZone": "Asia/Shanghai",
		"version": "weekly-core-loop-v1", "status": "not_collected",
		"users": nil, "loops": nil, "verifiedUsers": 0, "verifiedLoops": 0,
		"unknown": 0, "smallSample": false, "coverageStart": nil,
		"evaluations":      []any{},
		"detailsTruncated": false,
	}
	if details {
		out["evaluations"] = []any{}
	}
	return out
}

func weekBounds(date string) (string, string) {
	t, err := time.Parse("2006-01-02", date)
	if err != nil {
		t = time.Now()
	}
	weekday := int(t.Weekday())
	if weekday == 0 {
		weekday = 7
	}
	monday := t.AddDate(0, 0, -(weekday - 1))
	sunday := monday.AddDate(0, 0, 6)
	return monday.Format("2006-01-02"), sunday.Format("2006-01-02")
}

func shanghaiDate() string {
	loc, _ := time.LoadLocation("Asia/Shanghai")
	return time.Now().In(loc).Format("2006-01-02")
}

func (h *Handlers) ensureCoreLoopSettingsTable() {

	_, _ = h.DB.Exec(`INSERT INTO core_loop_metric_settings(id) VALUES (1) ON CONFLICT DO NOTHING`)

}

func (h *Handlers) coreLoopSettingsRow() map[string]any {
	h.ensureCoreLoopSettingsTable()
	if !h.hasTable("core_loop_metric_settings") {
		return map[string]any{"enabled": 0, "version": 1, "coverage_start": nil, "environment": nil}
	}
	row := h.queryOne(`SELECT enabled, version, coverage_start, environment FROM core_loop_metric_settings WHERE id=1`)
	if row == nil {
		return map[string]any{"enabled": 0, "version": 1, "coverage_start": nil, "environment": nil}
	}
	return row
}

func (h *Handlers) coreLoopSettingsResponse() map[string]any {
	row := h.coreLoopSettingsRow()
	env := strings.TrimSpace(os.Getenv("CORE_LOOP_ENVIRONMENT"))
	enabled := intFromAny(row["enabled"]) != 0
	var coverage any = nil
	if cs := row["coverage_start"]; cs != nil && strings.TrimSpace(asString(cs)) != "" {
		if env != "" && strings.TrimSpace(asString(row["environment"])) == env {
			coverage = asString(cs)
		}
	}
	return map[string]any{
		"enabled":       enabled && env != "",
		"version":       intFromAny(row["version"]),
		"coverageStart": coverage,
		"environment":   env,
		"timeZone":      "Asia/Shanghai",
	}
}

func (h *Handlers) CoreLoopsSettingsGet(c *gin.Context) {
	c.JSON(http.StatusOK, h.coreLoopSettingsResponse())
}

func (h *Handlers) CoreLoopsSettingsPut(c *gin.Context) {
	h.ensureCoreLoopSettingsTable()
	var body struct {
		Enabled bool `json:"enabled"`
		Version int  `json:"version"`
	}
	if !bindJSON(c, &body) {
		return
	}
	env := strings.TrimSpace(os.Getenv("CORE_LOOP_ENVIRONMENT"))
	if body.Enabled && env == "" {
		httpx.SendError(c, http.StatusConflict, "请先在服务端配置 CORE_LOOP_ENVIRONMENT", "CORE_LOOP_ENV_MISSING")
		return
	}
	res, err := h.DB.Exec(`UPDATE core_loop_metric_settings SET enabled=?, environment=?, coverage_start=CASE WHEN ?=1 AND coverage_start IS NULL THEN CURRENT_TIMESTAMP ELSE coverage_start END,
		version=version+1, updated_at=CURRENT_TIMESTAMP WHERE id=1 AND version=?`,
		boolToInt(body.Enabled), env, boolToInt(body.Enabled), body.Version)
	if err != nil || mustRows(res) == 0 {
		httpx.SendError(c, http.StatusConflict, "采集配置已变化，请刷新后重试", "CORE_LOOP_SETTINGS_CONFLICT")
		return
	}
	h.recordAudit(c, "core_loop.configure", "core_loop", "1", "更新周闭环统计设置")
	c.JSON(http.StatusOK, h.coreLoopSettingsResponse())
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

func (h *Handlers) CoreLoopsActorGet(c *gin.Context) {
	userID, err := strconv.Atoi(c.Param("userId"))
	if err != nil || userID <= 0 {
		httpx.SendError(c, http.StatusBadRequest, "用户 ID 无效", "INVALID_USER_ID")
		return
	}
	var exists int
	if h.DB.QueryRow(`SELECT 1 FROM users WHERE id=?`, userID).Scan(&exists) != nil {
		httpx.SendError(c, http.StatusNotFound, "用户不存在", "USER_NOT_FOUND")
		return
	}
	h.ensureCoreLoopSettingsTable()
	kind := "unknown"
	version := 0
	_ = h.DB.QueryRow(`SELECT kind, version FROM core_loop_actor_classifications WHERE user_id=?`, userID).Scan(&kind, &version)
	c.JSON(http.StatusOK, gin.H{
		"userId": userID, "actorKey": "user:" + strconv.Itoa(userID), "kind": kind, "version": version,
	})
}

func (h *Handlers) CoreLoopsActorPut(c *gin.Context) {
	adminID, _ := expressauth.UserID(c)
	userID, err := strconv.Atoi(c.Param("userId"))
	if err != nil || userID <= 0 {
		httpx.SendError(c, http.StatusBadRequest, "用户 ID 无效", "INVALID_USER_ID")
		return
	}
	var body struct {
		Kind    string `json:"kind"`
		Version int    `json:"version"`
	}
	if !bindJSON(c, &body) {
		return
	}
	allowed := map[string]bool{"real": true, "test": true, "demo": true, "automation": true, "unknown": true}
	if !allowed[body.Kind] {
		httpx.SendError(c, http.StatusBadRequest, "账号分类无效", "INVALID_ACTOR_KIND")
		return
	}
	var exists int
	if h.DB.QueryRow(`SELECT 1 FROM users WHERE id=?`, userID).Scan(&exists) != nil {
		httpx.SendError(c, http.StatusNotFound, "用户不存在", "USER_NOT_FOUND")
		return
	}
	h.ensureCoreLoopSettingsTable()
	var res sql.Result
	if body.Version == 0 {
		res, err = h.DB.Exec(`INSERT INTO core_loop_actor_classifications (user_id, kind, classified_by) VALUES (?, ?, ?)
			ON CONFLICT(user_id) DO NOTHING`, userID, body.Kind, adminID)
	} else {
		res, err = h.DB.Exec(`UPDATE core_loop_actor_classifications SET kind=?, classified_by=?, version=version+1, updated_at=CURRENT_TIMESTAMP
			WHERE user_id=? AND version=?`, body.Kind, adminID, userID, body.Version)
	}
	if err != nil || mustRows(res) == 0 {
		httpx.SendError(c, http.StatusConflict, "账号分类已变化，请刷新后重试", "CORE_LOOP_ACTOR_CONFLICT")
		return
	}
	h.recordAudit(c, "core_loop.classify", "user", strconv.Itoa(userID), "更新周闭环账号分类")
	c.JSON(http.StatusOK, gin.H{
		"userId": userID, "actorKey": "user:" + strconv.Itoa(userID), "kind": body.Kind, "version": body.Version + 1,
	})
}
