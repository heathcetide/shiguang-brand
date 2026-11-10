// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package opentelemetry provides a unified, one-call setup for OpenTelemetry
// traces, metrics, and logs — the three pillars of observability.
//
// It builds on the standalone `tracing` and `metrics` packages and adds
// the logs signal (still experimental in the OTel Go SDK) to provide a
// single entry point for application bootstrap.
//
// # Quick start
//
//	otelSDK, err := opentelemetry.Init(ctx, opentelemetry.Config{
//	    ServiceName:    "my-service",
//	    ServiceVersion: "1.0.0",
//	    Environment:    "production",
//	    TraceExporter:  opentelemetry.TraceExporterOTLPGRPC,
//	    OTLPEndpoint:   "localhost:4317",
//	    MetricsExporter: opentelemetry.MetricsExporterPrometheus,
//	    LogExporter:    opentelemetry.LogExporterOTLPGRPC,
//	    SampleRatio:    0.1,
//	})
//	if err != nil {
//	    log.Fatal(err)
//	}
//	defer otelSDK.Shutdown(ctx)
//
//	// Expose Prometheus metrics.
//	http.Handle("/metrics", otelSDK.MetricsHTTPHandler())
//	go http.ListenAndServe(":9090", nil)
//
// The package also provides a Zap→OTel logs bridge so that existing
// zap.Logger usage can be forwarded to the OTel logs pipeline.
package opentelemetry

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	promclient "github.com/prometheus/client_golang/prometheus"
	"go.opentelemetry.io/otel/attribute"
	otlploggrpc "go.opentelemetry.io/otel/exporters/otlp/otlplog/otlploggrpc"
	otlploghttp "go.opentelemetry.io/otel/exporters/otlp/otlplog/otlploghttp"
	stdoutlog "go.opentelemetry.io/otel/exporters/stdout/stdoutlog"
	otellog "go.opentelemetry.io/otel/log"
	otellognoop "go.opentelemetry.io/otel/log/noop"
	sdklog "go.opentelemetry.io/otel/sdk/log"
	"go.opentelemetry.io/otel/sdk/resource"
	semconv "go.opentelemetry.io/otel/semconv/v1.26.0"

	"github.com/heathcetide/DietDigiDose/pkg/common/metrics"
	"github.com/heathcetide/DietDigiDose/pkg/common/tracing"
)

// TraceExporterKind selects which trace exporter to use.
type TraceExporterKind = tracing.ExporterKind

const (
	TraceExporterOTLPGRPC = tracing.ExporterOTLPGRPC
	TraceExporterOTLPHTTP = tracing.ExporterOTLPHTTP
	TraceExporterStdout   = tracing.ExporterStdout
	TraceExporterNoop     = tracing.ExporterNoop
)

// MetricsExporterKind selects which metrics exporter to use.
type MetricsExporterKind string

const (
	// MetricsExporterPrometheus exposes metrics via a Prometheus HTTP handler.
	MetricsExporterPrometheus MetricsExporterKind = "prometheus"
	// MetricsExporterNoop discards all metrics.
	MetricsExporterNoop MetricsExporterKind = "noop"
)

// LogExporterKind selects which log exporter to use.
type LogExporterKind string

const (
	// LogExporterOTLPGRPC sends logs via OTLP over gRPC (port 4317).
	LogExporterOTLPGRPC LogExporterKind = "otlp_grpc"
	// LogExporterOTLPHTTP sends logs via OTLP over HTTP (port 4318).
	LogExporterOTLPHTTP LogExporterKind = "otlp_http"
	// LogExporterStdout writes logs to stdout (useful for development).
	LogExporterStdout LogExporterKind = "stdout"
	// LogExporterNoop discards all logs.
	LogExporterNoop LogExporterKind = "noop"
)

