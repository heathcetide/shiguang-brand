// Copyright (c) 2026 heathcetide. All rights reserved.

package ai

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/heathcetide/DietDigiDose/internal/dbx"
)

var reversibleActionTypes = map[string]struct{}{
	"add_inventory_item":    {},
	"update_inventory_item": {},
	"create_meal_plan":      {},
	"update_meal_plan":      {},
	"add_shopping_items":    {},
	"update_shopping_item":  {},
}

func listAgentActions(db *dbx.DB, runID string, userID int) []map[string]any {
	if !db.HasTable("agent_actions") {
		return []map[string]any{}
	}
	rows, err := db.Query(`SELECT id, action_type, status, COALESCE(payload_json,'{}'),
		COALESCE(executed_at,''), COALESCE(undone_at,''), COALESCE(expires_at,'')
		FROM agent_actions WHERE run_id=? AND user_id=? ORDER BY created_at ASC`, runID, userID)
	if err != nil {
		return []map[string]any{}
	}
	defer rows.Close()
	out := make([]map[string]any, 0)
	for rows.Next() {
		var id, actionType, status, payloadRaw, executedAt, undoneAt, expiresAt string
		if rows.Scan(&id, &actionType, &status, &payloadRaw, &executedAt, &undoneAt, &expiresAt) != nil {
			continue
		}
		item := map[string]any{
			"id": id, "actionType": actionType, "status": status, "name": actionType,
		}
		var payload map[string]any
		if json.Unmarshal([]byte(payloadRaw), &payload) == nil {
			if summary, ok := payload["summary"].(string); ok && summary != "" {
				item["name"] = summary
			}
		}
		if status == "executed" && undoneAt == "" {
			if _, ok := reversibleActionTypes[actionType]; ok && executedAt != "" {
				if t, err := time.Parse(time.RFC3339Nano, executedAt); err == nil {
					item["undoAvailableUntil"] = t.Add(10 * time.Minute).UTC().Format(time.RFC3339Nano)
				} else if t, err := time.Parse(time.RFC3339, executedAt); err == nil {
					item["undoAvailableUntil"] = t.Add(10 * time.Minute).UTC().Format(time.RFC3339Nano)
				}
			}
		}
		out = append(out, item)
	}
	return out
}

func loadPendingApproval(db *dbx.DB, runID string, userID int) any {
	if agentRunsExpressShape(db) || db.HasColumn("agent_runs", "pending_approval_json") {
		var raw sql.NullString
		_ = db.QueryRow(`SELECT pending_approval_json FROM agent_runs WHERE id=? AND user_id=?`, runID, userID).Scan(&raw)
		if raw.Valid && strings.TrimSpace(raw.String) != "" && raw.String != "null" {
			var parsed any
			if json.Unmarshal([]byte(raw.String), &parsed) == nil {
				return parsed
			}
		}
	}
	if !db.HasTable("agent_actions") {
		return nil
	}
	rows, err := db.Query(`SELECT id, action_type, risk_level, COALESCE(payload_json,'{}'), COALESCE(version,1), COALESCE(expires_at,'')
		FROM agent_actions WHERE run_id=? AND user_id=? AND status IN ('proposed','awaiting_approval')
		ORDER BY created_at ASC`, runID, userID)
	if err != nil {
		return nil
	}
	defer rows.Close()
	actions := make([]map[string]any, 0)
	var expiresAt string
	for rows.Next() {
		var id, actionType, risk, payloadRaw string
		var version int
		var exp string
		if rows.Scan(&id, &actionType, &risk, &payloadRaw, &version, &exp) != nil {
			continue
		}
		var payload map[string]any
		_ = json.Unmarshal([]byte(payloadRaw), &payload)
		summary := actionType
		if payload != nil {
			if s, ok := payload["summary"].(string); ok && s != "" {
				summary = s
			}
		}
		actions = append(actions, map[string]any{
			"id": id, "actionType": actionType, "riskLevel": risk, "summary": summary,
			"payload": payload, "version": version,
		})
		if exp != "" {
			expiresAt = exp
		}
	}
	if len(actions) == 0 {
		return nil
	}
	if expiresAt == "" {
		expiresAt = time.Now().UTC().Add(24 * time.Hour).Format(time.RFC3339Nano)
	}
	return map[string]any{"version": 1, "actions": actions, "expiresAt": expiresAt}
}

