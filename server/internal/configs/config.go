// Copyright (c) 2026 heathcetide. All rights reserved.

package configs

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

// Config holds all application configuration.
type Config struct {
	Server         ServerConfig         `yaml:"server"`
	Upstream       UpstreamConfig       `yaml:"upstream"`
	Scaffold       ScaffoldConfig       `yaml:"scaffold"`
	Deployment     DeploymentConfig     `yaml:"deployment"`
	Database       DatabaseConfig       `yaml:"database"`
	Redis          RedisConfig          `yaml:"redis"`
	Logging        LoggingConfig        `yaml:"logging"`
	RateLimit      RateLimitConfig      `yaml:"rateLimit"`
	CircuitBreaker CircuitBreakerConfig `yaml:"circuitBreaker"`
	Docs           DocsConfig           `yaml:"docs"`
	JWT            JWTConfig            `yaml:"jwt"`
	I18n           I18nConfig           `yaml:"i18n"`
	Storage        StorageConfig        `yaml:"storage"`
	Cache          CacheConfig          `yaml:"cache"`
	Lock           LockConfig           `yaml:"lock"`
	Retry          RetryConfig          `yaml:"retry"`
	Fallback       FallbackConfig       `yaml:"fallback"`
	LLM            LLMConfig            `yaml:"llm"`
	TTS            TTSConfig            `yaml:"tts"`
	App            AppConfig            `yaml:"app"`
}

// LLMConfig configures the primary chat/vision provider (OpenAI or Anthropic-compatible).
type LLMConfig struct {
	Enabled  bool          `yaml:"enabled"`
	Protocol string        `yaml:"protocol"` // openai | anthropic
	APIKey   string        `yaml:"apiKey"`
	BaseURL  string        `yaml:"baseURL"`
	Model    string        `yaml:"model"`
	Timeout  time.Duration `yaml:"timeout"`
}

// TTSConfig configures speech synthesis (MiniMax / OpenAI-compatible).
type TTSConfig struct {
	Enabled  bool   `yaml:"enabled"`
	Provider string `yaml:"provider"` // minimax | openai
	APIKey   string `yaml:"apiKey"`
	BaseURL  string `yaml:"baseURL"`
	Model    string `yaml:"model"`
	Voice    string `yaml:"voice"`
}

// UpstreamConfig points at the Express strangler upstream.
type UpstreamConfig struct {
	Express string `yaml:"express"`
}

// ScaffoldConfig toggles template demo routes that would collide with Express.
type ScaffoldConfig struct {
	Enabled bool `yaml:"enabled"`
}

// DeploymentConfig mirrors Express /api/v1/health metadata.
type DeploymentConfig struct {
	Profile        string `yaml:"profile"`
	DatabaseDriver string `yaml:"databaseDriver"`
}

type ServerConfig struct {
	Port         int           `yaml:"port"`
	ReadTimeout  time.Duration `yaml:"readTimeout"`
	WriteTimeout time.Duration `yaml:"writeTimeout"`
	IdleTimeout  time.Duration `yaml:"idleTimeout"`
}

type DatabaseConfig struct {
	Driver          string        `yaml:"driver"` // mysql, postgres, sqlite
	DSN             string        `yaml:"dsn"`
	MaxOpenConns    int           `yaml:"maxOpenConns"`
	MaxIdleConns    int           `yaml:"maxIdleConns"`
	ConnMaxLifetime time.Duration `yaml:"connMaxLifetime"`
}

type RedisConfig struct {
	Addr     string `yaml:"addr"`
	Password string `yaml:"password"`
	DB       int    `yaml:"db"`
}

type LoggingConfig struct {
	Level           string `yaml:"level"`
	Filename        string `yaml:"filename"`
	MaxSize         int    `yaml:"maxSize"`
	MaxAge          int    `yaml:"maxAge"`
	MaxBackups      int    `yaml:"maxBackups"`
	Daily           bool   `yaml:"daily"`
	SensitiveFields string `yaml:"sensitiveFields"`
}

