// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package convert provides type-safe conversion utilities and format
// interconversion (JSON / TOML / YAML).
//
// # Type Conversion
//
// The ToXxx family of functions convert any value to the target type,
// returning a zero value and/or error on failure:
//
//	ToInt("42")           → 42, nil
//	ToInt("abc")          → 0, error
//	ToString(42)          → "42", nil
//	ToFloat64("3.14")     → 3.14, nil
//	ToBool("true")        → true, nil
//	ToSlice[int]([]any{1,2,3}) → []int{1,2,3}, nil
//
// # Format Interconversion
//
// Convert between JSON, TOML, and YAML representations:
//
//	json, err := convert.FromYAMLToJSON(yamlBytes)
//	toml, err := convert.FromJSONToTOML(jsonBytes)
//	yaml, err := convert.FromTOMLToYAML(tomlBytes)
//
// All interconversion functions decode the source into a generic
// map[string]any (or []any for arrays) and re-encode to the target format.
package convert
