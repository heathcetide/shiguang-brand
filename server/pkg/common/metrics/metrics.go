// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package metrics provides a reusable, library-friendly wrapper around the
// OpenTelemetry Go metrics SDK with a Prometheus exporter.
//
// It handles the boilerplate of constructing a MeterProvider with a
// Prometheus exporter, a Resource describing the service, and custom
// histogram bucket boundaries — while exposing the full OpenTelemetry
// metric API (Counter, Histogram, Gauge, UpDownCounter) for application
// code.
//
// A Prometheus-compatible HTTP handler is provided for the /metrics
// endpoint.
//
// # Quick start
//
//	provider, err := metrics.Init(metrics.Config{
//	    ServiceName:    "my-service",
//	    ServiceVersion: "1.0.0",
//	})
//	if err != nil {
//	    log.Fatal(err)
//	}
//	defer provider.Shutdown(ctx)
//
//	// Register the /metrics endpoint.
//	http.Handle("/metrics", provider.HTTPHandler())
//	go http.ListenAndServe(":9090", nil)
//
//	// Create and use instruments.
//	counter, _ := provider.Meter().Float64Counter("requests_total",
//	    metric.WithDescription("Total number of requests"))
//	counter.Add(ctx, 1)
package metrics

import (
	"context"
	"fmt"
	"net/http"
	"sync"
	"time"

	promclient "github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"go.opentelemetry.io/otel/attribute"
	otelprom "go.opentelemetry.io/otel/exporters/prometheus"
	otelmetric "go.opentelemetry.io/otel/metric"
	"go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/resource"
	semconv "go.opentelemetry.io/otel/semconv/v1.26.0"
)

// Config configures the metrics provider.
type Config struct {
	// ServiceName identifies the emitting service. Required.
	ServiceName string
	// ServiceVersion is the service version. Optional.
	ServiceVersion string
	// ServiceNamespace groups services under a namespace. Optional.
	ServiceNamespace string
	// Environment is the deployment environment. Optional.
	Environment string
	// ResourceAttributes are additional key-value attributes attached to the
	// resource.
	ResourceAttributes map[string]string
	// DefaultHistogramBuckets sets the default bucket boundaries for ALL
	// histograms that don't specify their own. If empty, the OpenTelemetry
	// default buckets are used.
	DefaultHistogramBuckets []float64
	// SetGlobal registers the provider as the global MeterProvider. Default: true.
	SetGlobal bool
	// PrometheusRegistry is the Prometheus registry to use. If nil, a new
	// private registry is created (not the global default).
	PrometheusRegistry promclient.Registerer
	// PrometheusGatherer is the Prometheus gatherer to use. If nil, a new
	// private gatherer is created.
	PrometheusGatherer promclient.Gatherer
}

// DefaultConfig returns a Config with sensible defaults.
func DefaultConfig() Config {
	return Config{
		ServiceName: "unknown-service",
		SetGlobal:   true,
	}
}

// DefaultHTTPBuckets are the default histogram buckets for HTTP request
// duration (in seconds).
var DefaultHTTPBuckets = []float64{
	0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
}

// Provider wraps an SDK MeterProvider with its Prometheus exporter and
// HTTP handler.
type Provider struct {
	mp         *metric.MeterProvider
	meter      otelmetric.Meter
	exporter   *otelprom.Exporter
	handler    http.Handler
	shutdown   func(context.Context) error
	shutdownMu sync.Mutex
}

// MeterProvider returns the underlying SDK MeterProvider.
func (p *Provider) MeterProvider() *metric.MeterProvider {
	return p.mp
}

// Meter returns a meter with the configured service name.
func (p *Provider) Meter() otelmetric.Meter {
	return p.meter
}

// HTTPHandler returns an http.Handler that exposes the Prometheus metrics.
// Use it with http.Handle("/metrics", provider.HTTPHandler()).
func (p *Provider) HTTPHandler() http.Handler {
	return p.handler
}

// Exporter returns the underlying Prometheus exporter.
func (p *Provider) Exporter() *otelprom.Exporter {
	return p.exporter
}

// Shutdown flushes and shuts down the provider. It is safe to call multiple times.
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

// Init creates a metrics Provider from the given Config, registers it
// globally (if SetGlobal is true), and returns the provider.
//
// Call Shutdown on the returned provider on application exit.
func Init(cfg Config) (*Provider, error) {
	p, err := NewProvider(cfg)
	if err != nil {
		return nil, err
	}
	if cfg.SetGlobal {
		otelSetGlobalMeterProvider(p.mp)
	}
	return p, nil
}

