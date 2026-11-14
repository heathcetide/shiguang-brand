// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package opentelemetry

import (
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/log/global"
	"go.opentelemetry.io/otel/propagation"
	sdklog "go.opentelemetry.io/otel/sdk/log"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
)

// setGlobalTracerProvider registers the tracer provider globally.
func setGlobalTracerProvider(tp *sdktrace.TracerProvider) {
	if tp == nil {
		return
	}
	otel.SetTracerProvider(tp)
}

// setGlobalTextMapPropagator sets the W3C Trace Context + Baggage propagator.
func setGlobalTextMapPropagator() {
	otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(
		propagation.TraceContext{},
		propagation.Baggage{},
	))
}

// setGlobalLoggerProvider registers the logger provider globally.
func setGlobalLoggerProvider(lp *sdklog.LoggerProvider) {
	if lp == nil {
		return
	}
	global.SetLoggerProvider(lp)
}