// Config configures the unified OTel SDK (traces + metrics + logs).
type Config struct {
	// ── Shared ──
	ServiceName        string
	ServiceVersion     string
	ServiceNamespace   string
	Environment        string
	ResourceAttributes map[string]string

	// ── Tracing ──
	TraceExporter          TraceExporterKind
	OTLPEndpoint           string // used for trace OTLP exporters
	OTLPInsecure           *bool
	OTLPHeaders            map[string]string
	SampleRatio            float64
	SpanBatchTimeout       time.Duration
	SpanMaxQueueSize       int
	SpanMaxExportBatchSize int

	// ── Metrics ──
	MetricsExporter         MetricsExporterKind
	DefaultHistogramBuckets []float64
	PrometheusRegistry      promclient.Registerer
	PrometheusGatherer      promclient.Gatherer

	// ── Logs ──
	LogExporter     LogExporterKind
	LogOTLPEndpoint string // used for log OTLP exporters (defaults to OTLPEndpoint)
	LogOTLPInsecure *bool
	LogOTLPHeaders  map[string]string

	// ── Global ──
	// SetGlobal registers all providers globally. Default: true.
	SetGlobal bool
}

// DefaultConfig returns a Config with sensible defaults.
func DefaultConfig() Config {
	return Config{
		ServiceName:     "unknown-service",
		TraceExporter:   TraceExporterNoop,
		MetricsExporter: MetricsExporterNoop,
		LogExporter:     LogExporterNoop,
		SampleRatio:     1.0,
		SetGlobal:       true,
	}
}

// SDK is the unified OTel SDK handle. It holds the trace provider, metrics
// provider, and log provider, and provides a single Shutdown method.
type SDK struct {
	Traces  *tracing.Provider
	Metrics *metrics.Provider
	Logs    *LogProvider

	shutdownMu sync.Mutex
	shutdown   func(context.Context) error
}

// LogProvider wraps an SDK LoggerProvider.
type LogProvider struct {
	lp         *sdklog.LoggerProvider
	logger     otellog.Logger
	shutdown   func(context.Context) error
	shutdownMu sync.Mutex
}

// LoggerProvider returns the underlying SDK LoggerProvider.
func (p *LogProvider) LoggerProvider() *sdklog.LoggerProvider {
	return p.lp
}

// Logger returns a logger with the configured service name.
func (p *LogProvider) Logger() otellog.Logger {
	return p.logger
}

// Shutdown flushes and shuts down the log provider. It is safe to call
// multiple times and from concurrent goroutines.
func (p *LogProvider) Shutdown(ctx context.Context) error {
	p.shutdownMu.Lock()
	defer p.shutdownMu.Unlock()
	if p.shutdown == nil {
		return nil
	}
	err := p.shutdown(ctx)
	p.shutdown = nil
	return err
}

// MetricsHTTPHandler returns the Prometheus HTTP handler from the metrics
// provider, or nil if metrics are not enabled.
func (s *SDK) MetricsHTTPHandler() http.Handler {
	if s.Metrics == nil {
		return nil
	}
	return s.Metrics.HTTPHandler()
}

// Shutdown flushes and shuts down all providers (traces, metrics, logs).
// It is safe to call multiple times.
func (s *SDK) Shutdown(ctx context.Context) error {
	s.shutdownMu.Lock()
	defer s.shutdownMu.Unlock()
	if s.shutdown == nil {
		return nil
	}
	err := s.shutdown(ctx)
	s.shutdown = nil
	return err
}

