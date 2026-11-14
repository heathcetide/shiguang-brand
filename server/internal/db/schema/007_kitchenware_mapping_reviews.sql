-- Kitchenware mapping review queue (Express parity for admin审核).

CREATE TABLE IF NOT EXISTS kitchenware_mapping_reviews (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	raw_name TEXT NOT NULL,
	normalized_name TEXT NOT NULL,
	source_type TEXT NOT NULL,
	source_id TEXT,
	status TEXT NOT NULL DEFAULT 'pending',
	confidence REAL DEFAULT 0,
	suggested_catalog_id INTEGER,
	reviewed_at DATETIME,
	reviewed_by INTEGER,
	reviewed_notes TEXT,
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
	updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
	UNIQUE(normalized_name, source_type, source_id)
);

CREATE INDEX IF NOT EXISTS idx_kitchenware_mapping_reviews_status
	ON kitchenware_mapping_reviews(status, id);
