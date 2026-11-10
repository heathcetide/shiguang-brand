// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package migration provides a database schema migration framework inspired
// by golang-migrate and goose.
//
// It supports versioned SQL migrations with up/down directions, embedded SQL
// files, and filesystem-based SQL files. The actual migration execution is
// delegated to a Migrator implementation (e.g. gormmigrator), keeping this
// core package free of database dependencies.
//
// # Migration file naming
//
// Migrations are identified by a numeric version and a description:
//
//	0001_create_users.up.sql
//	0001_create_users.down.sql
//	0002_add_email_index.up.sql
//	0002_add_email_index.down.sql
//
// The version is a zero-padded integer. The ".up.sql" and ".down.sql"
// suffixes distinguish forward and rollback scripts.
//
// # Quick start
//
//	//go:embed migrations/*.sql
//	var migrationFS embed.FS
//
//	src := migration.NewEmbedSource(migrationFS, "migrations")
//	migrator := gormmigrator.New(db, src)
//
//	if err := migrator.Up(context.Background()); err != nil {
//	    log.Fatal(err)
//	}
//
// # Integration with bootstrap
//
//	app := bootstrap.New("myapp",
//	    bootstrap.WithProfile(bootstrap.ProfileDev),
//	    bootstrap.WithMigration(migrator),       // versioned SQL migrations
//	    // or for dev/test:
//	    // bootstrap.WithAutoMigrate(db, &User{}, &Order{}),
//	)
//
// In dev/test profiles, you might prefer WithAutoMigrate (GORM AutoMigrate)
// for rapid iteration. In production, use WithMigration with versioned SQL
// files for controlled, reviewable schema changes.
package migration

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"sort"
	"strconv"
	"strings"
)

// ──────────────────────────────────────────────
// Errors
// ──────────────────────────────────────────────

var (
	// ErrNoMigrations is returned when the source contains no migrations.
	ErrNoMigrations = errors.New("migration: no migrations found")
	// ErrMigrationNotFound is returned when a specific version is not found.
	ErrMigrationNotFound = errors.New("migration: version not found")
	// ErrAlreadyApplied is returned when trying to apply an already-applied migration.
	ErrAlreadyApplied = errors.New("migration: already applied")
	// ErrNotApplied is returned when trying to roll back a migration that wasn't applied.
	ErrNotApplied = errors.New("migration: not applied")
	// ErrInvalidVersion is returned when a migration version is invalid.
	ErrInvalidVersion = errors.New("migration: invalid version")
)

// ──────────────────────────────────────────────
// Migration
// ──────────────────────────────────────────────

// Migration represents a single versioned database migration.
type Migration struct {
	// Version is the numeric version identifier (e.g. 1, 2, 3).
	Version uint64

	// Description is a human-readable name (e.g. "create_users").
	Description string

	// UpSQL is the forward migration SQL. Empty means no-op.
	UpSQL string

	// DownSQL is the rollback migration SQL. Empty means no rollback possible.
	DownSQL string
}

// HasUp returns true if this migration has a forward SQL script.
func (m *Migration) HasUp() bool { return strings.TrimSpace(m.UpSQL) != "" }

// HasDown returns true if this migration has a rollback SQL script.
func (m *Migration) HasDown() bool { return strings.TrimSpace(m.DownSQL) != "" }

// String returns a human-readable representation.
func (m *Migration) String() string {
	return fmt.Sprintf("%d_%s", m.Version, m.Description)
}

// ──────────────────────────────────────────────
// MigrationStatus
// ──────────────────────────────────────────────

// MigrationStatus represents the status of a single migration.
type MigrationStatus struct {
	Migration
	Applied bool
	// AppliedAt is the timestamp when the migration was applied (if applied).
	AppliedAt string
}

// ──────────────────────────────────────────────
// Source
// ──────────────────────────────────────────────

// Source provides migration files. Implementations include EmbedSource
// (for go:embed) and FileSource (for filesystem directories).
type Source interface {
	// Migrations returns all migrations sorted by version ascending.
	Migrations() ([]Migration, error)
}

// ──────────────────────────────────────────────
// EmbedSource
// ──────────────────────────────────────────────

// EmbedSource reads migrations from an embedded filesystem (go:embed).
//
// Usage:
//
//	//go:embed migrations/*.sql
//	var migrationFS embed.FS
//	src := migration.NewEmbedSource(migrationFS, "migrations")
type EmbedSource struct {
	fsys fs.FS
	root string
}

// NewEmbedSource creates a Source from an embedded filesystem.
// The root is the directory within the FS containing the .sql files.
func NewEmbedSource(fsys fs.FS, root string) *EmbedSource {
	// If root is empty, use the FS root.
	if root == "" {
		root = "."
	}
	return &EmbedSource{fsys: fsys, root: root}
}

// Migrations implements Source.
func (s *EmbedSource) Migrations() ([]Migration, error) {
	return parseMigrationsFromFS(s.fsys, s.root)
}

// ──────────────────────────────────────────────
// FileSource
// ──────────────────────────────────────────────

// FileSource reads migrations from a filesystem directory.
//
// Usage:
//
//	src := migration.NewFileSource("./db/migrations")
type FileSource struct {
	dir string
}

