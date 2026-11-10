-- Tables used by migrated catalog, shopping and recommendation endpoints.
CREATE TABLE IF NOT EXISTS ingredients_library (
 id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, category TEXT, unit TEXT,
 calories_100g REAL, protein_100g REAL, fat_100g REAL, carbs_100g REAL,
 source TEXT, source_ref TEXT, barcode TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS user_custom_foods (
 id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, name TEXT NOT NULL,
 category TEXT, unit TEXT, calories_100g REAL, protein_100g REAL, fat_100g REAL, carbs_100g REAL,
 status TEXT DEFAULT 'pending', note TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS kitchenware_catalog (
 id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, category TEXT,
 description TEXT, image_url TEXT, capability_codes_json TEXT DEFAULT '[]',
 created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS kitchenware_items (
 id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, name TEXT NOT NULL,
 category TEXT, status TEXT DEFAULT '良好', note TEXT, catalog_id INTEGER,
 version INTEGER DEFAULT 1, deleted_at TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS kitchenware_capabilities (
 id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
 category TEXT, description TEXT, safety_level TEXT DEFAULT 'standard'
);
CREATE TABLE IF NOT EXISTS recipe_favorites (
 user_id INTEGER NOT NULL, recipe_id INTEGER NOT NULL,
 created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(user_id, recipe_id),
 FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
 FOREIGN KEY(recipe_id) REFERENCES recipes(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS shopping_list_items (
 id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, client_id TEXT,
 name TEXT NOT NULL, quantity TEXT DEFAULT '', amount TEXT DEFAULT '适量', category TEXT DEFAULT '其他',
 checked INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 1,
 storage_location TEXT, expiration_date TEXT, deleted_at TEXT,
 created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(user_id, client_id)
);
CREATE TABLE IF NOT EXISTS user_recommendation_preferences (
 user_id INTEGER PRIMARY KEY, preferences_json TEXT NOT NULL DEFAULT '{}',
 version INTEGER NOT NULL DEFAULT 1, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS recommendation_learning_settings (
 user_id INTEGER PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 0,
 overrides_json TEXT DEFAULT '{}',
 version INTEGER NOT NULL DEFAULT 1, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS recipe_recommendation_events (
 id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, recipe_id INTEGER,
 event_type TEXT, source TEXT, payload_json TEXT, scoring_version TEXT, surface TEXT,
 request_id TEXT, metadata_json TEXT, idempotency_key TEXT,
 created_at DATETIME DEFAULT CURRENT_TIMESTAMP, UNIQUE(user_id, idempotency_key)
);
CREATE TABLE IF NOT EXISTS ai_usage_logs (
 id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, endpoint TEXT, model TEXT,
 prompt_tokens INTEGER DEFAULT 0, completion_tokens INTEGER DEFAULT 0, total_tokens INTEGER DEFAULT 0,
 latency_ms INTEGER DEFAULT 0, success INTEGER DEFAULT 1, estimated_cost_usd REAL DEFAULT 0,
 failure_reason TEXT, run_id TEXT, agent_name TEXT, phase TEXT,
 created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
