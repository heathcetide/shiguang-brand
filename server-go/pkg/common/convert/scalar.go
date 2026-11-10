// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package convert

import (
	"encoding/json"
	"fmt"
	"reflect"
	"strconv"
	"strings"
	"time"
)

// ──────────────────────────────────────────────
// Scalar conversions
// ──────────────────────────────────────────────

// ToInt converts any value to int. Supports int variants, float variants,
// string (parsed), bool (1/0), and json.Number.
func ToInt(v any) (int, error) {
	switch val := v.(type) {
	case int:
		return val, nil
	case int8:
		return int(val), nil
	case int16:
		return int(val), nil
	case int32:
		return int(val), nil
	case int64:
		return int(val), nil
	case uint:
		return int(val), nil
	case uint8:
		return int(val), nil
	case uint16:
		return int(val), nil
	case uint32:
		return int(val), nil
	case uint64:
		return int(val), nil
	case float32:
		return int(val), nil
	case float64:
		return int(val), nil
	case string:
		if val == "" {
			return 0, fmt.Errorf("convert: empty string cannot convert to int")
		}
		n, err := strconv.ParseInt(strings.TrimSpace(val), 10, 64)
		if err != nil {
			return 0, fmt.Errorf("convert: cannot convert %q to int: %w", val, err)
		}
		return int(n), nil
	case bool:
		if val {
			return 1, nil
		}
		return 0, nil
	case json.Number:
		n, err := val.Int64()
		if err != nil {
			return 0, fmt.Errorf("convert: cannot convert json.Number %s to int: %w", val, err)
		}
		return int(n), nil
	case nil:
		return 0, fmt.Errorf("convert: nil cannot convert to int")
	default:
		return 0, fmt.Errorf("convert: unsupported type %T for int", v)
	}
}

// ToInt64 converts any value to int64.
func ToInt64(v any) (int64, error) {
	n, err := ToInt(v)
	if err != nil {
		// Try float path for large numbers.
		switch val := v.(type) {
		case float64:
			return int64(val), nil
		case float32:
			return int64(val), nil
		case json.Number:
			return val.Int64()
		}
		return 0, err
	}
	return int64(n), nil
}

// ToUint converts any value to uint.
func ToUint(v any) (uint, error) {
	n, err := ToInt64(v)
	if err != nil {
		return 0, err
	}
	if n < 0 {
		return 0, fmt.Errorf("convert: negative value %d cannot convert to uint", n)
	}
	return uint(n), nil
}

// ToFloat64 converts any value to float64.
func ToFloat64(v any) (float64, error) {
	switch val := v.(type) {
	case float64:
		return val, nil
	case float32:
		return float64(val), nil
	case int:
		return float64(val), nil
	case int8:
		return float64(val), nil
	case int16:
		return float64(val), nil
	case int32:
		return float64(val), nil
	case int64:
		return float64(val), nil
	case uint:
		return float64(val), nil
	case uint8:
		return float64(val), nil
	case uint16:
		return float64(val), nil
	case uint32:
		return float64(val), nil
	case uint64:
		return float64(val), nil
	case string:
		if val == "" {
			return 0, fmt.Errorf("convert: empty string cannot convert to float64")
		}
		f, err := strconv.ParseFloat(strings.TrimSpace(val), 64)
		if err != nil {
			return 0, fmt.Errorf("convert: cannot convert %q to float64: %w", val, err)
		}
		return f, nil
	case json.Number:
		return val.Float64()
	case bool:
		if val {
			return 1, nil
		}
		return 0, nil
	case nil:
		return 0, fmt.Errorf("convert: nil cannot convert to float64")
	default:
		return 0, fmt.Errorf("convert: unsupported type %T for float64", v)
	}
}

// ToBool converts any value to bool. Recognizes: bool, string
// ("true"/"false"/"1"/"0"/"yes"/"no"/"on"/"off"), int (non-zero = true).
func ToBool(v any) (bool, error) {
	switch val := v.(type) {
	case bool:
		return val, nil
	case string:
		s := strings.ToLower(strings.TrimSpace(val))
		switch s {
		case "true", "1", "yes", "on", "t":
			return true, nil
		case "false", "0", "no", "off", "f", "":
			return false, nil
		default:
			return false, fmt.Errorf("convert: cannot convert %q to bool", val)
		}
	case int:
		return val != 0, nil
	case int8:
		return val != 0, nil
	case int16:
		return val != 0, nil
	case int32:
		return val != 0, nil
	case int64:
		return val != 0, nil
	case uint:
		return val != 0, nil
	case float64:
		return val != 0, nil
	case float32:
		return val != 0, nil
	case nil:
		return false, nil
	default:
		return false, fmt.Errorf("convert: unsupported type %T for bool", v)
	}
}

