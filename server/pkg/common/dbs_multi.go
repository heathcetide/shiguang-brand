// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package common

import (
	"context"
	"fmt"
	"sync"
	"sync/atomic"
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common/constants"
	"gorm.io/gorm"
)

// ──────────────────────────────────────────────
// Multi-datasource manager with read/write splitting
// ──────────────────────────────────────────────

// DataSourceRole classifies a datasource as read or write.
type DataSourceRole string

const (
	// RoleWrite is the primary/writable datasource.
	RoleWrite DataSourceRole = "write"
	// RoleRead is a read-only replica datasource.
	RoleRead DataSourceRole = "read"
)

// DataSourceConfig describes a single named datasource.
type DataSourceConfig struct {
	// Name is a unique identifier for this datasource (e.g. "master",
	// "replica-1"). Must be non-empty.
	Name string
	// Role is either RoleWrite or RoleRead. Defaults to RoleWrite.
	Role DataSourceRole
	// Driver is the database driver: mysql, postgres, sqlite.
	Driver string
	// DSN is the data-source-name for the driver.
	DSN string
}

// DataSourceManager holds multiple named GORM connections and supports
// runtime selection of read vs write instances.
//
// It is safe for concurrent use. The zero value is NOT ready to use —
// always construct via [NewDataSourceManager].
//
// # Read/write splitting
//
// When a request is dispatched via [DataSourceManager.Use], the manager
// picks a write instance for [RoleWrite] and a read instance for
// [RoleRead]. If no read instance is configured, the write instance is
// used as a fallback. Multiple read instances are load-balanced via
// round-robin.
//
// # Quick start
//
//	mgr, err := NewDataSourceManager(
//	    DataSourceConfig{Name: "master", Role: RoleWrite, Driver: "mysql", DSN: masterDSN},
//	    DataSourceConfig{Name: "replica-1", Role: RoleRead, Driver: "mysql", DSN: replicaDSN},
//	)
//	if err != nil { panic(err) }
//	defer mgr.Close()
//
//	// Pick a write connection for mutations.
//	writeDB := mgr.Write()
//	writeDB.Create(&user)
//
//	// Pick a read connection for queries (round-robins across replicas).
//	readDB := mgr.Read()
//	readDB.First(&user, 1)
//
//	// Or use context-driven selection (see Use / FromContext).
//	ctx := mgr.Use(context.Background(), RoleRead)
//	db := FromContext(ctx, mgr)
//	db.Find(&users)
type DataSourceManager struct {
	mu       sync.RWMutex
	writes   []*gorm.DB
	reads    []*gorm.DB
	byName   map[string]*gorm.DB
	readIdx  atomic.Uint64
	writeIdx atomic.Uint64
	closed   atomic.Bool
}

// NewDataSourceManager opens all configured datasources and returns a
// ready-to-use manager. Each connection pool is configured via
// [ConfigureConnectionPool]. At least one write datasource is required.
func NewDataSourceManager(configs ...DataSourceConfig) (*DataSourceManager, error) {
	if len(configs) == 0 {
		return nil, fmt.Errorf("dbs: at least one datasource config required")
	}
	m := &DataSourceManager{
		byName: make(map[string]*gorm.DB),
	}
	for _, cfg := range configs {
		if cfg.Name == "" {
			return nil, fmt.Errorf("dbs: datasource name must not be empty")
		}
		if cfg.Driver == "" {
			cfg.Driver = GetEnv(constants.ENV_DB_DRIVER)
		}
		if cfg.DSN == "" {
			return nil, fmt.Errorf("dbs: datasource %q dsn must not be empty", cfg.Name)
		}
		if cfg.Role == "" {
			cfg.Role = RoleWrite
		}
		if _, exists := m.byName[cfg.Name]; exists {
			return nil, fmt.Errorf("dbs: duplicate datasource name %q", cfg.Name)
		}
		db, err := InitDatabase(nil, cfg.Driver, cfg.DSN)
		if err != nil {
			m.Close()
			return nil, fmt.Errorf("dbs: open %q: %w", cfg.Name, err)
		}
		m.byName[cfg.Name] = db
		switch cfg.Role {
		case RoleRead:
			m.reads = append(m.reads, db)
		default:
			m.writes = append(m.writes, db)
		}
	}
	if len(m.writes) == 0 {
		m.Close()
		return nil, fmt.Errorf("dbs: at least one write datasource required")
	}
	return m, nil
}

