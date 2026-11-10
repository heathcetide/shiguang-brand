// Copyright (c) 2026 heathcetide. All rights reserved.

package voicepacks

import (
	"database/sql"
	"encoding/json"
	"strings"
)

// AdminItem is the admin VoicePacks list shape.
func AdminItem(row map[string]any) map[string]any {
	manifest := parseManifestJSON(row["manifest_json"])
	styleTags := jsonArray(row["style_tags_json"])
	return map[string]any{
		"id":            row["id"],
		"voiceId":       row["voice_id"],
		"name":          row["name"],
		"version":       row["version"],
		"language":      nullOr(row["language"], "zh-CN"),
		"styleTags":     styleTags,
		"manifest":      manifest,
		"providerVoice": nullStr(row["provider_voice"]),
		"status":        row["status"],
		"revision":      row["revision"],
		"createdBy":     nullInt(row["created_by"]),
		"reviewedBy":    nullInt(row["reviewed_by"]),
		"publishedAt":   nullStr(row["published_at"]),
		"revokedAt":     nullStr(row["revoked_at"]),
		"revokeReason":  nullStr(row["revoke_reason"]),
		"createdAt":     row["created_at"],
		"updatedAt":     row["updated_at"],
	}
}

// ClientItem is a published catalog entry for mobile clients.
func ClientItem(row map[string]any) map[string]any {
	return parseManifestJSON(row["manifest_json"])
}

func ScanRow(scanner interface {
	Scan(dest ...any) error
}) (map[string]any, error) {
	var id, revision int
	var voiceID, name, version, language, styleTags, manifest, fingerprint, status string
	var providerVoice sql.NullString
	var createdBy, reviewedBy sql.NullInt64
	var publishedAt, revokedAt, revokeReason, createdAt, updatedAt sql.NullString
	err := scanner.Scan(&id, &voiceID, &name, &version, &language, &styleTags, &manifest, &fingerprint,
		&providerVoice, &status, &revision, &createdBy, &reviewedBy, &publishedAt, &revokedAt, &revokeReason,
		&createdAt, &updatedAt)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"id": id, "voice_id": voiceID, "name": name, "version": version, "language": language,
		"style_tags_json": styleTags, "manifest_json": manifest, "resource_fingerprint": fingerprint,
		"provider_voice": providerVoice, "status": status, "revision": revision,
		"created_by": createdBy, "reviewed_by": reviewedBy,
		"published_at": publishedAt, "revoked_at": revokedAt, "revoke_reason": revokeReason,
		"created_at": createdAt, "updated_at": updatedAt,
	}, nil
}

// SelectColumnsConst is the column list for voice_pack_versions scans.
func SelectColumnsConst() string {
	return `id, voice_id, name, version, language, style_tags_json, manifest_json, resource_fingerprint,
		provider_voice, status, revision, created_by, reviewed_by, published_at, revoked_at, revoke_reason, created_at, updated_at`
}

func parseManifestJSON(v any) map[string]any {
	switch t := v.(type) {
	case string:
		var m map[string]any
		if json.Unmarshal([]byte(t), &m) == nil {
			return m
		}
	case []byte:
		var m map[string]any
		if json.Unmarshal(t, &m) == nil {
			return m
		}
	}
	return map[string]any{}
}

func jsonArray(v any) []any {
	switch t := v.(type) {
	case string:
		var arr []any
		if json.Unmarshal([]byte(t), &arr) == nil {
			return arr
		}
	}
	return []any{}
}

func nullStr(v any) any {
	switch t := v.(type) {
	case sql.NullString:
		if !t.Valid || strings.TrimSpace(t.String) == "" {
			return nil
		}
		return t.String
	case string:
		if strings.TrimSpace(t) == "" {
			return nil
		}
		return t
	default:
		return nil
	}
}

func nullInt(v any) any {
	switch t := v.(type) {
	case sql.NullInt64:
		if !t.Valid {
			return nil
		}
		return t.Int64
	case int64:
		return t
	case int:
		return t
	default:
		return nil
	}
}

func nullOr(v any, fallback string) any {
	s, _ := v.(string)
	if strings.TrimSpace(s) == "" {
		return fallback
	}
	return s
}