type RateLimitConfig struct {
	Enabled bool `yaml:"enabled"`
	RPS     int  `yaml:"rps"`
	Burst   int  `yaml:"burst"`
}

type CircuitBreakerConfig struct {
	Enabled          bool   `yaml:"enabled"`
	FailureThreshold int    `yaml:"failureThreshold"`
	MinRequests      int    `yaml:"minRequests"`
	RecoveryTimeout  string `yaml:"recoveryTimeout"`
}

type DocsConfig struct {
	Enabled    bool   `yaml:"enabled"`
	Path       string `yaml:"path"`
	Theme      string `yaml:"theme"` // scalar, swagger, redoc, stoplight
	DarkMode   bool   `yaml:"darkMode"`
	CDNMode    string `yaml:"cdnMode"`    // public, selfhosted, custom
	CDNBaseURL string `yaml:"cdnBaseUrl"` // base URL for selfhosted mode
}

type JWTConfig struct {
	Enabled    bool   `yaml:"enabled"`
	Secret     string `yaml:"secret"`
	Issuer     string `yaml:"issuer"`
	AccessTTL  string `yaml:"accessTTL"`
	RefreshTTL string `yaml:"refreshTTL"`
}

type I18nConfig struct {
	Enabled          bool     `yaml:"enabled"`
	DefaultLocale    string   `yaml:"defaultLocale"`    // e.g. zh-CN
	SupportedLocales []string `yaml:"supportedLocales"` // supported language list
	FallbackLocale   string   `yaml:"fallbackLocale"`   // fallback language
	TranslationsPath string   `yaml:"translationsPath"` // translation files directory
}

type AppConfig struct {
	Name        string `yaml:"name"`
	Environment string `yaml:"environment"` // dev, test, prod (maps to constants.ENV_DEV / ENV_PROD)
}

// StorageConfig holds object storage configuration (ling-base/stores).
// Default backend is local (local filesystem, zero cloud SDK dependency).
// To switch to cloud storage, set driver to s3/oss/cos/minio/kodo/tos/obs/ks3
// and fill in the corresponding credentials.
type StorageConfig struct {
	Driver        string `yaml:"driver"`        // local | s3 | oss | cos | minio | kodo | tos | obs | ks3
	Root          string `yaml:"root"`          // local: root directory; cloud: bucket name
	Region        string `yaml:"region"`        // cloud storage region
	Endpoint      string `yaml:"endpoint"`      // custom endpoint (MinIO / S3-compatible)
	AccessKey     string `yaml:"accessKey"`     // cloud storage AccessKey
	SecretKey     string `yaml:"secretKey"`     // cloud storage SecretKey
	PublicURLBase string `yaml:"publicUrlBase"` // public access base URL (empty = use PublicURL() default)
	MaxFileSize   int64  `yaml:"maxFileSize"`   // max file size in bytes (0 = unlimited)
}

// CacheConfig holds cache configuration (ling-base/common/cache).
// Default backend is memory (in-process, zero external dependencies).
type CacheConfig struct {
	Driver          string `yaml:"driver"`          // memory | redis | bigcache | freecache | ristretto
	DefaultTTL      string `yaml:"defaultTTL"`      // default TTL (e.g. 10m, 1h)
	CleanupInterval string `yaml:"cleanupInterval"` // memory: GC interval
	// Redis-specific (empty = reuse top-level redis config)
	RedisAddr     string `yaml:"redisAddr"`
	RedisPassword string `yaml:"redisPassword"`
	RedisDB       int    `yaml:"redisDB"`
}

// LockConfig holds distributed lock configuration (ling-base/common/lock).
// Default backend is memory (in-process, single instance).
type LockConfig struct {
	Driver     string `yaml:"driver"`     // memory | redis | etcd | zookeeper | consul | mysql | postgres
	DefaultTTL string `yaml:"defaultTTL"` // default lock TTL (e.g. 10s, 30s)
	RetryDelay string `yaml:"retryDelay"` // lock acquisition retry interval
	// Redis-specific (empty = reuse top-level redis config)
	RedisAddr     string `yaml:"redisAddr"`
	RedisPassword string `yaml:"redisPassword"`
	RedisDB       int    `yaml:"redisDB"`
}

