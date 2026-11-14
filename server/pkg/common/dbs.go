// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package common

import (
	"bufio"
	"io"
	"log"
	"os"
	"strings"
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common/constants"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// InitDatabase creates a GORM DB connection. If driver or dsn is empty,
// it falls back to environment variables DB_DRIVER / DSN.
func InitDatabase(logWrite io.Writer, driver, dsn string) (*gorm.DB, error) {
	if driver == "" {
		driver = GetEnv(constants.ENV_DB_DRIVER)
	}
	if dsn == "" {
		dsn = GetEnv(constants.ENV_DSN)
	}

	if logWrite == nil {
		logWrite = os.Stdout
	}

	newLogger := logger.New(
		log.New(logWrite, "\r\n", log.LstdFlags),
		logger.Config{
			SlowThreshold:             time.Second,
			LogLevel:                  logger.Warn,
			IgnoreRecordNotFoundError: true,
			Colorful:                  false,
		},
	)

	cfg := &gorm.Config{
		Logger:                                   newLogger,
		SkipDefaultTransaction:                   true,
		DisableForeignKeyConstraintWhenMigrating: true,
	}

	db, err := createDatabaseInstance(cfg, driver, dsn)
	if err != nil {
		return nil, err
	}

	ConfigureConnectionPool(db)

	return db, nil
}

// ConfigureConnectionPool configures the database connection pool.
// Overrides via env (positive ints only):
//
//	DB_MAX_OPEN_CONNS  (default: postgres 40, others 200)
//	DB_MAX_IDLE_CONNS  (default: postgres 20, others 50)
//	DB_CONN_MAX_LIFETIME  (Go duration, default 1h)
//	DB_CONN_MAX_IDLE_TIME (Go duration, default 30m)
func ConfigureConnectionPool(db *gorm.DB) {
	sqlDB, err := db.DB()
	if err != nil {
		log.Printf("Failed to get database instance: %v", err)
		return
	}

	driver := ""
	if db.Dialector != nil {
		driver = strings.ToLower(strings.TrimSpace(db.Dialector.Name()))
	}
	if driver == "" {
		driver = strings.ToLower(strings.TrimSpace(GetEnv(constants.ENV_DB_DRIVER)))
	}
	maxOpen, maxIdle := 200, 50
	if driver == constants.DBDriverPG || driver == "postgresql" {
		maxOpen, maxIdle = 40, 20
	}
	if n, ok := PositiveIntEnv(constants.ENV_DB_MAX_OPEN_CONNS); ok {
		maxOpen = n
	}
	if n, ok := PositiveIntEnv(constants.ENV_DB_MAX_IDLE_CONNS); ok {
		maxIdle = n
	}
	if maxIdle > maxOpen {
		maxIdle = maxOpen
	}

	lifetime := time.Hour
	if d, ok := EnvDuration(constants.ENV_DB_CONN_MAX_LIFETIME); ok && d > 0 {
		lifetime = d
	}
	idleTime := 30 * time.Minute
	if d, ok := EnvDuration(constants.ENV_DB_CONN_MAX_IDLE_TIME); ok && d > 0 {
		idleTime = d
	}

	sqlDB.SetMaxOpenConns(maxOpen)
	sqlDB.SetMaxIdleConns(maxIdle)
	sqlDB.SetConnMaxLifetime(lifetime)
	sqlDB.SetConnMaxIdleTime(idleTime)
	log.Printf("database pool configured driver=%s max_open=%d max_idle=%d lifetime=%s idle_time=%s",
		driver, maxOpen, maxIdle, lifetime, idleTime)
}

// MakeMigrates runs AutoMigrate for each instance.
func MakeMigrates(db *gorm.DB, insts []any) error {
	for _, v := range insts {
		if err := db.AutoMigrate(v); err != nil {
			return err
		}
	}
	return nil
}

// RunInitSQL executes SQL statements from a local .sql file segment by
// segment (split by semicolon). Comment lines starting with -- or # and
// empty lines are skipped. Idempotent scripts should use IF NOT EXISTS
// in SQL for protection.
func RunInitSQL(db *gorm.DB, sqlFilePath string) error {
	f, err := os.Open(sqlFilePath)
	if err != nil {
		return err
	}
	defer f.Close()
	var (
		sb      strings.Builder
		scanner = bufio.NewScanner(f)
	)
	// Relax token limit (long lines)
	buf := make([]byte, 0, 1024*1024)
	scanner.Buffer(buf, 1024*1024)

	for scanner.Scan() {
		line := scanner.Text()
		trim := strings.TrimSpace(line)
		// Ignore comment lines (starting with -- or #) and empty lines
		if trim == "" || strings.HasPrefix(trim, "--") || strings.HasPrefix(trim, "#") {
			continue
		}
		sb.WriteString(line)
		sb.WriteString("\n")
		// Use ; as statement terminator (simple splitting, suitable for most scenarios)
		if strings.HasSuffix(trim, ";") {
			stmt := strings.TrimSpace(sb.String())
			sb.Reset()
			if stmt != "" {
				if err := db.Exec(stmt).Error; err != nil {
					return err
				}
			}
		}
	}
	// Handle remaining content at end of file without semicolon
	rest := strings.TrimSpace(sb.String())
	if rest != "" {
		if err := db.Exec(rest).Error; err != nil {
			return err
		}
	}
	return scanner.Err()
}
