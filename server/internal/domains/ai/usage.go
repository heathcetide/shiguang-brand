// Copyright (c) 2026 heathcetide. All rights reserved.

package ai

import (
	"strings"
	"time"

	"github.com/heathcetide/DietDigiDose/internal/dbx"
)

type UsageRecord struct {
	UserID           int
	Endpoint         string
	Model            string
	PromptTokens     int
	CompletionTokens int
	TotalTokens      int
	LatencyMs        int
	Success          bool
	EstimatedCostUSD float64
	FailureReason    string
	RunID            string
	AgentName        string
	Phase            string
}

func recordUsage(db *dbx.DB, rec UsageRecord) {
	if db == nil || !db.HasTable("ai_usage_logs") {
		return
	}
	endpoint := strings.TrimSpace(rec.Endpoint)
	if endpoint == "" {
		endpoint = "chat"
	}
	model := strings.TrimSpace(rec.Model)
	if model == "" {
		model = "unknown"
	}
	total := rec.TotalTokens
	if total <= 0 {
		total = rec.PromptTokens + rec.CompletionTokens
	}
	success := 0
	if rec.Success {
		success = 1
	}
	_, _ = db.Exec(`INSERT INTO ai_usage_logs
		(user_id, endpoint, model, prompt_tokens, completion_tokens, total_tokens, latency_ms,
		 success, estimated_cost_usd, failure_reason, run_id, agent_name, phase, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		rec.UserID, endpoint, model, rec.PromptTokens, rec.CompletionTokens, total, rec.LatencyMs,
		success, rec.EstimatedCostUSD, nullIfEmpty(rec.FailureReason), nullIfEmpty(rec.RunID),
		nullIfEmpty(rec.AgentName), nullIfEmpty(rec.Phase), time.Now().UTC().Format(time.RFC3339))
}

func nullIfEmpty(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return value
}

func estimateTokens(text string) int {
	runes := len([]rune(text))
	if runes <= 0 {
		return 0
	}
	// Rough bilingual estimate (~2 chars/token for CJK-heavy text).
	n := (runes + 1) / 2
	if n < 1 {
		return 1
	}
	return n
}
