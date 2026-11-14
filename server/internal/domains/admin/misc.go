// Copyright (c) 2026 heathcetide. All rights reserved.

package admin

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/heathcetide/DietDigiDose/internal/expressauth"
	"github.com/heathcetide/DietDigiDose/internal/httpx"
)

const appUpdatesReleasesKey = "app_updates_releases"

func (h *Handlers) loadAppUpdateReleases() []map[string]any {
	raw, ok := h.getSetting(appUpdatesReleasesKey)
	if !ok || strings.TrimSpace(raw) == "" {
		return []map[string]any{}
	}
	var list []map[string]any
	if json.Unmarshal([]byte(raw), &list) != nil {
		return []map[string]any{}
	}
	return list
}

func (h *Handlers) saveAppUpdateReleases(list []map[string]any) {
	raw, _ := json.Marshal(list)
	h.upsertSetting(appUpdatesReleasesKey, string(raw))
}

func (h *Handlers) NotificationsList(c *gin.Context) {
	campaigns := make([]map[string]any, 0)
	notifications := make([]map[string]any, 0)
	if h.hasTable("notification_campaigns") {
		rows, err := h.DB.Query(`SELECT c.id, c.title, COALESCE(c.body,''), COALESCE(c.status,''),
			COALESCE(c.recipient_count,0), COALESCE(c.success_count,0), COALESCE(c.failure_count,0),
			COALESCE(c.created_at,''), COALESCE(u.username,'')
			FROM notification_campaigns c
			LEFT JOIN users u ON u.id = c.admin_user_id
			ORDER BY c.id DESC LIMIT 50`)
		if err == nil {
			defer rows.Close()
			for rows.Next() {
				var id, recipients, success, failure int
				var title, body, status, created, adminName string
				if rows.Scan(&id, &title, &body, &status, &recipients, &success, &failure, &created, &adminName) == nil {
					campaigns = append(campaigns, map[string]any{
						"id": id, "title": title, "body": body, "status": status,
						"recipientCount": recipients, "successCount": success, "failureCount": failure,
						"createdAt": created, "adminName": adminName,
					})
				}
			}
		}
	}
	if h.hasTable("notifications") {
		rows, err := h.DB.Query(`SELECT id, user_id, COALESCE(type,''), COALESCE(title,''), COALESCE(body,''), COALESCE(created_at,'')
			FROM notifications ORDER BY id DESC LIMIT 100`)
		if err == nil {
			defer rows.Close()
			for rows.Next() {
				var id, userID int
				var typ, title, body, created string
				if rows.Scan(&id, &userID, &typ, &title, &body, &created) == nil {
					notifications = append(notifications, map[string]any{
						"id": id, "userId": userID, "type": typ, "title": title, "body": body, "createdAt": created,
					})
				}
			}
		}
	}
	if len(campaigns) == 0 {
		campaigns = notifications
	}
	var activeDevices, enabledUsers int
	if h.hasTable("user_push_tokens") {
		_ = h.DB.QueryRow(`SELECT COUNT(*) FROM user_push_tokens WHERE revoked_at IS NULL`).Scan(&activeDevices)
	} else if h.hasTable("push_tokens") {
		_ = h.DB.QueryRow(`SELECT COUNT(*) FROM push_tokens`).Scan(&activeDevices)
	}
	_ = h.DB.QueryRow(`SELECT COUNT(*) FROM users WHERE COALESCE(is_disabled,0)=0`).Scan(&enabledUsers)
	c.JSON(http.StatusOK, gin.H{
		"campaigns": campaigns, "notifications": notifications, "automatic": []any{},
		"activeDevices": activeDevices, "enabledUsers": enabledUsers,
		"interventionsEnabled": true,
		"interventionMetrics": gin.H{
			"candidates": 0, "suppressed": 0, "inbox_only": 0, "accepted": 0, "uncertain": 0,
			"failed": 0, "acted": 0, "action_plan_recipe": 0, "cooking_started": 0,
			"inventory_used": 0, "inventory_discarded": 0, "action_not_helpful": 0, "expired_unhandled": 0,
		},
		"metrics": gin.H{
			"created": 0, "pushSubmitted": 0, "pushDelivered": 0,
			"opened": 0, "actionClicks": 0, "pushFailures": 0,
		},
	})
}

