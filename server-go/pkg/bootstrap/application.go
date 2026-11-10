// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package bootstrap

import (
	"context"
	"fmt"
	"io"
	"os"
	"sync"
	"sync/atomic"
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common/eventbus"
	"github.com/heathcetide/DietDigiDose/pkg/common/logger"
	"github.com/heathcetide/DietDigiDose/pkg/version"
)

// AppStatus represents the current status of the application.
type AppStatus int32

const (
	StatusCreated AppStatus = iota
	StatusInitializing
	StatusStarting
	StatusRunning
	StatusStopping
	StatusStopped
	StatusFailed
)

func (s AppStatus) String() string {
	switch s {
	case StatusCreated:
		return "created"
	case StatusInitializing:
		return "initializing"
	case StatusStarting:
		return "starting"
	case StatusRunning:
		return "running"
	case StatusStopping:
		return "stopping"
	case StatusStopped:
		return "stopped"
	case StatusFailed:
		return "failed"
	default:
		return "unknown"
	}
}

// Application is the central orchestrator, analogous to Spring's
// SpringApplication / ApplicationContext. It wires together the component
// registry, lifecycle manager, profile manager, properties, event publisher,
// banner, and graceful shutdown.
type Application struct {
	mu        sync.Mutex
	name      string
	status    atomic.Int32
	startTime time.Time

	registry   *Registry
	lifecycle  *LifecycleManager
	profiles   *ProfileManager
	properties *Properties
	events     eventbus.Bus
	shutdown   *ShutdownManager

	bannerText      string
	bannerFile      string
	output          io.Writer
	shutdownTimeout time.Duration

	// Migration support.
	migrationRunner   MigrationRunner
	autoMigrator      AutoMigrator
	autoMigrateModels []any
}

// Option is a functional option for configuring an Application.
type Option func(*Application)

// New creates a new Application with the given name and options.
//
//	app := bootstrap.New("myapp",
//	    bootstrap.WithProfile(bootstrap.ProfileProd),
//	    bootstrap.WithShutdownTimeout(60*time.Second),
//	    bootstrap.WithBannerText("MyApp"),
//	)
func New(name string, opts ...Option) *Application {
	app := &Application{
		name:            name,
		registry:        NewRegistry(),
		lifecycle:       NewLifecycleManager(),
		profiles:        NewProfileManager(ProfileDev),
		properties:      NewProperties(),
		events:          newEventBus(),
		shutdown:        NewShutdownManager(30 * time.Second),
		bannerText:      name,
		output:          os.Stdout,
		shutdownTimeout: 30 * time.Second,
	}
	app.status.Store(int32(StatusCreated))

	for _, opt := range opts {
		opt(app)
	}
	return app
}

// WithProfile sets the active profile.
func WithProfile(profile string) Option {
	return func(a *Application) {
		a.profiles.Active(profile)
	}
}

// WithProfiles sets multiple active profiles.
func WithProfiles(profiles ...string) Option {
	return func(a *Application) {
		a.profiles.Active(profiles...)
	}
}

// WithBannerText sets the banner text.
func WithBannerText(text string) Option {
	return func(a *Application) {
		a.bannerText = text
	}
}

// WithBannerFile sets the banner file path.
func WithBannerFile(filename string) Option {
	return func(a *Application) {
		a.bannerFile = filename
	}
}

// WithShutdownTimeout sets the graceful shutdown timeout.
func WithShutdownTimeout(d time.Duration) Option {
	return func(a *Application) {
		a.shutdownTimeout = d
		a.shutdown.SetTimeout(d)
	}
}

// WithOutput sets the output writer for banner and logs.
func WithOutput(w io.Writer) Option {
	return func(a *Application) {
		a.output = w
	}
}

// WithProperties loads properties from a map.
func WithProperties(m map[string]string) Option {
	return func(a *Application) {
		a.properties.LoadFromMap(m)
	}
}

// WithEnvProperties loads properties from environment variables with the
// given prefix.
func WithEnvProperties(prefix string) Option {
	return func(a *Application) {
		a.properties.LoadFromEnv(prefix)
	}
}

// Register adds a component to the registry. If the component implements
// Lifecycle, it is also registered with the lifecycle manager.
func (a *Application) Register(name string, component any) error {
	if err := a.registry.Register(name, component); err != nil {
		return err
	}
	if lc, ok := component.(Lifecycle); ok {
		a.lifecycle.AddLifecycle(name, lc)
	}
	return nil
}

// MustRegister is like Register but panics on error.
func (a *Application) MustRegister(name string, component any) {
	if err := a.Register(name, component); err != nil {
		panic(err)
	}
}

// AddInitHook registers an init hook.
func (a *Application) AddInitHook(name string, fn InitHook) {
	a.lifecycle.AddInitHook(name, fn)
}

// AddShutdownHook registers a shutdown hook.
func (a *Application) AddShutdownHook(name string, fn ShutdownHook) {
	a.shutdown.AddHook(name, fn)
}

// OnEvent subscribes to an application event.
func (a *Application) OnEvent(eventName string, handler eventbus.Handler) eventbus.Subscription {
	return a.events.Subscribe(eventName, handler)
}

// Registry returns the component registry.
func (a *Application) Registry() *Registry { return a.registry }

// Lifecycle returns the lifecycle manager.
func (a *Application) Lifecycle() *LifecycleManager { return a.lifecycle }

// Profiles returns the profile manager.
func (a *Application) Profiles() *ProfileManager { return a.profiles }

// Properties returns the application properties.
func (a *Application) Properties() *Properties { return a.properties }

// Events returns the event bus.
func (a *Application) Events() eventbus.Bus { return a.events }

