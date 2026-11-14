// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package convert

import (
	"encoding/json"
	"fmt"
	"reflect"
)

// ──────────────────────────────────────────────
// Deep copy / clone
// ──────────────────────────────────────────────

// DeepCopy creates a deep copy of v via JSON round-trip. Returns nil if
// the value cannot be marshaled. This is suitable for structs, maps,
// slices, and primitives. Unexported fields are NOT copied (JSON does
// not see them).
func DeepCopy[T any](v T) T {
	b, err := json.Marshal(v)
	if err != nil {
		var zero T
		return zero
	}
	var result T
	_ = json.Unmarshal(b, &result)
	return result
}

// CopyJSON creates a deep copy of v via JSON round-trip into a new value
// of the same type. Returns an error if marshaling or unmarshaling fails.
func CopyJSON(v any) (any, error) {
	b, err := json.Marshal(v)
	if err != nil {
		return nil, fmt.Errorf("convert: copy marshal: %w", err)
	}
	// Decode into generic any to preserve structure.
	var result any
	if err := json.Unmarshal(b, &result); err != nil {
		return nil, fmt.Errorf("convert: copy unmarshal: %w", err)
	}
	return result, nil
}

// Clone is a type-safe deep copy that returns the same type as input.
// Uses JSON round-trip, so unexported fields are not preserved.
func Clone[T any](v T) (T, error) {
	b, err := json.Marshal(v)
	if err != nil {
		var zero T
		return zero, fmt.Errorf("convert: clone marshal: %w", err)
	}
	var result T
	if err := json.Unmarshal(b, &result); err != nil {
		var zero T
		return zero, fmt.Errorf("convert: clone unmarshal: %w", err)
	}
	return result, nil
}

// ──────────────────────────────────────────────
// Map utilities
// ──────────────────────────────────────────────

// ToMapStringString converts any map to map[string]string. Values are
// converted via ToString. Keys are converted via ToString.
func ToMapStringString(v any) (map[string]string, error) {
	if v == nil {
		return nil, nil
	}
	rv := reflect.ValueOf(v)
	if rv.Kind() != reflect.Map {
		return nil, fmt.Errorf("convert: expected map, got %T", v)
	}
	result := make(map[string]string, rv.Len())
	for _, key := range rv.MapKeys() {
		ks, err := ToString(key.Interface())
		if err != nil {
			return nil, fmt.Errorf("convert: map key: %w", err)
		}
		vs, err := ToString(rv.MapIndex(key).Interface())
		if err != nil {
			return nil, fmt.Errorf("convert: map value for key %q: %w", ks, err)
		}
		result[ks] = vs
	}
	return result, nil
}

// ToMapStringInt converts any map to map[string]int. Values are converted
// via ToInt. Keys are converted via ToString.
func ToMapStringInt(v any) (map[string]int, error) {
	if v == nil {
		return nil, nil
	}
	rv := reflect.ValueOf(v)
	if rv.Kind() != reflect.Map {
		return nil, fmt.Errorf("convert: expected map, got %T", v)
	}
	result := make(map[string]int, rv.Len())
	for _, key := range rv.MapKeys() {
		ks, err := ToString(key.Interface())
		if err != nil {
			return nil, fmt.Errorf("convert: map key: %w", err)
		}
		vi, err := ToInt(rv.MapIndex(key).Interface())
		if err != nil {
			return nil, fmt.Errorf("convert: map value for key %q: %w", ks, err)
		}
		result[ks] = vi
	}
	return result, nil
}

// ──────────────────────────────────────────────
// JSON convenience
// ──────────────────────────────────────────────

// JSONToMap converts JSON bytes to map[string]any.
func JSONToMap(data []byte) (map[string]any, error) {
	var m map[string]any
	if err := json.Unmarshal(data, &m); err != nil {
		return nil, fmt.Errorf("convert: JSON to map: %w", err)
	}
	return m, nil
}

// JSONToSlice converts JSON bytes to []any.
func JSONToSlice(data []byte) ([]any, error) {
	var s []any
	if err := json.Unmarshal(data, &s); err != nil {
		return nil, fmt.Errorf("convert: JSON to slice: %w", err)
	}
	return s, nil
}

// MustMarshal is like Marshal but panics on error. Use only for static
// data in tests or initialization.
func MustMarshal(format Format, v any) []byte {
	b, err := Marshal(format, v)
	if err != nil {
		panic(err)
	}
	return b
}

// MustUnmarshal is like Unmarshal but panics on error.
func MustUnmarshal(format Format, data []byte, v any) {
	if err := Unmarshal(format, data, v); err != nil {
		panic(err)
	}
}
