// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package tracing provides a reusable, library-friendly wrapper around the
// OpenTelemetry Go SDK for distributed tracing.
//
// It handles the boilerplate of constructing a TracerProvider with a
// configurable exporter (OTLP gRPC, OTLP HTTP, stdout, or no-op), a
// Resource describing the service, a sampler, and W3C Trace Context
// propagation — while leaving the application in full control of when
// to start, flush, and shut down the pipeline.
//
// The Jaeger native exporter is deprecated upstream; Jaeger accepts OTLP
// directly (port 4317 for gRPC, 4318 for HTTP), so this package only
// ships OTLP exporters.
//
// # Quick start
//
//	shutdown, err := tracing.Init(ctx, tracing.Config{
//	    ServiceName:    "my-service",
//	    ServiceVersion: "1.0.0",
//	    Exporter:       tracing.ExporterOTLPGRPC,
//	    OTLPEndpoint:   "localhost:4317",
//	    SampleRatio:    0.1,
//	})
//	if err != nil {
//	    log.Fatal(err)
//	}
//	defer shutdown(ctx)
//
//	// Use the global tracer.
//	ctx, span := tracing.Start(ctx, "operation-name")
//	defer span.End()
//
// # Library usage
//
// Instead of using the global provider, you can create a standalone
// Provider and pass it explicitly:
//
//	tp, shutdown, err := tracing.NewProvider(ctx, config)
//	defer shutdown(ctx)
//	tracer := tp.Tracer("my-library")
package tracing

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/exporters/stdout/stdouttrace"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/trace"
)

// ExporterKind selects which trace exporter to use.
type ExporterKind string

const (
	// ExporterOTLPGRPC sends spans via OTLP over gRPC (default Jaeger/Collector port 4317).
	ExporterOTLPGRPC ExporterKind = "otlp_grpc"
	// ExporterOTLPHTTP sends spans via OTLP over HTTP (default port 4318).
	ExporterOTLPHTTP ExporterKind = "otlp_http"
	// ExporterStdout writes spans to stdout (useful for development).
	ExporterStdout ExporterKind = "stdout"
	// ExporterNoop discards all spans (useful for testing or disabled tracing).
	ExporterNoop ExporterKind = "noop"
)

// Config configures the tracing provider.
type Config struct {
	// ServiceName identifies the emitting service. Required.
	ServiceName string
	// ServiceVersion is the service version (e.g. "1.0.0"). Optional.
	ServiceVersion string
	// ServiceNamespace groups services under a namespace. Optional.
	ServiceNamespace string
	// Environment is the deployment environment (e.g. "production", "staging"). Optional.
	Environment string
	// Exporter selects the exporter kind. Default: ExporterNoop.
	Exporter ExporterKind
	// OTLPEndpoint is the OTLP collector address (e.g. "localhost:4317"). Used
	// for OTLP gRPC and HTTP exporters.
	OTLPEndpoint string
	// OTLPInsecure disables TLS for OTLP connections. Default: true for
	// localhost endpoints, false otherwise.
	OTLPInsecure *bool
	// OTLPHeaders are additional headers sent with OTLP requests.
	OTLPHeaders map[string]string
	// SampleRatio is the probability [0.0, 1.0] of sampling a trace.
	// 1.0 = sample all, 0.0 = sample none. Default: 1.0 (always sample).
	SampleRatio float64
	// SpanBatchTimeout is the maximum delay before a batch of spans is exported.
	// Default: 5s.
	SpanBatchTimeout time.Duration
	// SpanMaxQueueSize is the maximum number of spans buffered before export.
	// Default: 2048.
	SpanMaxQueueSize int
	// SpanMaxExportBatchSize is the maximum number of spans in a single export batch.
	// Default: 512.
	SpanMaxExportBatchSize int
	// ResourceAttributes are additional key-value attributes attached to the
	// resource (e.g. host.name, deployment.environment).
	ResourceAttributes map[string]string
	// SetGlobal registers the provider as the global TracerProvider. Default: true.
	SetGlobal bool
}

// DefaultConfig returns a Config with sensible defaults.
func DefaultConfig() Config {
	return Config{
		ServiceName:            "unknown-service",
		Exporter:               ExporterNoop,
		SampleRatio:            1.0,
		SpanBatchTimeout:       5 * time.Second,
		SpanMaxQueueSize:       2048,
		SpanMaxExportBatchSize: 512,
		SetGlobal:              true,
	}
}