// NewProvider creates a metrics Provider without setting globals.
func NewProvider(cfg Config) (*Provider, error) {
	if cfg.ServiceName == "" {
		return nil, fmt.Errorf("metrics: ServiceName is required")
	}

	// Use a private Prometheus registry by default to avoid polluting the
	// global registry.
	reg := cfg.PrometheusRegistry
	gatherer := cfg.PrometheusGatherer
	if reg == nil || gatherer == nil {
		promReg := promclient.NewRegistry()
		if reg == nil {
			reg = promReg
		}
		if gatherer == nil {
			gatherer = promReg
		}
	}

	// Build the OTel Prometheus exporter.
	exporterOpts := []otelprom.Option{
		otelprom.WithRegisterer(reg),
	}
	if len(cfg.DefaultHistogramBuckets) > 0 {
		exporterOpts = append(exporterOpts,
			otelprom.WithAggregationSelector(
				histogramBucketsSelector(cfg.DefaultHistogramBuckets)))
	}
	exporter, err := otelprom.New(exporterOpts...)
	if err != nil {
		return nil, fmt.Errorf("metrics: create prometheus exporter: %w", err)
	}

	// Build the resource.
	res, err := newResource(context.Background(), cfg)
	if err != nil {
		return nil, fmt.Errorf("metrics: create resource: %w", err)
	}

	// Build the MeterProvider.
	mp := metric.NewMeterProvider(
		metric.WithResource(res),
		metric.WithReader(exporter),
	)

	// Build the Prometheus HTTP handler.
	handler := promhttp.HandlerFor(gatherer, promhttp.HandlerOpts{
		Registry:          reg,
		EnableOpenMetrics: true,
	})

	return &Provider{
		mp:       mp,
		meter:    mp.Meter(cfg.ServiceName),
		exporter: exporter,
		handler:  handler,
		shutdown: func(ctx context.Context) error {
			return mp.Shutdown(ctx)
		},
	}, nil
}

// histogramBucketsSelector returns a view option that applies custom bucket
// boundaries to all histogram instruments.
func histogramBucketsSelector(buckets []float64) metric.AggregationSelector {
	return func(inst metric.InstrumentKind) metric.Aggregation {
		if inst == metric.InstrumentKindHistogram {
			return metric.AggregationExplicitBucketHistogram{
				Boundaries: buckets,
			}
		}
		return metric.DefaultAggregationSelector(inst)
	}
}

// newResource constructs an OTel Resource from the config.
func newResource(ctx context.Context, cfg Config) (*resource.Resource, error) {
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

	svcRes := resource.NewSchemaless(toKeyValues(cfg)...)
	return resource.Merge(baseRes, svcRes)
}

