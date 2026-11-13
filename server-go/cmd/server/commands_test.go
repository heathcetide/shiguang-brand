package main

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/heathcetide/DietDigiDose/internal/configs"
	appdb "github.com/heathcetide/DietDigiDose/internal/db"
)

func TestExplicitMigrationAndProductionReadOnlyPreparation(t *testing.T) {
	t.Setenv("DATABASE_MIGRATION_URL", "")
	t.Setenv("ADMIN_INITIAL_PASSWORD", "")
	t.Setenv("APP_DATABASE_AUTO_MIGRATE", "0")
	passwordFile := filepath.Join(t.TempDir(), "bootstrap-secret")
	if err := os.WriteFile(passwordFile, []byte("OnlyForThisTest123!\n"), 0600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("ADMIN_INITIAL_PASSWORD_FILE", passwordFile)
	cfg := configs.Default()
	cfg.App.Environment = "prod"
	cfg.Database.DSN = filepath.Join(t.TempDir(), "commands.db")
	db, _, err := appdb.Open("sqlite", cfg.Database.DSN)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err := prepareSchema(db, cfg); err == nil {
		t.Fatal("production startup accepted an unmigrated database")
	}
	if err := runCommand(cfg, true); err != nil {
		t.Fatal(err)
	}
	if err := prepareSchema(db, cfg); err != nil {
		t.Fatal(err)
	}
	var before string
	if err := db.QueryRow(`SELECT password_hash FROM users WHERE username='admin'`).Scan(&before); err != nil {
		t.Fatal(err)
	}
	if err := runCommand(cfg, true); err != nil {
		t.Fatal(err)
	}
	var after string
	if err := db.QueryRow(`SELECT password_hash FROM users WHERE username='admin'`).Scan(&after); err != nil {
		t.Fatal(err)
	}
	if before != after {
		t.Fatal("repeat command overwrote the initial account")
	}
	t.Setenv("WORKER_TASKS", "none")
	if err := runCommand(cfg, false); err == nil {
		t.Fatal("disabled standalone worker reported running")
	}
}
