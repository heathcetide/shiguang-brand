// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package postgres provides a [tree.Store] backed by PostgreSQL via GORM.
//
// It is a thin convenience wrapper over [gormstore] that accepts a raw
// DSN, constructs the GORM connection, and hands it off. For advanced
// connection-pool tuning, construct the *gorm.DB yourself and pass it
// to [gormstore.New] directly.
//
// # Quick start
//
//	store, err := postgres.New("host=127.0.0.1 user=devops password=pass dbname=devops sslmode=disable")
//	tr, _ := tree.New(store)
package postgres

import (
	"fmt"

	gormstore "github.com/heathcetide/DietDigiDose/pkg/common/tree/gormstore"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// New opens a PostgreSQL connection and returns a [gormstore.Store].
// The schema is auto-migrated on first use.
func New(dsn string) (*gormstore.Store, error) {
	if dsn == "" {
		return nil, fmt.Errorf("tree/postgres: dsn must not be empty")
	}
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{
		Logger:                                   logger.Default.LogMode(logger.Warn),
		SkipDefaultTransaction:                   true,
		DisableForeignKeyConstraintWhenMigrating: true,
	})
	if err != nil {
		return nil, fmt.Errorf("tree/postgres: open: %w", err)
	}
	return gormstore.New(db)
}