// Write returns a write datasource connection, round-robining if there
// are multiple write instances.
func (m *DataSourceManager) Write() *gorm.DB {
	if len(m.writes) == 1 {
		return m.writes[0]
	}
	idx := m.writeIdx.Add(1) - 1
	return m.writes[idx%uint64(len(m.writes))]
}

// Read returns a read datasource connection, round-robining if there
// are multiple read instances. If no read instances are configured,
// falls back to a write connection.
func (m *DataSourceManager) Read() *gorm.DB {
	if len(m.reads) == 0 {
		return m.Write()
	}
	if len(m.reads) == 1 {
		return m.reads[0]
	}
	idx := m.readIdx.Add(1) - 1
	return m.reads[idx%uint64(len(m.reads))]
}

// Get returns the datasource with the given name, or nil if not found.
func (m *DataSourceManager) Get(name string) *gorm.DB {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.byName[name]
}

// Writes returns all write connections.
func (m *DataSourceManager) Writes() []*gorm.DB {
	return m.writes
}

// Reads returns all read connections.
func (m *DataSourceManager) Reads() []*gorm.DB {
	return m.reads
}

// Close closes all underlying connections.
func (m *DataSourceManager) Close() error {
	if !m.closed.CompareAndSwap(false, true) {
		return nil
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	var firstErr error
	for _, db := range m.byName {
		if sqlDB, err := db.DB(); err == nil {
			if err := sqlDB.Close(); err != nil && firstErr == nil {
				firstErr = err
			}
		}
	}
	return firstErr
}

// ──────────────────────────────────────────────
// Context-driven selection
// ──────────────────────────────────────────────

type dsCtxKey struct{}

// Use returns a context tagged with the requested role, so downstream
// code can retrieve the appropriate *gorm.DB via [FromContext].
func (m *DataSourceManager) Use(ctx context.Context, role DataSourceRole) context.Context {
	return context.WithValue(ctx, dsCtxKey{}, dsChoice{mgr: m, role: role})
}

// UseName returns a context tagged with a specific datasource name,
// overriding role-based selection. Useful for pinning a query to a
// particular instance.
func (m *DataSourceManager) UseName(ctx context.Context, name string) context.Context {
	return context.WithValue(ctx, dsCtxKey{}, dsChoice{mgr: m, name: name})
}

type dsChoice struct {
	mgr  *DataSourceManager
	role DataSourceRole
	name string
}

// FromContext retrieves the *gorm.DB selected in ctx via
// [DataSourceManager.Use] or [DataSourceManager.UseName]. If ctx has no
// selection, fallback is returned (or the manager's default write
// connection if fallback is nil).
func FromContext(ctx context.Context, fallback *gorm.DB) *gorm.DB {
	if v, ok := ctx.Value(dsCtxKey{}).(dsChoice); ok && v.mgr != nil {
		if v.name != "" {
			if db := v.mgr.Get(v.name); db != nil {
				return db
			}
		}
		if v.role == RoleRead {
			return v.mgr.Read()
		}
		return v.mgr.Write()
	}
	if fallback != nil {
		return fallback
	}
	return nil
}

// ──────────────────────────────────────────────
// Health check
// ──────────────────────────────────────────────

// PingAll pings every datasource and returns the first error encountered.
// Useful for readiness probes.
func (m *DataSourceManager) PingAll(ctx context.Context) error {
	m.mu.RLock()
	defer m.mu.RUnlock()
	for name, db := range m.byName {
		sqlDB, err := db.DB()
		if err != nil {
			return fmt.Errorf("dbs: ping %q: %w", name, err)
		}
		pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
		defer cancel()
		if err := sqlDB.PingContext(pingCtx); err != nil {
			return fmt.Errorf("dbs: ping %q: %w", name, err)
		}
	}
	return nil
}
