// Copyright (c) 2026 heathcetide. All rights reserved.

package dbx

import (
	"regexp"
	"strings"
)

var (
	reConflictDoNothing      = regexp.MustCompile(`(?i)\s+ON\s+CONFLICT(?:\s*\([^)]*\))?\s+DO\s+NOTHING`)
	reConflictDoUpdate       = regexp.MustCompile(`(?is)\s+ON\s+CONFLICT(?:\s*\([^)]*\))?\s+DO\s+UPDATE\s+SET\s+(.+)$`)
	reExcludedRef            = regexp.MustCompile(`(?i)\bexcluded\.([a-zA-Z_][a-zA-Z0-9_]*)`)
	reInsertInto             = regexp.MustCompile(`(?i)^\s*INSERT\s+INTO\b`)
	reReturningClause        = regexp.MustCompile(`(?i)\s+RETURNING\b.+$`)
)

var (
	reSettingsKeyList  = regexp.MustCompile(`(?i)\bsystem_settings\s*\(\s*key\s*,`)
	reSettingsKeyOnly  = regexp.MustCompile(`(?i)\bsystem_settings\s*\(\s*key\s*\)`)
	reSettingsWhereKey = regexp.MustCompile(`(?i)\bWHERE\s+key\b`)
	reSettingsSelectKey = regexp.MustCompile(`(?i)\bSELECT\s+key\s*,`)
	reSettingsKeyIn    = regexp.MustCompile(`(?i)\bkey\s+IN\s*\(`)
	reSettingsKeyLike  = regexp.MustCompile(`(?i)\bkey\s+LIKE\b`)
	reSettingsKeyEq    = regexp.MustCompile(`(?i)\bkey\s*=`)
)

// Rewrite adapts portable SQLite/PostgreSQL-flavored SQL for MySQL.
func Rewrite(query, dialect string) string {
	if dialect != "mysql" {
		return query
	}
	q := strings.TrimSpace(query)
	if reConflictDoNothing.MatchString(q) {
		q = reConflictDoNothing.ReplaceAllString(q, "")
		if reInsertInto.MatchString(q) && !strings.Contains(strings.ToUpper(q), "IGNORE") {
			q = reInsertInto.ReplaceAllString(q, "INSERT IGNORE INTO")
		}
		q = quoteMySQLReserved(q)
		return strings.TrimSpace(q)
	}
	if m := reConflictDoUpdate.FindStringSubmatch(q); len(m) == 2 {
		setClause := reExcludedRef.ReplaceAllString(m[1], "VALUES($1)")
		base := strings.TrimSpace(reConflictDoUpdate.ReplaceAllString(q, ""))
		return quoteMySQLReserved(base) + " ON DUPLICATE KEY UPDATE " + strings.TrimSpace(setClause)
	}
	return quoteMySQLReserved(q)
}

func quoteMySQLReserved(q string) string {
	if !strings.Contains(strings.ToLower(q), "system_settings") {
		return q
	}
	q = reSettingsKeyList.ReplaceAllString(q, "system_settings(`key`,")
	q = reSettingsKeyOnly.ReplaceAllString(q, "system_settings(`key`)")
	q = reSettingsSelectKey.ReplaceAllString(q, "SELECT `key`,")
	q = reSettingsWhereKey.ReplaceAllString(q, "WHERE `key`")
	q = reSettingsKeyIn.ReplaceAllString(q, "`key` IN (")
	q = reSettingsKeyLike.ReplaceAllString(q, "`key` LIKE")
	q = reSettingsKeyEq.ReplaceAllString(q, "`key`=")
	return q
}

func stripReturning(query string) string {
	return strings.TrimSpace(reReturningClause.ReplaceAllString(strings.TrimSpace(query), ""))
}