// RetryConfig holds retry strategy configuration (ling-base/common/retry).
type RetryConfig struct {
	MaxAttempts  int    `yaml:"maxAttempts"`  // max attempts (including the first)
	InitialDelay string `yaml:"initialDelay"` // initial backoff delay
	MaxDelay     string `yaml:"maxDelay"`     // backoff cap
	Factor       string `yaml:"factor"`       // backoff multiplier (e.g. 2.0)
	Jitter       bool   `yaml:"jitter"`       // enable jitter
}

// FallbackConfig holds degradation/fallback configuration.
// When the circuit breaker is open or a remote call fails,
// a fallback response is returned instead of a 5xx error.
type FallbackConfig struct {
	Enabled        bool   `yaml:"enabled"`        // enable fallback
	DefaultMessage string `yaml:"defaultMessage"` // default fallback message
	StatusCode     int    `yaml:"statusCode"`     // default fallback HTTP status code (0 = 503)
}

// Default returns the default configuration.
func Default() *Config {
	return &Config{
		Server: ServerConfig{
			Port:         9090,
			ReadTimeout:  15 * time.Second,
			WriteTimeout: 0,
			IdleTimeout:  60 * time.Second,
		},
		Upstream: UpstreamConfig{
			Express: "",
		},
		Scaffold: ScaffoldConfig{
			Enabled: false,
		},
		Deployment: DeploymentConfig{
			Profile:        "china",
			DatabaseDriver: "sqlite",
		},
		Database: DatabaseConfig{
			Driver:          "sqlite",
			DSN:             "",
			MaxOpenConns:    25,
			MaxIdleConns:    10,
			ConnMaxLifetime: 5 * time.Minute,
		},
		Redis: RedisConfig{
			Addr: "localhost:6379",
			DB:   0,
		},
		Logging: LoggingConfig{
			Level:      "info",
			Filename:   "logs/app.log",
			MaxSize:    100,
			MaxAge:     30,
			MaxBackups: 10,
			Daily:      true,
		},
		RateLimit: RateLimitConfig{
			Enabled: false,
			RPS:     100,
			Burst:   200,
		},
		CircuitBreaker: CircuitBreakerConfig{
			Enabled:          false,
			FailureThreshold: 5,
			MinRequests:      10,
			RecoveryTimeout:  "30s",
		},
		Docs: DocsConfig{
			Enabled:  true,
			Path:     "/docs",
			Theme:    "scalar",
			DarkMode: false,
			CDNMode:  "public",
		},
		JWT: JWTConfig{
			Enabled:    false,
			Secret:     "change-me-in-prod-32bytes!",
			Issuer:     "DietDigiDose",
			AccessTTL:  "15m",
			RefreshTTL: "168h",
		},
		I18n: I18nConfig{
			Enabled:          true,
			DefaultLocale:    "zh-CN",
			SupportedLocales: []string{"en", "zh-CN"},
			FallbackLocale:   "en",
			TranslationsPath: "i18n/translations",
		},
		Storage: StorageConfig{
			Driver:      "local",
			Root:        "uploads",
			MaxFileSize: 10 * 1024 * 1024, // 10 MB
		},
		Cache: CacheConfig{
			Driver:          "memory",
			DefaultTTL:      "10m",
			CleanupInterval: "1m",
		},
		Lock: LockConfig{
			Driver:     "memory",
			DefaultTTL: "10s",
			RetryDelay: "50ms",
		},
		Retry: RetryConfig{
			MaxAttempts:  3,
			InitialDelay: "100ms",
			MaxDelay:     "10s",
			Factor:       "2.0",
			Jitter:       true,
		},
		Fallback: FallbackConfig{
			Enabled:        true,
			DefaultMessage: "service temporarily unavailable",
			StatusCode:     503,
		},
		App: AppConfig{
			Name:        "Shiwei Daily",
			Environment: "dev",
		},
	}
}

