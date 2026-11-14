// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package validate provides struct-tag-driven data validation with
// built-in rules, custom rule registration, nested struct validation,
// and slice validation.
//
// # Quick Start
//
//	type User struct {
//	    Name     string `validate:"required,min=3,max=50"`
//	    Email    string `validate:"required,email"`
//	    Age      int    `validate:"min=18,max=120"`
//	    Password string `validate:"required,min=8"`
//	    Confirm  string `validate:"eqfield=Password"`
//	}
//
//	user := User{Name: "ab", Email: "invalid", Age: 5}
//	err := validate.Validate(user)
//	// → returns *validate.Errors with field-specific messages
//
// # Built-in Rules
//
//	required          — field must not be zero value
//	min=N             — minimum value (numbers) or length (strings/slices)
//	max=N             — maximum value (numbers) or length (strings/slices)
//	len=N             — exact length (strings/slices) or value (numbers)
//	eq=N              — must equal N
//	ne=N              — must not equal N
//	gt=N              — greater than N
//	gte=N             — greater than or equal to N
//	lt=N              — less than N
//	lte=N             — less than or equal to N
//	oneof=a b c       — must be one of the listed values
//	email             — must be a valid email address
//	url               — must be a valid URL
//	ip                — must be a valid IP address
//	ipv4              — must be a valid IPv4 address
//	ipv6              — must be a valid IPv6 address
//	alpha             — must contain only alpha characters
//	alphanum          — must contain only alphanumeric characters
//	numeric           — must contain only numeric characters
//	contains=s        — must contain substring s
//	startswith=s      — must start with s
//	endswith=s        — must end with s
//	regex=pattern     — must match the regex pattern
//	eqfield=Name      — must equal another field's value
//	nefield=Name      — must not equal another field's value
//	gtfield=Name      — must be greater than another field's value
//	ltefield=Name     — must be less than or equal to another field's value
//	unique            — slice elements must be unique
//	dive              — validate slice/map elements recursively
//	nostructlevel     — skip nested struct validation (opt-in)
//
// # Custom Rules
//
//	validate.AddRule("phone", func(value any, param string, parent any) error {
//	    s, ok := value.(string)
//	    if !ok { return validate.ErrInvalidType }
//	    if !phoneRegex.MatchString(s) {
//	        return fmt.Errorf("invalid phone number")
//	    }
//	    return nil
//	})
//
//	type Contact struct {
//	    Phone string `validate:"required,phone"`
//	}
//
// # Nested Validation
//
// Nested structs are validated automatically. Use the `dive` rule to
// validate elements of a slice or values of a map.
//
//	type Order struct {
//	    Items []Item `validate:"required,dive"`
//	}
package validate