// Name returns the application name.
func (a *Application) Name() string { return a.name }

// Status returns the current application status.
func (a *Application) Status() AppStatus {
	return AppStatus(a.status.Load())
}

// StartTime returns when the application was started.
func (a *Application) StartTime() time.Time { return a.startTime }

// Uptime returns how long the application has been running.
func (a *Application) Uptime() time.Duration {
	if a.startTime.IsZero() {
		return 0
	}
	return time.Since(a.startTime)
}

// Run starts the application and blocks until a shutdown signal is received.
// This is the main entry point, analogous to SpringApplication.run().
func (a *Application) Run() error {
	ctx := context.Background()

	// Print banner
	a.printBanner()

	// Phase: Initializing
	a.setStatus(StatusInitializing)
	a.events.Publish(ctx, eventbus.New(EventAppStarting, a))

	// Run database migrations (if configured) before init hooks.
	if err := a.runMigrations(ctx); err != nil {
		a.setStatus(StatusFailed)
		a.events.Publish(ctx, eventbus.New(EventAppFailed, a))
		return fmt.Errorf("migration phase failed: %w", err)
	}

	if err := a.lifecycle.Init(ctx); err != nil {
		a.setStatus(StatusFailed)
		a.events.Publish(ctx, eventbus.New(EventAppFailed, a))
		return fmt.Errorf("init phase failed: %w", err)
	}

	// Phase: Starting
	a.setStatus(StatusStarting)
	a.startTime = time.Now()

	if err := a.lifecycle.Start(ctx); err != nil {
		a.setStatus(StatusFailed)
		a.events.Publish(ctx, eventbus.New(EventAppFailed, a))
		return fmt.Errorf("start phase failed: %w", err)
	}

	// Phase: Running
	a.setStatus(StatusRunning)
	a.events.Publish(ctx, eventbus.New(EventAppStarted, a))
	a.events.Publish(ctx, eventbus.New(EventAppReady, a))

	logger.Infof("[app] %s started (profile=%v, components=%d, uptime=%s)",
		a.name, a.profiles.ActiveProfiles(), a.registry.Count(), a.Uptime())

	// Register shutdown hook to stop lifecycle.
	a.shutdown.AddHook("lifecycle-stop", func(ctx context.Context) error {
		a.setStatus(StatusStopping)
		a.events.Publish(ctx, eventbus.New(EventAppStopping, a))
		if err := a.lifecycle.Stop(ctx); err != nil {
			return err
		}
		a.setStatus(StatusStopped)
		a.events.Publish(ctx, eventbus.New(EventAppStopped, a))
		return nil
	})

	// Block until shutdown signal.
	a.shutdown.WaitForSignal()
	return nil
}

// RunAsync starts the application in a goroutine and returns immediately.
// The returned channel receives an error if startup fails, or nil on
// successful start. Use Stop() to trigger shutdown.
func (a *Application) RunAsync() <-chan error {
	errCh := make(chan error, 1)
	go func() {
		ctx := context.Background()

		a.printBanner()

		a.setStatus(StatusInitializing)
		a.events.Publish(ctx, eventbus.New(EventAppStarting, a))

		// Run database migrations (if configured) before init hooks.
		if err := a.runMigrations(ctx); err != nil {
			a.setStatus(StatusFailed)
			errCh <- fmt.Errorf("migration phase failed: %w", err)
			return
		}

		if err := a.lifecycle.Init(ctx); err != nil {
			a.setStatus(StatusFailed)
			errCh <- fmt.Errorf("init phase failed: %w", err)
			return
		}

		a.setStatus(StatusStarting)
		a.startTime = time.Now()

		if err := a.lifecycle.Start(ctx); err != nil {
			a.setStatus(StatusFailed)
			errCh <- fmt.Errorf("start phase failed: %w", err)
			return
		}

		a.setStatus(StatusRunning)
		a.events.Publish(ctx, eventbus.New(EventAppStarted, a))
		a.events.Publish(ctx, eventbus.New(EventAppReady, a))
		errCh <- nil

		// Register shutdown hook.
		a.shutdown.AddHook("lifecycle-stop", func(ctx context.Context) error {
			a.setStatus(StatusStopping)
			a.events.Publish(ctx, eventbus.New(EventAppStopping, a))
			if err := a.lifecycle.Stop(ctx); err != nil {
				return err
			}
			a.setStatus(StatusStopped)
			a.events.Publish(ctx, eventbus.New(EventAppStopped, a))
			return nil
		})

		a.shutdown.WaitForSignal()
	}()
	return errCh
}

// Stop triggers a graceful shutdown.
func (a *Application) Stop() {
	a.shutdown.Stop()
}

// printBanner prints the application banner with metadata.
func (a *Application) printBanner() {
	info := BannerInfo{
		AppName:   a.name,
		Version:   version.GetVersion(),
		Profile:   joinProfiles(a.profiles.ActiveProfiles()),
		GoVersion: version.GetGoVersion(),
		GitCommit: version.GetGitCommit(),
		BuildTime: version.GetBuildTime(),
		StartTime: time.Now(),
	}
	if err := PrintBannerWithInfoFromFile(a.output, a.bannerText, a.bannerFile, info); err != nil {
		logger.Infof("[app] banner print failed: %v", err)
	}
}

func (a *Application) setStatus(s AppStatus) {
	a.status.Store(int32(s))
}

func joinProfiles(profiles []string) string {
	if len(profiles) == 0 {
		return ""
	}
	result := ""
	for i, p := range profiles {
		if i > 0 {
			result += ", "
		}
		result += p
	}
	return result
}