func (h *Handlers) NotificationCampaignPost(c *gin.Context) {
	adminID, _ := expressauth.UserID(c)
	var body struct {
		Title string `json:"title"`
		Body  string `json:"body"`
	}
	if !bindJSON(c, &body) {
		return
	}
	title := strings.TrimSpace(body.Title)
	msg := strings.TrimSpace(body.Body)
	if title == "" || msg == "" {
		httpx.SendError(c, http.StatusBadRequest, "请求参数无效", "INVALID_BODY")
		return
	}
	if !h.hasTable("notification_campaigns") {

	}
	var recipientCount int
	_ = h.DB.QueryRow(`SELECT COUNT(*) FROM users WHERE COALESCE(is_disabled,0)=0 AND role='user'`).Scan(&recipientCount)
	campaignID, err := h.DB.InsertID(`INSERT INTO notification_campaigns (admin_user_id, title, body, status, recipient_count)
		VALUES (?, ?, ?, 'draft', ?)`, adminID, title, msg, recipientCount)
	if err != nil {
		httpx.SendError(c, http.StatusInternalServerError, "创建活动失败", "CAMPAIGN_FAILED")
		return
	}

	h.recordAudit(c, "notification.campaign", "notification_campaign", strconv.FormatInt(campaignID, 10), "创建通知活动")
	c.JSON(http.StatusCreated, gin.H{"id": campaignID, "title": title, "recipients": recipientCount, "ok": true})
}

func (h *Handlers) AppUpdatesList(c *gin.Context) {
	releases := h.loadAppUpdateReleases()
	active := make([]map[string]any, 0, len(releases))
	for _, r := range releases {
		if revoked, _ := r["revoked"].(bool); !revoked {
			active = append(active, r)
		}
	}
	c.JSON(http.StatusOK, gin.H{
		"configured": true,
		"manifestPath": "",
		"allowedOrigins": []any{},
		"manifest": gin.H{"releases": active},
		"releases": active,
		"allReleases": releases,
		"error": nil,
	})
}

func (h *Handlers) AppUpdatesPublish(c *gin.Context) {
	var release map[string]any
	if !bindJSON(c, &release) {
		return
	}
	release["revoked"] = false
	release["publishedAt"] = time.Now().UTC().Format(time.RFC3339)
	list := h.loadAppUpdateReleases()
	channel := strings.TrimSpace(asString(release["channel"]))
	appID := strings.TrimSpace(asString(release["applicationId"]))
	filtered := make([]map[string]any, 0, len(list))
	for _, item := range list {
		if strings.TrimSpace(asString(item["channel"])) == channel &&
			strings.TrimSpace(asString(item["applicationId"])) == appID {
			continue
		}
		filtered = append(filtered, item)
	}
	filtered = append(filtered, release)
	h.saveAppUpdateReleases(filtered)
	snapshot := asString(release["snapshot"])
	if snapshot == "" {
		snapshot = channel
	}
	h.recordAudit(c, "app_updates.publish", "app_update", snapshot, "发布应用更新")
	c.JSON(http.StatusOK, gin.H{"ok": true, "release": release})
}

