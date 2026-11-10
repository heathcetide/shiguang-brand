//go:build !mysql && !pg

// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package common

import (
	"github.com/heathcetide/DietDigiDose/pkg/common/constants"
	"github.com/glebarez/sqlite"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func createDatabaseInstance(cfg *gorm.Config, driver, dsn string) (*gorm.DB, error) {
	switch driver {
	case constants.DBDriverMySQL:
		db, err := gorm.Open(mysql.Open(dsn), cfg)
		if err != nil {
			return nil, err
		}
		sqlDB, err := db.DB()
		if err != nil {
			return nil, err
		}
		_, err = sqlDB.Exec("SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci")
		if err != nil {
			_, _ = sqlDB.Exec("SET NAMES utf8mb4")
		}
		return db, nil
	case constants.DBDriverPG:
		return gorm.Open(postgres.Open(dsn), cfg)
	case constants.DBDriverSQLite:
		return gorm.Open(sqlite.Open(dsn), cfg)
	default:
		if dsn == "" {
			dsn = "file::memory:"
		}
		return gorm.Open(sqlite.Open(dsn), cfg)
	}
}
