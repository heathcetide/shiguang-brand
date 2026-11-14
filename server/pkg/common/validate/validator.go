// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package validate

import (
	"fmt"
	"reflect"
	"strings"
)

// Validate validates a struct and returns all field errors. Returns nil
// if the value is valid. Non-struct values are validated against any
// rules found in the default tag (not typical — use ValidateWithTag for
// inline validation).
func Validate(v any) error {
	if v == nil {
		return nil
	}
	errs := validateStruct(reflect.ValueOf(v), "")
	if len(errs) == 0 {
		return nil
	}
	return errs
}

// ValidateWithTag validates a single value against a tag string (e.g.
// "required,min=3"). This is useful for validating individual values
// outside of a struct context.
func ValidateWithTag(value any, tag string) error {
	rules := parseTag(tag)
	for _, r := range rules {
		fn := GetRule(r.name)
		if fn == nil {
			return fmt.Errorf("validate: unknown rule %q", r.name)
		}
		if err := fn(value, r.param, nil); err != nil {
			return FieldError{Field: "_", Rule: r.name, Value: value, Message: err.Error()}
		}
	}
	return nil
}

// tagRule represents a single rule parsed from a struct tag.
type tagRule struct {
	name  string
	param string
}

// parseTag parses a validation tag like "required,min=3,max=50" into
// individual rules. Rules are comma-separated; key=value pairs use "=".
func parseTag(tag string) []tagRule {
	if tag == "" {
		return nil
	}
	var rules []tagRule
	for _, part := range splitTag(tag) {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		name, param, _ := strings.Cut(part, "=")
		rules = append(rules, tagRule{name: strings.ToLower(name), param: param})
	}
	return rules
}

// splitTag splits a tag by commas, respecting quoted values that may
// contain commas (e.g. regex="a,b").
func splitTag(tag string) []string {
	var parts []string
	var current strings.Builder
	inQuote := false
	for _, ch := range tag {
		switch ch {
		case '"':
			inQuote = !inQuote
			current.WriteRune(ch)
		case ',':
			if inQuote {
				current.WriteRune(ch)
			} else {
				parts = append(parts, current.String())
				current.Reset()
			}
		default:
			current.WriteRune(ch)
		}
	}
	if current.Len() > 0 {
		parts = append(parts, current.String())
	}
	return parts
}

// validateStruct recursively validates a struct value.
func validateStruct(rv reflect.Value, prefix string) Errors {
	// Dereference pointers.
	for rv.Kind() == reflect.Ptr {
		if rv.IsNil() {
			return nil
		}
		rv = rv.Elem()
	}

	if rv.Kind() != reflect.Struct {
		return nil
	}

	var errs Errors
	rt := rv.Type()
	for i := 0; i < rt.NumField(); i++ {
		field := rt.Field(i)
		// Skip unexported fields.
		if field.PkgPath != "" {
			continue
		}
		fieldValue := rv.Field(i)
		fieldPath := field.Name
		if prefix != "" {
			fieldPath = prefix + "." + field.Name
		}

		tag := field.Tag.Get("validate")
		rules := parseTag(tag)

		// If the field is a pointer, dereference for rule checking.
		checkValue := fieldValue
		for checkValue.Kind() == reflect.Ptr && !checkValue.IsNil() {
			checkValue = checkValue.Elem()
		}

		// Apply rules.
		hasDive := false
		for _, r := range rules {
			if r.name == "dive" {
				hasDive = true
				continue
			}
			if r.name == "nostructlevel" {
				continue
			}
			fn := GetRule(r.name)
			if fn == nil {
				errs = append(errs, FieldError{
					Field:   fieldPath,
					Rule:    r.name,
					Value:   fieldValue.Interface(),
					Message: fmt.Sprintf("unknown rule %q", r.name),
				})
				continue
			}
			if err := fn(checkValue.Interface(), r.param, rv.Interface()); err != nil {
				errs = append(errs, FieldError{
					Field:   fieldPath,
					Rule:    r.name,
					Value:   fieldValue.Interface(),
					Message: err.Error(),
				})
			}
		}

		// Recurse into nested structs (unless nostructlevel is set).
		if !hasNoStructLevel(rules) {
			if checkValue.Kind() == reflect.Struct {
				errs = append(errs, validateStruct(checkValue, fieldPath)...)
			}
		}

		// Dive into slices/maps.
		if hasDive {
			errs = append(errs, validateDive(checkValue, fieldPath, rules)...)
		}
	}
	return errs
}

func hasNoStructLevel(rules []tagRule) bool {
	for _, r := range rules {
		if r.name == "nostructlevel" {
			return true
		}
	}
	return false
}

// validateDive validates each element of a slice or map.
func validateDive(rv reflect.Value, fieldPath string, rules []tagRule) Errors {
	for rv.Kind() == reflect.Ptr {
		if rv.IsNil() {
			return nil
		}
		rv = rv.Elem()
	}

	var errs Errors
	switch rv.Kind() {
	case reflect.Slice, reflect.Array:
		for i := 0; i < rv.Len(); i++ {
			elem := rv.Index(i)
			elemPath := fmt.Sprintf("%s[%d]", fieldPath, i)
			if elem.Kind() == reflect.Struct {
				errs = append(errs, validateStruct(elem, elemPath)...)
			} else {
				// Apply non-dive rules to each element.
				for _, r := range rules {
					if r.name == "dive" || r.name == "required" || r.name == "nostructlevel" {
						continue
					}
					fn := GetRule(r.name)
					if fn == nil {
						continue
					}
					if err := fn(elem.Interface(), r.param, nil); err != nil {
						errs = append(errs, FieldError{
							Field:   elemPath,
							Rule:    r.name,
							Value:   elem.Interface(),
							Message: err.Error(),
						})
					}
				}
			}
		}
	case reflect.Map:
		for _, key := range rv.MapKeys() {
			elem := rv.MapIndex(key)
			elemPath := fmt.Sprintf("%s[%v]", fieldPath, key.Interface())
			if elem.Kind() == reflect.Struct {
				errs = append(errs, validateStruct(elem, elemPath)...)
			}
		}
	}
	return errs
}
