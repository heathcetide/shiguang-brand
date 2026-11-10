// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package config

import (
	"fmt"
	"os"
	"reflect"
	"strconv"
	"strings"
	"sync"
	"time"
)

// envStore holds values loaded from .env files, separate from os.Environ.
// This allows struct tag application to see both .env file values and
// OS env vars, with OS env taking precedence.
var envStore = &stringStore{
	data: make(map[string]string),
}

type stringStore struct {
	mu   sync.RWMutex
	data map[string]string
}

func (s *stringStore) Set(key, val string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.data[strings.ToUpper(key)] = val
}

func (s *stringStore) Get(key string) (string, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	v, ok := s.data[strings.ToUpper(key)]
	return v, ok
}

func (s *stringStore) Purge() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.data = make(map[string]string)
}

// lookupEnvValue checks OS env first, then the .env file store.
func lookupEnvValue(key string) (string, bool) {
	if v, ok := os.LookupEnv(key); ok {
		return v, true
	}
	return envStore.Get(key)
}

// applyEnvOverrides reads struct tags and applies env var values.
// Supported tags:
//
//	env:"KEY"           — overrides from env var KEY
//	env:"KEY,required"  — fails if KEY is not set
//	env:"-"             — skip this field
//
// Field types: string, int, int64, float64, bool, time.Duration.
func applyEnvOverrides(out any) error {
	v := reflect.ValueOf(out)
	if v.Kind() != reflect.Ptr || v.IsNil() {
		return nil
	}
	return applyEnvToStruct(v.Elem())
}

func applyEnvToStruct(v reflect.Value) error {
	t := v.Type()
	for i := 0; i < v.NumField(); i++ {
		field := v.Field(i)
		if !field.CanSet() {
			continue
		}

		structField := t.Field(i)
		tag := structField.Tag.Get("env")
		if tag == "-" {
			continue
		}

		// Parse env tag: "KEY" or "KEY,required".
		parts := strings.SplitN(tag, ",", 2)
		key := strings.TrimSpace(parts[0])
		required := false
		if len(parts) > 1 && strings.TrimSpace(parts[1]) == "required" {
			required = true
		}

		// If no env tag, recurse into nested structs.
		if key == "" {
			if field.Kind() == reflect.Struct && field.CanAddr() {
				if err := applyEnvToStruct(field); err != nil {
					return err
				}
			}
			continue
		}

		val, found := lookupEnvValue(key)
		if !found || strings.TrimSpace(val) == "" {
			if required {
				return errRequired(key, structField.Name)
			}
			continue
		}

		if err := setFieldValue(field, val); err != nil {
			return fmt.Errorf("config: env %s: %w", key, err)
		}
	}
	return nil
}

// setFieldValue sets a reflect.Value from a string, handling common types.
func setFieldValue(field reflect.Value, val string) error {
	switch field.Kind() {
	case reflect.String:
		field.SetString(val)

	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		// Special case: time.Duration is an int64.
		if field.Type() == reflect.TypeOf(time.Duration(0)) {
			d, err := time.ParseDuration(val)
			if err != nil {
				return err
			}
			field.SetInt(int64(d))
		} else {
			n, err := strconv.ParseInt(val, 10, 64)
			if err != nil {
				return err
			}
			field.SetInt(n)
		}

	case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64:
		n, err := strconv.ParseUint(val, 10, 64)
		if err != nil {
			return err
		}
		field.SetUint(n)

	case reflect.Float32, reflect.Float64:
		f, err := strconv.ParseFloat(val, 64)
		if err != nil {
			return err
		}
		field.SetFloat(f)

	case reflect.Bool:
		b, err := strconv.ParseBool(val)
		if err != nil {
			return err
		}
		field.SetBool(b)

	case reflect.Slice:
		if field.Type().Elem().Kind() == reflect.String {
			items := strings.Split(val, ",")
			for i := range items {
				items[i] = strings.TrimSpace(items[i])
			}
			field.Set(reflect.ValueOf(items))
		}

	default:
		// Unsupported type — skip silently.
	}
	return nil
}

// errRequired returns an error for a missing required env var.
func errRequired(key, fieldName string) error {
	return fmt.Errorf("config: required env var %s for field %s is not set", key, fieldName)
}
