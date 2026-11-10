//
// Tencent is pleased to support the open source community by making trpc-agent-go available.
//
// Copyright (C) 2025 Tencent.  All rights reserved.
//
// trpc-agent-go is licensed under the Apache License Version 2.0.
//
//

// Package structuredoutput builds structured output schema data from Go types.
package compat

import (
	"reflect"
)

// schemaName returns the provider-facing structured output schema name.
func schemaName(name string) string {
	if name == "" {
		return "output"
	}
	return name
}

// fromType returns the schema name, generated JSON schema, and pointer type.
func fromType(examplePtr any, strict bool) (string, map[string]any, reflect.Type) {
	t := typeOf(examplePtr)
	if t == nil {
		return "", nil, nil
	}
	genOpts := make([]Option, 0, 1)
	if strict {
		genOpts = append(genOpts, WithStrict())
	}
	gen := New(genOpts...)
	schema := gen.Generate(t.Elem())
	name := t.Elem().Name()
	return schemaName(name), schema, t
}

// typeOf returns the pointer type used for typed structured output.
func typeOf(examplePtr any) reflect.Type {
	if examplePtr == nil {
		return nil
	}
	rt := reflect.TypeOf(examplePtr)
	if rt.Kind() == reflect.Pointer {
		return rt
	}
	return reflect.PointerTo(rt)
}