// ToString converts any value to string. Numbers are formatted, bool
// becomes "true"/"false", nil becomes "".
func ToString(v any) (string, error) {
	switch val := v.(type) {
	case string:
		return val, nil
	case bool:
		if val {
			return "true", nil
		}
		return "false", nil
	case int:
		return strconv.FormatInt(int64(val), 10), nil
	case int8:
		return strconv.FormatInt(int64(val), 10), nil
	case int16:
		return strconv.FormatInt(int64(val), 10), nil
	case int32:
		return strconv.FormatInt(int64(val), 10), nil
	case int64:
		return strconv.FormatInt(val, 10), nil
	case uint:
		return strconv.FormatUint(uint64(val), 10), nil
	case uint8:
		return strconv.FormatUint(uint64(val), 10), nil
	case uint16:
		return strconv.FormatUint(uint64(val), 10), nil
	case uint32:
		return strconv.FormatUint(uint64(val), 10), nil
	case uint64:
		return strconv.FormatUint(val, 10), nil
	case float32:
		return strconv.FormatFloat(float64(val), 'f', -1, 32), nil
	case float64:
		return strconv.FormatFloat(val, 'f', -1, 64), nil
	case []byte:
		return string(val), nil
	case nil:
		return "", nil
	case fmt.Stringer:
		return val.String(), nil
	case json.Number:
		return val.String(), nil
	default:
		// Fall back to JSON encoding for complex types.
		b, err := json.Marshal(val)
		if err != nil {
			return "", fmt.Errorf("convert: cannot convert %T to string: %w", v, err)
		}
		return string(b), nil
	}
}

// ToDuration converts any value to time.Duration. Accepts
// time.Duration, string (e.g. "5s", "100ms"), and numeric types
// (interpreted as nanoseconds).
func ToDuration(v any) (time.Duration, error) {
	switch val := v.(type) {
	case time.Duration:
		return val, nil
	case string:
		d, err := time.ParseDuration(val)
		if err != nil {
			return 0, fmt.Errorf("convert: cannot parse %q as duration: %w", val, err)
		}
		return d, nil
	case int:
		return time.Duration(val), nil
	case int64:
		return time.Duration(val), nil
	case float64:
		return time.Duration(val), nil
	case json.Number:
		n, err := val.Int64()
		if err != nil {
			return 0, err
		}
		return time.Duration(n), nil
	case nil:
		return 0, fmt.Errorf("convert: nil cannot convert to duration")
	default:
		return 0, fmt.Errorf("convert: unsupported type %T for duration", v)
	}
}

// ──────────────────────────────────────────────
// Slice / Map conversions
// ──────────────────────────────────────────────

// ToSlice converts any value to a typed slice. If v is already a slice of
// T, it is returned directly. If v is a []any, each element is converted
// to T. If v is a single value, a slice containing that one value is
// returned.
func ToSlice[T any](v any) ([]T, error) {
	if v == nil {
		return nil, nil
	}

	rv := reflect.ValueOf(v)
	switch rv.Kind() {
	case reflect.Slice, reflect.Array:
		result := make([]T, rv.Len())
		for i := 0; i < rv.Len(); i++ {
			elem := rv.Index(i).Interface()
			converted, err := toType[T](elem)
			if err != nil {
				return nil, fmt.Errorf("convert: element %d: %w", i, err)
			}
			result[i] = converted
		}
		return result, nil
	default:
		// Single value → slice of one.
		converted, err := toType[T](v)
		if err != nil {
			return nil, err
		}
		return []T{converted}, nil
	}
}

// ToSliceString converts any value to []string.
func ToSliceString(v any) ([]string, error) {
	return ToSlice[string](v)
}

// ToSliceInt converts any value to []int.
func ToSliceInt(v any) ([]int, error) {
	return ToSlice[int](v)
}

// ToMapStringAny converts a map[any]any (common from YAML decoding) to
// map[string]any. Keys that are not strings are converted via fmt.Sprint.
func ToMapStringAny(v any) (map[string]any, error) {
	if v == nil {
		return nil, nil
	}
	rv := reflect.ValueOf(v)
	if rv.Kind() != reflect.Map {
		return nil, fmt.Errorf("convert: expected map, got %T", v)
	}
	result := make(map[string]any, rv.Len())
	for _, key := range rv.MapKeys() {
		ks, err := ToString(key.Interface())
		if err != nil {
			return nil, fmt.Errorf("convert: map key: %w", err)
		}
		result[ks] = rv.MapIndex(key).Interface()
	}
	return result, nil
}

// toType converts a single value to the target type T using JSON
// round-trip as a fallback for complex types.
func toType[T any](v any) (T, error) {
	var zero T

	// Fast path: already the target type.
	if t, ok := v.(T); ok {
		return t, nil
	}

	// Try JSON round-trip for arbitrary types.
	b, err := json.Marshal(v)
	if err != nil {
		return zero, fmt.Errorf("convert: marshal %T: %w", v, err)
	}
	var result T
	if err := json.Unmarshal(b, &result); err != nil {
		return zero, fmt.Errorf("convert: unmarshal to %T: %w", zero, err)
	}
	return result, nil
}
