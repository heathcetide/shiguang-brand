// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package validate

import (
	"errors"
	"fmt"
)

// Sentinel errors.
var (
	// ErrInvalidType is returned by a rule when the field value is not
	// of the expected type.
	ErrInvalidType = errors.New("validate: invalid field type for rule")

	// ErrNoValidator is returned when a custom rule is not found.
	ErrNoValidator = errors.New("validate: no validator registered for rule")
)

// FieldError describes a validation failure for a single field.
type FieldError struct {
	Field   string // dotted path, e.g. "User.Address.Street"
	Rule    string // rule that failed, e.g. "required", "min"
	Value   any    // the invalid value
	Message string // human-readable error message
}

func (e FieldError) Error() string {
	if e.Message != "" {
		return fmt.Sprintf("validate: field %q: %s", e.Field, e.Message)
	}
	return fmt.Sprintf("validate: field %q failed rule %q", e.Field, e.Rule)
}

// Errors is a collection of field errors.
type Errors []FieldError

func (e Errors) Error() string {
	if len(e) == 0 {
		return "validate: no errors"
	}
	if len(e) == 1 {
		return e[0].Error()
	}
	msg := fmt.Sprintf("validate: %d errors:\n", len(e))
	for _, fe := range e {
		msg += "  " + fe.Error() + "\n"
	}
	return msg
}

// Has returns true if any error matches the given field path.
func (e Errors) Has(field string) bool {
	for _, fe := range e {
		if fe.Field == field {
			return true
		}
	}
	return false
}

// ForField returns all errors for the given field path.
func (e Errors) ForField(field string) Errors {
	var result Errors
	for _, fe := range e {
		if fe.Field == field {
			result = append(result, fe)
		}
	}
	return result
}

// Fields returns the set of field paths that have errors.
func (e Errors) Fields() []string {
	seen := make(map[string]bool)
	var fields []string
	for _, fe := range e {
		if !seen[fe.Field] {
			seen[fe.Field] = true
			fields = append(fields, fe.Field)
		}
	}
	return fields
}