func loadPendingInput(db *dbx.DB, runID string, userID int) any {
	if !(agentRunsExpressShape(db) || db.HasColumn("agent_runs", "pending_input_json")) {
		return nil
	}
	var raw sql.NullString
	_ = db.QueryRow(`SELECT pending_input_json FROM agent_runs WHERE id=? AND user_id=?`, runID, userID).Scan(&raw)
	if !raw.Valid || strings.TrimSpace(raw.String) == "" || raw.String == "null" {
		return nil
	}
	var parsed any
	if json.Unmarshal([]byte(raw.String), &parsed) == nil {
		return parsed
	}
	return nil
}

func enrichAgentRun(db *dbx.DB, run map[string]any, runID string, userID int) {
	run["pendingApproval"] = loadPendingApproval(db, runID, userID)
	run["pendingInput"] = loadPendingInput(db, runID, userID)
}

func getAgentRunMedia(db *dbx.DB, runID string, userID int) (kind, mimeType, dataURL string, ok bool) {
	if !db.HasTable("agent_run_media") {
		return "", "", "", false
	}
	var data string
	err := db.QueryRow(`SELECT kind, mime_type, data_base64 FROM agent_run_media
		WHERE run_id=? AND user_id=? AND kind='image' ORDER BY created_at DESC LIMIT 1`,
		runID, userID).Scan(&kind, &mimeType, &data)
	if err != nil || data == "" {
		return "", "", "", false
	}
	if !strings.HasPrefix(data, "data:") {
		dataURL = fmt.Sprintf("data:%s;base64,%s", mimeType, data)
	} else {
		dataURL = data
	}
	return kind, mimeType, dataURL, true
}

func resumeAgentRun(db *dbx.DB, runID string, userID int, body map[string]any) (map[string]any, int, error) {
	run, ok := getAgentRun(db, runID, userID)
	if !ok {
		return nil, 404, fmt.Errorf("AGENT_RUN_NOT_FOUND")
	}
	status, _ := run["status"].(string)
	now := time.Now().UTC()
	input := strings.TrimSpace(asStringField(body, "input"))
	decision := strings.TrimSpace(asStringField(body, "decision"))

	switch {
	case input != "":
		if status != "awaiting_input" {
			return nil, 409, fmt.Errorf("AGENT_RESUME_FAILED")
		}
		appendAgentEvent(db, runID, userID, "user_input", map[string]any{"input": input})
		reply := "已收到补充信息，继续处理。"
		completeAgentRunWithReply(db, runID, userID, reply)
	case decision != "":
		if status != "awaiting_approval" {
			return nil, 409, fmt.Errorf("AGENT_RESUME_FAILED")
		}
		if decision != "approve" && decision != "reject" && decision != "edit" {
			return nil, 400, fmt.Errorf("AGENT_RESUME_FAILED")
		}
		if err := applyApprovalDecision(db, runID, userID, decision, body, now); err != nil {
			return nil, 400, err
		}
		if decision == "reject" {
			completeAgentRunWithReply(db, runID, userID, "已拒绝待确认操作。")
		} else {
			completeAgentRunWithReply(db, runID, userID, "已批准并执行待确认操作。")
		}
	default:
		return nil, 400, fmt.Errorf("AGENT_RESUME_FAILED")
	}
	run, _ = getAgentRun(db, runID, userID)
	enrichAgentRun(db, run, runID, userID)
	return agentEnvelope(run), 200, nil
}

