-- Cross-worker task leases (Express worker_task_leases parity).

CREATE TABLE IF NOT EXISTS worker_task_leases (
	task_name TEXT PRIMARY KEY,
	owner_id TEXT NOT NULL,
	lease_expires_at TEXT NOT NULL,
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
	updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_worker_task_leases_expires
	ON worker_task_leases(lease_expires_at);