func (h *Handlers) AppUpdatesRevoke(c *gin.Context) {
	var body struct {
		ApplicationID string `json:"applicationId"`
		Channel       string `json:"channel"`
	}
	if !bindJSON(c, &body) {
		return
	}
	channel := strings.TrimSpace(body.Channel)
	appID := strings.TrimSpace(body.ApplicationID)
	if channel == "" || appID == "" {
		httpx.SendError(c, http.StatusBadRequest, "请求参数无效", "INVALID_BODY")
		return
	}
	list := h.loadAppUpdateReleases()
	found := false
	for i := range list {
		if strings.TrimSpace(asString(list[i]["channel"])) == channel &&
			strings.TrimSpace(asString(list[i]["applicationId"])) == appID &&
			!asBool(list[i]["revoked"]) {
			list[i]["revoked"] = true
			list[i]["revokedAt"] = time.Now().UTC().Format(time.RFC3339)
			found = true
			break
		}
	}
	if !found {
		httpx.SendError(c, http.StatusNotFound, "未找到在线版本", "RELEASE_NOT_FOUND")
		return
	}
	h.saveAppUpdateReleases(list)
	h.recordAudit(c, "app_updates.revoke", "app_update", channel+":"+appID, "撤销应用更新")
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func asString(v any) string {
	s, _ := v.(string)
	return s
}

func asBool(v any) bool {
	switch t := v.(type) {
	case bool:
		return t
	case float64:
		return t != 0
	default:
		return false
	}
}

func (h *Handlers) AgentRunsList(c *gin.Context) {
	emptyUsage := gin.H{"modelCalls": 0, "promptTokens": 0, "completionTokens": 0, "totalTokens": 0, "estimatedCostUsd": 0}
	empty := gin.H{
		"items": []any{}, "total": 0, "page": 1, "pageSize": 25,
		"statusCounts": []any{}, "usageSummary": emptyUsage,
	}
	if !h.hasTable("agent_runs") {
		c.JSON(http.StatusOK, empty)
		return
	}
	page, pageSize, offset := parsePageParams(c, 25, 100)
	statusFilter := strings.TrimSpace(c.Query("status"))
	modalityFilter := strings.TrimSpace(c.Query("modality"))
	hasModality := h.hasColumn("agent_runs", "modality")
	hasUpdated := h.hasColumn("agent_runs", "updated_at")

	where := []string{"1=1"}
	args := make([]any, 0)
	if statusFilter != "" {
		where = append(where, "r.status=?")
		args = append(args, statusFilter)
	}
	if modalityFilter != "" && hasModality {
		where = append(where, "r.modality=?")
		args = append(args, modalityFilter)
	}
	whereSQL := strings.Join(where, " AND ")

	var total int
	_ = h.DB.QueryRow(`SELECT COUNT(*) FROM agent_runs r WHERE `+whereSQL, args...).Scan(&total)

	// Close statusCounts rows before the next Query — SQLite MaxOpenConns=1 deadlocks otherwise.
	statusCounts := make([]map[string]any, 0)
	if countRows, err := h.DB.Query(`SELECT status, COUNT(*) FROM agent_runs GROUP BY status`); err == nil {
		for countRows.Next() {
			var status string
			var count int
			if err := countRows.Scan(&status, &count); err == nil {
				statusCounts = append(statusCounts, map[string]any{"status": status, "count": count})
			}
		}
		_ = countRows.Close()
	}

	// JOIN users — never QueryRow while another rows cursor is open.
	selectSQL := `SELECT r.id, r.user_id, COALESCE(r.status,''), COALESCE(r.created_at,''), COALESCE(u.username,'')`
	if hasModality {
		selectSQL += `, COALESCE(r.modality,'')`
	} else {
		selectSQL += `, ''`
	}
	if hasUpdated {
		selectSQL += `, COALESCE(r.updated_at,'')`
	} else {
		selectSQL += `, ''`
	}
	selectSQL += ` FROM agent_runs r LEFT JOIN users u ON u.id=r.user_id WHERE ` + whereSQL + ` ORDER BY r.created_at DESC LIMIT ? OFFSET ?`
	queryArgs := append(append([]any{}, args...), pageSize, offset)
	rows, err := h.DB.Query(selectSQL, queryArgs...)
	if err != nil {
		c.JSON(http.StatusOK, empty)
		return
	}
	defer rows.Close()
	items := make([]map[string]any, 0)
	for rows.Next() {
		var userID int
		var id, status, created, username, modality, updated string
		if err := rows.Scan(&id, &userID, &status, &created, &username, &modality, &updated); err != nil {
			continue
		}
		items = append(items, map[string]any{
			"id": id, "userId": userID, "username": username, "sessionId": "",
			"modality": modality, "source": "", "status": status,
			"errorCode": nil, "errorMessage": nil, "startedAt": created, "completedAt": nil,
			"createdAt": created, "updatedAt": updated, "durationMs": nil,
			"eventCount": 0, "actionCount": 0, "modelCallCount": 0,
			"promptTokens": 0, "completionTokens": 0, "totalTokens": 0, "estimatedCostUsd": 0,
			"hasMedia": 0, "specialists": nil, "lastEventSummary": nil, "promptPreview": "",
		})
	}
	c.JSON(http.StatusOK, gin.H{
		"items": items, "total": total, "page": page, "pageSize": pageSize,
		"statusCounts": statusCounts, "usageSummary": emptyUsage,
	})
}

func (h *Handlers) AgentRunDetail(c *gin.Context) {
	runID := c.Param("runId")
	if !h.hasTable("agent_runs") {
		httpx.SendError(c, http.StatusNotFound, "运行记录不存在", "AGENT_RUN_NOT_FOUND")
		return
	}
	var userID int
	var status, result, created sql.NullString
	err := h.DB.QueryRow(`SELECT user_id, status, COALESCE(result_json,''), COALESCE(created_at,'') FROM agent_runs WHERE id=?`, runID).
		Scan(&userID, &status, &result, &created)
	if err == sql.ErrNoRows {
		httpx.SendError(c, http.StatusNotFound, "运行记录不存在", "AGENT_RUN_NOT_FOUND")
		return
	}
	if err != nil {
		httpx.SendError(c, http.StatusInternalServerError, "读取失败", "AGENT_RUN_FAILED")
		return
	}
	h.recordAudit(c, "agent_run.view", "agent_run", runID, "查看 Agent 运行")
	c.JSON(http.StatusOK, gin.H{
		"id": runID, "userId": userID, "status": nullStr(status),
		"result": parseJSONMap(result.String), "createdAt": nullStr(created),
	})
}

func (h *Handlers) MediaCleanupJobs(c *gin.Context) {
	empty := gin.H{
		"items": []any{}, "jobs": []any{}, "total": 0, "page": 1, "pageSize": 25,
		"staleAfterMinutes": 30,
		"summary": gin.H{"pending": 0, "processing": 0, "completed": 0, "failing": 0, "stale": 0},
	}
	if !h.hasTable("media_cleanup_jobs") {
		c.JSON(http.StatusOK, empty)
		return
	}
	statusFilter := strings.TrimSpace(c.Query("status"))
	attention := strings.TrimSpace(c.Query("attention")) == "1" || strings.EqualFold(c.Query("attention"), "true")
	staleOnly := strings.TrimSpace(c.Query("stale")) == "1" || strings.EqualFold(c.Query("stale"), "true")
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("pageSize", "25"))
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 25
	}
	olderThanHours, _ := strconv.Atoi(strings.TrimSpace(c.Query("olderThanHours")))
	offset := (page - 1) * pageSize

	where := []string{"1=1"}
	args := make([]any, 0)
	if statusFilter != "" {
		where = append(where, "status=?")
		args = append(args, statusFilter)
	}
	if attention {
		where = append(where, "status IN ('failed','failing','pending','queued','stale')")
	}
	if staleOnly {
		where = append(where, "status='stale'")
	}
	if olderThanHours > 0 {
		where = append(where, "created_at <= datetime('now', ?)")
		args = append(args, fmt.Sprintf("-%d hours", olderThanHours))
	}
	whereSQL := strings.Join(where, " AND ")

	var total int
	countArgs := append([]any{}, args...)
	_ = h.DB.QueryRow(`SELECT COUNT(*) FROM media_cleanup_jobs WHERE `+whereSQL, countArgs...).Scan(&total)

	query := `SELECT id, owner_user_id, COALESCE(status,''), COALESCE(attempts,0),
		COALESCE(created_at,''), COALESCE(last_error,'')
		FROM media_cleanup_jobs WHERE ` + whereSQL + ` ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`
	args = append(args, pageSize, offset)
	rows, err := h.DB.Query(query, args...)
	if err != nil {
		c.JSON(http.StatusOK, empty)
		return
	}
	defer rows.Close()
	jobs := make([]map[string]any, 0)
	summary := map[string]int{"pending": 0, "processing": 0, "completed": 0, "failing": 0, "stale": 0}
	for rows.Next() {
		var id, ownerID, attempts int
		var status, created, lastErr string
		if rows.Scan(&id, &ownerID, &status, &attempts, &created, &lastErr) == nil {
			item := map[string]any{
				"id": id, "ownerUserId": ownerID, "status": status, "attempts": attempts,
				"createdAt": created, "lastError": nullIfEmpty(lastErr),
				"eligibleForRetry": status == "failed" || status == "queued" || status == "pending",
			}
			jobs = append(jobs, item)
			switch status {
			case "pending", "queued":
				summary["pending"]++
			case "processing":
				summary["processing"]++
			case "completed":
				summary["completed"]++
			case "failed", "failing":
				summary["failing"]++
			case "stale":
				summary["stale"]++
			}
		}
	}
	c.JSON(http.StatusOK, gin.H{
		"items": jobs, "jobs": jobs, "total": total, "page": page, "pageSize": pageSize,
		"staleAfterMinutes": 30, "summary": summary,
	})
}

