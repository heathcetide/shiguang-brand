// Copyright (c) 2026 heathcetide. All rights reserved.

package social

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"
)

const maintenanceRuleVersion = "maintenance-go-stub-2026-03-20.1"
const maintenanceMaxAttempts = 3

// RunPlanMaintenanceDispatch enqueues daily checks and batches events into jobs.
func (h *Handlers) RunPlanMaintenanceDispatch(ctx context.Context) (map[string]any, error) {
	limit := envInt("PLAN_MAINTENANCE_EVENT_BATCH_SIZE", 200)
	daily, err := h.enqueuePlanMaintenanceDaily(time.Now().UTC(), limit)
	if err != nil {
		return map[string]any{"dailyChecksCreated": daily}, err
	}
	events, err := h.enqueuePlanMaintenanceEvents(time.Now().UTC(), limit)
	return map[string]any{
		"phase": "event_dispatch", "dailyChecksCreated": daily, "eventsEnqueued": events,
	}, err
}

// RunPlanMaintenanceProcess claims jobs, writes stub diagnostics, and publishes notices.
func (h *Handlers) RunPlanMaintenanceProcess(ctx context.Context) (map[string]any, error) {
	batch := envInt("PLAN_MAINTENANCE_JOB_BATCH_SIZE", 10)
	processed, succeeded, failed := 0, 0, 0
	for i := 0; i < batch; i++ {
		if ctx.Err() != nil {
			break
		}
		job, err := h.claimPlanMaintenanceJob(time.Now().UTC())
		if err != nil || job == nil {
			break
		}
		processed++
		if err := h.completePlanMaintenanceJobStub(job, time.Now().UTC()); err != nil {
			_ = h.failPlanMaintenanceJob(job, time.Now().UTC(), err.Error())
			failed++
			continue
		}
		succeeded++
	}
	published, _ := h.publishPlanMaintenanceResults(envInt("PLAN_MAINTENANCE_EVENT_BATCH_SIZE", 200))
	return map[string]any{
		"processed": processed, "succeeded": succeeded, "failed": failed,
		"details": map[string]any{"phase": "event_processing", "reportsPublished": published},
	}, nil
}

func (h *Handlers) enqueuePlanMaintenanceDaily(now time.Time, limit int) (int, error) {
	if !h.hasTable("plan_maintenance_settings") || !h.hasTable("plan_maintenance_events") {
		return 0, nil
	}
	nowStr := now.Format(time.RFC3339)
	rows, err := h.DB.Query(`SELECT user_id, COALESCE(time_zone,'Asia/Shanghai'), COALESCE(local_time,'09:00'), COALESCE(version,0)
		FROM plan_maintenance_settings
		WHERE COALESCE(enabled,0)=1 AND (next_check_at IS NULL OR next_check_at <= ?)
		ORDER BY next_check_at, user_id LIMIT ?`, nowStr, limit)
	if err != nil {
		return 0, err
	}
	defer rows.Close()
	inserted := 0
	for rows.Next() {
		var userID, version int
		var tz, localTime string
		if rows.Scan(&userID, &tz, &localTime, &version) != nil {
			continue
		}
		localDate := currentDateKey(now)
		eventID := randomTokenHex(16)
		res, err := h.DB.Exec(`INSERT INTO plan_maintenance_events (id, user_id, event_type, source_id, subject_id, created_at)
			VALUES (?, ?, 'daily_check', ?, ?, ?)
			ON CONFLICT(user_id, event_type, source_id) DO NOTHING`,
			eventID, userID, localDate, localDate, nowStr)
		if err == nil && rowsAffected(res) > 0 {
			inserted++
		}
		next := now.Add(24 * time.Hour).Format(time.RFC3339)
		_, _ = h.DB.Exec(`UPDATE plan_maintenance_settings
			SET next_check_at=?, next_local_date=?, version=version+1, updated_at=?
			WHERE user_id=?`, next, dateKeyAfterDays(localDate, 1), nowStr, userID)
	}
	return inserted, nil
}

