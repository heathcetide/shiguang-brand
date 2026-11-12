// Copyright (c) 2026 heathcetide. All rights reserved.

package configs

import (
	"os"
	"testing"
	"time"
)

func TestDefault(t *testing.T) {
	cfg := Default()
	if cfg.App.Name != "Shiwei Daily" {
		t.Errorf("expected English server name Shiwei Daily, got %q", cfg.App.Name)
	}
	if cfg.Server.Port != 9090 {
		t.Errorf("expected port 9090, got %d", cfg.Server.Port)
	}
	if cfg.Upstream.Express != "" {
		t.Errorf("expected express upstream disabled by default, got %s", cfg.Upstream.Express)
	}
	if cfg.Scaffold.Enabled {
		t.Error("expected scaffold disabled by default")
	}
	if cfg.App.Environment != "dev" {
		t.Errorf("expected env=dev, got %s", cfg.App.Environment)
	}
	if cfg.Database.Driver != "sqlite" {
		t.Errorf("expected driver=sqlite, got %s", cfg.Database.Driver)
	}
}

func TestLoad_MissingFile(t *testing.T) {
	cfg, err := Load("/nonexistent/path/config.yaml")
	if err != nil {
		t.Fatalf("expected no error for missing file, got %v", err)
	}
	if cfg == nil {
		t.Fatal("expected non-nil config")
	}
	if cfg.Server.Port != 9090 {
		t.Errorf("expected default port, got %d", cfg.Server.Port)
	}
}

func TestLoad_ValidYAML(t *testing.T) {
	tmp := t.TempDir() + "/config.yaml"
	yaml := `
server:
  port: 9999
app:
  environment: prod
database:
  driver: mysql
  dsn: "user:pass@tcp(localhost:3306)/db"
`
	if err := os.WriteFile(tmp, []byte(yaml), 0o644); err != nil {
		t.Fatal(err)
	}

	cfg, err := Load(tmp)
	if err != nil {
		t.Fatalf("Load failed: %v", err)
	}
	if cfg.Server.Port != 9999 {
		t.Errorf("expected port=9999, got %d", cfg.Server.Port)
	}
	if cfg.App.Environment != "prod" {
		t.Errorf("expected env=prod, got %s", cfg.App.Environment)
	}
	if cfg.Database.Driver != "mysql" {
		t.Errorf("expected driver=mysql, got %s", cfg.Database.Driver)
	}
}

func TestEnvOverrides(t *testing.T) {
	t.Setenv("APP_SERVER_PORT", "7777")
	t.Setenv("APP_APP_ENVIRONMENT", "test")
	t.Setenv("APP_DATABASE_DSN", "env-dsn")
	t.Setenv("APP_JWT_ENABLED", "true")
	t.Setenv("APP_DOCS_ENABLED", "false")

	cfg, err := Load("/nonexistent")
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Server.Port != 7777 {
		t.Errorf("expected port=7777 from env, got %d", cfg.Server.Port)
	}
	if cfg.App.Environment != "test" {
		t.Errorf("expected env=test from env, got %s", cfg.App.Environment)
	}
	if cfg.Database.DSN != "env-dsn" {
		t.Errorf("expected dsn=env-dsn from env, got %s", cfg.Database.DSN)
	}
	if !cfg.JWT.Enabled {
		t.Error("expected jwt enabled from env")
	}
	if cfg.Docs.Enabled {
		t.Error("expected docs disabled from env")
	}
}

func TestInitDB_SQLite(t *testing.T) {
	cfg := DatabaseConfig{
		Driver:          "sqlite",
		DSN:             t.TempDir() + "/test.db",
		MaxOpenConns:    1,
		MaxIdleConns:    1,
		ConnMaxLifetime: time.Minute,
	}
	db, err := InitDB(cfg)
	if err != nil {
		t.Fatalf("InitDB failed: %v", err)
	}
	if db == nil {
		t.Fatal("expected non-nil db")
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	_ = sqlDB.Close()
}

func TestInitDB_UnsupportedDriver(t *testing.T) {
	_, err := InitDB(DatabaseConfig{Driver: "oracle"})
	if err == nil {
		t.Fatal("expected error for unsupported driver")
	}
}
