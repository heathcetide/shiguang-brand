// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package convert

import (
	"encoding/json"
	"fmt"

	"github.com/BurntSushi/toml"
	"gopkg.in/yaml.v3"
)

// Format represents a serialization format.
type Format string

const (
	FormatJSON Format = "json"
	FormatYAML Format = "yaml"
	FormatTOML Format = "toml"
)

// ──────────────────────────────────────────────
// Encode / Decode
// ──────────────────────────────────────────────

// Marshal encodes v to the specified format.
func Marshal(format Format, v any) ([]byte, error) {
	switch format {
	case FormatJSON:
		return json.Marshal(v)
	case FormatYAML:
		return yaml.Marshal(v)
	case FormatTOML:
		return tomlEncoder(v)
	default:
		return nil, fmt.Errorf("convert: unsupported format %q", format)
	}
}

// Unmarshal decodes data in the specified format into v.
func Unmarshal(format Format, data []byte, v any) error {
	switch format {
	case FormatJSON:
		return json.Unmarshal(data, v)
	case FormatYAML:
		return yaml.Unmarshal(data, v)
	case FormatTOML:
		return toml.Unmarshal(data, v)
	default:
		return fmt.Errorf("convert: unsupported format %q", format)
	}
}

// tomlEncoder encodes v to TOML. BurntSushi/toml only supports
// top-level maps and structs, so we JSON-roundtrip to normalize.
func tomlEncoder(v any) ([]byte, error) {
	// TOML requires a map or struct at the top level. If v is a slice
	// or scalar, wrap it in a map under a "data" key.
	b, err := json.Marshal(v)
	if err != nil {
		return nil, fmt.Errorf("convert: TOML encode (json marshal): %w", err)
	}
	var generic any
	if err := json.Unmarshal(b, &generic); err != nil {
		return nil, fmt.Errorf("convert: TOML encode (json unmarshal): %w", err)
	}
	wrapped := wrapForTOML(generic)
	var buf []byte
	enc := toml.NewEncoder(&byteWriter{buf: &buf})
	if err := enc.Encode(wrapped); err != nil {
		return nil, fmt.Errorf("convert: TOML encode: %w", err)
	}
	return buf, nil
}

// byteWriter is a simple io.Writer backed by a []byte.
type byteWriter struct{ buf *[]byte }

func (w *byteWriter) Write(p []byte) (int, error) {
	*w.buf = append(*w.buf, p...)
	return len(p), nil
}

// wrapForTOML ensures the value is a map at the top level (TOML requirement).
func wrapForTOML(v any) any {
	switch v.(type) {
	case map[string]any:
		return v
	default:
		return map[string]any{"data": v}
	}
}

// ──────────────────────────────────────────────
// Interconversion
// ──────────────────────────────────────────────

// Convert converts data from one format to another. The source is decoded
// into a generic any and re-encoded to the target format.
func Convert(from, to Format, data []byte) ([]byte, error) {
	if from == to {
		// Same format — validate by round-tripping.
		var v any
		if err := Unmarshal(from, data, &v); err != nil {
			return nil, fmt.Errorf("convert: validate %s: %w", from, err)
		}
		return Marshal(to, v)
	}

	var v any
	if err := Unmarshal(from, data, &v); err != nil {
		return nil, fmt.Errorf("convert: decode %s: %w", from, err)
	}
	return Marshal(to, v)
}

// FromJSONToYAML converts JSON bytes to YAML.
func FromJSONToYAML(data []byte) ([]byte, error) {
	return Convert(FormatJSON, FormatYAML, data)
}

// FromYAMLToJSON converts YAML bytes to JSON.
func FromYAMLToJSON(data []byte) ([]byte, error) {
	return Convert(FormatYAML, FormatJSON, data)
}

// FromJSONToTOML converts JSON bytes to TOML.
func FromJSONToTOML(data []byte) ([]byte, error) {
	return Convert(FormatJSON, FormatTOML, data)
}

// FromTOMLToJSON converts TOML bytes to JSON.
func FromTOMLToJSON(data []byte) ([]byte, error) {
	return Convert(FormatTOML, FormatJSON, data)
}

// FromYAMLToTOML converts YAML bytes to TOML.
func FromYAMLToTOML(data []byte) ([]byte, error) {
	return Convert(FormatYAML, FormatTOML, data)
}

// FromTOMLToYAML converts TOML bytes to YAML.
func FromTOMLToYAML(data []byte) ([]byte, error) {
	return Convert(FormatTOML, FormatYAML, data)
}

// ──────────────────────────────────────────────
// Struct-level interconversion
// ──────────────────────────────────────────────

// StructToJSON encodes a struct to JSON bytes.
func StructToJSON(v any) ([]byte, error) {
	return json.Marshal(v)
}

// StructToYAML encodes a struct to YAML bytes.
func StructToYAML(v any) ([]byte, error) {
	return yaml.Marshal(v)
}

// StructToTOML encodes a struct to TOML bytes.
func StructToTOML(v any) ([]byte, error) {
	return tomlEncoder(v)
}

// JSONToStruct decodes JSON bytes into a struct.
func JSONToStruct(data []byte, v any) error {
	return json.Unmarshal(data, v)
}

// YAMLToStruct decodes YAML bytes into a struct.
func YAMLToStruct(data []byte, v any) error {
	return yaml.Unmarshal(data, v)
}

// TOMLToStruct decodes TOML bytes into a struct.
func TOMLToStruct(data []byte, v any) error {
	return toml.Unmarshal(data, v)
}