func (h *Handlers) enqueuePlanMaintenanceEvents(now time.Time, limit int) (int, error) {
	if !h.hasTable("plan_maintenance_events") || !h.hasTable("plan_maintenance_jobs") {
		return 0, nil
	}
	cutoff := now.Add(-30 * time.Second).Format(time.RFC3339)
	var rows *sql.Rows
	var err error
	if h.hasTable("plan_maintenance_job_events") {
		rows, err = h.DB.Query(`SELECT e.id, e.user_id FROM plan_maintenance_events e
			WHERE e.processed_at IS NULL
			  AND e.created_at <= ?
			  AND NOT EXISTS (SELECT 1 FROM plan_maintenance_job_events m WHERE m.event_id=e.id)
			ORDER BY e.created_at, e.id LIMIT ?`, cutoff, limit)
	} else {
		rows, err = h.DB.Query(`SELECT e.id, e.user_id FROM plan_maintenance_events e
			WHERE e.processed_at IS NULL AND e.created_at <= ?
			ORDER BY e.created_at, e.id LIMIT ?`, cutoff, limit)
	}
	if err != nil {
		return 0, err
	}
	defer rows.Close()
	type ev struct {
		ID     string
		UserID int
	}
	list := make([]ev, 0)
	byUser := map[int][]string{}
	order := make([]int, 0)
	for rows.Next() {
		var e ev
		if rows.Scan(&e.ID, &e.UserID) != nil {
			continue
		}
		list = append(list, e)
		if _, ok := byUser[e.UserID]; !ok {
			order = append(order, e.UserID)
		}
		byUser[e.UserID] = append(byUser[e.UserID], e.ID)
	}
	enqueued := 0
	for _, userID := range order {
		eventIDs := byUser[userID]
		jobID := ""
		_ = h.DB.QueryRow(`SELECT id FROM plan_maintenance_jobs
			WHERE user_id=? AND status='queued' AND COALESCE(attempts,0)=0
			ORDER BY created_at LIMIT 1`, userID).Scan(&jobID)
		if jobID == "" {
			jobID = randomTokenHex(16)
			_, err := h.DB.Exec(`INSERT INTO plan_maintenance_jobs
				(id, user_id, status, attempts, available_at, rule_version, created_at, updated_at)
				VALUES (?, ?, 'queued', 0, ?, ?, ?, ?)`,
				jobID, userID, now.Format(time.RFC3339), maintenanceRuleVersion,
				now.Format(time.RFC3339), now.Format(time.RFC3339))
			if err != nil {
				continue
			}
		}
		for _, eventID := range eventIDs {
			if h.hasTable("plan_maintenance_job_events") {
				_, err := h.DB.Exec(`INSERT INTO plan_maintenance_job_events (event_id, job_id) VALUES (?, ?)
					ON CONFLICT(event_id) DO NOTHING`, eventID, jobID)
				if err == nil {
					enqueued++
				}
			} else {
				enqueued++
			}
		}
	}
	return enqueued, nil
}

type planMaintJob struct {
	ID     string
	UserID int
	Token  string
}

func (h *Handlers) claimPlanMaintenanceJob(now time.Time) (*planMaintJob, error) {
	if !h.hasTable("plan_maintenance_jobs") {
		return nil, nil
	}
	nowStr := now.Format(time.RFC3339)
	_, _ = h.DB.Exec(`UPDATE plan_maintenance_jobs SET status='failed', last_error='lease exhausted', updated_at=?
		WHERE status='running' AND lease_expires_at IS NOT NULL AND lease_expires_at <= ? AND attempts >= ?`,
		nowStr, nowStr, maintenanceMaxAttempts)
	_, _ = h.DB.Exec(`UPDATE plan_maintenance_jobs SET status='queued', lease_token=NULL, lease_expires_at=NULL, updated_at=?
		WHERE status='running' AND lease_expires_at IS NOT NULL AND lease_expires_at <= ? AND attempts < ?`,
		nowStr, nowStr, maintenanceMaxAttempts)

	var id string
	var userID int
	err := h.DB.QueryRow(`SELECT id, user_id FROM plan_maintenance_jobs
		WHERE status='queued' AND (available_at IS NULL OR available_at <= ?)
		  AND user_id NOT IN (SELECT user_id FROM plan_maintenance_jobs WHERE status='running')
		ORDER BY available_at, created_at, id LIMIT 1`, nowStr).Scan(&id, &userID)
	if err != nil {
		return nil, nil
	}
	token := randomTokenHex(16)
	leaseUntil := now.Add(5 * time.Minute).Format(time.RFC3339)
	res, err := h.DB.Exec(`UPDATE plan_maintenance_jobs
		SET status='running', attempts=attempts+1, lease_token=?, lease_expires_at=?, updated_at=?
		WHERE id=? AND status='queued'`, token, leaseUntil, nowStr, id)
	if err != nil || rowsAffected(res) == 0 {
		return nil, err
	}
	return &planMaintJob{ID: id, UserID: userID, Token: token}, nil
}

