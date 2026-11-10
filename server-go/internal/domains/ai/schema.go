package ai

import "github.com/heathcetide/DietDigiDose/internal/dbx"

func agentRunsExpressShape(db *dbx.DB) bool { return db.HasColumn("agent_runs", "session_id") }
func writeConfirmExpressShape(db *dbx.DB) bool {
	return db.HasColumn("ai_write_confirmations", "committed_result_json")
}
