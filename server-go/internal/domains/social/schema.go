// Copyright (c) 2026 heathcetide. All rights reserved.

package social

import (
	"database/sql"
	"sync"
)

var schemaOnce sync.Once

func (h *Handlers) ensureSchema() {
	schemaOnce.Do(func() {
		if h.DB == nil {
			return
		}
		for _, stmt := range socialSchemaStmts {
			_, _ = h.DB.Exec(stmt)
		}
	})
}

var socialSchemaStmts = []string{
	`CREATE TABLE IF NOT EXISTS households (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL,
		invite_code TEXT UNIQUE,
		owner_id INTEGER,
		owner_user_id INTEGER,
		version INTEGER NOT NULL DEFAULT 1,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	)`,
	`CREATE TABLE IF NOT EXISTS household_members (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		household_id INTEGER NOT NULL,
		user_id INTEGER NOT NULL,
		role TEXT DEFAULT 'member',
		dining_shared INTEGER NOT NULL DEFAULT 0,
		dining_preferences_json TEXT NOT NULL DEFAULT '{}',
		dining_version INTEGER NOT NULL DEFAULT 1,
		joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		UNIQUE(household_id, user_id)
	)`,
	`CREATE TABLE IF NOT EXISTS household_inventory (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		household_id INTEGER NOT NULL,
		created_by_user_id INTEGER NOT NULL,
		food_name TEXT NOT NULL,
		category TEXT NOT NULL DEFAULT '其他',
		quantity TEXT NOT NULL DEFAULT '1',
		expiration_date TEXT,
		storage_location TEXT DEFAULT '冷藏',
		image_url TEXT,
		is_available INTEGER DEFAULT 1,
		version INTEGER NOT NULL DEFAULT 1,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
	)`,
	`CREATE TABLE IF NOT EXISTS household_inventory_items (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		household_id INTEGER NOT NULL,
		created_by_user_id INTEGER NOT NULL,
		food_name TEXT NOT NULL,
		category TEXT NOT NULL DEFAULT '其他',
		quantity TEXT NOT NULL DEFAULT '1',
		expiration_date TEXT,
		storage_location TEXT DEFAULT '冷藏',
		image_url TEXT,
		is_available INTEGER DEFAULT 1,
		version INTEGER NOT NULL DEFAULT 1,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
	)`,
	`CREATE TABLE IF NOT EXISTS household_meals (
		id TEXT PRIMARY KEY,
		household_id INTEGER NOT NULL,
		created_by_user_id INTEGER,
		membership_id INTEGER,
		food_name TEXT NOT NULL,
		produced_servings REAL NOT NULL DEFAULT 1,
		remaining_servings REAL NOT NULL DEFAULT 1,
		payload_json TEXT,
		version INTEGER NOT NULL DEFAULT 1,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
	)`,
	`CREATE TABLE IF NOT EXISTS household_meal_reservations (
		meal_id TEXT NOT NULL,
		membership_id INTEGER NOT NULL,
		servings REAL NOT NULL DEFAULT 0,
		PRIMARY KEY(meal_id, membership_id)
	)`,
	`CREATE TABLE IF NOT EXISTS household_shopping_items (
		id TEXT PRIMARY KEY,
		household_id INTEGER NOT NULL,
		name TEXT NOT NULL,
		amount TEXT NOT NULL DEFAULT '适量',
		category TEXT NOT NULL DEFAULT '其他',
		checked INTEGER NOT NULL DEFAULT 0,
		storage_location TEXT,
		expiration_date TEXT,
		created_by_user_id INTEGER NOT NULL,
		updated_by_user_id INTEGER NOT NULL,
		purchased_by_user_id INTEGER,
		version INTEGER NOT NULL DEFAULT 1,
		deleted_at DATETIME,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
	)`,
	`CREATE TABLE IF NOT EXISTS household_dining_preferences (
		household_id INTEGER NOT NULL,
		user_id INTEGER NOT NULL,
		membership_id INTEGER,
		dining_shared INTEGER NOT NULL DEFAULT 0,
		preferences_json TEXT NOT NULL DEFAULT '{}',
		version INTEGER NOT NULL DEFAULT 1,
		PRIMARY KEY(household_id, user_id)
	)`,
	`CREATE TABLE IF NOT EXISTS household_activity_logs (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		household_id INTEGER NOT NULL,
		operator_user_id INTEGER NOT NULL,
		action TEXT NOT NULL,
		food_name TEXT,
		quantity TEXT,
		storage_location TEXT,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	)`,
	`CREATE TABLE IF NOT EXISTS community_posts (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id INTEGER NOT NULL,
		content TEXT,
		share_code TEXT,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	)`,
	`CREATE TABLE IF NOT EXISTS community_comments (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		post_id INTEGER NOT NULL,
		user_id INTEGER NOT NULL,
		username TEXT,
		content TEXT NOT NULL,
		likes_count INTEGER DEFAULT 0,
		accepted INTEGER DEFAULT 0,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	)`,
	`CREATE TABLE IF NOT EXISTS community_follows (
		follower_id INTEGER NOT NULL,
		followed_id INTEGER NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		PRIMARY KEY(follower_id, followed_id)
	)`,
	`CREATE TABLE IF NOT EXISTS community_checkins (
		user_id INTEGER NOT NULL,
		date_key TEXT NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		PRIMARY KEY(user_id, date_key)
	)`,
	`CREATE TABLE IF NOT EXISTS community_shares (
		code TEXT PRIMARY KEY,
		post_id INTEGER NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	)`,
	`CREATE TABLE IF NOT EXISTS community_comment_likes (
		comment_id INTEGER NOT NULL,
		user_id INTEGER NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		PRIMARY KEY(comment_id, user_id)
	)`,
	`CREATE TABLE IF NOT EXISTS community_post_likes (
		post_id INTEGER NOT NULL,
		user_id INTEGER NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		PRIMARY KEY(post_id, user_id)
	)`,
	`CREATE TABLE IF NOT EXISTS notifications (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id INTEGER NOT NULL,
		type TEXT,
		title TEXT,
		body TEXT,
		read_at TEXT,
		is_read INTEGER DEFAULT 0,
		action_status TEXT,
		metadata_json TEXT,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	)`,
	`CREATE TABLE IF NOT EXISTS user_notification_inbox (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id INTEGER NOT NULL,
		type TEXT NOT NULL,
		title TEXT NOT NULL,
		body TEXT NOT NULL,
		is_read INTEGER NOT NULL DEFAULT 0,
		action_status TEXT,
		feedback_id INTEGER,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	)`,
	`CREATE TABLE IF NOT EXISTS user_notification_preferences (
		user_id INTEGER PRIMARY KEY,
		expiring_alert INTEGER NOT NULL DEFAULT 1,
		meal_reminder INTEGER NOT NULL DEFAULT 1,
		water_reminder INTEGER NOT NULL DEFAULT 1,
		breakfast_time TEXT DEFAULT '08:00',
		lunch_time TEXT DEFAULT '12:00',
		dinner_time TEXT DEFAULT '18:00',
		water_start_time TEXT DEFAULT '09:00',
		water_end_time TEXT DEFAULT '21:00',
		water_interval_minutes INTEGER DEFAULT 120,
		quiet_start_time TEXT DEFAULT '22:00',
		quiet_end_time TEXT DEFAULT '07:00',
		weekdays_enabled INTEGER DEFAULT 1,
		weekends_enabled INTEGER DEFAULT 1,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
	)`,
	`CREATE TABLE IF NOT EXISTS user_intervention_preferences (
		user_id INTEGER PRIMARY KEY,
		preferences_json TEXT NOT NULL DEFAULT '{}',
		version INTEGER NOT NULL DEFAULT 1,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
	)`,
	`CREATE TABLE IF NOT EXISTS push_devices (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id INTEGER NOT NULL,
		expo_push_token TEXT NOT NULL,
		platform TEXT NOT NULL,
		is_active INTEGER NOT NULL DEFAULT 1,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		UNIQUE(expo_push_token)
	)`,
	`CREATE TABLE IF NOT EXISTS notification_interventions (
		id TEXT PRIMARY KEY,
		user_id INTEGER NOT NULL,
		intervention_type TEXT,
		title TEXT,
		body TEXT,
		card_json TEXT,
		payload_json TEXT,
		feedback_json TEXT,
		status TEXT DEFAULT 'inbox',
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	)`,
	`CREATE TABLE IF NOT EXISTS proactive_intervention_preferences (
		user_id INTEGER PRIMARY KEY,
		enabled INTEGER NOT NULL DEFAULT 0,
		expiry_rescue INTEGER NOT NULL DEFAULT 1,
		dinner_window INTEGER NOT NULL DEFAULT 1,
		time_zone TEXT NOT NULL DEFAULT 'Asia/Shanghai',
		dinner_time TEXT NOT NULL DEFAULT '18:00',
		dinner_lead_minutes INTEGER NOT NULL DEFAULT 60,
		extras_json TEXT NOT NULL DEFAULT '{}',
		version INTEGER NOT NULL DEFAULT 1,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
	)`,
	`CREATE TABLE IF NOT EXISTS proactive_interventions (
		id TEXT PRIMARY KEY,
		user_id INTEGER NOT NULL,
		source_key TEXT NOT NULL,
		kind TEXT NOT NULL,
		status TEXT NOT NULL DEFAULT 'inbox',
		title TEXT,
		body TEXT,
		why_now TEXT,
		expires_label TEXT,
		starts_at DATETIME,
		expires_at DATETIME,
		local_date TEXT,
		inventory_ids_json TEXT,
		recipe_ids_json TEXT,
		candidate_json TEXT,
		notification_id INTEGER,
		delivery_state TEXT NOT NULL DEFAULT 'none',
		channel TEXT DEFAULT 'inbox_only',
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		UNIQUE(user_id, source_key)
	)`,
	`CREATE TABLE IF NOT EXISTS proactive_intervention_scan_cursor (
		id INTEGER PRIMARY KEY CHECK(id=1),
		user_id_cursor INTEGER NOT NULL DEFAULT 0,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
	)`,
	`INSERT OR IGNORE INTO proactive_intervention_scan_cursor(id, user_id_cursor) VALUES (1, 0)`,
	`CREATE TABLE IF NOT EXISTS proactive_intervention_actions (
		id TEXT PRIMARY KEY,
		intervention_id TEXT NOT NULL,
		user_id INTEGER NOT NULL,
		idempotency_key TEXT NOT NULL,
		action TEXT NOT NULL,
		request_json TEXT NOT NULL DEFAULT '{}',
		result_json TEXT NOT NULL DEFAULT '{}',
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		UNIQUE(user_id, idempotency_key)
	)`,
	`CREATE TABLE IF NOT EXISTS user_feedback (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id INTEGER NOT NULL,
		category TEXT NOT NULL DEFAULT 'issue',
		content TEXT NOT NULL,
		context_json TEXT,
		status TEXT NOT NULL DEFAULT 'received',
		request_key TEXT,
		version INTEGER NOT NULL DEFAULT 1,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME
	)`,
	`CREATE TABLE IF NOT EXISTS feedback_messages (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		feedback_id INTEGER NOT NULL,
		author_id INTEGER NOT NULL,
		author_role TEXT NOT NULL,
		visibility TEXT NOT NULL DEFAULT 'public',
		content TEXT NOT NULL,
		status TEXT,
		request_key TEXT,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	)`,
}

func (h *Handlers) householdMember(householdID, userID int) (memberID int, role string, ok bool) {
	err := h.DB.QueryRow(`SELECT id, COALESCE(role,'member') FROM household_members WHERE household_id=? AND user_id=?`,
		householdID, userID).Scan(&memberID, &role)
	return memberID, role, err == nil
}

func (h *Handlers) insertHousehold(tx *sql.Tx, name string, userID int, inviteCode string) (int64, error) {
	res, err := tx.Exec(`INSERT INTO households (name, invite_code, owner_id, owner_user_id) VALUES (?, ?, ?, ?)`,
		name, inviteCode, userID, userID)
	if err != nil {
		res, err = tx.Exec(`INSERT INTO households (name, owner_user_id) VALUES (?, ?)`, name, userID)
	}
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}
