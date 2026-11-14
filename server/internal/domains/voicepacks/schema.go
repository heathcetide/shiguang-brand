// Copyright (c) 2026 heathcetide. All rights reserved.

package voicepacks

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"github.com/heathcetide/DietDigiDose/internal/dbx"
)

// ResourceFingerprint hashes manifest JSON for deduplication.
func ResourceFingerprint(manifest any) string {
	raw, _ := json.Marshal(manifest)
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}

// CatalogVersion returns a short hash over published voice pack rows.
func CatalogVersion(db *dbx.DB) string {
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
