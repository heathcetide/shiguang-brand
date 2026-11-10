// Copyright (c) 2026 heathcetide. All rights reserved.

package db

import (
	"database/sql"
	"strings"
)

// EnsureCoreSchema creates the minimum tables needed for Go-only local boot
// when Express has not yet initialized the shared SQLite file.
func EnsureCoreSchema(conn *sql.DB, driver string) error {
	if driver != "sqlite" {
		return nil
	}
	stmts := []string{
		`CREATE TABLE IF NOT EXISTS users (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			username TEXT UNIQUE NOT NULL,
			email TEXT UNIQUE,
			phone TEXT UNIQUE,
			password_hash TEXT,
			nickname TEXT,
			avatar_url TEXT,
			bio TEXT,
			role TEXT DEFAULT 'user',
			must_change_password INTEGER DEFAULT 0,
			session_version INTEGER NOT NULL DEFAULT 1,
			daily_calories_target INTEGER,
			is_disabled INTEGER DEFAULT 0,
			is_verified_expert INTEGER DEFAULT 0,
			last_login_at TEXT,
			last_login_ip TEXT,
			phone_verified_at TEXT,
			email_verified_at TEXT,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE IF NOT EXISTS inventory_items (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL,
			food_name TEXT NOT NULL,
			category TEXT NOT NULL,
			quantity TEXT NOT NULL,
			expiration_date TEXT NOT NULL,
			storage_location TEXT DEFAULT '冷藏',
			image_url TEXT,
			is_available INTEGER DEFAULT 1,
			version INTEGER DEFAULT 1,
			quantity_value TEXT,
			quantity_unit TEXT,
			note TEXT,
			deleted_at TEXT,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE IF NOT EXISTS system_settings (
			key TEXT PRIMARY KEY,
			value TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS recipes (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			title TEXT NOT NULL,
			summary TEXT,
			cover_image_url TEXT,
			cook_time_minutes INTEGER,
			difficulty TEXT,
			ingredients_json TEXT,
			steps_json TEXT
		)`,
		`CREATE TABLE IF NOT EXISTS funnel_events (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			event_name TEXT NOT NULL,
			actor_hash TEXT,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE IF NOT EXISTS admin_audit_logs (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			admin_user_id INTEGER,
			action TEXT,
			resource_type TEXT,
			resource_id TEXT,
			summary TEXT,
			ip_address TEXT,
			user_agent TEXT,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE IF NOT EXISTS user_health_profiles (
			user_id INTEGER PRIMARY KEY,
			profile_json TEXT
		)`,
		`CREATE TABLE IF NOT EXISTS inventory_change_logs (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER,
			inventory_item_id INTEGER,
			action TEXT,
			source TEXT,
			quantity_before TEXT,
			quantity_after TEXT,
			quantity_unit TEXT,
			delta_value TEXT,
			idempotency_key TEXT,
			metadata_json TEXT,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE IF NOT EXISTS inventory_consumption_requests (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL,
			idempotency_key TEXT NOT NULL,
			result_json TEXT NOT NULL,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(user_id, idempotency_key)
		)`,
		`CREATE TABLE IF NOT EXISTS shopping_inventory_imports (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL,
			idempotency_key TEXT NOT NULL,
			result_json TEXT NOT NULL,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(user_id, idempotency_key)
		)`,
		`CREATE TABLE IF NOT EXISTS inventory_intake_batches (
			id TEXT PRIMARY KEY,
			user_id INTEGER NOT NULL,
			idempotency_key TEXT NOT NULL,
			source TEXT NOT NULL,
			source_reference TEXT,
			confirmed_payload_json TEXT NOT NULL,
			result_json TEXT NOT NULL,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(user_id, idempotency_key)
		)`,
		`CREATE TABLE IF NOT EXISTS inventory_scan_jobs (
			id TEXT PRIMARY KEY,
			user_id INTEGER NOT NULL,
			image_hash TEXT,
			status TEXT NOT NULL DEFAULT 'queued',
			result_json TEXT,
			error_message TEXT,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE INDEX IF NOT EXISTS idx_inventory_intake_batches_user_created
			ON inventory_intake_batches(user_id, created_at DESC)`,
		`CREATE INDEX IF NOT EXISTS idx_inventory_change_logs_item
			ON inventory_change_logs(user_id, inventory_item_id, created_at DESC)`,
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
		if _, err := conn.Exec(stmt); err != nil {
			return err
		}
	}
	alters := []string{
		`ALTER TABLE inventory_items ADD COLUMN batch_code TEXT`,
		`ALTER TABLE inventory_items ADD COLUMN package_size_value REAL`,
		`ALTER TABLE inventory_items ADD COLUMN package_size_unit TEXT`,
		`ALTER TABLE inventory_items ADD COLUMN updated_at DATETIME`,
		`ALTER TABLE inventory_change_logs ADD COLUMN metadata_json TEXT`,
	}
	for _, stmt := range alters {
		if _, err := conn.Exec(stmt); err != nil {
			if strings.Contains(strings.ToLower(err.Error()), "duplicate column") {
				continue
			}
		}
	}
	return nil
}
