package constants

import (
	"strings"
	"time"
)

// Copyright (c) 2026 LingByte
// SPDX-License-Identifier: MIT

const (
	ENV_LOCAL = "local"
	ENV_DEV   = "dev"
	ENV_PROD  = "prod"

	// Backup env keys
	ENV_BACKUP_ENABLED        = "BACKUP_ENABLED"
	ENV_BACKUP_PATH           = "BACKUP_PATH"
	ENV_BACKUP_SCHEDULE       = "BACKUP_SCHEDULE"
	ENV_BACKUP_RETENTION_DAYS = "BACKUP_RETENTION_DAYS"

	// Database driver names
	DBDriverSQLite = "sqlite"
	DBDriverMySQL  = "mysql"
	DBDriverPG     = "postgres"
)

// Environment variable keys for database / config cache
const (
	ENV_DB_DRIVER             = "DB_DRIVER"
	ENV_DSN                   = "DSN"
	ENV_DB_MAX_OPEN_CONNS     = "DB_MAX_OPEN_CONNS"
	ENV_DB_MAX_IDLE_CONNS     = "DB_MAX_IDLE_CONNS"
	ENV_DB_CONN_MAX_LIFETIME  = "DB_CONN_MAX_LIFETIME"
	ENV_DB_CONN_MAX_IDLE_TIME = "DB_CONN_MAX_IDLE_TIME"
	ENV_CONFIG_CACHE_SIZE     = "CONFIG_CACHE_SIZE"
	ENV_CONFIG_CACHE_EXPIRED  = "CONFIG_CACHE_EXPIRED"
)

// Server defaults
const (
	DefaultServerAddr = ":8082"
	DefaultUploadDir  = "./data/uploads"
)

// Route prefixes
const (
	UploadRoute = "/uploads"
)

// Timeout / size defaults
const (
	DefaultReadHeaderTimeout  = 30 * time.Second
	DefaultReadTimeout        = 5 * time.Minute
	DefaultIdleTimeout        = 120 * time.Second
	DefaultShutdownTimeout    = 25 * time.Second
	DefaultMaxHeaderBytes     = 1 << 20  // 1 MB
	DefaultMaxMultipartMemory = 32 << 20 // 32 MB
)

// Session defaults
const (
	DefaultSessionExpireDays   = 7
	DefaultSessionRandomKeyLen = 32
)

// SIP defaults
const (
	DefaultSIPHost    = "0.0.0.0"
	DefaultSIPPort    = 6050
	DefaultSIPLocalIP = "127.0.0.1"
)

// Timezone constants (IANA names). Use these with logger.InitTimezone
// instead of hardcoding string literals throughout the codebase.
const (
	TimezoneShanghai   = "Asia/Shanghai"       // China Standard Time (UTC+8)
	TimezoneTokyo      = "Asia/Tokyo"          // Japan Standard Time (UTC+9)
	TimezoneSingapore  = "Asia/Singapore"      // Singapore Time (UTC+8)
	TimezoneKolkata    = "Asia/Kolkata"        // India Standard Time (UTC+5:30)
	TimezoneDubai      = "Asia/Dubai"          // Gulf Standard Time (UTC+4)
	TimezoneLondon     = "Europe/London"       // GMT/BST (UTC+0/+1)
	TimezoneParis      = "Europe/Paris"        // Central European Time (UTC+1/+2)
	TimezoneBerlin     = "Europe/Berlin"       // Central European Time (UTC+1/+2)
	TimezoneMoscow     = "Europe/Moscow"       // Moscow Standard Time (UTC+3)
	TimezoneNewYork    = "America/New_York"    // Eastern Time (UTC-5/-4)
	TimezoneChicago    = "America/Chicago"     // Central Time (UTC-6/-5)
	TimezoneLosAngeles = "America/Los_Angeles" // Pacific Time (UTC-8/-7)
	TimezoneSaoPaulo   = "America/Sao_Paulo"   // Brasilia Time (UTC-3)
	TimezoneSydney     = "Australia/Sydney"    // Australian Eastern Time (UTC+10/+11)
	TimezoneAuckland   = "Pacific/Auckland"    // New Zealand Time (UTC+12/+13)
	TimezoneUTC        = "UTC"                 // Coordinated Universal Time
)

// DefaultTimezone is the fallback timezone when the configured name is empty
// or invalid. Aligned with logger.DefaultTimezone.
const DefaultTimezone = TimezoneShanghai

// Retention / scheduler intervals
const (
	DefaultLogRetentionInterval       = 24 * time.Hour
	DefaultSignalingRetentionInterval = 6 * time.Hour
	DefaultSIPUserOnlineSweepSeconds  = 30
)

// Environment variable keys
const (
	ENV_MODE                          = "MODE"
	ENV_SIP_USER_ONLINE_SWEEP_SECONDS = "SIP_USER_ONLINE_SWEEP_SECONDS"
	ENV_PROFILE_AUTO_PPROF            = "PROFILE_AUTO_PPROF"
	ENV_PPROF_ENABLED                 = "PPROF_ENABLED"
	ENV_UPLOAD_DIR                    = "UPLOAD_DIR"
)

// Misc
const (
	DefaultBannerFile    = "banner.txt"
	SignalChannelBufSize = 1
)

const DbField = "_ling_db"

// IsProdMode reports whether a MODE value requests production-strict behaviour.
// Single source of truth for the prod check — the long form "production" is
// matched as a prefix of ENV_PROD instead of a second constant.
func IsProdMode(mode string) bool {
	return strings.HasPrefix(strings.ToLower(strings.TrimSpace(mode)), ENV_PROD)
}