// toKeyValues converts the Config into a slice of attribute.KeyValue.
func toKeyValues(cfg Config) []attribute.KeyValue {
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

// ──────────────────────────────────────────────
// Convenience instrument creators (use the global MeterProvider)
// ──────────────────────────────────────────────

// Float64Counter creates a float64 counter using the global MeterProvider.
func Float64Counter(name string, opts ...otelmetric.Float64CounterOption) (otelmetric.Float64Counter, error) {
	return otelmetricGetter().Meter("github.com/LingByte/ling-base/common/metrics").Float64Counter(name, opts...)
}

// Int64Counter creates an int64 counter using the global MeterProvider.
func Int64Counter(name string, opts ...otelmetric.Int64CounterOption) (otelmetric.Int64Counter, error) {
	return otelmetricGetter().Meter("github.com/LingByte/ling-base/common/metrics").Int64Counter(name, opts...)
}

// Float64Histogram creates a float64 histogram using the global MeterProvider.
func Float64Histogram(name string, opts ...otelmetric.Float64HistogramOption) (otelmetric.Float64Histogram, error) {
	return otelmetricGetter().Meter("github.com/LingByte/ling-base/common/metrics").Float64Histogram(name, opts...)
}

// Int64Histogram creates an int64 histogram using the global MeterProvider.
func Int64Histogram(name string, opts ...otelmetric.Int64HistogramOption) (otelmetric.Int64Histogram, error) {
	return otelmetricGetter().Meter("github.com/LingByte/ling-base/common/metrics").Int64Histogram(name, opts...)
}

// Float64ObservableGauge creates a float64 observable gauge using the global MeterProvider.
func Float64ObservableGauge(name string, opts ...otelmetric.Float64ObservableGaugeOption) (otelmetric.Float64ObservableGauge, error) {
	return otelmetricGetter().Meter("github.com/LingByte/ling-base/common/metrics").Float64ObservableGauge(name, opts...)
}

// Int64ObservableGauge creates an int64 observable gauge using the global MeterProvider.
func Int64ObservableGauge(name string, opts ...otelmetric.Int64ObservableGaugeOption) (otelmetric.Int64ObservableGauge, error) {
	return otelmetricGetter().Meter("github.com/LingByte/ling-base/common/metrics").Int64ObservableGauge(name, opts...)
}

// Float64UpDownCounter creates a float64 up-down counter using the global MeterProvider.
func Float64UpDownCounter(name string, opts ...otelmetric.Float64UpDownCounterOption) (otelmetric.Float64UpDownCounter, error) {
	return otelmetricGetter().Meter("github.com/LingByte/ling-base/common/metrics").Float64UpDownCounter(name, opts...)
}

// Int64UpDownCounter creates an int64 up-down counter using the global MeterProvider.
func Int64UpDownCounter(name string, opts ...otelmetric.Int64UpDownCounterOption) (otelmetric.Int64UpDownCounter, error) {
	return otelmetricGetter().Meter("github.com/LingByte/ling-base/common/metrics").Int64UpDownCounter(name, opts...)
}

// ──────────────────────────────────────────────
// HTTP middleware helper
// ──────────────────────────────────────────────

// HTTPMiddleware is an HTTP middleware that records request duration and
// count metrics. It uses the provider's meter to create the instruments.
type HTTPMiddleware struct {
	requestsTotal   otelmetric.Int64Counter
	requestDuration otelmetric.Float64Histogram
}

// NewHTTPMiddleware creates an HTTP metrics middleware.
func NewHTTPMiddleware(p *Provider) (*HTTPMiddleware, error) {
	meter := p.Meter()
	requestsTotal, err := meter.Int64Counter("http_requests_total",
		otelmetric.WithDescription("Total number of HTTP requests"))
	if err != nil {
		return nil, fmt.Errorf("metrics: create http_requests_total: %w", err)
	}
	requestDuration, err := meter.Float64Histogram("http_request_duration_seconds",
		otelmetric.WithDescription("HTTP request duration in seconds"),
		otelmetric.WithExplicitBucketBoundaries(DefaultHTTPBuckets...))
	if err != nil {
		return nil, fmt.Errorf("metrics: create http_request_duration_seconds: %w", err)
	}
	return &HTTPMiddleware{
		requestsTotal:   requestsTotal,
		requestDuration: requestDuration,
	}, nil
}

// Wrap wraps an http.Handler with metrics instrumentation.
// The following attributes are recorded on both instruments:
//   - method: HTTP method (GET, POST, ...)
//   - status: HTTP status code as a string (e.g. "200", "404")
//   - path: request URL path
func (m *HTTPMiddleware) Wrap(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		ww := &statusWriter{ResponseWriter: w, status: 200}
		next.ServeHTTP(ww, r)
		duration := time.Since(start).Seconds()

		attrs := otelmetric.WithAttributes(
			attribute.String("method", r.Method),
			attribute.String("status", statusLabel(ww.status)),
			attribute.String("path", r.URL.Path),
		)
		m.requestsTotal.Add(r.Context(), 1, attrs)
		m.requestDuration.Record(r.Context(), duration, attrs)
	})
}

// statusLabel converts an HTTP status code to a label value.
// Common status codes are returned as-is; unknown codes are grouped
// into "5xx", "4xx", etc. for cardinality control.
func statusLabel(status int) string {
	if status <= 0 {
		return "unknown"
	}
	switch {
	case status < 200:
		return "1xx"
	case status < 300:
		return "2xx"
	case status < 400:
		return "3xx"
	case status < 500:
		return "4xx"
	default:
		return "5xx"
	}
}

// statusWriter tracks the HTTP response status code.
type statusWriter struct {
	http.ResponseWriter
	status int
}

func (w *statusWriter) WriteHeader(status int) {
	w.status = status
	w.ResponseWriter.WriteHeader(status)
}

// Unwrap returns the underlying ResponseWriter, enabling compatibility
// with http.ResponseController (Go 1.20+).
func (w *statusWriter) Unwrap() http.ResponseWriter {
	return w.ResponseWriter
}
