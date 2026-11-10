// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package gormmigrator implements the migration.Migrator interface using
// GORM as the database driver. It maintains a `schema_migrations` table
// to track which migration versions have been applied.
//
// Each migration is executed within a transaction. If the migration SQL
// fails, the transaction is rolled back and the version is not recorded.
//
// # Quick start
//
//	import (
//	    "embed"
//	    "context"
//	    gormmigrator "github.com/LingByte/ling-base/common/migration/gormmigrator"
//	    "github.com/heathcetide/DietDigiDose/pkg/common/migration"
//	    "gorm.io/gorm"
//	)
//
//	//go:embed migrations/*.sql
//	var migrationFS embed.FS
//
//	func runMigrations(db *gorm.DB) error {
//	    src := migration.NewEmbedSource(migrationFS, "migrations")
//	    m := gormmigrator.New(db, src)
//	    return m.Up(context.Background())
//	}
//
// # Schema migrations table
//
// The migrator creates a `schema_migrations` table:
//
//	CREATE TABLE schema_migrations (
//	    version BIGINT PRIMARY KEY,
//	    description VARCHAR(255),
//	    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
//	);
//
// # Transaction safety
//
// Each migration runs inside a database transaction. If the SQL fails,
// the transaction is rolled back. Note that some SQL statements (like
// DDL on MySQL) may implicitly commit and cannot be rolled back — this
// is a database limitation, not a migrator limitation.
package gormmigrator

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common/migration"
	"gorm.io/gorm"
)

// ──────────────────────────────────────────────
// Schema
// ──────────────────────────────────────────────

// schemaMigration is the GORM model for the schema_migrations table.
type schemaMigration struct {
	Version     uint64    `gorm:"primaryKey"`
	Description string    `gorm:"type:varchar(255)"`
	AppliedAt   time.Time `gorm:"autoCreateTime"`
}

func (schemaMigration) TableName() string { return "schema_migrations" }

// ──────────────────────────────────────────────
// Migrator
// ──────────────────────────────────────────────

// Migrator implements migration.Migrator using GORM.
type Migrator struct {
	db    *gorm.DB
	src   migration.Source
	table string
}

// New creates a new GORM-based migrator.
// The schema_migrations table is created automatically if it doesn't exist.
func New(db *gorm.DB, src migration.Source) (*Migrator, error) {
	if db == nil {
		return nil, errors.New("gormmigrator: db must not be nil")
	}
	if src == nil {
		return nil, errors.New("gormmigrator: source must not be nil")
	}

	m := &Migrator{db: db, src: src, table: "schema_migrations"}

	// Ensure the schema_migrations table exists.
	if err := db.AutoMigrate(&schemaMigration{}); err != nil {
		return nil, fmt.Errorf("gormmigrator: create schema_migrations table: %w", err)
	}

	return m, nil
}

// MustNew is like New but panics on error.
func MustNew(db *gorm.DB, src migration.Source) *Migrator {
	m, err := New(db, src)
	if err != nil {
		panic(err)
	}
	return m
}

// ──────────────────────────────────────────────
// Up
// ──────────────────────────────────────────────

// Up applies all pending migrations in order.
func (m *Migrator) Up(ctx context.Context) error {
	return m.UpTo(ctx, 0) // 0 means apply all
}

// UpTo applies migrations up to and including the given version.
// If version is 0, all pending migrations are applied.
func (m *Migrator) UpTo(ctx context.Context, targetVersion uint64) error {
	migrations, err := m.src.Migrations()
	if err != nil {
		return fmt.Errorf("gormmigrator: load migrations: %w", err)
	}

	applied, err := m.appliedVersions()
	if err != nil {
		return fmt.Errorf("gormmigrator: get applied versions: %w", err)
	}

	for _, mig := range migrations {
		if targetVersion > 0 && mig.Version > targetVersion {
			break
		}
		if applied[mig.Version] {
			continue
		}
		if err := m.applyUp(ctx, &mig); err != nil {
			return fmt.Errorf("gormmigrator: apply %s: %w", mig.String(), err)
		}
	}

	return nil
}

// ──────────────────────────────────────────────
// Down
// ──────────────────────────────────────────────

// Down rolls back all applied migrations in reverse order.
func (m *Migrator) Down(ctx context.Context) error {
	return m.DownTo(ctx, 0) // 0 means rollback all
}

// DownTo rolls back migrations down to (but not including) the given version.
// If version is 0, all migrations are rolled back.
func (m *Migrator) DownTo(ctx context.Context, targetVersion uint64) error {
	migrations, err := m.src.Migrations()
	if err != nil {
		return fmt.Errorf("gormmigrator: load migrations: %w", err)
	}

	applied, err := m.appliedVersions()
	if err != nil {
		return fmt.Errorf("gormmigrator: get applied versions: %w", err)
	}

	// Iterate in reverse order.
	for i := len(migrations) - 1; i >= 0; i-- {
		mig := migrations[i]
		if mig.Version <= targetVersion {
			break
		}
		if !applied[mig.Version] {
			continue
		}
		if err := m.applyDown(ctx, &mig); err != nil {
			return fmt.Errorf("gormmigrator: rollback %s: %w", mig.String(), err)
		}
	}

	return nil
}

