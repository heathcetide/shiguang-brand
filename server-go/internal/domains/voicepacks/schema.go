// Copyright (c) 2026 heathcetide. All rights reserved.

package voicepacks

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sync"
)

var schemaOnce sync.Once

// EnsureSchema creates Express-compatible voice pack tables when missing.
func EnsureSchema(db *sql.DB) {
	if db == nil {
		return
	}
	schemaOnce.Do(func() {
		_, _ = db.Exec(`
			CREATE TABLE IF NOT EXISTS voice_pack_versions (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				voice_id TEXT NOT NULL,
				name TEXT NOT NULL,
				version TEXT NOT NULL,
				language TEXT NOT NULL DEFAULT 'zh-CN',
				style_tags_json TEXT NOT NULL DEFAULT '[]',
				manifest_json TEXT NOT NULL,
				resource_fingerprint TEXT NOT NULL UNIQUE,
				provider_voice TEXT,
				status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'published', 'disabled', 'revoked')),
				revision INTEGER NOT NULL DEFAULT 1,
				created_by INTEGER,
				reviewed_by INTEGER,
				published_at DATETIME,
				revoked_at DATETIME,
				revoke_reason TEXT,
				created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
				updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
				UNIQUE(voice_id, version),
				FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
				FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL
			);
			CREATE TABLE IF NOT EXISTS voice_pack_status_history (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				voice_pack_version_id INTEGER NOT NULL,
				actor_user_id INTEGER,
				from_status TEXT,
				to_status TEXT NOT NULL,
				reason TEXT,
				revision INTEGER NOT NULL,
				created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
				FOREIGN KEY (voice_pack_version_id) REFERENCES voice_pack_versions(id) ON DELETE CASCADE,
				FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
			);
			CREATE INDEX IF NOT EXISTS idx_voice_pack_versions_status_voice
				ON voice_pack_versions(status, voice_id, version);
			CREATE INDEX IF NOT EXISTS idx_voice_pack_history_version_created
				ON voice_pack_status_history(voice_pack_version_id, created_at DESC, id DESC);
			CREATE TABLE IF NOT EXISTS user_voice_preferences (
				user_id INTEGER PRIMARY KEY,
				selected_voice_id TEXT,
				selected_version TEXT,
				preference TEXT NOT NULL DEFAULT 'automatic' CHECK(preference IN ('automatic', 'system-only')),
				version INTEGER NOT NULL DEFAULT 1,
				created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
				updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
				FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
			);
		`)
	})
}

// ResourceFingerprint hashes manifest JSON for deduplication.
func ResourceFingerprint(manifest any) string {
	raw, _ := json.Marshal(manifest)
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}

// CatalogVersion returns a short hash over published voice pack rows.
func CatalogVersion(db *sql.DB) string {
	rows, err := db.Query(`SELECT id, revision, status, updated_at FROM voice_pack_versions ORDER BY id`)
	if err != nil {
		return "empty"
	}
	defer rows.Close()
	h := sha256.New()
	for rows.Next() {
		var id, revision int
		var status, updated string
		if rows.Scan(&id, &revision, &status, &updated) == nil {
			_, _ = fmt.Fprintf(h, "%d:%d:%s:%s|", id, revision, status, updated)
		}
	}
	return hex.EncodeToString(h.Sum(nil))[:20]
}