// Init creates a unified OTel SDK from the given Config and registers all
// providers globally (if SetGlobal is true).
func Init(ctx context.Context, cfg Config) (*SDK, error) {
	if cfg.ServiceName == "" {
		return nil, fmt.Errorf("opentelemetry: ServiceName is required")
	}

	sdk := &SDK{}
	var shutdowns []func(context.Context) error

	// Combine all shutdowns.
	sdk.shutdown = func(ctx context.Context) error {
		var errs []error
		for _, fn := range shutdowns {
			if err := fn(ctx); err != nil {
				errs = append(errs, err)
			}
		}
		if len(errs) > 0 {
			return fmt.Errorf("opentelemetry: shutdown errors: %v", errs)
		}
		return nil
	}

	// ── Traces ──
	traceCfg := tracing.Config{
		ServiceName:            cfg.ServiceName,
		ServiceVersion:         cfg.ServiceVersion,
		ServiceNamespace:       cfg.ServiceNamespace,
		Environment:            cfg.Environment,
		ResourceAttributes:     cfg.ResourceAttributes,
		Exporter:               cfg.TraceExporter,
		OTLPEndpoint:           cfg.OTLPEndpoint,
		OTLPInsecure:           cfg.OTLPInsecure,
		OTLPHeaders:            cfg.OTLPHeaders,
		SampleRatio:            cfg.SampleRatio,
		SpanBatchTimeout:       cfg.SpanBatchTimeout,
		SpanMaxQueueSize:       cfg.SpanMaxQueueSize,
		SpanMaxExportBatchSize: cfg.SpanMaxExportBatchSize,
		SetGlobal:              cfg.SetGlobal,
	}
	// Create a single tracing provider. We use NewProvider (not Init) to
	// get the Provider handle, then set the global ourselves if needed.
	// This avoids creating two separate providers.
	tp, err := tracing.NewProvider(ctx, traceCfg)
	if err != nil {
		_ = sdk.Shutdown(ctx)
		return nil, fmt.Errorf("opentelemetry: init tracing: %w", err)
	}
	sdk.Traces = tp
	shutdowns = append(shutdowns, tp.Shutdown)

	if cfg.SetGlobal {
		setGlobalTracerProvider(tp.TracerProvider())
		setGlobalTextMapPropagator()
	}

	// ── Metrics ──
	if cfg.MetricsExporter == MetricsExporterPrometheus {
		metricsCfg := metrics.Config{
			ServiceName:             cfg.ServiceName,
			ServiceVersion:          cfg.ServiceVersion,
			ServiceNamespace:        cfg.ServiceNamespace,
			Environment:             cfg.Environment,
			ResourceAttributes:      cfg.ResourceAttributes,
			DefaultHistogramBuckets: cfg.DefaultHistogramBuckets,
			SetGlobal:               cfg.SetGlobal,
			PrometheusRegistry:      cfg.PrometheusRegistry,
			PrometheusGatherer:      cfg.PrometheusGatherer,
		}
		mp, err := metrics.Init(metricsCfg)
		if err != nil {
			_ = sdk.Shutdown(ctx)
			return nil, fmt.Errorf("opentelemetry: init metrics: %w", err)
		}
		sdk.Metrics = mp
		shutdowns = append(shutdowns, mp.Shutdown)
	}

	// ── Logs ──
	// LogOTLPEndpoint defaults to OTLPEndpoint if not explicitly set.
	logEndpoint := cfg.LogOTLPEndpoint
	if logEndpoint == "" {
		logEndpoint = cfg.OTLPEndpoint
	}
	logCfg := logConfig{
		ServiceName:        cfg.ServiceName,
		ServiceVersion:     cfg.ServiceVersion,
		ServiceNamespace:   cfg.ServiceNamespace,
		Environment:        cfg.Environment,
		Exporter:           cfg.LogExporter,
		OTLPEndpoint:       logEndpoint,
		OTLPInsecure:       cfg.LogOTLPInsecure,
		OTLPHeaders:        cfg.LogOTLPHeaders,
		ResourceAttributes: cfg.ResourceAttributes,
	}
	lp, err := newLogProvider(ctx, logCfg)
	if err != nil {
		_ = sdk.Shutdown(ctx)
		return nil, fmt.Errorf("opentelemetry: init logs: %w", err)
	}
	sdk.Logs = lp
	shutdowns = append(shutdowns, lp.Shutdown)

	if cfg.SetGlobal {
		setGlobalLoggerProvider(lp.lp)
	}

	return sdk, nil
}

// ──────────────────────────────────────────────
// Log provider
// ──────────────────────────────────────────────

type logConfig struct {
	ServiceName        string
	ServiceVersion     string
	ServiceNamespace   string
	Environment        string
	Exporter           LogExporterKind
	OTLPEndpoint       string
	OTLPInsecure       *bool
	OTLPHeaders        map[string]string
	ResourceAttributes map[string]string
}

