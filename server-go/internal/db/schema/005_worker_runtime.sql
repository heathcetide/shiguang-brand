-- Worker / push / media-cleanup tables needed for Express parity.

CREATE TABLE IF NOT EXISTS push_notification_receipts (
	expo_ticket_id TEXT PRIMARY KEY,
	user_id INTEGER NOT NULL,
	notification_id INTEGER,
	expo_push_token TEXT NOT NULL,
	submit_status TEXT NOT NULL DEFAULT 'unknown',
	receipt_status TEXT NOT NULL DEFAULT 'pending',
	error_code TEXT,
	error_message TEXT,
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
	checked_at DATETIME
);

CREATE TABLE IF NOT EXISTS notification_events (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	user_id INTEGER NOT NULL,
	notification_id INTEGER,
	event_type TEXT NOT NULL,
	metadata_json TEXT,
	expo_ticket_id TEXT,
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS notification_deliveries (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	user_id INTEGER NOT NULL,
	inventory_item_id INTEGER,
	notification_type TEXT NOT NULL,
	delivery_date TEXT NOT NULL,
	status TEXT NOT NULL DEFAULT 'queued',
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
	UNIQUE(user_id, inventory_item_id, notification_type, delivery_date)
);

CREATE TABLE IF NOT EXISTS notification_inventory_items (
	notification_id INTEGER NOT NULL,
	inventory_item_id INTEGER NOT NULL,
	user_id INTEGER NOT NULL,
	PRIMARY KEY (notification_id, inventory_item_id)
);

CREATE TABLE IF NOT EXISTS media_cleanup_jobs (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	owner_user_id INTEGER NOT NULL,
	urls_json TEXT NOT NULL DEFAULT '[]',
	objects_json TEXT,
	status TEXT NOT NULL DEFAULT 'pending',
	attempts INTEGER NOT NULL DEFAULT 0,
	last_error TEXT,
	claim_token TEXT,
	claimed_at DATETIME,
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
	updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
	completed_at DATETIME
);

CREATE TABLE IF NOT EXISTS worker_task_runs (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	task_name TEXT NOT NULL,
	worker_id TEXT,
	status TEXT NOT NULL DEFAULT 'running',
	summary_json TEXT,
	started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
	finished_at DATETIME,
	error_text TEXT
);

CREATE INDEX IF NOT EXISTS idx_push_receipts_pending
	ON push_notification_receipts(receipt_status, created_at);

CREATE INDEX IF NOT EXISTS idx_notification_events_notification
	ON notification_events(notification_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_media_cleanup_status
	ON media_cleanup_jobs(status, updated_at);

CREATE INDEX IF NOT EXISTS idx_worker_task_runs_started
	ON worker_task_runs(started_at DESC);

-- Plan-maintenance columns Express workers expect (safe on fresh Go DBs).
ALTER TABLE plan_maintenance_events ADD COLUMN processed_at TEXT;
ALTER TABLE plan_maintenance_events ADD COLUMN details_json TEXT;
ALTER TABLE plan_maintenance_jobs ADD COLUMN rule_version TEXT;
ALTER TABLE plan_maintenance_jobs ADD COLUMN lease_token TEXT;
ALTER TABLE plan_maintenance_jobs ADD COLUMN lease_expires_at TEXT;
ALTER TABLE plan_maintenance_jobs ADD COLUMN last_error TEXT;

CREATE TABLE IF NOT EXISTS plan_maintenance_job_events (
	event_id TEXT PRIMARY KEY,
	job_id TEXT NOT NULL,
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_plan_maintenance_events_dedupe
	ON plan_maintenance_events(user_id, event_type, source_id);

ALTER TABLE user_notification_inbox ADD COLUMN category TEXT;
ALTER TABLE user_notification_inbox ADD COLUMN inventory_item_id INTEGER;
ALTER TABLE user_notification_inbox ADD COLUMN group_key TEXT;
ALTER TABLE user_notification_inbox ADD COLUMN priority TEXT;

ALTER TABLE proactive_interventions ADD COLUMN next_attempt_at TEXT;
ALTER TABLE proactive_interventions ADD COLUMN lease_until TEXT;
ALTER TABLE proactive_interventions ADD COLUMN lease_owner TEXT;