// NewFileSource creates a Source from a filesystem directory.
func NewFileSource(dir string) *FileSource {
	return &FileSource{dir: dir}
}

// Migrations implements Source.
func (s *FileSource) Migrations() ([]Migration, error) {
	return parseMigrationsFromFS(newFileFS(s.dir), ".")
}

// ──────────────────────────────────────────────
// StaticSource
// ──────────────────────────────────────────────

// StaticSource is a Source backed by a fixed list of migrations.
// Useful for testing or when migrations are defined programmatically.
type StaticSource struct {
	migrations []Migration
}

// NewStaticSource creates a Source from a list of migrations.
func NewStaticSource(migrations ...Migration) *StaticSource {
	migs := make([]Migration, len(migrations))
	copy(migs, migrations)
	sort.Slice(migs, func(i, j int) bool { return migs[i].Version < migs[j].Version })
	return &StaticSource{migrations: migs}
}

// Migrations implements Source.
func (s *StaticSource) Migrations() ([]Migration, error) {
	result := make([]Migration, len(s.migrations))
	copy(result, s.migrations)
	return result, nil
}

// ──────────────────────────────────────────────
// Migrator interface
// ──────────────────────────────────────────────

// Migrator executes database migrations. Implementations are responsible
// for tracking applied versions in a schema_migrations table.
type Migrator interface {
	// Up applies all pending migrations. Returns ErrNoMigrations if there
	// are no migrations to apply.
	Up(ctx context.Context) error

	// UpTo applies migrations up to and including the given version.
	UpTo(ctx context.Context, version uint64) error

	// Down rolls back all applied migrations (in reverse order).
	Down(ctx context.Context) error

	// DownTo rolls back migrations down to (but not including) the given
	// version. Version 0 means rollback all.
	DownTo(ctx context.Context, version uint64) error

	// Steps applies n migrations forward (positive n) or backward (negative n).
	Steps(ctx context.Context, n int) error

	// Version returns the current applied version (0 if none).
	Version(ctx context.Context) (uint64, bool, error)

	// Status returns the status of all migrations.
	Status(ctx context.Context) ([]MigrationStatus, error)

	// Close releases any resources held by the migrator.
	Close() error
}

// ──────────────────────────────────────────────
// Parsing helpers
// ──────────────────────────────────────────────

// parseMigrationsFromFS reads .sql files from a filesystem and parses them
// into Migration objects.
func parseMigrationsFromFS(fsys fs.FS, root string) ([]Migration, error) {
	entries, err := fs.ReadDir(fsys, root)
	if err != nil {
		return nil, fmt.Errorf("migration: read dir %q: %w", root, err)
	}

	// Map: version → partial migration (up/down may come from separate files).
	type partial struct {
		description string
		upSQL       string
		downSQL     string
	}
	partials := make(map[uint64]*partial)

	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		name := entry.Name()
		if !strings.HasSuffix(name, ".sql") {
			continue
		}

		version, desc, direction, ok := parseMigrationFilename(name)
		if !ok {
			continue
		}

		p, exists := partials[version]
		if !exists {
			p = &partial{}
			partials[version] = p
		}

		content, err := fs.ReadFile(fsys, joinPath(root, name))
		if err != nil {
			return nil, fmt.Errorf("migration: read %q: %w", name, err)
		}

		p.description = desc
		switch direction {
		case "up":
			p.upSQL = string(content)
		case "down":
			p.downSQL = string(content)
		}
	}

	if len(partials) == 0 {
		return nil, ErrNoMigrations
	}

	// Build sorted list of migrations.
	versions := make([]uint64, 0, len(partials))
	for v := range partials {
		versions = append(versions, v)
	}
	sort.Slice(versions, func(i, j int) bool { return versions[i] < versions[j] })

	migrations := make([]Migration, 0, len(versions))
	for _, v := range versions {
		p := partials[v]
		migrations = append(migrations, Migration{
			Version:     v,
			Description: p.description,
			UpSQL:       p.upSQL,
			DownSQL:     p.downSQL,
		})
	}

	return migrations, nil
}

// parseMigrationFilename parses a migration filename like
// "0001_create_users.up.sql" and returns (version, description, direction, ok).
func parseMigrationFilename(name string) (version uint64, description, direction string, ok bool) {
	// Strip .sql suffix.
	if !strings.HasSuffix(name, ".sql") {
		return 0, "", "", false
	}
	name = strings.TrimSuffix(name, ".sql")

	// Check for .up or .down suffix.
	if strings.HasSuffix(name, ".up") {
		direction = "up"
		name = strings.TrimSuffix(name, ".up")
	} else if strings.HasSuffix(name, ".down") {
		direction = "down"
		name = strings.TrimSuffix(name, ".down")
	} else {
		return 0, "", "", false
	}

	// Split version_description.
	parts := strings.SplitN(name, "_", 2)
	if len(parts) < 2 {
		return 0, "", "", false
	}

	v, err := strconv.ParseUint(parts[0], 10, 64)
	if err != nil {
		return 0, "", "", false
	}

	return v, parts[1], direction, true
}

// joinPath joins root and name, handling the "." root case.
func joinPath(root, name string) string {
	if root == "." || root == "" {
		return name
	}
	return root + "/" + name
}
