// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package sqlite provides a [tree.Store] backed by SQLite via GORM.
//
// It is a thin convenience wrapper over [gormstore] that accepts a file
// path (or ":memory:" for an in-process database), constructs the GORM
// connection, and hands it off. For advanced configuration, construct
// the *gorm.DB yourself and pass it to [gormstore.New] directly.
//
// # Quick start
//
//	store, err := sqlite.New("devops.db")
//	tr, _ := tree.New(store)
//
// # In-memory

//
//	store, err := sqlite.New(":memory:")
package sqlite

import (
	"fmt"

	gormstore "github.com/heathcetide/DietDigiDose/pkg/common/tree/gormstore"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// New opens a SQLite database at path and returns a [gormstore.Store].
// Use ":memory:" for a non-persistent in-process database. The schema
// is auto-migrated on first use.
func New(path string) (*gormstore.Store, error) {
	if path == "" {
		return nil, fmt.Errorf("tree/sqlite: path must not be empty")
	}
	db, err := gorm.Open(sqlite.Open(path), &gorm.Config{
		Logger:                                   logger.Default.LogMode(logger.Warn),
		SkipDefaultTransaction:                   true,
		DisableForeignKeyConstraintWhenMigrating: true,
	})
	if err != nil {
		return nil, fmt.Errorf("tree/sqlite: open: %w", err)
	}
	return gormstore.New(db)
}
