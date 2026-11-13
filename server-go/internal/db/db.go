// Copyright (c) 2026 heathcetide. All rights reserved.

package db

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	_ "github.com/glebarez/go-sqlite"
	"github.com/heathcetide/DietDigiDose/internal/dbx"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"
)

// Open opens the application database.
// driver: sqlite | postgres (also accepts postgresql)
// dsn empty for sqlite defaults to data/dietdigidose.db (legacy server/data still probed).
func Open(driver, dsn string) (*dbx.DB, string, error) {
	normalized := strings.ToLower(strings.TrimSpace(driver))
	if normalized == "" {
		normalized = "sqlite"
	}
	switch normalized {
	case "sqlite":
		path := strings.TrimSpace(dsn)
		if path == "" {
			path = defaultSQLitePath()
		}
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			return nil, "", fmt.Errorf("create sqlite dir: %w", err)
		}
		// modernc driver name is "sqlite"; enable FK like better-sqlite3.
		conn, err := sql.Open("sqlite", path+"?_pragma=foreign_keys(1)&_pragma=busy_timeout(5000)")
		if err != nil {
			return nil, "", err
		}
		conn.SetMaxOpenConns(1)
		conn.SetMaxIdleConns(1)
		conn.SetConnMaxLifetime(0)
		if err := conn.Ping(); err != nil {
			_ = conn.Close()
			return nil, "", fmt.Errorf("ping sqlite %s: %w", path, err)
		}
		return dbx.Wrap(conn, "sqlite"), "sqlite", nil
	case "postgres", "postgresql":
		url := strings.TrimSpace(dsn)
		if url == "" {
			url = strings.TrimSpace(os.Getenv("DATABASE_URL"))
		}
		if url == "" {
			return nil, "", fmt.Errorf("postgres requires database.dsn or DATABASE_URL")
		}
		config, err := pgx.ParseConfig(url)
		if err != nil {
			return nil, "", fmt.Errorf("parse postgres configuration: %w", err)
		}
		// Simple protocol lets PostgreSQL perform assignment casts for the
		// legacy TEXT quantity fields. pgx still safely quotes every argument.
		config.DefaultQueryExecMode = pgx.QueryExecModeSimpleProtocol
		config.RuntimeParams["timezone"] = "UTC"
		conn := stdlib.OpenDB(*config)
		conn.SetMaxOpenConns(25)
		conn.SetMaxIdleConns(10)
		conn.SetConnMaxLifetime(5 * time.Minute)
		if err := conn.Ping(); err != nil {
			_ = conn.Close()
			return nil, "", fmt.Errorf("ping postgres: %w", err)
		}
		return dbx.Wrap(conn, "postgresql"), "postgresql", nil
	default:
		return nil, "", fmt.Errorf("unsupported database driver %q", driver)
	}
}

func defaultSQLitePath() string {
	if v := strings.TrimSpace(os.Getenv("DATABASE_PATH")); v != "" {
		return v
	}
	// Prefer Go-owned data/; keep legacy server/data candidates for one-release migration.
	candidates := []string{
		filepath.Join("data", "dietdigidose.db"),
		filepath.Join("..", "data", "dietdigidose.db"),
		filepath.Join("..", "server", "data", "dietdigidose.db"),
		filepath.Join("server", "data", "dietdigidose.db"),
	}
	for _, c := range candidates {
		if abs, err := filepath.Abs(c); err == nil {
			if _, err := os.Stat(abs); err == nil {
				return abs
			}
		}
	}
	abs, _ := filepath.Abs(candidates[0])
	return abs
}
