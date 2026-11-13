// Copyright (c) 2026 heathcetide. All rights reserved.

package admin

import (
	"database/sql"
	"os"
	"strconv"
	"strings"
	"time"
)

type coreLoopFact struct {
	ActorKey     string
	UserID       int
	ProductionID string
	CompletedAt  string
	Kind         string
	Included     bool
}

func (h *Handlers) projectCoreLoopWeek(date string, details bool) map[string]any {
	start, end := weekBounds(date)
	env := strings.TrimSpace(os.Getenv("CORE_LOOP_ENVIRONMENT"))
	settings := h.coreLoopSettingsRow()
	enabled := intFromAny(settings["enabled"]) != 0
	coverageStart := strings.TrimSpace(asString(settings["coverage_start"]))
	settingsEnv := strings.TrimSpace(asString(settings["environment"]))

	report := coreLoopNotCollected(date, details)
	if coverageStart != "" {
		report["coverageStart"] = coverageStart
	}
	if !enabled || env == "" || coverageStart == "" || (settingsEnv != "" && settingsEnv != env) {
		return report
	}

	now := time.Now().UTC()
	loc := time.FixedZone("CST", 8*3600)
	weekStart, _ := time.ParseInLocation("2006-01-02", start, loc)
	// endDate from weekBounds is Sunday; exclusive end is next Monday.
	weekEndExclusive, _ := time.ParseInLocation("2006-01-02", end, loc)
	weekEndExclusive = weekEndExclusive.AddDate(0, 0, 1)
	cov, covErr := time.Parse(time.RFC3339, coverageStart)
	if covErr != nil {
		cov, _ = time.Parse("2006-01-02 15:04:05", coverageStart)
	}
	if !cov.IsZero() && !cov.Before(weekEndExclusive) {
		return report
	}

	facts := h.collectCoreLoopFacts(start, end)
	verifiedUsers := map[int]struct{}{}
	verifiedLoops := 0
	evaluations := make([]any, 0, len(facts))
	for _, fact := range facts {
		if !fact.Included || fact.CompletedAt == "" {
			continue
		}
		completed, err := time.Parse(time.RFC3339, fact.CompletedAt)
		if err != nil {
			completed, err = time.ParseInLocation("2006-01-02 15:04:05", fact.CompletedAt, loc)
		}
		if err != nil {
			completed, err = time.ParseInLocation("2006-01-02", fact.CompletedAt, loc)
		}
		if err != nil {
			continue
		}
		if completed.Before(weekStart) || !completed.Before(weekEndExclusive) {
			continue
		}
		if !cov.IsZero() && completed.Before(cov) {
			continue
		}
		verifiedUsers[fact.UserID] = struct{}{}
		verifiedLoops++
		if details && len(evaluations) < 200 {
			evaluations = append(evaluations, map[string]any{
				"actorKey": fact.ActorKey, "userId": fact.UserID, "productionId": fact.ProductionID,
				"completedAt": fact.CompletedAt, "kind": fact.Kind, "reason": "included",
			})
		}
	}

	status := "in_progress"
	if now.Before(weekStart) || (!cov.IsZero() && !cov.Before(weekEndExclusive)) {
		status = "not_collected"
	} else if !cov.IsZero() && cov.After(weekStart) && cov.Before(weekEndExclusive) {
		status = "partial"
	} else if !now.Before(weekEndExclusive) {
		status = "complete"
	}

	report["status"] = status
	if status == "not_collected" || status == "partial" {
		report["users"] = nil
		report["loops"] = nil
	} else {
		report["users"] = len(verifiedUsers)
		report["loops"] = verifiedLoops
	}
	report["verifiedUsers"] = len(verifiedUsers)
	report["verifiedLoops"] = verifiedLoops
	report["smallSample"] = status != "not_collected" && len(verifiedUsers) > 0 && len(verifiedUsers) < 30
	if details {
		report["evaluations"] = evaluations
		report["detailsTruncated"] = len(facts) > 200
	}
	return report
}

func (h *Handlers) collectCoreLoopFacts(startDate, endDate string) []coreLoopFact {
	facts := make([]coreLoopFact, 0)
	upper := endDate + " 23:59:59"
	kindByUser := h.coreLoopActorKindMap()
	appendRows := func(prefix string, rows *sql.Rows) {
		defer rows.Close()
		for rows.Next() {
			var id, userID int
			var completed sql.NullString
			if rows.Scan(&id, &userID, &completed) != nil {
				continue
			}
			kind := kindByUser[userID]
			if kind == "" {
				kind = "unknown"
			}
			facts = append(facts, coreLoopFact{
				ActorKey: "user:" + strconv.Itoa(userID), UserID: userID,
				ProductionID: prefix + strconv.Itoa(id), CompletedAt: completed.String,
				Kind: kind, Included: kind != "excluded" && kind != "demo" && kind != "test" && kind != "automation",
			})
		}
	}
	if h.hasTable("prepared_meals") {
		rows, err := h.DB.Query(`SELECT id, user_id, COALESCE(completed_at, created_at, '')
			FROM prepared_meals
			WHERE COALESCE(completed_at, created_at, '') >= ? AND COALESCE(completed_at, created_at, '') <= ?
			ORDER BY id`, startDate, upper)
		if err == nil {
			appendRows("prepared:", rows)
		}
	}
	if h.hasTable("cooking_completions") {
		rows, err := h.DB.Query(`SELECT id, user_id, COALESCE(completed_at, created_at, '')
			FROM cooking_completions
			WHERE COALESCE(completed_at, created_at, '') >= ? AND COALESCE(completed_at, created_at, '') <= ?
			ORDER BY id`, startDate, upper)
		if err == nil {
			appendRows("cooking:", rows)
		}
	}
	return facts
}

func (h *Handlers) coreLoopActorKindMap() map[int]string {
	out := map[int]string{}
	if !h.hasTable("core_loop_actor_classifications") {
		return out
	}
	rows, err := h.DB.Query(`SELECT user_id, COALESCE(kind,'') FROM core_loop_actor_classifications`)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var userID int
		var kind string
		if rows.Scan(&userID, &kind) != nil {
			continue
		}
		if strings.TrimSpace(kind) == "" {
			kind = "unknown"
		}
		out[userID] = kind
	}
	return out
}

func (h *Handlers) coreLoopActorKind(userID int) string {
	if kind := h.coreLoopActorKindMap()[userID]; kind != "" {
		return kind
	}
	return "unknown"
}
