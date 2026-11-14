// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package gormstore implements [tree.Store] on top of GORM, supporting
// any SQL dialect that GORM supports (MySQL, PostgreSQL, SQLite, …).
//
// The schema is a single table [tree.Node.TableName] with columns
// mirroring [tree.Node]. A unique index on (level, path, name) enforces
// sibling uniqueness. The materialized-path column is indexed for
// efficient prefix scans.
//
// # Quick start
//
//	import (
//	    "gorm.io/driver/sqlite"
//	    "gorm.io/gorm"
//	    gormstore "github.com/LingByte/ling-base/common/tree/gormstore"
//	    "github.com/heathcetide/DietDigiDose/pkg/common/tree"
//	)
//
//	db, err := gorm.Open(sqlite.Open("file::memory:?cache=shared"), &gorm.Config{})
//	store, err := gormstore.New(db)
//	tr, _ := tree.New(store)
package gormstore

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common/tree"
	"gorm.io/gorm"
)

// Store is a GORM-backed implementation of [tree.Store].
type Store struct {
	db *gorm.DB
}

// ensure Store satisfies tree.Store at compile time.
var _ tree.Store = (*Store)(nil)

// New creates a GORM-backed store. It auto-migrates the schema if the
// table does not yet exist.
func New(db *gorm.DB) (*Store, error) {
	if db == nil {
		return nil, errors.New("gormstore: db must not be nil")
	}
	if err := db.AutoMigrate(&tree.Node{}); err != nil {
		return nil, fmt.Errorf("gormstore: auto-migrate: %w", err)
	}
	// Create indexes (idempotent). GORM auto-migrate creates the PK
	// but not composite unique indexes reliably across dialects, so we
	// add them explicitly.
	if err := db.Exec(
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_tree_level_path_name ` +
			`ON ` + tree.Node{}.TableName() + ` (level, path, name)`,
	).Error; err != nil {
		// Some dialects (older MySQL) don't support IF NOT EXISTS on
		// CREATE INDEX. Fall back to a silent ignore — the unique
		// constraint may already exist.
		_ = err
	}
	if err := db.Exec(
		`CREATE INDEX IF NOT EXISTS idx_tree_path ON ` + tree.Node{}.TableName() + ` (path)`,
	).Error; err != nil {
		_ = err
	}
	return &Store{db: db}, nil
}

// MustNew is like [New] but panics on error.
func MustNew(db *gorm.DB) *Store {
	s, err := New(db)
	if err != nil {
		panic(err)
	}
	return s
}

func (s *Store) withCtx(ctx context.Context) *gorm.DB {
	return s.db.WithContext(ctx)
}

func (s *Store) Insert(ctx context.Context, n *tree.Node) error {
	if n == nil {
		return tree.ErrNodeNotFound
	}
	if n.CreatedAt.IsZero() {
		n.CreatedAt = time.Now()
	}
	n.UpdatedAt = time.Now()
	if err := s.withCtx(ctx).Create(n).Error; err != nil {
		if isDuplicateKey(err) {
			return tree.ErrNodeExists
		}
		return err
	}
	return nil
}

func (s *Store) Get(ctx context.Context, level int, path, name string) (*tree.Node, error) {
	var n tree.Node
	err := s.withCtx(ctx).
		Where("level = ? AND path = ? AND name = ?", level, path, name).
		First(&n).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, tree.ErrNodeNotFound
		}
		return nil, err
	}
	return &n, nil
}

func (s *Store) GetByID(ctx context.Context, id int64) (*tree.Node, error) {
	var n tree.Node
	err := s.withCtx(ctx).First(&n, id).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, tree.ErrNodeNotFound
		}
		return nil, err
	}
	return &n, nil
}

func (s *Store) DeleteByID(ctx context.Context, id int64) error {
	res := s.withCtx(ctx).Delete(&tree.Node{}, id)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return tree.ErrNodeNotFound
	}
	return nil
}

func (s *Store) ListChildren(ctx context.Context, level int, path string) ([]*tree.Node, error) {
	var nodes []*tree.Node
	err := s.withCtx(ctx).
		Where("level = ? AND path = ?", level, path).
		Order("name ASC").
		Find(&nodes).Error
	if err != nil {
		return nil, err
	}
	return nodes, nil
}

func (s *Store) ListByPathPrefix(ctx context.Context, level int, pathPrefix string) ([]*tree.Node, error) {
	// Match both exact path and path with "/" suffix to catch direct
	// children (e.g. prefix "/1" should match both "/1" and "/1/2").
	escaped := strings.NewReplacer("%", "\\%", "_", "\\_").Replace(pathPrefix)
	pattern := escaped + "/%"
	q := s.withCtx(ctx).Where("path = ? OR path LIKE ? ESCAPE '\\'", pathPrefix, pattern)
	if level != 0 {
		q = q.Where("level = ?", level)
	}
	var nodes []*tree.Node
	if err := q.Order("level ASC, name ASC").Find(&nodes).Error; err != nil {
		return nil, err
	}
	return nodes, nil
}

func (s *Store) Tx(ctx context.Context, fn func(ctx context.Context) error) error {
	return s.withCtx(ctx).Transaction(func(tx *gorm.DB) error {
		txCtx := context.WithValue(ctx, txKey{}, tx)
		return fn(txCtx)
	})
}

type txKey struct{}

// Close is a no-op; the caller owns the *gorm.DB and is responsible for
// closing the underlying sql.DB.
func (s *Store) Close() error { return nil }

// isDuplicateKey reports whether err is a unique-constraint violation
// across supported dialects.
func isDuplicateKey(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	// MySQL: "Error 1062: Duplicate entry"
	// PostgreSQL: "duplicate key value violates unique constraint"
	// SQLite: "UNIQUE constraint failed"
	return strings.Contains(msg, "Duplicate entry") ||
		strings.Contains(msg, "duplicate key") ||
		strings.Contains(msg, "UNIQUE constraint")
}
