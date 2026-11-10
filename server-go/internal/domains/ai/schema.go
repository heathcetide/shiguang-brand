// Copyright (c) 2026 heathcetide. All rights reserved.

package ai

import (
	"database/sql"
	"sync"
)

var schemaOnce sync.Once

// EnsureSchema creates AI-related tables when missing (Go-only SQLite bootstrap).
func EnsureSchema(db *sql.DB) {
	schemaOnce.Do(func() {
		stmts := []string{
			`CREATE TABLE IF NOT EXISTS ai_chat_messages (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				user_id INTEGER NOT NULL,
				session_id TEXT NOT NULL,
				role TEXT NOT NULL,
				content TEXT,
				created_at DATETIME DEFAULT CURRENT_TIMESTAMP
			)`,
			`CREATE TABLE IF NOT EXISTS ai_write_confirmations (
				id TEXT PRIMARY KEY,
				user_id INTEGER NOT NULL,
				status TEXT NOT NULL DEFAULT 'preview',
				payload_json TEXT,
				result_json TEXT,
				idempotency_key TEXT,
				created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
				updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
			)`,
			`CREATE TABLE IF NOT EXISTS agent_runs (
				id TEXT PRIMARY KEY,
				user_id INTEGER NOT NULL,
				modality TEXT NOT NULL,
				status TEXT NOT NULL,
				summary_json TEXT,
				artifacts_json TEXT,
				created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
				updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
			)`,
			`CREATE TABLE IF NOT EXISTS agent_run_events (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				run_id TEXT NOT NULL,
				sequence INTEGER NOT NULL,
				event_json TEXT,
				created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
				UNIQUE(run_id, sequence)
			)`,
		}
		for _, stmt := range stmts {
			_, _ = db.Exec(stmt)
		}
	})
}

func agentRunsExpressShape(db *sql.DB) bool {
	var name sql.NullString
	err := db.QueryRow(`SELECT name FROM pragma_table_info('agent_runs') WHERE name='session_id'`).Scan(&name)
	return err == nil && name.Valid
}

func writeConfirmExpressShape(db *sql.DB) bool {
	var name sql.NullString
	err := db.QueryRow(`SELECT name FROM pragma_table_info('ai_write_confirmations') WHERE name='committed_result_json'`).Scan(&name)
	return err == nil && name.Valid
}
