// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package metrics

import (
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	otelmetric "go.opentelemetry.io/otel/metric"
)

// otelSetGlobalMeterProvider registers the provider globally.
func otelSetGlobalMeterProvider(mp otelmetric.MeterProvider) {
	otel.SetMeterProvider(mp)
}

// otelmetricGetter returns the global MeterProvider.
func otelmetricGetter() otelmetric.MeterProvider {
	return otel.GetMeterProvider()
}

// KeyValue creates an attribute.KeyValue from a string key and string value.
// This is a convenience helper for common metric attribute usage.
func KeyValue(key, value string) attribute.KeyValue {
	return attribute.String(key, value)
}

// KeyInt creates an attribute.KeyValue from a string key and int value.
func KeyInt(key string, value int) attribute.KeyValue {
	return attribute.Int(key, value)
}

// KeyFloat creates an attribute.KeyValue from a string key and float64 value.
func KeyFloat(key string, value float64) attribute.KeyValue {
	return attribute.Float64(key, value)
}

// KeyBool creates an attribute.KeyValue from a string key and bool value.
func KeyBool(key string, value bool) attribute.KeyValue {
	return attribute.Bool(key, value)
}
