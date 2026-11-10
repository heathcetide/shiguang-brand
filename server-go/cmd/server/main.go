// Copyright (c) 2026 heathcetide. All rights reserved.

package main

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"


	"github.com/heathcetide/DietDigiDose/internal/appapi"
	"github.com/heathcetide/DietDigiDose/internal/configs"
	"github.com/heathcetide/DietDigiDose/internal/constants"
	expressdb "github.com/heathcetide/DietDigiDose/internal/db"
	"github.com/heathcetide/DietDigiDose/internal/expressauth"
	"github.com/heathcetide/DietDigiDose/internal/handlers"
	"github.com/heathcetide/DietDigiDose/internal/listeners"
	localmw "github.com/heathcetide/DietDigiDose/internal/middlewares"
	"github.com/heathcetide/DietDigiDose/internal/models"
	pkgcache "github.com/heathcetide/DietDigiDose/pkg/cache"
	pkglock "github.com/heathcetide/DietDigiDose/pkg/lock"
	pkgretry "github.com/heathcetide/DietDigiDose/pkg/retry"
	pkgfallback "github.com/heathcetide/DietDigiDose/pkg/fallback"
	pkgstorage "github.com/heathcetide/DietDigiDose/pkg/storage"
	"github.com/heathcetide/DietDigiDose/pkg/apidocs"
	"github.com/heathcetide/DietDigiDose/pkg/bootstrap"
	"github.com/heathcetide/DietDigiDose/pkg/common/jwtutil"
	"github.com/heathcetide/DietDigiDose/pkg/common/i18n"
	i18ngin "github.com/heathcetide/DietDigiDose/pkg/common/i18n/gin"
	respgin "github.com/heathcetide/DietDigiDose/pkg/common/response/gin"
	"github.com/heathcetide/DietDigiDose/pkg/common/response"
	"github.com/heathcetide/DietDigiDose/pkg/common/logger"
	"github.com/heathcetide/DietDigiDose/pkg/common/middleware"
	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
	"gorm.io/gorm"
)

// Build metadata (injected via ldflags).
var (
	Version   = "dev"
	BuildTime = "unknown"
	GitCommit = "none"
)

