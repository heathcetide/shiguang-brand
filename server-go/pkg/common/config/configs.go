// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package config

import (
	"context"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common/cache"
	lrucache "github.com/heathcetide/DietDigiDose/pkg/common/cache/lru"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// ============================================================
// ConfigItem — GORM model for the configs table
// ============================================================

// ConfigItem represents a row in the configs table. It is used by Store to
// persist key/value configuration entries in a database. When no DB is
// configured, Store falls back to environment variables.
type ConfigItem struct {
	ID        uint      `json:"id" gorm:"primaryKey"`
	Key       string    `json:"key" gorm:"size:128;uniqueIndex"`
	Desc      string    `json:"desc" gorm:"size:200"`
	Autoload  bool      `json:"autoload" gorm:"index"`
	Public    bool      `json:"public" gorm:"index;default:false"`
	Format    string    `json:"format" gorm:"size:20;default:text" comment:"json,yaml,int,float,bool,text"`
	Value     string    `json:"value"`
	CreatedAt time.Time `json:"-" gorm:"autoCreateTime"`
	UpdatedAt time.Time `json:"-" gorm:"autoUpdateTime"`
}

// TableName overrides the default table name.
func (ConfigItem) TableName() string { return "configs" }

// Supported format constants for ConfigItem.Format.
const (
	ConfigFormatText  = "text"
	ConfigFormatJSON  = "json"
	ConfigFormatYAML  = "yaml"
	ConfigFormatInt   = "int"
	ConfigFormatFloat = "float"
	ConfigFormatBool  = "bool"
)

// ============================================================
// Store — system config store with optional DB persistence
// ============================================================

// StoreOptions configures a Store.
type StoreOptions struct {
	// DB is the GORM database handle. When nil, the store operates in
	// env-only mode: GetValue reads from OS env vars and .env files,
	// SetValue/CheckValue are no-ops on the DB, LoadAutoloads returns nothing.
	DB *gorm.DB

	// Cache is an optional cache.Cache[string, []byte] implementation for config values.
	// When nil, an LRU cache with TTL is created automatically.
	Cache cache.Cache[string, []byte]

	// CacheSize is the max number of cached config entries (default 1024).
	// Only used when Cache is nil.
	CacheSize int

	// CacheTTL is how long a cached entry is valid (default 10s).
	// Only used when Cache is nil.
	CacheTTL time.Duration
}

// Store is a system configuration store. It can optionally persist configs
// to a database table and always falls back to environment variables when
// no DB is configured or a key is not found in the DB.
//
// Lookup order for GetValue:
//  1. In-memory cache (TTL)
//  2. Database configs table (if DB is configured)
//  3. OS environment variable / .env file
type Store struct {
	db    *gorm.DB
	cache cache.Cache[string, []byte]
	ctx   context.Context // background context for cache ops
}

// NewStore creates a new Store. db may be nil for env-only mode.
func NewStore(opts StoreOptions) (*Store, error) {
	s := &Store{
		db:  opts.DB,
		ctx: context.Background(),
	}

	// Use provided cache or create a default LRU with TTL.
	if opts.Cache != nil {
		s.cache = opts.Cache
	} else {
		size := opts.CacheSize
		if size <= 0 {
			size = 1024
		}
		ttl := opts.CacheTTL
		if ttl <= 0 {
			ttl = 10 * time.Second
		}
		c, err := lrucache.New[string, []byte](size,
			lrucache.WithDefaultTTL(ttl),
			lrucache.WithCleanupInterval(time.Minute),
		)
		if err != nil {
			return nil, fmt.Errorf("config: create cache: %w", err)
		}
		s.cache = c
	}

	return s, nil
}

// NewStoreWithDB is a convenience wrapper for NewStore with a DB and defaults.
func NewStoreWithDB(db *gorm.DB) (*Store, error) {
	return NewStore(StoreOptions{DB: db})
}

// NewEnvOnlyStore creates a Store that reads only from env vars / .env files.
func NewEnvOnlyStore() (*Store, error) {
	return NewStore(StoreOptions{})
}

// AutoMigrate creates the configs table if it doesn't exist and DB is set.
func (s *Store) AutoMigrate() error {
	if s.db == nil {
		return nil
	}
	return s.db.AutoMigrate(&ConfigItem{})
}

// HasDB reports whether the store has a database backend.
func (s *Store) HasDB() bool { return s.db != nil }

// Close releases cache resources.
func (s *Store) Close() error {
	if s.cache != nil {
		return s.cache.Close()
	}
	return nil
}

// ============================================================
// GetValue / SetValue
// ============================================================

// GetValue returns the config value for key. Lookup order:
//  1. In-memory cache (TTL)
//  2. Database configs table (if DB is configured)
//  3. OS environment variable / .env file
//
// Returns "" when the key is not found in any source.
func (s *Store) GetValue(key string) string {
	key = normalizeKey(key)

	// 1. Cache
	if s.cache != nil {
		if data, err := s.cache.Get(s.ctx, key); err == nil {
			return string(data)
		}
	}

	// 2. Database
	if s.db != nil {
		var c ConfigItem
		if err := s.db.Where("`key` = ?", key).Take(&c).Error; err == nil {
			s.cacheSet(key, c.Value)
			return c.Value
		}
	}

	// 3. Env fallback
	if v, ok := lookupEnvValue(key); ok {
		s.cacheSet(key, v)
		return v
	}
	return ""
}

// LookupValue returns the value and a found flag, similar to os.LookupEnv.
func (s *Store) LookupValue(key string) (string, bool) {
	v := s.GetValue(key)
	return v, v != ""
}

// SetValue upserts a config entry in the database and updates the cache.
// In env-only mode (no DB), it only updates the in-process envStore so that
// subsequent GetValue calls see the new value.
func (s *Store) SetValue(key, value, format string, autoload, public bool) error {
	key = normalizeKey(key)
	s.cacheDel(key)

	if s.db == nil {
		envStore.Set(key, value)
		return nil
	}

	c := &ConfigItem{
		Key:      key,
		Value:    value,
		Format:   format,
		Autoload: autoload,
		Public:   public,
	}
	if err := s.db.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "key"}},
		DoUpdates: clause.AssignmentColumns([]string{"value", "format", "autoload", "public", "updated_at"}),
	}).Create(c).Error; err != nil {
		return fmt.Errorf("config: setValue %q: %w", key, err)
	}
	s.cacheSet(key, value)
	return nil
}