// Load loads configuration from a file.
// If the file does not exist, default config is used.
// Supports both YAML (.yaml/.yml) and .env formats.
// Environment variables override corresponding fields (env has highest priority).
// Env var format: APP_<SECTION>_<FIELD>, e.g. APP_SERVER_PORT, APP_DATABASE_DSN.
func Load(path string) (*Config, error) {
	cfg := Default()

	data, err := os.ReadFile(path)
	if err != nil {
		// Config file not found; use defaults + env overrides
		applyEnvOverrides(cfg)
		if err := cfg.Validate(); err != nil {
			return nil, fmt.Errorf("config validation failed: %w", err)
		}
		return cfg, nil
	}

	if strings.HasSuffix(path, ".env") || strings.HasSuffix(path, ".env.prod") {
		// .env format: parse KEY=VALUE and set as env vars, then apply env overrides
		if err := loadDotEnv(data); err != nil {
			return nil, fmt.Errorf("failed to parse .env config: %w", err)
		}
		applyEnvOverrides(cfg)
	} else {
		// YAML format
		if err := yaml.Unmarshal(data, cfg); err != nil {
			return nil, fmt.Errorf("failed to parse YAML config: %w", err)
		}
		// Optional local override (gitignored), e.g. configs/config.local.yaml
		localPath := filepath.Join(filepath.Dir(path), "config.local.yaml")
		if localData, err := os.ReadFile(localPath); err == nil { // #nosec G304 -- fixed sibling override
			if err := yaml.Unmarshal(localData, cfg); err != nil {
				return nil, fmt.Errorf("failed to parse local YAML config: %w", err)
			}
		}
		applyEnvOverrides(cfg)
	}

	cfg.applyLLMEnvAliases()

	if err := cfg.Validate(); err != nil {
		return nil, fmt.Errorf("config validation failed: %w", err)
	}

	return cfg, nil
}

// applyLLMEnvAliases mirrors llm/tts yaml into process env so legacy readers keep working.
func (c *Config) applyLLMEnvAliases() {
	if !c.LLM.Enabled {
		return
	}
	if key := strings.TrimSpace(c.LLM.APIKey); key != "" {
		_ = os.Setenv("AI_API_KEY", key)
		_ = os.Setenv("AI_CHAT_API_KEY", key)
	}
	// Model / base / protocol apply even when the key lives only in system_settings,
	// so yaml remains the source of truth for MiniMax-M3 etc.
	if c.LLM.BaseURL != "" {
		_ = os.Setenv("AI_BASE_URL", c.LLM.BaseURL)
		_ = os.Setenv("AI_CHAT_BASE_URL", c.LLM.BaseURL)
		_ = os.Setenv("AI_VISION_BASE_URL", c.LLM.BaseURL)
	}
	if c.LLM.Model != "" {
		_ = os.Setenv("AI_MODEL", c.LLM.Model)
		_ = os.Setenv("AI_CHAT_MODEL", c.LLM.Model)
		_ = os.Setenv("AI_VISION_MODEL", c.LLM.Model)
	}
	if c.LLM.Protocol != "" {
		_ = os.Setenv("AI_PROTOCOL", c.LLM.Protocol)
	}
	if c.TTS.Enabled {
		if c.TTS.APIKey != "" {
			_ = os.Setenv("TTS_API_KEY", c.TTS.APIKey)
		} else if c.LLM.APIKey != "" {
			_ = os.Setenv("TTS_API_KEY", c.LLM.APIKey)
		}
		if c.TTS.BaseURL != "" {
			_ = os.Setenv("TTS_BASE_URL", c.TTS.BaseURL)
		}
		if c.TTS.Model != "" {
			_ = os.Setenv("TTS_MODEL", c.TTS.Model)
		}
		if c.TTS.Voice != "" {
			_ = os.Setenv("TTS_VOICE", c.TTS.Voice)
		}
		if c.TTS.Provider != "" {
			_ = os.Setenv("TTS_PROVIDER", c.TTS.Provider)
		}
	}
}