// ──────────────────────────────────────────────
// Steps
// ──────────────────────────────────────────────

// Steps applies n migrations forward (positive n) or backward (negative n).
func (m *Migrator) Steps(ctx context.Context, n int) error {
	if n == 0 {
		return nil
	}

	migrations, err := m.src.Migrations()
	if err != nil {
		return fmt.Errorf("gormmigrator: load migrations: %w", err)
	}

	applied, err := m.appliedVersions()
	if err != nil {
		return fmt.Errorf("gormmigrator: get applied versions: %w", err)
	}

	if n > 0 {
		// Forward n steps.
		count := 0
		for _, mig := range migrations {
			if count >= n {
				break
			}
			if applied[mig.Version] {
				continue
			}
			if err := m.applyUp(ctx, &mig); err != nil {
				return fmt.Errorf("gormmigrator: apply %s: %w", mig.String(), err)
			}
			count++
		}
	} else {
		// Backward |n| steps.
		count := 0
		target := -n
		for i := len(migrations) - 1; i >= 0; i-- {
			if count >= target {
				break
			}
			mig := migrations[i]
			if !applied[mig.Version] {
				continue
			}
			if err := m.applyDown(ctx, &mig); err != nil {
				return fmt.Errorf("gormmigrator: rollback %s: %w", mig.String(), err)
			}
			count++
		}
	}

	return nil
}

// ──────────────────────────────────────────────
// Version
// ──────────────────────────────────────────────

// Version returns the current applied version and whether any migration
// has been applied.
func (m *Migrator) Version(ctx context.Context) (uint64, bool, error) {
	var record schemaMigration
	result := m.db.WithContext(ctx).Order("version DESC").First(&record)
	if result.Error != nil {
		if errors.Is(result.Error, gorm.ErrRecordNotFound) {
			return 0, false, nil
		}
		return 0, false, fmt.Errorf("gormmigrator: get version: %w", result.Error)
	}
	return record.Version, true, nil
}

// ──────────────────────────────────────────────
// Status
// ──────────────────────────────────────────────

// Status returns the status of all migrations (applied and pending).
func (m *Migrator) Status(ctx context.Context) ([]migration.MigrationStatus, error) {
	migrations, err := m.src.Migrations()
	if err != nil {
		return nil, fmt.Errorf("gormmigrator: load migrations: %w", err)
	}

	applied, err := m.appliedVersions()
	if err != nil {
		return nil, fmt.Errorf("gormmigrator: get applied versions: %w", err)
	}

	// Fetch applied timestamps.
	var records []schemaMigration
	m.db.WithContext(ctx).Find(&records)
	appliedAtMap := make(map[uint64]string)
	for _, r := range records {
		appliedAtMap[r.Version] = r.AppliedAt.Format(time.RFC3339)
	}

	statuses := make([]migration.MigrationStatus, len(migrations))
	for i, mig := range migrations {
		statuses[i] = migration.MigrationStatus{
			Migration: mig,
			Applied:   applied[mig.Version],
			AppliedAt: appliedAtMap[mig.Version],
		}
	}

	return statuses, nil
}

// ──────────────────────────────────────────────
// Close
// ──────────────────────────────────────────────

// Close is a no-op (GORM manages the connection).
func (m *Migrator) Close() error { return nil }

// RunMigrations applies all pending migrations. This implements the
// bootstrap.MigrationRunner interface, allowing the migrator to be
// used with bootstrap.WithMigration().
func (m *Migrator) RunMigrations(ctx context.Context) error {
	return m.Up(ctx)
}

// ──────────────────────────────────────────────
// Internal
// ──────────────────────────────────────────────

// applyUp executes a single forward migration within a transaction.
func (m *Migrator) applyUp(ctx context.Context, mig *migration.Migration) error {
	return m.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if mig.HasUp() {
			if err := tx.Exec(mig.UpSQL).Error; err != nil {
				return fmt.Errorf("execute up sql: %w", err)
			}
		}
		// Record the migration.
		return tx.Create(&schemaMigration{
			Version:     mig.Version,
			Description: mig.Description,
		}).Error
	})
}

// applyDown executes a single rollback migration within a transaction.
func (m *Migrator) applyDown(ctx context.Context, mig *migration.Migration) error {
	return m.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if mig.HasDown() {
			if err := tx.Exec(mig.DownSQL).Error; err != nil {
				return fmt.Errorf("execute down sql: %w", err)
			}
		}
		// Remove the migration record.
		return tx.Where("version = ?", mig.Version).Delete(&schemaMigration{}).Error
	})
}

// appliedVersions returns a set of applied migration versions.
func (m *Migrator) appliedVersions() (map[uint64]bool, error) {
	var records []schemaMigration
	if err := m.db.Find(&records).Error; err != nil {
		return nil, err
	}
	result := make(map[uint64]bool, len(records))
	for _, r := range records {
		result[r.Version] = true
	}
	return result, nil
}

// Compile-time interface check.
var _ migration.Migrator = (*Migrator)(nil)
