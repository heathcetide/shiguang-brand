// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package validate

import (
	"fmt"
	"net/mail"
	"reflect"
	"strings"
)

// ValidateSlice validates each element of a slice against the given tag.
// Returns a map of index → error for all invalid elements. Returns nil
// if all elements are valid.
//
// This is a convenience function for validating slices outside of a
// struct context:
//
//	errs := validate.ValidateSlice([]string{"a", "ab", "abc"}, "min=2")
//	// errs[0] = error for "a" (length < 2)
func ValidateSlice(slice any, tag string) map[int]error {
	rv := reflect.ValueOf(slice)
	for rv.Kind() == reflect.Ptr {
		if rv.IsNil() {
			return nil
		}
		rv = rv.Elem()
	}
	if rv.Kind() != reflect.Slice && rv.Kind() != reflect.Array {
		return nil
	}

	rules := parseTag(tag)
	result := make(map[int]error)

	for i := 0; i < rv.Len(); i++ {
		elem := rv.Index(i)
		var elemErrs Errors
		for _, r := range rules {
			fn := GetRule(r.name)
			if fn == nil {
				elemErrs = append(elemErrs, FieldError{
					Field:   fmt.Sprintf("[%d]", i),
					Rule:    r.name,
					Message: fmt.Sprintf("unknown rule %q", r.name),
				})
				continue
			}
			if err := fn(elem.Interface(), r.param, nil); err != nil {
				elemErrs = append(elemErrs, FieldError{
					Field:   fmt.Sprintf("[%d]", i),
					Rule:    r.name,
					Value:   elem.Interface(),
					Message: err.Error(),
				})
			}
		}
		if len(elemErrs) > 0 {
			result[i] = elemErrs
		}
	}

	if len(result) == 0 {
		return nil
	}
	return result
}

// ValidateMap validates each value in a map against the given tag.
// Returns a map of key → error for all invalid values. Returns nil
// if all values are valid.
func ValidateMap(m any, tag string) map[any]error {
	rv := reflect.ValueOf(m)
	for rv.Kind() == reflect.Ptr {
		if rv.IsNil() {
			return nil
		}
		rv = rv.Elem()
	}
	if rv.Kind() != reflect.Map {
		return nil
	}

	rules := parseTag(tag)
	result := make(map[any]error)

	for _, key := range rv.MapKeys() {
		val := rv.MapIndex(key)
		var valErrs Errors
		for _, r := range rules {
			fn := GetRule(r.name)
			if fn == nil {
				valErrs = append(valErrs, FieldError{
					Field:   fmt.Sprintf("[%v]", key.Interface()),
					Rule:    r.name,
					Message: fmt.Sprintf("unknown rule %q", r.name),
				})
				continue
			}
			if err := fn(val.Interface(), r.param, nil); err != nil {
				valErrs = append(valErrs, FieldError{
					Field:   fmt.Sprintf("[%v]", key.Interface()),
					Rule:    r.name,
					Value:   val.Interface(),
					Message: err.Error(),
				})
			}
		}
		if len(valErrs) > 0 {
			result[key.Interface()] = valErrs
		}
	}

	if len(result) == 0 {
		return nil
	}
	return result
}

// HasRule returns true if a rule with the given name is registered.
func HasRule(name string) bool {
	_, ok := builtinRules[strings.ToLower(name)]
	return ok
}

// RegisteredRules returns the names of all registered rules (built-in +
// custom).
func RegisteredRules() []string {
	names := make([]string, 0, len(builtinRules))
	for name := range builtinRules {
		names = append(names, name)
	}
	return names
}

// ResetRules restores the default built-in rule set, removing any custom
// rules added via AddRule. This is primarily useful for testing.
func ResetRules() {
	builtinRules = make(map[string]RuleFunc)
	registerBuiltinRules()
}

// ValidateEmail reports whether s is a valid email address. It uses the
// same logic as the "email" validation rule (net/mail.ParseAddress).
func ValidateEmail(s string) bool {
	if _, err := mail.ParseAddress(s); err != nil {
		return false
	}
	return true
}