// Validate checks configuration completeness and validity.
// Called at the end of Load() to catch config errors at startup.
func (c *Config) Validate() error {
	var errs []string

	// Server
	if c.Server.Port < 1 || c.Server.Port > 65535 {
		errs = append(errs, "server.port must be between 1 and 65535")
	}
	if c.Server.ReadTimeout < 0 {
		errs = append(errs, "server.readTimeout must not be negative")
	}
	if c.Server.WriteTimeout < 0 {
		errs = append(errs, "server.writeTimeout must not be negative")
	}

	// Database (DSN is required in production)
	if c.App.Environment == "prod" && c.Database.DSN == "" {
		errs = append(errs, "database.dsn must not be empty in production")
	}

	// JWT
	if c.JWT.Enabled {
		if c.JWT.Secret == "" {
			errs = append(errs, "jwt.secret must not be empty when jwt.enabled is true")
		}
		if len(c.JWT.Secret) > 0 && len(c.JWT.Secret) < 16 {
			errs = append(errs, "jwt.secret must be at least 16 characters (security requirement)")
		}
		if c.JWT.AccessTTL == "" {
			errs = append(errs, "jwt.accessTTL must not be empty when jwt.enabled is true")
		}
	}

	// RateLimit
	if c.RateLimit.Enabled {
		if c.RateLimit.RPS <= 0 {
			errs = append(errs, "rateLimit.rps must be > 0 when rateLimit.enabled is true")
		}
	}

	// CircuitBreaker
	if c.CircuitBreaker.Enabled {
		if c.CircuitBreaker.FailureThreshold <= 0 {
			errs = append(errs, "circuitBreaker.failureThreshold must be > 0 when enabled")
		}
	}
	// I18n
	if c.I18n.Enabled {
		if c.I18n.DefaultLocale == "" {
			errs = append(errs, "i18n.defaultLocale must not be empty when i18n.enabled is true")
		}
	}

	if len(errs) > 0 {
		return fmt.Errorf("%s", strings.Join(errs, "; "))
	}
	return nil
}

// loadDotEnv parses .env file content (KEY=VALUE format)
// and sets key-value pairs as environment variables (does not override existing ones).
func loadDotEnv(data []byte) error {
	scanner := bufio.NewScanner(strings.NewReader(string(data)))
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		// Skip empty lines and comments
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		// Parse KEY=VALUE
		idx := strings.Index(line, "=")
		if idx <= 0 {
			continue
		}
		key := strings.TrimSpace(line[:idx])
		val := strings.TrimSpace(line[idx+1:])
		// Strip quotes
		if len(val) >= 2 && ((val[0] == '"' && val[len(val)-1] == '"') ||
			(val[0] == '\'' && val[len(val)-1] == '\'')) {
			val = val[1 : len(val)-1]
		}
		// Do not override existing env vars
		if _, exists := os.LookupEnv(key); !exists {
			os.Setenv(key, val)
		}
	}
	return scanner.Err()
}

