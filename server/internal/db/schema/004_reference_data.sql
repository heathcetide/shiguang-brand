-- Immutable source records are separate from editable business projections.
CREATE TABLE IF NOT EXISTS reference_data_releases (
 dataset_id TEXT PRIMARY KEY, archive_sha256 TEXT NOT NULL,
 source_url TEXT NOT NULL, data_license TEXT, imported_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS reference_data_records (
 dataset_id TEXT NOT NULL, collection TEXT NOT NULL, logical_id TEXT NOT NULL,
 payload_json TEXT NOT NULL, payload_sha256 TEXT NOT NULL,
 target_table TEXT, target_id INTEGER,
 PRIMARY KEY(dataset_id, collection, logical_id),
 FOREIGN KEY(dataset_id) REFERENCES reference_data_releases(dataset_id)
);
CREATE TABLE IF NOT EXISTS nutrition_source_samples (
 dataset_id TEXT NOT NULL, sample_id TEXT NOT NULL, ingredient_id INTEGER,
 display_name TEXT NOT NULL, source_kind TEXT NOT NULL, source_url TEXT NOT NULL,
 data_license TEXT, scope TEXT NOT NULL, basis TEXT NOT NULL,
 calories_100g REAL, protein_100g REAL, fat_100g REAL, carbs_100g REAL,
 nutrients_json TEXT NOT NULL, payload_json TEXT NOT NULL,
 professional_review_performed INTEGER NOT NULL DEFAULT 0,
 automatic_runtime_binding INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(dataset_id, sample_id),
 FOREIGN KEY(dataset_id) REFERENCES reference_data_releases(dataset_id),
 FOREIGN KEY(ingredient_id) REFERENCES ingredients_library(id)
);
CREATE INDEX IF NOT EXISTS idx_nutrition_sample_ingredient ON nutrition_source_samples(ingredient_id);
CREATE INDEX IF NOT EXISTS idx_reference_target ON reference_data_records(target_table, target_id);