func applyApprovalDecision(db *dbx.DB, runID string, userID int, decision string, body map[string]any, now time.Time) error {
	if !db.HasTable("agent_actions") {
		return nil
	}
	nowStr := now.UTC().Format(time.RFC3339Nano)
	status := "executed"
	if decision == "reject" {
		status = "rejected"
	}
	if decision == "edit" {
		rawActions, _ := body["actions"].([]any)
		if len(rawActions) == 0 {
			return fmt.Errorf("AGENT_RESUME_FAILED")
		}
		for _, item := range rawActions {
			m, _ := item.(map[string]any)
			if m == nil {
				continue
			}
			id := strings.TrimSpace(asStringField(m, "id"))
			if id == "" {
				continue
			}
			payload, _ := json.Marshal(m["payload"])
			_, _ = db.Exec(`UPDATE agent_actions SET payload_json=?, status='executed', approval_decision=?,
				approved_by_user_id=?, approved_at=?, executed_at=?, updated_at=? WHERE id=? AND run_id=? AND user_id=?`,
				string(payload), decision, userID, nowStr, nowStr, nowStr, id, runID, userID)
		}
		return nil
	}
	_, err := db.Exec(`UPDATE agent_actions SET status=?, approval_decision=?, approved_by_user_id=?,
		approved_at=?, executed_at=CASE WHEN ?= 'executed' THEN ? ELSE executed_at END, updated_at=?
		WHERE run_id=? AND user_id=? AND status IN ('proposed','awaiting_approval')`,
		status, decision, userID, nowStr, status, nowStr, nowStr, runID, userID)
	return err
}