// applyEnvOverrides applies APP_-prefixed environment variables to the config.
// Supported: APP_APP_ENVIRONMENT / APP_APP_NAME / APP_SERVER_PORT /
// APP_DATABASE_DRIVER / APP_DATABASE_DSN / APP_REDIS_ADDR /
// APP_REDIS_PASSWORD / APP_JWT_SECRET / APP_JWT_ENABLED /
// APP_DOCS_ENABLED / APP_RATELIMIT_ENABLED / APP_RATELIMIT_RPS
func applyEnvOverrides(cfg *Config) {
	// App
	if v := os.Getenv("APP_APP_NAME"); v != "" {
		cfg.App.Name = v
	}
	if v := os.Getenv("NODE_ENV"); v == "production" {
		cfg.App.Environment = "prod"
	}
	if v := os.Getenv("APP_APP_ENVIRONMENT"); v != "" {
		cfg.App.Environment = v
	}
	// Server
	if v := os.Getenv("PORT"); v != "" {
		if port, err := strconv.Atoi(v); err == nil {
			cfg.Server.Port = port
		}
	}
	if v := os.Getenv("APP_SERVER_PORT"); v != "" {
		if port, err := strconv.Atoi(v); err == nil {
			cfg.Server.Port = port
		}
	}
	// Upstream / scaffold / deployment
	if v, ok := os.LookupEnv("APP_UPSTREAM_EXPRESS"); ok {
		if strings.EqualFold(v, "off") || strings.EqualFold(v, "false") || v == "0" {
			cfg.Upstream.Express = ""
		} else {
			cfg.Upstream.Express = v
		}
	}
	if v := os.Getenv("APP_SCAFFOLD_ENABLED"); v != "" {
		cfg.Scaffold.Enabled = strings.EqualFold(v, "true") || v == "1"
	}
	if v := os.Getenv("APP_DEPLOYMENT_PROFILE"); v != "" {
		cfg.Deployment.Profile = v
	} else if v := os.Getenv("DEPLOYMENT_PROFILE"); v != "" {
		cfg.Deployment.Profile = v
	}
	if v := os.Getenv("APP_DEPLOYMENT_DATABASE_DRIVER"); v != "" {
		cfg.Deployment.DatabaseDriver = v
	} else if v := os.Getenv("DATABASE_DRIVER"); v != "" {
		cfg.Deployment.DatabaseDriver = v
	}
	// Database
	// Shared names are fallbacks; explicit APP_* variables always win.
	if v := os.Getenv("DATABASE_DRIVER"); v != "" {
		cfg.Database.Driver = v
	}
	if v := os.Getenv("APP_DATABASE_DRIVER"); v != "" {
		cfg.Database.Driver = v
	}
	cfg.Database.Driver = strings.ToLower(strings.TrimSpace(cfg.Database.Driver))
	if cfg.Database.Driver == "postgres" {
		cfg.Database.Driver = "postgresql"
	}
	if cfg.Database.Driver == "postgresql" || cfg.Database.Driver == "mysql" {
		if v := os.Getenv("DATABASE_URL"); v != "" {
			cfg.Database.DSN = v
		}
		if cfg.Database.Driver == "mysql" {
			if v := os.Getenv("MYSQL_DSN"); v != "" && strings.TrimSpace(cfg.Database.DSN) == "" {
				cfg.Database.DSN = v
			}
		}
	} else if cfg.Database.Driver == "sqlite" {
		if v := os.Getenv("DATABASE_PATH"); v != "" {
			cfg.Database.DSN = v
		}
	}
	if v := os.Getenv("APP_DATABASE_DSN"); v != "" {
		cfg.Database.DSN = v
	}
	cfg.Deployment.DatabaseDriver = cfg.Database.Driver
	// Redis
	if v := os.Getenv("APP_REDIS_ADDR"); v != "" {
		cfg.Redis.Addr = v
	}
	if v := os.Getenv("APP_REDIS_PASSWORD"); v != "" {
		cfg.Redis.Password = v
	}
	// JWT
	if v := os.Getenv("APP_JWT_SECRET"); v != "" {
		cfg.JWT.Secret = v
	}
	if v := os.Getenv("APP_JWT_ENABLED"); v != "" {
		cfg.JWT.Enabled = strings.EqualFold(v, "true") || v == "1"
	}
	// Docs
	if v := os.Getenv("APP_DOCS_ENABLED"); v != "" {
		cfg.Docs.Enabled = strings.EqualFold(v, "true") || v == "1"
	}
	// RateLimit
	if v := os.Getenv("APP_RATELIMIT_ENABLED"); v != "" {
		cfg.RateLimit.Enabled = strings.EqualFold(v, "true") || v == "1"
	}
	if v := os.Getenv("APP_RATELIMIT_RPS"); v != "" {
		if rps, err := strconv.Atoi(v); err == nil {
			cfg.RateLimit.RPS = rps
		}
	}
	// I18n
	if v := os.Getenv("APP_I18N_ENABLED"); v != "" {
		cfg.I18n.Enabled = strings.EqualFold(v, "true") || v == "1"
	}
	if v := os.Getenv("APP_I18N_DEFAULT_LOCALE"); v != "" {
		cfg.I18n.DefaultLocale = v
	}
	if v := os.Getenv("APP_I18N_FALLBACK_LOCALE"); v != "" {
		cfg.I18n.FallbackLocale = v
	}
	if v := os.Getenv("APP_I18N_TRANSLATIONS_PATH"); v != "" {
		cfg.I18n.TranslationsPath = v
	}
	// Storage
	if v := os.Getenv("APP_STORAGE_DRIVER"); v != "" {
		cfg.Storage.Driver = v
	}
	if v := os.Getenv("APP_STORAGE_ROOT"); v != "" {
		cfg.Storage.Root = v
	}
	if v := os.Getenv("APP_STORAGE_REGION"); v != "" {
		cfg.Storage.Region = v
	}
	if v := os.Getenv("APP_STORAGE_ENDPOINT"); v != "" {
		cfg.Storage.Endpoint = v
	}
	if v := os.Getenv("APP_STORAGE_ACCESS_KEY"); v != "" {
		cfg.Storage.AccessKey = v
	}
	if v := os.Getenv("APP_STORAGE_SECRET_KEY"); v != "" {
		cfg.Storage.SecretKey = v
	}
	if v := os.Getenv("APP_STORAGE_PUBLIC_URL_BASE"); v != "" {
		cfg.Storage.PublicURLBase = v
	}
	// Cache
	if v := os.Getenv("APP_CACHE_DRIVER"); v != "" {
		cfg.Cache.Driver = v
	}
	if v := os.Getenv("APP_CACHE_DEFAULT_TTL"); v != "" {
		cfg.Cache.DefaultTTL = v
	}
	// Lock
	if v := os.Getenv("APP_LOCK_DRIVER"); v != "" {
		cfg.Lock.Driver = v
	}
	if v := os.Getenv("APP_LOCK_DEFAULT_TTL"); v != "" {
		cfg.Lock.DefaultTTL = v
	}
	// Retry
	if v := os.Getenv("APP_RETRY_MAX_ATTEMPTS"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			cfg.Retry.MaxAttempts = n
		}
	}
	if v := os.Getenv("APP_RETRY_INITIAL_DELAY"); v != "" {
		cfg.Retry.InitialDelay = v
	}
	// Fallback
	if v := os.Getenv("APP_FALLBACK_ENABLED"); v != "" {
		cfg.Fallback.Enabled = strings.EqualFold(v, "true") || v == "1"
	}
	if v := os.Getenv("APP_FALLBACK_MESSAGE"); v != "" {
		cfg.Fallback.DefaultMessage = v
	}
}

// InitDB creates a database connection based on the configuration.
func InitDB(cfg DatabaseConfig) (*gorm.DB, error) {
	var dialector gorm.Dialector
	switch cfg.Driver {
	case "mysql":
		dialector = mysql.Open(cfg.DSN)
	case "postgres", "postgresql":
		dialector = postgres.Open(cfg.DSN)
	case "sqlite":
		dialector = sqlite.Open(cfg.DSN)
	default:
		return nil, fmt.Errorf("unsupported database driver: %s", cfg.Driver)
	}

	db, err := gorm.Open(dialector, &gorm.Config{})
	if err != nil {
		return nil, fmt.Errorf("failed to connect to database: %w", err)
	}

	sqlDB, err := db.DB()
	if err != nil {
		return nil, err
	}
	sqlDB.SetMaxOpenConns(cfg.MaxOpenConns)
	sqlDB.SetMaxIdleConns(cfg.MaxIdleConns)
	sqlDB.SetConnMaxLifetime(cfg.ConnMaxLifetime)

	return db, nil
}