// SetValueSimple upserts a text-format, non-public, non-autoload config.
func (s *Store) SetValueSimple(key, value string) error {
	return s.SetValue(key, value, ConfigFormatText, false, false)
}

// ============================================================
// Typed getters
// ============================================================

// GetIntValue returns the config value as int, or defaultVal when unset/invalid.
func (s *Store) GetIntValue(key string, defaultVal int) int {
	v := s.GetValue(key)
	if v == "" {
		return defaultVal
	}
	n, err := strconv.ParseInt(v, 10, 64)
	if err != nil {
		return defaultVal
	}
	return int(n)
}

// GetInt64Value returns the config value as int64, or defaultVal when unset/invalid.
func (s *Store) GetInt64Value(key string, defaultVal int64) int64 {
	v := s.GetValue(key)
	if v == "" {
		return defaultVal
	}
	n, err := strconv.ParseInt(v, 10, 64)
	if err != nil {
		return defaultVal
	}
	return n
}

// GetFloatValue returns the config value as float64, or defaultVal when unset/invalid.
func (s *Store) GetFloatValue(key string, defaultVal float64) float64 {
	v := s.GetValue(key)
	if v == "" {
		return defaultVal
	}
	f, err := strconv.ParseFloat(v, 64)
	if err != nil {
		return defaultVal
	}
	return f
}

// GetBoolValue returns the config value as bool. Returns false when unset/invalid.
func (s *Store) GetBoolValue(key string) bool {
	v := strings.ToLower(strings.TrimSpace(s.GetValue(key)))
	if v == "" {
		return false
	}
	b, err := strconv.ParseBool(v)
	if err != nil {
		return false
	}
	return b
}

// GetBoolValueWithDefault returns the config value as bool, or defaultVal when unset.
func (s *Store) GetBoolValueWithDefault(key string, defaultVal bool) bool {
	v := strings.ToLower(strings.TrimSpace(s.GetValue(key)))
	if v == "" {
		return defaultVal
	}
	b, err := strconv.ParseBool(v)
	if err != nil {
		return defaultVal
	}
	return b
}

// GetDurationValue returns the config value as time.Duration (e.g. "30s", "5m").
func (s *Store) GetDurationValue(key string, defaultVal time.Duration) time.Duration {
	v := s.GetValue(key)
	if v == "" {
		return defaultVal
	}
	d, err := time.ParseDuration(v)
	if err != nil {
		return defaultVal
	}
	return d
}