func newLogProvider(ctx context.Context, cfg logConfig) (*LogProvider, error) {
	if cfg.Exporter == LogExporterNoop || cfg.Exporter == "" {
		return &LogProvider{
			lp:     nil, // No provider — logs are no-ops.
			logger: otellognoop.NewLoggerProvider().Logger(cfg.ServiceName),
		}, nil
	}

	exp, err := newLogExporter(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("create log exporter: %w", err)
	}

	res, err := newLogResource(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("create log resource: %w", err)
	}

	lp := sdklog.NewLoggerProvider(
		sdklog.WithResource(res),
		sdklog.WithProcessor(sdklog.NewBatchProcessor(exp)),
	)

	return &LogProvider{
		lp:     lp,
		logger: lp.Logger(cfg.ServiceName),
		shutdown: func(ctx context.Context) error {
			return lp.Shutdown(ctx)
		},
	}, nil
}

func newLogExporter(ctx context.Context, cfg logConfig) (sdklog.Exporter, error) {
	endpoint := cfg.OTLPEndpoint
	if endpoint == "" {
		endpoint = "localhost:4317"
	}

	switch cfg.Exporter {
	case LogExporterOTLPGRPC:
		opts := []otlploggrpc.Option{
			otlploggrpc.WithEndpoint(endpoint),
		}
		if isInsecureLog(cfg) {
			opts = append(opts, otlploggrpc.WithInsecure())
		}
		if len(cfg.OTLPHeaders) > 0 {
			opts = append(opts, otlploggrpc.WithHeaders(cfg.OTLPHeaders))
		}
		return otlploggrpc.New(ctx, opts...)
	case LogExporterOTLPHTTP:
		opts := []otlploghttp.Option{
			otlploghttp.WithEndpoint(endpoint),
		}
		if isInsecureLog(cfg) {
			opts = append(opts, otlploghttp.WithInsecure())
		}
		if len(cfg.OTLPHeaders) > 0 {
			opts = append(opts, otlploghttp.WithHeaders(cfg.OTLPHeaders))
		}
		return otlploghttp.New(ctx, opts...)
	case LogExporterStdout:
		return stdoutlog.New(stdoutlog.WithPrettyPrint())
	default:
		return nil, fmt.Errorf("unknown log exporter kind: %q", cfg.Exporter)
	}
}

func isInsecureLog(cfg logConfig) bool {
	if cfg.OTLPInsecure != nil {
		return *cfg.OTLPInsecure
	}
	return cfg.OTLPEndpoint == "" || isLocalhostLog(cfg.OTLPEndpoint)
}

func isLocalhostLog(endpoint string) bool {
	if endpoint == "" {
		return false
	}
	return strings.HasPrefix(endpoint, "localhost") ||
		strings.HasPrefix(endpoint, "127.") ||
		strings.HasPrefix(endpoint, "0.0.0.0:") ||
		strings.HasPrefix(endpoint, "[::1]") ||
		strings.HasPrefix(endpoint, "::1")
}

func newLogResource(ctx context.Context, cfg logConfig) (*resource.Resource, error) {
	opts := []resource.Option{
		resource.WithFromEnv(),
		resource.WithHost(),
		resource.WithProcessPID(),
		resource.WithProcessRuntimeName(),
		resource.WithProcessRuntimeVersion(),
		resource.WithTelemetrySDK(),
	}

	baseRes, err := resource.New(ctx, opts...)
	if err != nil {
		return nil, err
	}

	svcRes := resource.NewSchemaless(toLogKeyValues(cfg)...)
	return resource.Merge(baseRes, svcRes)
}

func toLogKeyValues(cfg logConfig) []attribute.KeyValue {
	attrs := []attribute.KeyValue{
		semconv.ServiceNameKey.String(cfg.ServiceName),
	}
	if cfg.ServiceVersion != "" {
		attrs = append(attrs, semconv.ServiceVersionKey.String(cfg.ServiceVersion))
	}
	if cfg.ServiceNamespace != "" {
		attrs = append(attrs, semconv.ServiceNamespaceKey.String(cfg.ServiceNamespace))
	}
	if cfg.Environment != "" {
		attrs = append(attrs, semconv.DeploymentEnvironmentKey.String(cfg.Environment))
	}
	for k, v := range cfg.ResourceAttributes {
		attrs = append(attrs, attribute.String(k, v))
	}
	return attrs
}
