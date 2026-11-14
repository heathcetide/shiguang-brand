// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package bootstrap

import (
	"context"
	"fmt"

	"github.com/heathcetide/DietDigiDose/pkg/common/logger"
)

// MigrationRunner is the interface that bootstrap uses to run database
// migrations during the init phase. This decouples bootstrap from any
// specific migration library (gormmigrator, goose, golang-migrate, etc.).
//
// The runner is executed as an init hook when WithMigration is configured.
// In dev/test profiles, you may prefer WithAutoMigrate for rapid iteration.
// In production, use WithMigration with versioned SQL migrations.
//
// Example using common/migration/gormmigrator:
//
//	migrator, _ := gormmigrator.New(db, src)
//	app := bootstrap.New("myapp",
//	    bootstrap.WithProfile(bootstrap.ProfileProd),
//	    bootstrap.WithMigration(migrator),
//	)
type MigrationRunner interface {
	// RunMigrations executes pending database migrations.
	// Implementations should apply all pending migrations or return an error.
	RunMigrations(ctx context.Context) error
}

// AutoMigrator is the interface for GORM-style auto-migration (schema
// sync from struct definitions). This is convenient for dev/test but
// should NOT be used in production — use versioned SQL migrations instead.
type AutoMigrator interface {
	// AutoMigrate creates/updates database tables to match the given
	// model structs.
	AutoMigrate(dst ...any) error
}

// WithMigration configures the application to run database migrations
// during the init phase (before lifecycle components start).
//
// The runner is executed as the first init hook. If migration fails,
// the application startup is aborted.
//
// Use this for production environments with versioned SQL migrations.
// For dev/test, consider WithAutoMigrate instead.
func WithMigration(runner MigrationRunner) Option {
	return func(a *Application) {
		a.migrationRunner = runner
	}
}

// WithAutoMigrate configures the application to run GORM AutoMigrate
// during the init phase. This is convenient for dev/test environments
// where you want the schema to auto-sync from struct definitions.
//
// WARNING: Do NOT use in production. AutoMigrate does not support
// down migrations, column removals, or schema rollbacks. Use
// WithMigration with versioned SQL files for production.
//
//	app := bootstrap.New("myapp",
//	    bootstrap.WithProfile(bootstrap.ProfileDev),
//	    bootstrap.WithAutoMigrate(db, &User{}, &Order{}),
//	)
func WithAutoMigrate(db AutoMigrator, models ...any) Option {
	return func(a *Application) {
		a.autoMigrator = db
		a.autoMigrateModels = models
	}
}

// runMigrations executes the configured migration strategy during init.
// This is called before any init hooks and before lifecycle components start.
func (a *Application) runMigrations(ctx context.Context) error {
	if a.migrationRunner != nil {
		logger.Infof("[app] running database migrations...")
		if err := a.migrationRunner.RunMigrations(ctx); err != nil {
			return fmt.Errorf("database migration failed: %w", err)
		}
		logger.Infof("[app] database migrations completed")
	}

	if a.autoMigrator != nil && len(a.autoMigrateModels) > 0 {
		logger.Infof("[app] running auto-migrate for %d models...", len(a.autoMigrateModels))
		if err := a.autoMigrator.AutoMigrate(a.autoMigrateModels...); err != nil {
			return fmt.Errorf("auto-migrate failed: %w", err)
		}
		logger.Infof("[app] auto-migrate completed")
	}

	return nil
}