func nullIfEmpty(s string) any {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	return s
}

func mustRows(res sql.Result) int64 {
	if res == nil {
		return 0
	}
	n, _ := res.RowsAffected()
	return n
}

func (h *Handlers) WorkerRunsList(c *gin.Context) {
	taskFilter := strings.TrimSpace(c.Query("task"))
	statusFilter := strings.TrimSpace(c.Query("status"))
	table := ""
	if h.hasTable("worker_runs") {
		table = "worker_runs"
	} else if h.hasTable("worker_task_runs") {
		table = "worker_task_runs"
	}
	if table != "" {
		startedCol := "COALESCE(started_at,'')"
		if table == "worker_runs" && h.hasColumn(table, "created_at") {
			startedCol = "COALESCE(started_at, created_at, '')"
		}
		q := `SELECT id, COALESCE(task_name,''), COALESCE(worker_id,''), COALESCE(status,''),
			` + startedCol + `, COALESCE(finished_at,''),
			COALESCE(duration_ms,0), COALESCE(processed_count,0), COALESCE(succeeded_count,0), COALESCE(failed_count,0)
			FROM ` + table + ` WHERE 1=1`
		args := make([]any, 0)
		if taskFilter != "" {
			q += ` AND task_name=?`
			args = append(args, taskFilter)
		}
		if statusFilter != "" {
			q += ` AND status=?`
			args = append(args, statusFilter)
		}
		q += ` ORDER BY started_at DESC, id DESC LIMIT 100`
		rows, err := h.DB.Query(q, args...)
		if err == nil {
			defer rows.Close()
			runs := scanWorkerRuns(rows)
			c.JSON(http.StatusOK, gin.H{"runs": runs})
			return
		}
	}
	if h.hasTable("plan_maintenance_jobs") {
		rows, err := h.DB.Query(`SELECT id, user_id, COALESCE(status,''), COALESCE(attempts,0),
			COALESCE(created_at,''), COALESCE(updated_at,''), COALESCE(result_json,'')
			FROM plan_maintenance_jobs ORDER BY created_at DESC LIMIT 100`)
		if err == nil {
			defer rows.Close()
			runs := make([]map[string]any, 0)
			for rows.Next() {
				var userID, attempts int
				var id, status, created, updated, resultRaw string
				if rows.Scan(&id, &userID, &status, &attempts, &created, &updated, &resultRaw) == nil {
					runs = append(runs, map[string]any{
						"id": id, "taskName": "plan_maintenance", "workerId": strconv.Itoa(userID),
						"status": status, "startedAt": created, "finishedAt": updated,
						"result": parseJSONMap(resultRaw), "attempts": attempts,
					})
				}
			}
			c.JSON(http.StatusOK, gin.H{"runs": runs})
			return
		}
	}
	c.JSON(http.StatusOK, gin.H{"runs": []any{}})
}

