package db

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"embed"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/heathcetide/DietDigiDose/internal/dbx"
	"golang.org/x/crypto/bcrypt"
)

//go:embed schema/*.sql
var migrations embed.FS

// EnsureCoreSchema is kept for the server entry point. Schema initialization is
// now versioned and identical for SQLite and PostgreSQL, not a SQLite-only stub.
func EnsureCoreSchema(conn *dbx.DB, driver string) error {
	if conn.Dialect != driver {
		return fmt.Errorf("database dialect mismatch: %s != %s", conn.Dialect, driver)
	}
	return Migrate(conn)
}

// CheckSchema verifies migrations without issuing any DDL. Production API and
// worker roles can have DML-only privileges; a separate job owns schema changes.
func CheckSchema(conn *dbx.DB) error {
	entries, err := migrations.ReadDir("schema")
	if err != nil {
		return err
	}
	for _, entry := range entries {
		raw, err := migrations.ReadFile("schema/" + entry.Name())
		if err != nil {
			return err
		}
		var checksum string
		if err := conn.QueryRow(`SELECT checksum FROM go_schema_migrations WHERE version=?`, entry.Name()).Scan(&checksum); err != nil {
			return fmt.Errorf("schema not ready; run server -migrate with the migration role: %w", err)
		}
		if checksum != fmt.Sprintf("%x", sha256.Sum256(raw)) {
			return fmt.Errorf("migration %s checksum changed", entry.Name())
		}
	}
	for _, col := range additiveColumns {
		if !conn.HasColumn(col.table, col.name) {
			return fmt.Errorf("missing %s.%s; run server -migrate", col.table, col.name)
		}
	}
	return nil
}

var additiveColumns = []struct{ table, name, typ string }{
	{"inventory_items", "batch_code", "TEXT"},
	{"inventory_items", "package_size_value", "REAL"},
	{"inventory_items", "package_size_unit", "TEXT"},
	{"inventory_items", "updated_at", "TEXT"},
	{"inventory_change_logs", "metadata_json", "TEXT"},
	{"diet_records", "amount", "TEXT"},
	{"community_posts", "username", "TEXT"},
	{"community_posts", "nickname", "TEXT"},
	{"community_posts", "avatar_url", "TEXT"},
	{"community_posts", "image_url", "TEXT"},
	{"community_posts", "image_urls", "TEXT"},
	{"community_posts", "category", "TEXT"},
	{"community_posts", "deleted_at", "TEXT"},
	{"community_posts", "likes_count", "INTEGER DEFAULT 0"},
	{"community_posts", "comment_count", "INTEGER DEFAULT 0"},
	{"community_posts", "views_count", "INTEGER DEFAULT 0"},
	{"community_posts", "event_start_at", "TEXT"},
	{"community_posts", "event_end_at", "TEXT"},
	{"community_posts", "question_status", "TEXT"},
	{"community_posts", "accepted_comment_id", "INTEGER"},
	{"community_comments", "nickname", "TEXT"},
	{"community_comments", "avatar_url", "TEXT"},
	{"community_comments", "image_url", "TEXT"},
	{"diet_records", "protein", "REAL"},
	{"diet_records", "carbs", "REAL"},
	{"diet_records", "fat", "REAL"},
	{"diet_records", "image_url", "TEXT"},
	{"diet_records", "recorded_time", "TEXT"},
	{"ai_chat_messages", "source", "TEXT"},
	{"ai_chat_messages", "status", "TEXT"},
	{"ai_chat_messages", "response_time_ms", "INTEGER"},
	{"user_notification_inbox", "category", "TEXT"},
	{"ingredients_library", "aliases_json", "TEXT DEFAULT '[]'"},
	{"ingredients_library", "source_version", "TEXT"},
	{"ingredients_library", "data_license", "TEXT"},
	{"ingredients_library", "quality_status", "TEXT DEFAULT 'needs_review'"},
	{"ingredients_library", "nutrition_basis", "TEXT DEFAULT 'unknown'"},
	{"ingredients_library", "base_data_payload", "TEXT"},
	{"ingredients_library", "image_url", "TEXT"},
	{"ingredients_library", "brands", "TEXT"},
	{"ingredients_library", "micronutrients_json", "TEXT"},
	{"ingredients_library", "normalized_name", "TEXT"},
	{"ingredients_library", "original_name", "TEXT"},
	{"ingredients_library", "deleted_at", "TEXT"},
	{"ingredients_library", "deleted_by", "INTEGER"},
	{"recipes", "source", "TEXT"},
	{"recipes", "source_url", "TEXT"},
	{"recipes", "source_revision", "TEXT"},
	{"recipes", "data_license", "TEXT"},
	{"recipes", "external_id", "TEXT"},
	{"recipes", "status", "TEXT DEFAULT 'approved'"},
	{"recipes", "quality_status", "TEXT DEFAULT 'trusted'"},
	{"recipes", "serving_size", "REAL"},
	{"recipes", "automatic_inventory_write_allowed", "INTEGER NOT NULL DEFAULT 1"},
	{"recipes", "base_data_payload", "TEXT"},
	{"recipes", "image_url", "TEXT"},
	{"recipes", "description", "TEXT"},
	{"recipes", "cook_time", "INTEGER"},
	{"recipes", "calories", "INTEGER"},
	{"recipes", "protein", "REAL"},
	{"recipes", "carbs", "REAL"},
	{"recipes", "fat", "REAL"},
	{"recipes", "category", "TEXT"},
	{"recipes", "tags", "TEXT"},
	{"recipes", "deleted_at", "TEXT"},
	{"kitchenware_catalog", "source", "TEXT"},
	{"kitchenware_catalog", "quality_status", "TEXT DEFAULT 'needs_review'"},
	{"kitchenware_catalog", "base_data_payload", "TEXT"},
	{"kitchenware_catalog", "aliases", "TEXT DEFAULT '[]'"},
	{"kitchenware_catalog", "barcode", "TEXT"},
	{"kitchenware_catalog", "brands", "TEXT"},
}

