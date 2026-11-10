// Copyright (c) 2026 heathcetide. All rights reserved.

package admin

import (
	"database/sql"
	"encoding/json"
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
	if h.hasTable("notification_campaigns") {
		rows, err := h.DB.Query(`SELECT c.id, c.title, COALESCE(c.body,''), COALESCE(c.status,''),
			COALESCE(c.recipient_count,0), COALESCE(c.success_count,0), COALESCE(c.failure_count,0),
			COALESCE(c.created_at,''), COALESCE(u.username,'')
			FROM notification_campaigns c
			LEFT JOIN users u ON u.id = c.admin_user_id
			ORDER BY c.id DESC LIMIT 50`)
		if err == nil {
			defer rows.Close()
			campaigns := make([]map[string]any, 0)
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
			c.JSON(http.StatusOK, gin.H{"campaigns": campaigns, "notifications": campaigns})
			return
		}
	}
	if h.hasTable("notifications") {
		rows, err := h.DB.Query(`SELECT id, user_id, COALESCE(type,''), COALESCE(title,''), COALESCE(body,''), COALESCE(created_at,'')
			FROM notifications ORDER BY id DESC LIMIT 100`)
		if err == nil {
			defer rows.Close()
			list := make([]map[string]any, 0)
			for rows.Next() {
				var id, userID int
				var typ, title, body, created string
				if rows.Scan(&id, &userID, &typ, &title, &body, &created) == nil {
					list = append(list, map[string]any{
						"id": id, "userId": userID, "type": typ, "title": title, "body": body, "createdAt": created,
					})
				}
			}
			c.JSON(http.StatusOK, gin.H{"notifications": list})
			return
		}
	}
	c.JSON(http.StatusOK, gin.H{"notifications": []any{}, "campaigns": []any{}})
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
		_, _ = h.DB.Exec(`CREATE TABLE IF NOT EXISTS notification_campaigns (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			admin_user_id INTEGER NOT NULL,
			title TEXT NOT NULL,
			body TEXT NOT NULL,
			status TEXT NOT NULL DEFAULT 'draft',
			recipient_count INTEGER NOT NULL DEFAULT 0,
			success_count INTEGER NOT NULL DEFAULT 0,
			failure_count INTEGER NOT NULL DEFAULT 0,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`)
	}
	var recipientCount int
	_ = h.DB.QueryRow(`SELECT COUNT(*) FROM users WHERE COALESCE(is_disabled,0)=0 AND role='user'`).Scan(&recipientCount)
	res, err := h.DB.Exec(`INSERT INTO notification_campaigns (admin_user_id, title, body, status, recipient_count)
		VALUES (?, ?, ?, 'draft', ?)`, adminID, title, msg, recipientCount)
	if err != nil {
		httpx.SendError(c, http.StatusInternalServerError, "创建活动失败", "CAMPAIGN_FAILED")
		return
	}
	campaignID, _ := res.LastInsertId()
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
	c.JSON(http.StatusOK, gin.H{"releases": active, "allReleases": releases})
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
	if !h.hasTable("agent_runs") {
		c.JSON(http.StatusOK, gin.H{"runs": []any{}})
		return
	}
	rows, err := h.DB.Query(`SELECT id, user_id, COALESCE(status,''), COALESCE(created_at,'') FROM agent_runs ORDER BY created_at DESC LIMIT 100`)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"runs": []any{}})
		return
	}
	defer rows.Close()
	list := make([]map[string]any, 0)
	for rows.Next() {
		var userID int
		var id, status, created string
		if err := rows.Scan(&id, &userID, &status, &created); err != nil {
			continue
		}
		list = append(list, map[string]any{"id": id, "userId": userID, "status": status, "createdAt": created})
	}
	c.JSON(http.StatusOK, gin.H{"runs": list})
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
	if !h.hasTable("media_cleanup_jobs") {
		c.JSON(http.StatusOK, gin.H{"jobs": []any{}})
		return
	}
	rows, err := h.DB.Query(`SELECT id, owner_user_id, COALESCE(status,''), COALESCE(attempts,0),
		COALESCE(created_at,''), COALESCE(last_error,'')
		FROM media_cleanup_jobs ORDER BY created_at DESC, id DESC LIMIT 100`)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"jobs": []any{}})
		return
	}
	defer rows.Close()
	jobs := make([]map[string]any, 0)
	for rows.Next() {
		var id, ownerID, attempts int
		var status, created, lastErr string
		if rows.Scan(&id, &ownerID, &status, &attempts, &created, &lastErr) == nil {
			jobs = append(jobs, map[string]any{
				"id": id, "ownerUserId": ownerID, "status": status, "attempts": attempts,
				"createdAt": created, "lastError": nullIfEmpty(lastErr),
			})
		}
	}
	c.JSON(http.StatusOK, gin.H{"jobs": jobs})
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
		c.JSON(http.StatusOK, gin.H{"jobs": []any{}})
		return
	}
	rows, err := h.DB.Query(`SELECT id, user_id, status, COALESCE(created_at,'') FROM inventory_scan_jobs ORDER BY created_at DESC LIMIT 100`)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"jobs": []any{}})
		return
	}
	defer rows.Close()
	jobs := make([]map[string]any, 0)
	for rows.Next() {
		var id string
		var userID int
		var status, created string
		if err := rows.Scan(&id, &userID, &status, &created); err != nil {
			continue
		}
		jobs = append(jobs, map[string]any{"id": id, "userId": userID, "status": status, "createdAt": created})
	}
	c.JSON(http.StatusOK, gin.H{"jobs": jobs})
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

