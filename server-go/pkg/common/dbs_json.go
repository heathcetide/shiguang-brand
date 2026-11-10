// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package common

import (
	"database/sql/driver"
	"encoding/json"
	"errors"
	"fmt"
)

// ──────────────────────────────────────────────
// StringArray
// ──────────────────────────────────────────────

// StringArray is a GORM/SQL custom type that stores a []string as a
// JSON array in a single database column. It implements:
//   - driver.Valuer  → JSON-encodes the slice for storage
//   - sql.Scanner    → JSON-decodes the column value back into the slice
//   - json.Marshaler / json.Unmarshaler → for API JSON binding
//
// # Usage with GORM
//
//	type Tag struct {
//	    ID    uint         `gorm:"primaryKey"`
//	    Tags  StringArray  `gorm:"type:json"`
//	}
//
// # Usage with raw SQL
//
//	var tags StringArray
//	db.QueryRow("SELECT tags FROM posts WHERE id = ?", 1).Scan(&tags)
type StringArray []string

// Value implements driver.Valuer — encodes the slice as JSON.
func (s StringArray) Value() (driver.Value, error) {
	if s == nil {
		return "[]", nil
	}
	data, err := json.Marshal(s)
	if err != nil {
		return nil, fmt.Errorf("StringArray.Value: %w", err)
	}
	return string(data), nil
}

// Scan implements sql.Scanner — decodes JSON from the database.
// Supports []byte, string, and nil inputs.
func (s *StringArray) Scan(input interface{}) error {
	if input == nil {
		*s = nil
		return nil
	}

	var data []byte
	switch v := input.(type) {
	case []byte:
		data = v
	case string:
		data = []byte(v)
	default:
		return fmt.Errorf("StringArray.Scan: unsupported type %T", input)
	}

	if len(data) == 0 {
		*s = nil
		return nil
	}

	var result []string
	if err := json.Unmarshal(data, &result); err != nil {
		return fmt.Errorf("StringArray.Scan: %w", err)
	}
	*s = result
	return nil
}

// MarshalJSON implements json.Marshaler.
func (s StringArray) MarshalJSON() ([]byte, error) {
	if s == nil {
		return []byte("null"), nil
	}
	return json.Marshal([]string(s))
}

// UnmarshalJSON implements json.Unmarshaler.
func (s *StringArray) UnmarshalJSON(data []byte) error {
	if len(data) == 0 || string(data) == "null" {
		*s = nil
		return nil
	}
	var result []string
	if err := json.Unmarshal(data, &result); err != nil {
		return err
	}
	*s = result
	return nil
}

// ──────────────────────────────────────────────
// IntArray
// ──────────────────────────────────────────────

// IntArray is a GORM/SQL custom type that stores a []int as a JSON
// array in a single database column.
type IntArray []int

// Value implements driver.Valuer.
func (a IntArray) Value() (driver.Value, error) {
	if a == nil {
		return "[]", nil
	}
	data, err := json.Marshal(a)
	if err != nil {
		return nil, fmt.Errorf("IntArray.Value: %w", err)
	}
	return string(data), nil
}

// Scan implements sql.Scanner.
func (a *IntArray) Scan(input interface{}) error {
	if input == nil {
		*a = nil
		return nil
	}

	var data []byte
	switch v := input.(type) {
	case []byte:
		data = v
	case string:
		data = []byte(v)
	default:
		return fmt.Errorf("IntArray.Scan: unsupported type %T", input)
	}

	if len(data) == 0 {
		*a = nil
		return nil
	}

	var result []int
	if err := json.Unmarshal(data, &result); err != nil {
		return fmt.Errorf("IntArray.Scan: %w", err)
	}
	*a = result
	return nil
}

// MarshalJSON implements json.Marshaler.
func (a IntArray) MarshalJSON() ([]byte, error) {
	if a == nil {
		return []byte("null"), nil
	}
	return json.Marshal([]int(a))
}

// UnmarshalJSON implements json.Unmarshaler.
func (a *IntArray) UnmarshalJSON(data []byte) error {
	if len(data) == 0 || string(data) == "null" {
		*a = nil
		return nil
	}
	var result []int
	if err := json.Unmarshal(data, &result); err != nil {
		return err
	}
	*a = result
	return nil
}

// ──────────────────────────────────────────────
// JSONMap
// ──────────────────────────────────────────────

// JSONMap is a GORM/SQL custom type that stores a map[string]any as
// JSON in a single database column. Useful for flexible schema-less
// metadata columns.
type JSONMap map[string]any

// Value implements driver.Valuer.
func (m JSONMap) Value() (driver.Value, error) {
	if m == nil {
		return nil, nil
	}
	data, err := json.Marshal(m)
	if err != nil {
		return nil, fmt.Errorf("JSONMap.Value: %w", err)
	}
	return string(data), nil
}

// Scan implements sql.Scanner.
func (m *JSONMap) Scan(input interface{}) error {
	if input == nil {
		*m = nil
		return nil
	}

	var data []byte
	switch v := input.(type) {
	case []byte:
		data = v
	case string:
		data = []byte(v)
	default:
		return fmt.Errorf("JSONMap.Scan: unsupported type %T", input)
	}

	if len(data) == 0 {
		*m = nil
		return nil
	}

	var result map[string]any
	if err := json.Unmarshal(data, &result); err != nil {
		return fmt.Errorf("JSONMap.Scan: %w", err)
	}
	*m = result
	return nil
}

// MarshalJSON implements json.Marshaler.
func (m JSONMap) MarshalJSON() ([]byte, error) {
	if m == nil {
		return []byte("null"), nil
	}
	return json.Marshal(map[string]any(m))
}

// UnmarshalJSON implements json.Unmarshaler.
func (m *JSONMap) UnmarshalJSON(data []byte) error {
	if len(data) == 0 || string(data) == "null" {
		*m = nil
		return nil
	}
	var result map[string]any
	if err := json.Unmarshal(data, &result); err != nil {
		return err
	}
	*m = result
	return nil
}

// ──────────────────────────────────────────────
// JSONRaw
// ──────────────────────────────────────────────

// JSONRaw is a GORM/SQL custom type that stores arbitrary JSON as
// raw bytes. Unlike JSONMap, it preserves the original JSON structure
// without decoding into a specific Go type.
type JSONRaw json.RawMessage

// Value implements driver.Valuer.
func (r JSONRaw) Value() (driver.Value, error) {
	if r == nil {
		return nil, nil
	}
	return string(r), nil
}

// Scan implements sql.Scanner.
func (r *JSONRaw) Scan(input interface{}) error {
	if input == nil {
		*r = nil
		return nil
	}

	var data []byte
	switch v := input.(type) {
	case []byte:
		data = v
	case string:
		data = []byte(v)
	default:
		return fmt.Errorf("JSONRaw.Scan: unsupported type %T", input)
	}

	if len(data) == 0 {
		*r = nil
		return nil
	}

	// Validate JSON.
	if !json.Valid(data) {
		return errors.New("JSONRaw.Scan: invalid JSON")
	}
	*r = append((*r)[:0], data...)
	return nil
}

// MarshalJSON implements json.Marshaler.
func (r JSONRaw) MarshalJSON() ([]byte, error) {
	if r == nil {
		return []byte("null"), nil
	}
	return []byte(r), nil
}

// UnmarshalJSON implements json.Unmarshaler.
func (r *JSONRaw) UnmarshalJSON(data []byte) error {
	if r == nil {
		return errors.New("JSONRaw.UnmarshalJSON: nil pointer")
	}
	*r = append((*r)[:0], data...)
	return nil
}