func scanWorkerRuns(rows *sql.Rows) []map[string]any {
	runs := make([]map[string]any, 0)
	for rows.Next() {
		var duration, processed, succeeded, failed int
		var id, task, worker, status, started, finished string
		if rows.Scan(&id, &task, &worker, &status, &started, &finished, &duration, &processed, &succeeded, &failed) == nil {
			runs = append(runs, map[string]any{
				"id": id, "taskName": task, "workerId": worker, "status": status,
				"startedAt": started, "finishedAt": nullIfEmpty(finished),
				"durationMs": duration, "processedCount": processed,
				"succeededCount": succeeded, "failedCount": failed,
			})
		}
	}
	return runs
}

func (h *Handlers) FunnelGet(c *gin.Context) {
	if !h.hasTable("funnel_events") {
		c.JSON(http.StatusOK, gin.H{"events": []any{}})
		return
	}
	rows, err := h.DB.Query(`SELECT event_name, COUNT(*) as cnt FROM funnel_events GROUP BY event_name ORDER BY cnt DESC LIMIT 50`)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"events": []any{}})
		return
	}
	defer rows.Close()
	events := make([]map[string]any, 0)
	for rows.Next() {
		var name string
		var cnt int
		if err := rows.Scan(&name, &cnt); err != nil {
			continue
		}
		events = append(events, map[string]any{"eventName": name, "count": cnt})
	}
	c.JSON(http.StatusOK, gin.H{"events": events})
}