func main() {
	info := &handlers.AppInfo{
		Name:      "DietDigiDose",
		Version:   Version,
		BuildTime: BuildTime,
		GitCommit: GitCommit,
	}

	// Load configuration
	cfg, err := configs.Load("configs/config.yaml")
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to load config: %v\n", err)
		os.Exit(1)
	}

	// Initialize timezone
	logger.InitTimezone(constants.TimezoneShanghai)

	// Initialize logger (zap + lumberjack rotation + sensitive field masking)
	if err := logger.Init(&logger.LogConfig{
		Level:           cfg.Logging.Level,
		Filename:        cfg.Logging.Filename,
		MaxSize:         cfg.Logging.MaxSize,
		MaxAge:          cfg.Logging.MaxAge,
		MaxBackups:      cfg.Logging.MaxBackups,
		Daily:           cfg.Logging.Daily,
		SensitiveFields: cfg.Logging.SensitiveFields,
	}, cfg.App.Environment); err != nil {
		fmt.Fprintf(os.Stderr, "failed to init logger: %v\n", err)
		os.Exit(1)
	}

	// Initialize i18n (multi-language translation)
	supportedLocales := make([]i18n.Locale, len(cfg.I18n.SupportedLocales))
	for i, loc := range cfg.I18n.SupportedLocales {
		supportedLocales[i] = i18n.Locale(loc)
	}
	i18nManager := i18n.NewManager(&i18n.Config{
		DefaultLocale:    i18n.Locale(cfg.I18n.DefaultLocale),
		SupportedLocales: supportedLocales,
		FallbackLocale:   i18n.Locale(cfg.I18n.FallbackLocale),
		TranslationsPath: cfg.I18n.TranslationsPath,
	})
	// Wire i18n resolver into the response package for automatic message translation
	respgin.Resolver = response.ResolverFunc(func(key string, args ...any) string {
		return i18nManager.T(i18nManager.GetDefaultLocale(), key, args...)
	})

	// Create bootstrap application
	appOpts := []bootstrap.Option{
		bootstrap.WithProfile(cfg.App.Environment),
		bootstrap.WithBannerText(info.Name),
		bootstrap.WithShutdownTimeout(15 * time.Second),
	}

	// Database initialization + migration
	var db *gorm.DB
	if cfg.Database.DSN != "" {
		db, err = configs.InitDB(cfg.Database)
		if err != nil {
			logger.Lg.Error("failed to init database", zap.Error(err))
			os.Exit(1)
		}
		// dev/test: AutoMigrate; prod: manual SQL migrations
		if cfg.App.Environment == "dev" || cfg.App.Environment == "test" {
			appOpts = append(appOpts, bootstrap.WithAutoMigrate(db, &models.User{}))
		}
	}

	// Initialize object storage (pkg/storage, default local backend)
	if err = pkgstorage.Init(
		cfg.Storage.Driver, cfg.Storage.Root, cfg.Storage.Region,
		cfg.Storage.Endpoint, cfg.Storage.AccessKey, cfg.Storage.SecretKey,
		cfg.Storage.PublicURLBase, cfg.Storage.MaxFileSize,
	); err != nil {
		logger.Lg.Error("failed to init storage", zap.Error(err))
		os.Exit(1)
	}

	// Initialize cache (pkg/cache, default memory backend)
	if err = pkgcache.Init(cfg.Cache.Driver, cfg.Cache.DefaultTTL, cfg.Cache.CleanupInterval); err != nil {
		logger.Lg.Error("failed to init cache", zap.Error(err))
		os.Exit(1)
	}

	// Initialize distributed lock (pkg/lock, default memory backend)
	if err = pkglock.Init(cfg.Lock.Driver, cfg.Lock.DefaultTTL, cfg.Lock.RetryDelay); err != nil {
		logger.Lg.Error("failed to init lock manager", zap.Error(err))
		os.Exit(1)
	}

	// Initialize retry strategy (pkg/retry)
	pkgretry.Init(cfg.Retry.MaxAttempts, cfg.Retry.InitialDelay, cfg.Retry.MaxDelay, cfg.Retry.Factor, cfg.Retry.Jitter)

	// Initialize fallback/degradation strategy (pkg/fallback)
	pkgfallback.Init(cfg.Fallback.Enabled, cfg.Fallback.DefaultMessage, cfg.Fallback.StatusCode)

	// Initialize timeout + circuit breaker manager (ling-base/middleware)
	recoveryTimeout, _ := time.ParseDuration(cfg.CircuitBreaker.RecoveryTimeout)
	middleware.InitTimeoutCircuitManager(
		middleware.TimeoutConfig{
			DefaultTimeout:   30 * time.Second,
			FallbackResponse: map[string]interface{}{"error": "service_unavailable", "message": "service temporarily unavailable"},
		},
		middleware.CircuitBreakerConfig{
			FailureThreshold:      cfg.CircuitBreaker.FailureThreshold,
			SuccessThreshold:      3,
			OpenTimeout:           recoveryTimeout,
			MaxConcurrentRequests: cfg.CircuitBreaker.MinRequests,
		},
		true,                        // enableTimeout
		cfg.CircuitBreaker.Enabled,  // enableCircuitBreaker
	)

	// Initialize JWT authentication (ling-base/common/jwtutil)
	accessTTL, _ := time.ParseDuration(cfg.JWT.AccessTTL)
	refreshTTL, _ := time.ParseDuration(cfg.JWT.RefreshTTL)
	jwtAuth, err := jwtutil.New(jwtutil.Config{
		Secret:     []byte(cfg.JWT.Secret),
		Issuer:     cfg.JWT.Issuer,
		AccessTTL:  accessTTL,
		RefreshTTL: refreshTTL,
	})
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to init JWT: %v\n", err)
		os.Exit(1)
	}
	info.JWTAuth = jwtAuth

	app := bootstrap.New(info.Name, appOpts...)

	// Register event listeners (post-processing for domain events)
	app.AddInitHook(constants.HookRegisterListeners, func(ctx context.Context) error {
		listeners.Register(db)
		return nil
	})

	// Open Express-shared SQL database (Wave 0)
	sqlDB, dbDriver, err := expressdb.Open(cfg.Database.Driver, cfg.Database.DSN)
	if err != nil {
		logger.Lg.Error("failed to open express shared database", zap.Error(err))
		os.Exit(1)
	}
	if err := expressdb.EnsureCoreSchema(sqlDB, dbDriver); err != nil {
		logger.Lg.Error("failed to ensure core schema", zap.Error(err))
		os.Exit(1)
	}
	cfg.Deployment.DatabaseDriver = dbDriver
	jwtSecret, err := expressauth.LoadJWTSecret()
	if err != nil {
		logger.Lg.Error("failed to load JWT secret", zap.Error(err))
		os.Exit(1)
	}
	expressAuth := expressauth.New(jwtSecret, sqlDB)

	// Register HTTP server as a lifecycle component
	app.Register("http-server", &httpServerComponent{
		info:        info,
		cfg:         cfg,
		db:          db,
		sqlDB:       sqlDB,
		dbDriver:    dbDriver,
		expressAuth: expressAuth,
		jwtAuth:     jwtAuth,
		i18nManager: i18nManager,
	})
	// Register cache as a lifecycle component (graceful shutdown)
	app.Register("cache", &cacheComponent{})

	// Start (blocks until a shutdown signal is received)
	if err := app.Run(); err != nil {
		logger.Lg.Error("application failed to start", zap.Error(err))
		os.Exit(1)
	}
}

