//go:build mysql

// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package common

import (
	"gorm.io/driver/mysql"
	"gorm.io/gorm"
)

func createDatabaseInstance(cfg *gorm.Config, driver, dsn string) (*gorm.DB, error) {
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
}
