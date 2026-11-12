// Copyright (c) 2026 heathcetide. All rights reserved.

package social

import (
	"context"
	"database/sql"
	"encoding/json"
	"os"
	"strings"
	"time"
)

// RunInterventionScanOnce runs a single intervention opportunity scan.
func (h *Handlers) RunInterventionScanOnce() (scanned, created int) {
	if !proactiveInterventionsEnabled() {
		return 0, 0
	}
	return h.runInterventionScanBatch()
}

// RunInterventionDeliveryTask claims due interventions and sends Expo pushes.
func (h *Handlers) RunInterventionDeliveryTask(ctx context.Context) (map[string]any, error) {
	out := map[string]any{"processed": 0, "accepted": 0, "failed": 0, "uncertain": 0}
	if !h.hasTable("proactive_interventions") || !proactiveInterventionsEnabled() {
		return out, nil
	}
	now := time.Now().UTC()
	nowStr := now.Format(time.RFC3339)
	rows, err := h.DB.Query(`SELECT user_id FROM proactive_interventions
		WHERE (delivery_state='pending' AND COALESCE(next_attempt_at, created_at) <= ?)
		   OR (delivery_state='sending' AND COALESCE(lease_until, created_at) <= ?)
		GROUP BY user_id
		ORDER BY MIN(COALESCE(next_attempt_at, lease_until, created_at)), user_id
		LIMIT 100`, nowStr, nowStr)
	if err != nil {
		return out, err
	}
	userIDs := make([]int, 0, 32)
	for rows.Next() {
		var uid int
		if rows.Scan(&uid) == nil {
			userIDs = append(userIDs, uid)
		}
	}
	_ = rows.Close()

	for _, userID := range userIDs {
		if ctx.Err() != nil {
			break
		}
		claimed := h.claimIntervention(userID, now)
		if claimed == nil {
			continue
		}
		out["processed"] = asMapInt(out["processed"]) + 1
		tokens := claimed.Tokens
		outcome := "uncertain"
		if len(tokens) == 0 {
			outcome = "failed"
		} else {
			msgs := make([]expoPushMessage, 0, len(tokens))
			for _, token := range tokens {
				if !isExpoPushToken(token) {
					continue
				}
				msgs = append(msgs, expoPushMessage{
					To: token, Title: claimed.Title, Body: claimed.Body, Priority: "high",
					Data: map[string]any{
						"type": "proactive_intervention",
						"interventionId": claimed.ID,
						"notificationId": claimed.NotificationID,
					},
				})
			}
			if len(msgs) == 0 {
				outcome = "failed"
			} else {
				tickets, err := h.sendExpoPush(ctx, msgs)
				if err != nil {
					outcome = "uncertain"
				} else {
					okAll, errAll := true, true
					for _, t := range tickets {
						if t.Status != "ok" && t.Status != "" {
							okAll = false
						} else {
							errAll = false
						}
					}
					if okAll {
						outcome = "accepted"
					} else if errAll {
						outcome = "failed"
					}
				}
			}
		}
		h.finishIntervention(claimed.ID, claimed.LeaseOwner, outcome, now)
		out[outcome] = asMapInt(out[outcome]) + 1
	}
	return out, nil
}

type claimedIntervention struct {
	ID             string
	Title          string
	Body           string
	NotificationID any
	Tokens         []string
	LeaseOwner     string
}

func (h *Handlers) claimIntervention(userID int, now time.Time) *claimedIntervention {
	// Reclaim stale sending → uncertain.
	_, _ = h.DB.Exec(`UPDATE proactive_interventions SET delivery_state='uncertain', lease_until=NULL, updated_at=?
		WHERE user_id=? AND delivery_state='sending' AND COALESCE(lease_until, created_at) <= ?`,
		now.Format(time.RFC3339), userID, now.Format(time.RFC3339))

	var id, title, body string
	var candidateJSON sql.NullString
	var notificationID sql.NullInt64
	err := h.DB.QueryRow(`SELECT id, COALESCE(title,''), COALESCE(body,''), candidate_json, notification_id
		FROM proactive_interventions
		WHERE user_id=? AND delivery_state='pending' AND COALESCE(next_attempt_at, created_at) <= ?
		ORDER BY COALESCE(next_attempt_at, created_at), id LIMIT 1`,
		userID, now.Format(time.RFC3339)).Scan(&id, &title, &body, &candidateJSON, &notificationID)
	if err != nil {
		return nil
	}
	if title == "" && candidateJSON.Valid {
		var cand map[string]any
		if json.Unmarshal([]byte(candidateJSON.String), &cand) == nil {
			title = strings.TrimSpace(asStringAny(cand["title"]))
			body = strings.TrimSpace(asStringAny(cand["body"]))
		}
	}
	leaseOwner := "go-worker"
	if v := strings.TrimSpace(os.Getenv("WORKER_ID")); v != "" {
		leaseOwner = v
	}
	leaseUntil := now.Add(120 * time.Second).Format(time.RFC3339)
	res, err := h.DB.Exec(`UPDATE proactive_interventions
		SET delivery_state='sending', lease_owner=?, lease_until=?, updated_at=?
		WHERE id=? AND delivery_state='pending'`, leaseOwner, leaseUntil, now.Format(time.RFC3339), id)
	if err != nil || rowsAffected(res) == 0 {
		return nil
	}
	var notif any
	if notificationID.Valid {
		notif = int(notificationID.Int64)
	}
	return &claimedIntervention{
		ID: id, Title: title, Body: body, NotificationID: notif,
		Tokens: h.activePushTokens(userID), LeaseOwner: leaseOwner,
	}
}

func (h *Handlers) finishIntervention(id, owner, outcome string, now time.Time) {
	statusExtra := ""
	if outcome == "accepted" {
		statusExtra = ", status='sent'"
	}
	_, _ = h.DB.Exec(`UPDATE proactive_interventions
		SET delivery_state=?, lease_owner=NULL, lease_until=NULL, updated_at=?`+statusExtra+`
		WHERE id=? AND delivery_state='sending' AND COALESCE(lease_owner,'')=?`,
		outcome, now.Format(time.RFC3339), id, owner)
}

func rowsAffected(res sql.Result) int64 {
	if res == nil {
		return 0
	}
	n, _ := res.RowsAffected()
	return n
}

func asMapInt(v any) int {
	switch n := v.(type) {
	case int:
		return n
	case int64:
		return int(n)
	case float64:
		return int(n)
	default:
		return 0
	}
}

func asStringAny(v any) string {
	s, _ := v.(string)
	return s
}