// GetStringWithDefault returns the config value, or defaultVal when unset.
func (s *Store) GetStringWithDefault(key, defaultVal string) string {
	v := s.GetValue(key)
	if v == "" {
		return defaultVal
	}
	return v
}

// ============================================================
// CheckValue — insert default if not exists
// ============================================================

// CheckValue inserts a default config entry if the key does not exist.
// This is useful for seeding default values on first run. In env-only mode
// it sets the value in the in-process envStore.
func (s *Store) CheckValue(key, defaultValue, format string, autoload, public bool) error {
	key = normalizeKey(key)

	if s.db == nil {
		if _, ok := lookupEnvValue(key); !ok {
			envStore.Set(key, defaultValue)
		}
		return nil
	}

	c := &ConfigItem{
		Key:      key,
		Value:    defaultValue,
		Format:   format,
		Autoload: autoload,
		Public:   public,
	}
	if err := s.db.Clauses(clause.OnConflict{
		DoNothing: true,
	}).Create(c).Error; err != nil {
		return fmt.Errorf("config: checkValue %q: %w", key, err)
	}
	return nil
}

// ============================================================
// DeleteValue
// ============================================================

// DeleteValue removes a config entry from the database and cache.
// In env-only mode it only removes from the in-process envStore.
func (s *Store) DeleteValue(key string) error {
	key = normalizeKey(key)
	s.cacheDel(key)

	if s.db == nil {
		envStore.Set(key, "")
		return nil
	}

	if err := s.db.Where("`key` = ?", key).Delete(&ConfigItem{}).Error; err != nil {
		return fmt.Errorf("config: deleteValue %q: %w", key, err)
	}
	return nil
}

// ============================================================
// LoadAutoloads / LoadPublicConfigs / AllConfigs
// ============================================================

// LoadAutoloads loads all configs with autoload=true into the cache.
// In env-only mode this is a no-op.
func (s *Store) LoadAutoloads() error {
	if s.db == nil {
		return nil
	}
	var configs []ConfigItem
	if err := s.db.Where("autoload = ?", true).Find(&configs).Error; err != nil {
		return fmt.Errorf("config: loadAutoloads: %w", err)
	}
	for _, c := range configs {
		s.cacheSet(c.Key, c.Value)
	}
	return nil
}

// LoadPublicConfigs loads all public configs into the cache and returns them.
// In env-only mode it returns nil.
func (s *Store) LoadPublicConfigs() ([]ConfigItem, error) {
	if s.db == nil {
		return nil, nil
	}
	var configs []ConfigItem
	if err := s.db.Where("public = ?", true).Find(&configs).Error; err != nil {
		return nil, fmt.Errorf("config: loadPublicConfigs: %w", err)
	}
	for _, c := range configs {
		s.cacheSet(c.Key, c.Value)
	}
	return configs, nil
}

// AllConfigs returns all config entries from the database.
// In env-only mode it returns nil.
func (s *Store) AllConfigs() ([]ConfigItem, error) {
	if s.db == nil {
		return nil, nil
	}
	var configs []ConfigItem
	if err := s.db.Find(&configs).Error; err != nil {
		return nil, fmt.Errorf("config: allConfigs: %w", err)
	}
	return configs, nil
}

// ============================================================
// Cache management
// ============================================================

// PurgeCache evicts a single key from the in-memory cache.
func (s *Store) PurgeCache(key string) {
	s.cacheDel(normalizeKey(key))
}

// PurgeAllCache evicts all entries from the in-memory cache.
func (s *Store) PurgeAllCache() {
	if s.cache != nil {
		_ = s.cache.Clear(s.ctx)
	}
}

// ============================================================
// Helpers
// ============================================================

// normalizeKey uppercases and trims the key for consistent lookups.
func normalizeKey(key string) string {
	return strings.ToUpper(strings.TrimSpace(key))
}

// SetEnv sets a value in the process environment (os.Setenv).
// This is a convenience for making config values visible to libraries
// that read env vars directly.
func SetEnv(key, value string) error {
	return os.Setenv(normalizeKey(key), value)
}

// cacheSet stores a string value in the cache.
func (s *Store) cacheSet(key, val string) {
	if s.cache != nil {
		_ = s.cache.Set(s.ctx, key, []byte(val), 0)
	}
}

// cacheDel removes a key from the cache.
func (s *Store) cacheDel(key string) {
	if s.cache != nil {
		_ = s.cache.Delete(s.ctx, key)
	}
}