// Provider wraps an sdktrace.TracerProvider with its shutdown function.
type Provider struct {
	tp         *sdktrace.TracerProvider
	tracer     trace.Tracer
	resource   *resource.Resource
	shutdown   func(context.Context) error
	shutdownMu sync.Mutex
}

// TracerProvider returns the underlying SDK TracerProvider.
func (p *Provider) TracerProvider() *sdktrace.TracerProvider {
	return p.tp
}

// Resource returns the OTel Resource associated with this provider.
func (p *Provider) Resource() *resource.Resource {
	return p.resource
}

// Tracer returns a tracer with the configured service name.
func (p *Provider) Tracer() trace.Tracer {
	return p.tracer
}

// Shutdown flushes and shuts down the provider. It is safe to call
// multiple times and from concurrent goroutines.
func (p *Provider) Shutdown(ctx context.Context) error {
	p.shutdownMu.Lock()
	defer p.shutdownMu.Unlock()
	if p.shutdown == nil {
		return nil
	}
	err := p.shutdown(ctx)
	p.shutdown = nil
	return err
}

// Init creates a tracing Provider from the given Config, registers it
// globally (if SetGlobal is true), and returns a shutdown function.
//
// The returned shutdown function flushes pending spans and releases
// resources. It should be called on application exit.
func Init(ctx context.Context, cfg Config) (func(context.Context) error, error) {
	p, err := NewProvider(ctx, cfg)
	if err != nil {
		return nil, err
	}
	if cfg.SetGlobal {
		otel.SetTracerProvider(p.tp)
		otel.SetTextMapPropagator(newPropagator())
	}
	return p.Shutdown, nil
}

// NewProvider creates a tracing Provider without setting globals.
func NewProvider(ctx context.Context, cfg Config) (*Provider, error) {
	if cfg.ServiceName == "" {
		return nil, fmt.Errorf("tracing: ServiceName is required")
	}
	if cfg.SpanBatchTimeout == 0 {
		cfg.SpanBatchTimeout = 5 * time.Second
	}
	if cfg.SpanMaxQueueSize == 0 {
		cfg.SpanMaxQueueSize = 2048
	}
	if cfg.SpanMaxExportBatchSize == 0 {
		cfg.SpanMaxExportBatchSize = 512
	}

	exp, err := newExporter(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("tracing: create exporter: %w", err)
	}

	res, err := newResource(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("tracing: create resource: %w", err)
	}

	sampler := newSampler(cfg.SampleRatio)

	batcherOpts := []sdktrace.BatchSpanProcessorOption{
		sdktrace.WithBatchTimeout(cfg.SpanBatchTimeout),
		sdktrace.WithMaxQueueSize(cfg.SpanMaxQueueSize),
		sdktrace.WithMaxExportBatchSize(cfg.SpanMaxExportBatchSize),
	}

	bsp := sdktrace.NewBatchSpanProcessor(exp, batcherOpts...)

	tp := sdktrace.NewTracerProvider(
		sdktrace.WithSampler(sampler),
		sdktrace.WithResource(res),
		sdktrace.WithSpanProcessor(bsp),
	)

	return &Provider{
		tp:       tp,
		tracer:   tp.Tracer(cfg.ServiceName),
		resource: res,
		shutdown: func(ctx context.Context) error {
			// Stop accepting new spans, then flush.
			if err := tp.Shutdown(ctx); err != nil {
				return fmt.Errorf("tracing: shutdown: %w", err)
			}
			return nil
		},
	}, nil
}

// newExporter creates the trace exporter based on the config.
func newExporter(ctx context.Context, cfg Config) (sdktrace.SpanExporter, error) {
	switch cfg.Exporter {
	case ExporterOTLPGRPC:
		opts := []otlptracegrpc.Option{
			otlptracegrpc.WithEndpoint(cfg.OTLPEndpoint),
		}
		if isInsecure(cfg) {
			opts = append(opts, otlptracegrpc.WithInsecure())
		}
		if len(cfg.OTLPHeaders) > 0 {
			opts = append(opts, otlptracegrpc.WithHeaders(cfg.OTLPHeaders))
		}
		return otlptracegrpc.New(ctx, opts...)
	case ExporterOTLPHTTP:
		opts := []otlptracehttp.Option{
			otlptracehttp.WithEndpoint(cfg.OTLPEndpoint),
		}
		if isInsecure(cfg) {
			opts = append(opts, otlptracehttp.WithInsecure())
		}
		if len(cfg.OTLPHeaders) > 0 {
			opts = append(opts, otlptracehttp.WithHeaders(cfg.OTLPHeaders))
		}
		return otlptracehttp.New(ctx, opts...)
	case ExporterStdout:
		return stdouttrace.New(stdouttrace.WithPrettyPrint())
	case ExporterNoop, "":
		return nil, nil // No exporter — spans are still sampled but discarded.
	default:
		return nil, fmt.Errorf("tracing: unknown exporter kind: %q", cfg.Exporter)
	}
}

