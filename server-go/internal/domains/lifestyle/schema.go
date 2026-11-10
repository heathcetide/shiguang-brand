// Copyright (c) 2026 heathcetide. All rights reserved.

package lifestyle

import (
	"database/sql"
	"sync"
)

var schemaOnce sync.Once

// EnsureSchema creates lifestyle-related tables when missing (Go-only SQLite bootstrap).
func EnsureSchema(db *sql.DB) {
	schemaOnce.Do(func() {
		stmts := []string{
			`CREATE TABLE IF NOT EXISTS diet_records (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				user_id INTEGER NOT NULL,
				meal_type TEXT,
				food_name TEXT,
				calories INTEGER DEFAULT 0,
				recorded_at TEXT,
				created_at DATETIME DEFAULT CURRENT_TIMESTAMP
			)`,
			`CREATE TABLE IF NOT EXISTS health_logs (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				user_id INTEGER NOT NULL,
				weight REAL,
				steps REAL,
				sleep_hours REAL,
				recorded_at TEXT,
				recorded_date TEXT,
				created_at DATETIME DEFAULT CURRENT_TIMESTAMP
			)`,
			`CREATE TABLE IF NOT EXISTS user_onboarding (
				user_id INTEGER PRIMARY KEY,
				payload_json TEXT,
				updated_at TEXT
			)`,
			`CREATE TABLE IF NOT EXISTS cooking_queue_items (
				id TEXT PRIMARY KEY,
				user_id INTEGER NOT NULL,
				recipe_id INTEGER,
				status TEXT DEFAULT 'waiting',
				position INTEGER DEFAULT 0,
				version INTEGER DEFAULT 1,
				body_json TEXT DEFAULT '{}',
				created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
				updated_at DATETIME
			)`,
			`CREATE TABLE IF NOT EXISTS meal_plans (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				user_id INTEGER NOT NULL,
				title TEXT,
				status TEXT DEFAULT 'draft',
				version INTEGER DEFAULT 1,
				payload_json TEXT,
				constraints_json TEXT DEFAULT '{}',
				draft_json TEXT DEFAULT '{}',
				start_date TEXT,
				end_date TEXT,
				created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
				updated_at DATETIME,
				deleted_at TEXT
			)`,
			`CREATE TABLE IF NOT EXISTS meal_plan_items (
				id TEXT PRIMARY KEY,
				plan_id TEXT NOT NULL,
				user_id INTEGER NOT NULL,
				status TEXT DEFAULT 'planned',
				version INTEGER DEFAULT 1,
				payload_json TEXT DEFAULT '{}',
				created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
				updated_at DATETIME,
				deleted_at TEXT
			)`,
			`CREATE TABLE IF NOT EXISTS meal_plan_changes (
				id TEXT PRIMARY KEY,
				user_id INTEGER NOT NULL,
				plan_id TEXT NOT NULL,
				item_id TEXT,
				status TEXT DEFAULT 'pending',
				fingerprint TEXT,
				body_json TEXT DEFAULT '{}',
				created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
				applied_at TEXT
			)`,
			`CREATE TABLE IF NOT EXISTS meal_plan_execution_requests (
				user_id INTEGER NOT NULL,
				idempotency_key TEXT NOT NULL,
				action TEXT NOT NULL,
				meal_plan_item_id TEXT NOT NULL,
				result_json TEXT NOT NULL,
				created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
				UNIQUE(user_id, idempotency_key)
			)`,
			`CREATE TABLE IF NOT EXISTS prepared_meals (
				id TEXT PRIMARY KEY,
				user_id INTEGER NOT NULL,
				idempotency_key TEXT,
				food_name TEXT NOT NULL,
				produced_servings REAL DEFAULT 1,
				remaining_servings REAL DEFAULT 1,
				version INTEGER DEFAULT 1,
				result_json TEXT DEFAULT '{}',
				produced_at DATETIME DEFAULT CURRENT_TIMESTAMP,
				updated_at DATETIME
			)`,
			`CREATE UNIQUE INDEX IF NOT EXISTS idx_prepared_meals_user_idempotency ON prepared_meals(user_id, idempotency_key)`,
			`CREATE TABLE IF NOT EXISTS prepared_meal_events (
				id TEXT PRIMARY KEY,
				user_id INTEGER NOT NULL,
				prepared_meal_id TEXT NOT NULL,
				idempotency_key TEXT NOT NULL,
				event_type TEXT NOT NULL,
				result_json TEXT DEFAULT '{}',
				created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
				UNIQUE(user_id, idempotency_key)
			)`,
			`CREATE TABLE IF NOT EXISTS cooking_completions (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				user_id INTEGER NOT NULL,
				idempotency_key TEXT NOT NULL,
				result_json TEXT NOT NULL,
				created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
				UNIQUE(user_id, idempotency_key)
			)`,
			`CREATE TABLE IF NOT EXISTS inventory_outcome_events (
				id TEXT PRIMARY KEY,
				user_id INTEGER NOT NULL,
				idempotency_key TEXT,
				outcome TEXT DEFAULT 'unknown',
				scope TEXT DEFAULT 'personal',
				occurred_at TEXT,
				payload_json TEXT DEFAULT '{}',
				version INTEGER DEFAULT 1,
				created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
				UNIQUE(user_id, idempotency_key)
			)`,
			`CREATE TABLE IF NOT EXISTS plan_maintenance_settings (
				user_id INTEGER PRIMARY KEY,
				enabled INTEGER DEFAULT 0,
				time_zone TEXT,
				local_time TEXT,
				next_check_at TEXT,
				next_local_date TEXT,
				last_completed_local_date TEXT,
				version INTEGER DEFAULT 0,
				updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
			)`,
			`CREATE TABLE IF NOT EXISTS plan_maintenance_jobs (
				id TEXT PRIMARY KEY,
				user_id INTEGER NOT NULL,
				status TEXT DEFAULT 'queued',
				attempts INTEGER DEFAULT 0,
				available_at TEXT,
				result_json TEXT,
				created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
				updated_at DATETIME
			)`,
			`CREATE TABLE IF NOT EXISTS plan_maintenance_events (
				id TEXT PRIMARY KEY,
				user_id INTEGER NOT NULL,
				event_type TEXT,
				source_id TEXT,
				subject_id TEXT,
				created_at DATETIME DEFAULT CURRENT_TIMESTAMP
			)`,
		}
		for _, stmt := range stmts {
			_, _ = db.Exec(stmt)
		}
	})
}