func Migrate(conn *dbx.DB) error {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	// Express's native PG schema has different boolean/JSON/state-machine
	// contracts. Refuse silently adopting it: migrate a backed-up copy explicitly.
	if conn.Dialect == "postgresql" && conn.HasTable("users") {
		var typ string
		err := conn.QueryRowContext(ctx, `SELECT data_type FROM information_schema.columns
			WHERE table_schema=current_schema() AND table_name='users' AND column_name='is_disabled'`).Scan(&typ)
		if err == nil && typ == "boolean" {
			return fmt.Errorf("legacy Express PostgreSQL schema detected; use a separate Go database and an explicit reviewed data migration, not an in-place schema conversion")
		}
	}
	tx, err := conn.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if conn.Dialect == "postgresql" {
		// Serialize concurrent migration jobs without relying on an application lock.
		if _, err := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(847235190)`); err != nil {
			return err
		}
	}
	if _, err := tx.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS go_schema_migrations (
		version TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL)`); err != nil {
		return err
	}
	entries, err := migrations.ReadDir("schema")
	if err != nil {
		return err
	}
	for _, entry := range entries {
		raw, err := migrations.ReadFile("schema/" + entry.Name())
		if err != nil {
			return err
		}
		checksum := fmt.Sprintf("%x", sha256.Sum256(raw))
		var existing string
		rowErr := tx.QueryRowContext(ctx, `SELECT checksum FROM go_schema_migrations WHERE version=?`, entry.Name()).Scan(&existing)
		if rowErr == nil {
			if existing != checksum {
				return fmt.Errorf("migration %s checksum changed", entry.Name())
			}
			continue
		}
		if rowErr != nil && !errors.Is(rowErr, sql.ErrNoRows) {
			return rowErr
		}
		// Migration files contain only simple DDL (no triggers/procedural bodies).
		// Remove whole-line comments before splitting their statement terminators.
		var ddl strings.Builder
		for _, line := range strings.Split(string(raw), "\n") {
			if !strings.HasPrefix(strings.TrimSpace(line), "--") {
				ddl.WriteString(line)
				ddl.WriteByte('\n')
			}
		}
		for _, stmt := range strings.Split(ddl.String(), ";") {
			stmt = strings.TrimSpace(stmt)
			if stmt == "" {
				continue
			}
			if _, err := tx.ExecContext(ctx, schemaSQL(stmt, conn.Dialect)); err != nil {
				return fmt.Errorf("migration %s: %w", entry.Name(), err)
			}
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO go_schema_migrations(version, checksum, applied_at) VALUES (?, ?, ?)`,
			entry.Name(), checksum, time.Now().UTC().Format(time.RFC3339Nano)); err != nil {
			return err
		}
	}
	// Adopt older Go SQLite files additively. Never recreate or truncate tables.
	for _, col := range additiveColumns {
		var n int
		query := `SELECT COUNT(*) FROM pragma_table_info(?) WHERE name=?`
		if conn.Dialect == "postgresql" {
			query = `SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=? AND column_name=?`
		}
		if err := tx.QueryRowContext(ctx, query, col.table, col.name).Scan(&n); err != nil {
			return err
		}
		if n == 0 {
			if _, err := tx.ExecContext(ctx, schemaSQL("ALTER TABLE "+col.table+" ADD COLUMN "+col.name+" "+col.typ, conn.Dialect)); err != nil {
				return err
			}
		}
	}
	return tx.Commit()
}

// Only embedded, versioned DDL passes through this conversion, never requests or
// application queries. TEXT timestamps/JSON and integer flags intentionally keep
// the existing Go API/storage representation. PG identities are native sequences.
func schemaSQL(stmt, dialect string) string {
	if dialect != "postgresql" {
		return stmt
	}
	return strings.NewReplacer(
		"INTEGER PRIMARY KEY AUTOINCREMENT", "BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY",
		"DATETIME", "TEXT",
		" REAL", " DOUBLE PRECISION",
	).Replace(stmt)
}

// BootstrapAdmin is opt-in. It never resets an existing account or inserts a
// default password. Run with the migration role before switching to the API role.
func BootstrapAdmin(conn *dbx.DB, password string) error {
	if password == "" {
		return nil
	}
	if len(password) < 12 || len(password) > 72 {
		return fmt.Errorf("ADMIN_INITIAL_PASSWORD must contain 12–72 bytes")
	}
	var count int
	if err := conn.QueryRow(`SELECT COUNT(*) FROM users WHERE username='admin'`).Scan(&count); err != nil {
		return err
	}
	if count > 0 {
		return nil
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), 12)
	if err != nil {
		return err
	}
	_, err = conn.Exec(`INSERT INTO users(username, password_hash, role, must_change_password)
		VALUES ('admin', ?, 'admin', 1) ON CONFLICT(username) DO NOTHING`, string(hash))
	return err
}