// isInsecure determines whether to use an insecure (non-TLS) connection.
func isInsecure(cfg Config) bool {
	if cfg.OTLPInsecure != nil {
		return *cfg.OTLPInsecure
	}
	// Default to insecure for localhost endpoints.
	return cfg.OTLPEndpoint == "" || isLocalhost(cfg.OTLPEndpoint)
}

// isLocalhost checks if the endpoint refers to a local address.
func isLocalhost(endpoint string) bool {
	if endpoint == "" {
		return false
	}
	return strings.HasPrefix(endpoint, "localhost") ||
		strings.HasPrefix(endpoint, "127.") ||
		strings.HasPrefix(endpoint, "0.0.0.0:") ||
		strings.HasPrefix(endpoint, "[::1]") ||
		strings.HasPrefix(endpoint, "::1")
}

// newResource constructs an OTel Resource from the config.
func newResource(ctx context.Context, cfg Config) (*resource.Resource, error) {
	opts := []resource.Option{
		resource.WithFromEnv(),    // Pull OTEL_RESOURCE_ATTRIBUTES from env.
		resource.WithHost(),       // Add host.name.
		resource.WithProcessPID(), // Add process.pid.
		resource.WithProcessRuntimeName(),
		resource.WithProcessRuntimeVersion(),
		resource.WithTelemetrySDK(), // Add telemetry.sdk.* attributes.
	}

	baseRes, err := resource.New(ctx, opts...)
	if err != nil {
		return nil, err
	}

	// Merge with service-specific attributes.
	svcRes := resource.NewSchemaless(toKeyValues(cfg)...)

	return resource.Merge(baseRes, svcRes)
}

// newSampler creates a sampler based on the sample ratio.
func newSampler(ratio float64) sdktrace.Sampler {
	if ratio <= 0 {
		return sdktrace.NeverSample()
	}
	if ratio >= 1 {
		return sdktrace.AlwaysSample()
	}
	return sdktrace.TraceIDRatioBased(ratio)
}

// newPropagator returns the W3C Trace Context + Baggage propagator.
func newPropagator() propagation.TextMapPropagator {
	return propagation.NewCompositeTextMapPropagator(
		propagation.TraceContext{},
		propagation.Baggage{},
	)
}

// ──────────────────────────────────────────────
// Convenience functions (use the global TracerProvider)
// ──────────────────────────────────────────────

// Start starts a new span using the global TracerProvider.
// It returns the context with the span and the span itself.
//
//	func myHandler(ctx context.Context) {
//	    ctx, span := tracing.Start(ctx, "myHandler")
//	    defer span.End()
//	    ...
//	}
func Start(ctx context.Context, spanName string, opts ...trace.SpanStartOption) (context.Context, trace.Span) {
	return otel.Tracer("github.com/LingByte/ling-base/common/tracing").Start(ctx, spanName, opts...)
}

// SpanFromContext returns the active span from the context, or a no-op
// span if no span is active.
func SpanFromContext(ctx context.Context) trace.Span {
	return trace.SpanFromContext(ctx)
}

// ContextWithSpan returns a new context with the given span set.
func ContextWithSpan(ctx context.Context, span trace.Span) context.Context {
	return trace.ContextWithSpan(ctx, span)
}

// Inject injects the current trace context into the carrier (e.g. HTTP headers).
func Inject(ctx context.Context, carrier propagation.TextMapCarrier) {
	otel.GetTextMapPropagator().Inject(ctx, carrier)
}

// Extract extracts the trace context from the carrier (e.g. HTTP headers).
func Extract(ctx context.Context, carrier propagation.TextMapCarrier) context.Context {
	return otel.GetTextMapPropagator().Extract(ctx, carrier)
}

// IsTracingEnabled returns true if a real (non-noop) TracerProvider is
// registered globally.
func IsTracingEnabled() bool {
	// The global tracer provider is always set (defaults to a noop).
	// We check by seeing if a span started via the global tracer is recorded.
	// A simpler heuristic: if Init was called with a non-noop exporter,
	// the provider is real. This function is a best-effort check.
	tp := otel.GetTracerProvider()
	_, ok := tp.(*sdktrace.TracerProvider)
	return ok
}
