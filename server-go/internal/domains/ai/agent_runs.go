// Copyright (c) 2026 heathcetide. All rights reserved.

package ai

import (
	"database/sql"
	"encoding/json"
	"strconv"
	"strings"
	"time"
)

func chatModality(db *sql.DB) string {
	if agentRunsExpressShape(db) {
		return "text"
	}
	return "chat"
}

func insertAgentRun(db *sql.DB, id string, userID int, sessionID, modality, status string, reply string, artifacts []any) {
	now := time.Now().UTC().Format(time.RFC3339Nano)
	artifactsJSON, _ := json.Marshal(artifacts)
	resultObj := map[string]any{"reply": reply, "artifacts": artifacts}
	resultJSON, _ := json.Marshal(resultObj)
	summaryJSON, _ := json.Marshal(map[string]any{
		"id": id, "sessionId": sessionID, "modality": modality, "status": status, "reply": reply,
	})

	if agentRunsExpressShape(db) {
		if sessionID == "" {
			sessionID = id
		}
		_, _ = db.Exec(`INSERT INTO agent_runs
			(id, user_id, session_id, modality, source, status, input_json, checkpoint_thread_id, result_json, created_at, updated_at, completed_at)
			VALUES (?, ?, ?, ?, 'assistant', ?, '{}', ?, ?, ?, ?, ?)`,
			id, userID, sessionID, modality, status, id, string(resultJSON), now, now, now)
		return
	}
	_, _ = db.Exec(`INSERT INTO agent_runs
		(id, user_id, modality, status, summary_json, artifacts_json, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		id, userID, modality, status, string(summaryJSON), string(artifactsJSON), now, now)
}

func getAgentRun(db *sql.DB, runID string, userID int) (map[string]any, bool) {
	if agentRunsExpressShape(db) {
		var sessionID, modality, status, resultJSON, created, updated sql.NullString
		err := db.QueryRow(`SELECT session_id, modality, status, COALESCE(result_json,''),
			COALESCE(created_at,''), COALESCE(updated_at,'')
			FROM agent_runs WHERE id=? AND user_id=?`, runID, userID).
			Scan(&sessionID, &modality, &status, &resultJSON, &created, &updated)
		if err != nil {
			return nil, false
		}
		reply := ""
		var artifacts []any
		if resultJSON.Valid && resultJSON.String != "" {
			var parsed map[string]any
			if json.Unmarshal([]byte(resultJSON.String), &parsed) == nil {
				if r, ok := parsed["reply"].(string); ok {
					reply = r
				}
				if a, ok := parsed["artifacts"].([]any); ok {
					artifacts = a
				}
			}
		}
		return map[string]any{
			"id": runID, "sessionId": nullStr(sessionID), "modality": nullStr(modality),
			"source": "assistant", "status": nullStr(status), "reply": reply,
			"artifacts": artifacts, "pendingApproval": nil, "pendingInput": nil,
			"createdAt": nullStr(created), "updatedAt": nullStr(updated),
		}, true
	}

	var modality, status, summaryJSON, artifactsJSON, created, updated sql.NullString
	err := db.QueryRow(`SELECT modality, status, COALESCE(summary_json,''), COALESCE(artifacts_json,''),
		COALESCE(created_at,''), COALESCE(updated_at,'')
		FROM agent_runs WHERE id=? AND user_id=?`, runID, userID).
		Scan(&modality, &status, &summaryJSON, &artifactsJSON, &created, &updated)
	if err != nil {
		return nil, false
	}
	run := map[string]any{
		"id": runID, "modality": nullStr(modality), "status": nullStr(status),
		"source": "assistant", "artifacts": []any{}, "pendingApproval": nil, "pendingInput": nil,
		"createdAt": nullStr(created), "updatedAt": nullStr(updated),
	}
	if summaryJSON.Valid && summaryJSON.String != "" {
		var s map[string]any
		if json.Unmarshal([]byte(summaryJSON.String), &s) == nil {
			for k, v := range s {
				run[k] = v
			}
		}
	}
	if artifactsJSON.Valid && artifactsJSON.String != "" && artifactsJSON.String != "[]" {
		var arts []any
		if json.Unmarshal([]byte(artifactsJSON.String), &arts) == nil {
			run["artifacts"] = arts
		}
	}
	if _, ok := run["sessionId"]; !ok {
		run["sessionId"] = runID
	}
	return run, true
}

func listAgentRunEvents(db *sql.DB, runID string, afterSequence int) []map[string]any {
	rows, err := db.Query(`SELECT sequence, COALESCE(event_json,'')
		FROM agent_run_events WHERE run_id=? AND sequence>? ORDER BY sequence ASC LIMIT 200`,
		runID, afterSequence)
	if err != nil {
		return []map[string]any{}
	}
	defer rows.Close()
	out := make([]map[string]any, 0)
	for rows.Next() {
		var seq int
		var raw string
		if rows.Scan(&seq, &raw) != nil {
			continue
		}
		ev := map[string]any{"sequence": seq, "type": "log", "payload": map[string]any{}}
		if raw != "" {
			var parsed map[string]any
			if json.Unmarshal([]byte(raw), &parsed) == nil {
				ev = parsed
				if ev["sequence"] == nil {
					ev["sequence"] = seq
				}
			}
		}
		out = append(out, ev)
	}
	return out
}

func setAgentRunStatus(db *sql.DB, runID string, userID int, status string) bool {
	now := time.Now().UTC().Format(time.RFC3339Nano)
	res, err := db.Exec(`UPDATE agent_runs SET status=?, updated_at=? WHERE id=? AND user_id=?`,
		status, now, runID, userID)
	if err != nil {
		return false
	}
	n, _ := res.RowsAffected()
	return n > 0
}

func newRunID(prefix string) string {
	return prefix + strconv.FormatInt(time.Now().UnixNano(), 10)
}

func wantsJSONResponse(cAccept string) bool {
	return strings.Contains(strings.ToLower(cAccept), "application/json")
}
