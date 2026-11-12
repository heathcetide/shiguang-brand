package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"strings"
	"syscall"

	"github.com/heathcetide/DietDigiDose/internal/configs"
	appdb "github.com/heathcetide/DietDigiDose/internal/db"
	"github.com/heathcetide/DietDigiDose/internal/dbx"
	"github.com/heathcetide/DietDigiDose/internal/domains/social"
	"github.com/heathcetide/DietDigiDose/internal/worker"
)

func envEnabled(key string, fallback bool) bool {
	if v, ok := os.LookupEnv(key); ok {
		return v == "1" || strings.EqualFold(v, "true")
	}
	return fallback
}

func prepareSchema(db *dbx.DB, cfg *configs.Config) error {
	if envEnabled("APP_DATABASE_AUTO_MIGRATE", cfg.App.Environment != "prod") {
		return appdb.Migrate(db)
	}
	return appdb.CheckSchema(db)
}

func runCommand(cfg *configs.Config, migrate bool) error {
	if migrate {
		if url := os.Getenv("DATABASE_MIGRATION_URL"); url != "" {
			cfg.Database.Driver = "postgresql"
			cfg.Database.DSN = url
		}
	}
	db, _, err := appdb.Open(cfg.Database.Driver, cfg.Database.DSN)
	if err != nil {
		return err
	}
	defer db.Close()
	if migrate {
		if err := appdb.Migrate(db); err != nil {
			return err
		}
		password := os.Getenv("ADMIN_INITIAL_PASSWORD")
		if file := os.Getenv("ADMIN_INITIAL_PASSWORD_FILE"); file != "" {
			raw, err := os.ReadFile(file)
			if err != nil {
				return fmt.Errorf("read administrator password file: %w", err)
			}
			password = strings.TrimRight(string(raw), "\r\n")
		}
		if err := appdb.BootstrapAdmin(db, password); err != nil {
			return err
		}
		fmt.Println("Go schema migrations verified/applied; existing accounts preserved")
		return nil
	}
	if err := appdb.CheckSchema(db); err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	socialHandlers := &social.Handlers{DB: db}
	worker.New(db, socialHandlers).Run(ctx)
	return nil
}