func (h *Handlers) InventoryScanJobsList(c *gin.Context) {
	if !h.hasTable("inventory_scan_jobs") {
		c.JSON(http.StatusOK, gin.H{"items": []any{}, "jobs": []any{}})
		return
	}
	rows, err := h.DB.Query(`SELECT j.id, j.user_id, j.status, COALESCE(j.created_at,''), COALESCE(u.username,'')
		FROM inventory_scan_jobs j LEFT JOIN users u ON u.id=j.user_id
		ORDER BY j.created_at DESC LIMIT 100`)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"items": []any{}, "jobs": []any{}})
		return
	}
	defer rows.Close()
	jobs := make([]map[string]any, 0)
	for rows.Next() {
		var id, status, created, username string
		var userID int
		if err := rows.Scan(&id, &userID, &status, &created, &username); err != nil {
			continue
		}
		jobs = append(jobs, map[string]any{
			"id": id, "userId": userID, "username": username, "status": status,
			"createdAt": created, "itemCount": 0,
		})
	}
	c.JSON(http.StatusOK, gin.H{"items": jobs, "jobs": jobs})
}

func (h *Handlers) InventoryScanJobDetail(c *gin.Context) {
	jobID := c.Param("jobId")
	if !h.hasTable("inventory_scan_jobs") {
		httpx.SendError(c, http.StatusNotFound, "任务不存在", "SCAN_JOB_NOT_FOUND")
		return
	}
	var userID int
	var status, result, created sql.NullString
	err := h.DB.QueryRow(`SELECT user_id, status, COALESCE(result_json,''), COALESCE(created_at,'') FROM inventory_scan_jobs WHERE id=?`, jobID).
		Scan(&userID, &status, &result, &created)
	if err == sql.ErrNoRows {
		httpx.SendError(c, http.StatusNotFound, "任务不存在", "SCAN_JOB_NOT_FOUND")
		return
	}
	if err != nil {
		httpx.SendError(c, http.StatusInternalServerError, "读取失败", "SCAN_JOB_FAILED")
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"id": jobID, "userId": userID, "status": nullStr(status),
		"result": parseJSONMap(result.String), "createdAt": nullStr(created),
	})
}