func (h *Handlers) completePlanMaintenanceJobStub(job *planMaintJob, now time.Time) error {
	result, _ := json.Marshal(map[string]any{
		"changes": []any{},
		"diagnostics": map[string]any{
			"ruleVersion": maintenanceRuleVersion,
			"checks":      []string{"full maintenance evaluator not ported; job completed with diagnostics only"},
		},
		"notificationRecorded": 0,
	})
	nowStr := now.Format(time.RFC3339)
	if h.hasTable("plan_maintenance_job_events") {
		_, _ = h.DB.Exec(`UPDATE plan_maintenance_events SET processed_at=?
			WHERE id IN (SELECT event_id FROM plan_maintenance_job_events WHERE job_id=?)`, nowStr, job.ID)
		var maxDate sql.NullString
		_ = h.DB.QueryRow(`SELECT MAX(subject_id) FROM plan_maintenance_events
			WHERE event_type='daily_check' AND id IN (SELECT event_id FROM plan_maintenance_job_events WHERE job_id=?)`,
			job.ID).Scan(&maxDate)
		if maxDate.Valid && maxDate.String != "" {
			_, _ = h.DB.Exec(`UPDATE plan_maintenance_settings SET last_completed_local_date=?, updated_at=? WHERE user_id=?`,
				maxDate.String, nowStr, job.UserID)
		}
	}
	_, err := h.DB.Exec(`UPDATE plan_maintenance_jobs
		SET status='completed', result_json=?, lease_token=NULL, lease_expires_at=NULL, updated_at=?
		WHERE id=? AND status='running' AND COALESCE(lease_token,'')=?`,
		string(result), nowStr, job.ID, job.Token)
	return err
}

func (h *Handlers) failPlanMaintenanceJob(job *planMaintJob, now time.Time, msg string) error {
	nowStr := now.Format(time.RFC3339)
	var attempts int
	_ = h.DB.QueryRow(`SELECT attempts FROM plan_maintenance_jobs WHERE id=?`, job.ID).Scan(&attempts)
	if attempts >= maintenanceMaxAttempts {
		_, err := h.DB.Exec(`UPDATE plan_maintenance_jobs
			SET status='failed', last_error=?, lease_token=NULL, lease_expires_at=NULL, updated_at=?
			WHERE id=?`, truncate(msg, 500), nowStr, job.ID)
		return err
	}
	retryAt := now.Add(time.Duration(30*(1<<(attempts-1))) * time.Second).Format(time.RFC3339)
	_, err := h.DB.Exec(`UPDATE plan_maintenance_jobs
		SET status='queued', last_error=?, available_at=?, lease_token=NULL, lease_expires_at=NULL, updated_at=?
		WHERE id=?`, truncate(msg, 500), retryAt, nowStr, job.ID)
	return err
}

func (h *Handlers) publishPlanMaintenanceResults(limit int) (int, error) {
	if !h.hasTable("plan_maintenance_jobs") || !h.inboxTableExists() {
		return 0, nil
	}
	rows, err := h.DB.Query(`SELECT id, user_id, status, COALESCE(result_json,'{}'), COALESCE(last_error,'')
		FROM plan_maintenance_jobs
		WHERE status IN ('completed','failed')
		ORDER BY updated_at, id LIMIT ?`, limit)
	if err != nil {
		return 0, err
	}
	defer rows.Close()
	published := 0
	for rows.Next() {
		var id string
		var userID int
		var status, resultJSON, lastError string
		if rows.Scan(&id, &userID, &status, &resultJSON, &lastError) != nil {
			continue
		}
		var result map[string]any
		_ = json.Unmarshal([]byte(resultJSON), &result)
		if asMapInt(result["notificationRecorded"]) == 1 {
			continue
		}
		title := "餐谱维护完成"
		body := "今日餐谱维护已完成（诊断模式）。"
		if status == "failed" {
			title = "餐谱维护失败"
			body = "餐谱维护未能完成，稍后会自动重试。"
			if lastError != "" {
				body = truncate(lastError, 120)
			}
		}
		groupKey := fmt.Sprintf("plan_maintenance:%s", id)
		_, _ = h.DB.InsertID(`INSERT INTO user_notification_inbox (user_id, type, title, body)
			VALUES (?, 'plan_maintenance', ?, ?)`, userID, title, body)
		_ = groupKey
		result["notificationRecorded"] = 1
		raw, _ := json.Marshal(result)
		_, _ = h.DB.Exec(`UPDATE plan_maintenance_jobs SET result_json=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`, string(raw), id)
		published++
	}
	return published, nil
}