func retryAgentRun(db *dbx.DB, runID string, userID int) (map[string]any, int, error) {
	run, ok := getAgentRun(db, runID, userID)
	if !ok {
		return nil, 404, fmt.Errorf("AGENT_RUN_NOT_FOUND")
	}
	status, _ := run["status"].(string)
	if status != "failed" {
		return nil, 409, fmt.Errorf("AGENT_RETRY_FAILED")
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	setAgentRunStatus(db, runID, userID, "queued")
	if db.HasColumn("agent_runs", "checkpoint_thread_id") {
		_, _ = db.Exec(`UPDATE agent_runs SET checkpoint_thread_id=NULL, error_code=NULL, error_message=NULL,
			started_at=NULL, completed_at=NULL, updated_at=? WHERE id=? AND user_id=?`, now, runID, userID)
	}
	appendAgentEvent(db, runID, userID, "retry", map[string]any{"reason": "manual_retry"})
	completeAgentRunWithReply(db, runID, userID, "已重新执行。")
	run, _ = getAgentRun(db, runID, userID)
	enrichAgentRun(db, run, runID, userID)
	return agentEnvelope(run), 200, nil
}

func undoAgentRun(db *dbx.DB, runID string, userID int) (undone int, code int, err error) {
	if _, ok := getAgentRun(db, runID, userID); !ok {
		return 0, 404, fmt.Errorf("AGENT_RUN_NOT_FOUND")
	}
	if !db.HasTable("agent_actions") {
		return 0, 200, nil
	}
	now := time.Now().UTC()
	rows, qerr := db.Query(`SELECT id, action_type, COALESCE(executed_at,''), COALESCE(undone_at,'')
		FROM agent_actions WHERE run_id=? AND user_id=? AND status='executed'`, runID, userID)
	if qerr != nil {
		return 0, 400, fmt.Errorf("AGENT_UNDO_FAILED")
	}
	defer rows.Close()
	type row struct {
		ID, ActionType, ExecutedAt, UndoneAt string
	}
	list := make([]row, 0)
	for rows.Next() {
		var r row
		if rows.Scan(&r.ID, &r.ActionType, &r.ExecutedAt, &r.UndoneAt) == nil {
			list = append(list, r)
		}
	}
	_ = rows.Close()
	for _, r := range list {
		if r.UndoneAt != "" {
			continue
		}
		if _, ok := reversibleActionTypes[r.ActionType]; !ok {
			continue
		}
		if r.ExecutedAt != "" {
			t, perr := time.Parse(time.RFC3339Nano, r.ExecutedAt)
			if perr != nil {
				t, perr = time.Parse(time.RFC3339, r.ExecutedAt)
			}
			if perr == nil && now.After(t.Add(10*time.Minute)) {
				return 0, 409, fmt.Errorf("AGENT_UNDO_FAILED")
			}
		}
		_, _ = db.Exec(`UPDATE agent_actions SET status='undone', undone_at=?, updated_at=? WHERE id=? AND user_id=?`,
			now.Format(time.RFC3339Nano), now.Format(time.RFC3339Nano), r.ID, userID)
		undone++
	}
	appendAgentEvent(db, runID, userID, "undo", map[string]any{"undone": undone})
	return undone, 200, nil
}

func completeAgentRunWithReply(db *dbx.DB, runID string, userID int, reply string) {
	now := time.Now().UTC().Format(time.RFC3339Nano)
	setAgentRunStatus(db, runID, userID, "completed")
	resultObj := map[string]any{"reply": reply, "artifacts": []any{}}
	resultJSON, _ := json.Marshal(resultObj)
	if agentRunsExpressShape(db) || db.HasColumn("agent_runs", "result_json") {
		_, _ = db.Exec(`UPDATE agent_runs SET result_json=?, pending_approval_json=NULL, pending_input_json=NULL,
			completed_at=?, updated_at=? WHERE id=? AND user_id=?`,
			string(resultJSON), now, now, runID, userID)
	}
	if db.HasColumn("agent_runs", "summary_json") {
		summary, _ := json.Marshal(map[string]any{"id": runID, "status": "completed", "reply": reply})
		_, _ = db.Exec(`UPDATE agent_runs SET summary_json=?, updated_at=? WHERE id=? AND user_id=?`,
			string(summary), now, runID, userID)
	}
	appendAgentEvent(db, runID, userID, "completed", map[string]any{"reply": reply})
}

func appendAgentEvent(db *dbx.DB, runID string, userID int, eventType string, payload map[string]any) {
	var seq int
	_ = db.QueryRow(`SELECT COALESCE(MAX(sequence),0) FROM agent_run_events WHERE run_id=?`, runID).Scan(&seq)
	seq++
	ev := map[string]any{
		"sequence": seq, "agentName": "go-runtime", "eventType": eventType,
		"type": eventType, "summary": eventType, "payload": payload,
		"createdAt": time.Now().UTC().Format(time.RFC3339Nano),
	}
	raw, _ := json.Marshal(ev)
	if db.HasColumn("agent_run_events", "user_id") {
		_, _ = db.Exec(`INSERT INTO agent_run_events (run_id, user_id, sequence, event_json, created_at)
			VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`, runID, userID, seq, string(raw))
		return
	}
	_, _ = db.Exec(`INSERT INTO agent_run_events (run_id, sequence, event_json, created_at)
		VALUES (?, ?, ?, CURRENT_TIMESTAMP)`, runID, seq, string(raw))
}

func agentEnvelope(run map[string]any) map[string]any {
	return map[string]any{
		"mode":            "agent",
		"run":             run,
		"reply":           run["reply"],
		"artifacts":       run["artifacts"],
		"solutionCards":   []any{},
		"pendingApproval": run["pendingApproval"],
	}
}

// RecordHighRiskApproval parks a chat-driven write as awaiting_approval (Go-native tool loop).
func RecordHighRiskApproval(db *dbx.DB, runID string, userID int, actions []map[string]any) {
	if !db.HasTable("agent_actions") || len(actions) == 0 {
		return
	}
	now := time.Now().UTC()
	expires := now.Add(24 * time.Hour).Format(time.RFC3339Nano)
	for i, action := range actions {
		id := asStringField(action, "id")
		if id == "" {
			id = fmt.Sprintf("%s-a%d", runID, i+1)
		}
		actionType := asStringField(action, "actionType")
		if actionType == "" {
			actionType = "unknown"
		}
		risk := asStringField(action, "riskLevel")
		if risk == "" {
			risk = "high"
		}
		payload, _ := json.Marshal(action)
		_, _ = db.Exec(`INSERT INTO agent_actions
			(id, run_id, user_id, action_type, risk_level, status, payload_json, version, expires_at, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, 'awaiting_approval', ?, 1, ?, ?, ?)
			ON CONFLICT(id) DO NOTHING`,
			id, runID, userID, actionType, risk, string(payload), expires,
			now.Format(time.RFC3339Nano), now.Format(time.RFC3339Nano))
	}
	pending := map[string]any{"version": 1, "actions": actions, "expiresAt": expires}
	pendingJSON, _ := json.Marshal(pending)
	setAgentRunStatus(db, runID, userID, "awaiting_approval")
	if db.HasColumn("agent_runs", "pending_approval_json") {
		_, _ = db.Exec(`UPDATE agent_runs SET pending_approval_json=?, updated_at=? WHERE id=? AND user_id=?`,
			string(pendingJSON), now.Format(time.RFC3339Nano), runID, userID)
	}
}