// HTTP server lifecycle component

type httpServerComponent struct {
	info        *handlers.AppInfo
	cfg         *configs.Config
	db          *gorm.DB
	sqlDB       *sql.DB
	dbDriver    string
	expressAuth *expressauth.Auth
	server      *http.Server
	jwtAuth     *jwtutil.Auth
	i18nManager *i18n.Manager
}

// cacheComponent wraps the cache as a bootstrap lifecycle component.
type cacheComponent struct{}

func (c *cacheComponent) Start(ctx context.Context) error { return nil }
func (c *cacheComponent) Stop(ctx context.Context) error {
	return pkgcache.Close()
}
func (c *cacheComponent) IsRunning() bool { return true }

func (c *httpServerComponent) Start(ctx context.Context) error {
	// Use Release mode in production
	if c.cfg.App.Environment == "prod" {
		gin.SetMode(gin.ReleaseMode)
	}

	r := gin.New()

	// Global middleware (ling-base/middleware)
	// Order matters: RequestID → Logger → PanicRecovery → CORS
	r.Use(middleware.RequestIDMiddleware())
	r.Use(middleware.LoggerMiddleware(logger.Lg))
	r.Use(middleware.PanicRecovery())
	r.Use(middleware.CORS())
	// i18n middleware (detects language from Accept-Language / query param / cookie)
	r.Use(i18ngin.Middleware(c.i18nManager))
	r.Use(localmw.RateLimit(c.cfg.RateLimit))
	r.Use(middleware.CircuitBreakerMiddleware())
	// Express-compatible APIs use per-route expressauth middleware; do not force ling-base JWT globally.

	// Mount apidocs first to get huma.API (for registering routes with OpenAPI docs)
	docsEnabled := c.cfg.Docs.Enabled
	api := apidocs.Mount(r, apidocs.Options{
		Title:       c.info.Name + " API",
		Version:     c.info.Version,
		Description: "DietDigiDose RESTful API documentation",
		DocsPath:    c.cfg.Docs.Path,
		DarkMode:    c.cfg.Docs.DarkMode,
		EnabledFunc: func() bool { return docsEnabled },
	})

	// Create handlers and register routes (humax.Group: Gin + OpenAPI docs)
	h := handlers.New(c.cfg, *c.info, c.db)
	h.DatabaseDriver = c.dbDriver
	h.Register(r, api)

	// Migrated Express domains (Wave 0+)
	if c.sqlDB != nil && c.expressAuth != nil {
		appapi.Register(r, appapi.Deps{DB: c.sqlDB, Auth: c.expressAuth})
		logger.Lg.Info("express-compatible domains registered", zap.String("databaseDriver", c.dbDriver))
	}

	expressProxy, err := handlers.NewExpressProxy(c.cfg.Upstream.Express)
	if err != nil {
		return fmt.Errorf("invalid upstream.express: %w", err)
	}
	if expressProxy != nil && strings.TrimSpace(c.cfg.Upstream.Express) != "" {
		logger.Lg.Info("express upstream configured for residual routes", zap.String("url", c.cfg.Upstream.Express))
		r.NoRoute(handlers.ProxyToExpress(expressProxy))
		r.NoMethod(handlers.ProxyToExpress(expressProxy))
	} else {
		logger.Lg.Warn("express upstream disabled; unmatched routes will 404")
	}

	c.server = &http.Server{
		Addr:         fmt.Sprintf(":%d", c.cfg.Server.Port),
		Handler:      r,
		ReadTimeout:  c.cfg.Server.ReadTimeout,
		WriteTimeout: c.cfg.Server.WriteTimeout,
		IdleTimeout:  c.cfg.Server.IdleTimeout,
	}

	go func() {
		logger.Lg.Info("HTTP server started",
			zap.String("addr", c.server.Addr),
			zap.String("version", c.info.Version))
		if err := c.server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Lg.Error("HTTP server error", zap.Error(err))
		}
	}()

	return nil
}

func (c *httpServerComponent) Stop(ctx context.Context) error {
	logger.Lg.Info("shutting down HTTP server...")
	err := c.server.Shutdown(ctx)
	if c.sqlDB != nil {
		_ = c.sqlDB.Close()
	}
	return err
}

func (c *httpServerComponent) IsRunning() bool {
	return c.server != nil
}
