// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package validate

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net"
	"net/mail"
	"net/url"
	"reflect"
	"regexp"
	"strconv"
	"strings"
	"unicode"

	"github.com/heathcetide/DietDigiDose/pkg/common/convert"
)

// RuleFunc is a validation rule function.
//
//   - value:  the field value to validate
//   - param:  the rule parameter (e.g. "3" for min=3), empty if none
//   - parent: the parent struct (for cross-field rules like eqfield)
//
// Return nil if valid, an error otherwise.
type RuleFunc func(value any, param string, parent any) error

// builtinRules holds the default rule set.
var builtinRules = map[string]RuleFunc{}

func init() {
	registerBuiltinRules()
}

// AddRule registers a custom validation rule. The rule name must be
// lowercase and not conflict with built-in rules (it will overwrite
// built-in rules if it does).
func AddRule(name string, fn RuleFunc) {
	if name == "" {
		return
	}
	builtinRules[strings.ToLower(name)] = fn
}

// GetRule returns the rule function for the given name, or nil if not found.
func GetRule(name string) RuleFunc {
	return builtinRules[strings.ToLower(name)]
}

func registerBuiltinRules() {
	builtinRules["required"] = ruleRequired
	builtinRules["min"] = ruleMin
	builtinRules["max"] = ruleMax
	builtinRules["len"] = ruleLen
	builtinRules["eq"] = ruleEq
	builtinRules["ne"] = ruleNe
	builtinRules["gt"] = ruleGt
	builtinRules["gte"] = ruleGte
	builtinRules["lt"] = ruleLt
	builtinRules["lte"] = ruleLte
	builtinRules["oneof"] = ruleOneOf
	builtinRules["email"] = ruleEmail
	builtinRules["url"] = ruleURL
	builtinRules["ip"] = ruleIP
	builtinRules["ipv4"] = ruleIPv4
	builtinRules["ipv6"] = ruleIPv6
	builtinRules["alpha"] = ruleAlpha
	builtinRules["alphanum"] = ruleAlphaNum
	builtinRules["numeric"] = ruleNumeric
	builtinRules["contains"] = ruleContains
	builtinRules["startswith"] = ruleStartsWith
	builtinRules["endswith"] = ruleEndsWith
	builtinRules["regex"] = ruleRegex
	builtinRules["eqfield"] = ruleEqField
	builtinRules["nefield"] = ruleNeField
	builtinRules["gtfield"] = ruleGtField
	builtinRules["gtefield"] = ruleGteField
	builtinRules["ltefield"] = ruleLteField
	builtinRules["unique"] = ruleUnique
	builtinRules["phone"] = rulePhone
	builtinRules["uuid"] = ruleUUID
	builtinRules["slug"] = ruleSlug
	builtinRules["creditcard"] = ruleCreditCard
	builtinRules["json"] = ruleJSON
	builtinRules["base64"] = ruleBase64
	builtinRules["hex"] = ruleHex
}

// ──────────────────────────────────────────────
// Required
// ──────────────────────────────────────────────

func ruleRequired(value any, _ string, _ any) error {
	if value == nil {
		return fmt.Errorf("is required")
	}
	rv := reflect.ValueOf(value)
	switch rv.Kind() {
	case reflect.Invalid:
		return fmt.Errorf("is required")
	case reflect.String:
		if rv.String() == "" {
			return fmt.Errorf("is required")
		}
	case reflect.Slice, reflect.Array, reflect.Map, reflect.Chan:
		if rv.Len() == 0 {
			return fmt.Errorf("is required")
		}
	case reflect.Ptr, reflect.Interface:
		if rv.IsNil() {
			return fmt.Errorf("is required")
		}
	case reflect.Bool:
		// For bool, "required" means must be true.
		if !rv.Bool() {
			return fmt.Errorf("must be true")
		}
	default:
		// Check zero value for numeric types.
		if rv.IsZero() {
			return fmt.Errorf("is required")
		}
	}
	return nil
}

// ──────────────────────────────────────────────
// Min / Max / Len
// ──────────────────────────────────────────────

func ruleMin(value any, param string, _ any) error {
	n, err := strconv.ParseInt(param, 10, 64)
	if err != nil {
		return fmt.Errorf("min: invalid param %q", param)
	}
	return compareValue(value, n, "min", func(actual, threshold int64) bool {
		return actual >= threshold
	}, func(actual, threshold float64) bool {
		return actual >= threshold
	})
}

func ruleMax(value any, param string, _ any) error {
	n, err := strconv.ParseInt(param, 10, 64)
	if err != nil {
		return fmt.Errorf("max: invalid param %q", param)
	}
	return compareValue(value, n, "max", func(actual, threshold int64) bool {
		return actual <= threshold
	}, func(actual, threshold float64) bool {
		return actual <= threshold
	})
}

func ruleLen(value any, param string, _ any) error {
	n, err := strconv.ParseInt(param, 10, 64)
	if err != nil {
		return fmt.Errorf("len: invalid param %q", param)
	}
	rv := reflect.ValueOf(value)
	switch rv.Kind() {
	case reflect.String, reflect.Slice, reflect.Array, reflect.Map:
		if int64(rv.Len()) != n {
			return fmt.Errorf("must have length %d (got %d)", n, rv.Len())
		}
		return nil
	default:
		return compareValue(value, n, "len", func(actual, threshold int64) bool {
			return actual == threshold
		}, func(actual, threshold float64) bool {
			return actual == threshold
		})
	}
}

// ──────────────────────────────────────────────
// Eq / Ne / Gt / Gte / Lt / Lte
// ──────────────────────────────────────────────

func ruleEq(value any, param string, _ any) error {
	return compareValue(value, parseNum(param), "eq", func(actual, threshold int64) bool {
		return actual == threshold
	}, func(actual, threshold float64) bool {
		return actual == threshold
	})
}

func ruleNe(value any, param string, _ any) error {
	err := ruleEq(value, param, nil)
	if err != nil {
		return nil // not equal = valid
	}
	return fmt.Errorf("must not equal %s", param)
}

func ruleGt(value any, param string, _ any) error {
	n, err := strconv.ParseInt(param, 10, 64)
	if err != nil {
		return fmt.Errorf("gt: invalid param %q", param)
	}
	return compareValue(value, n, "gt", func(actual, threshold int64) bool {
		return actual > threshold
	}, func(actual, threshold float64) bool {
		return actual > threshold
	})
}

func ruleGte(value any, param string, _ any) error {
	n, err := strconv.ParseInt(param, 10, 64)
	if err != nil {
		return fmt.Errorf("gte: invalid param %q", param)
	}
	return compareValue(value, n, "gte", func(actual, threshold int64) bool {
		return actual >= threshold
	}, func(actual, threshold float64) bool {
		return actual >= threshold
	})
}

func ruleLt(value any, param string, _ any) error {
	n, err := strconv.ParseInt(param, 10, 64)
	if err != nil {
		return fmt.Errorf("lt: invalid param %q", param)
	}
	return compareValue(value, n, "lt", func(actual, threshold int64) bool {
		return actual < threshold
	}, func(actual, threshold float64) bool {
		return actual < threshold
	})
}

func ruleLte(value any, param string, _ any) error {
	n, err := strconv.ParseInt(param, 10, 64)
	if err != nil {
		return fmt.Errorf("lte: invalid param %q", param)
	}
	return compareValue(value, n, "lte", func(actual, threshold int64) bool {
		return actual <= threshold
	}, func(actual, threshold float64) bool {
		return actual <= threshold
	})
}

// ──────────────────────────────────────────────
// OneOf
// ──────────────────────────────────────────────

func ruleOneOf(value any, param string, _ any) error {
	options := strings.Fields(param)
	rv := reflect.ValueOf(value)
	var s string
	switch rv.Kind() {
	case reflect.String:
		s = rv.String()
	default:
		s = fmt.Sprint(value)
	}
	for _, opt := range options {
		if s == opt {
			return nil
		}
	}
	return fmt.Errorf("must be one of: %s", param)
}

// ──────────────────────────────────────────────
// String format rules
// ──────────────────────────────────────────────

func ruleEmail(value any, _ string, _ any) error {
	s, ok := value.(string)
	if !ok {
		return ErrInvalidType
	}
	_, err := mail.ParseAddress(s)
	if err != nil {
		return fmt.Errorf("must be a valid email address")
	}
	return nil
}

func ruleURL(value any, _ string, _ any) error {
	s, ok := value.(string)
	if !ok {
		return ErrInvalidType
	}
	u, err := url.Parse(s)
	if err != nil || u.Scheme == "" || u.Host == "" {
		return fmt.Errorf("must be a valid URL")
	}
	return nil
}

func ruleIP(value any, _ string, _ any) error {
	s, ok := value.(string)
	if !ok {
		return ErrInvalidType
	}
	if net.ParseIP(s) == nil {
		return fmt.Errorf("must be a valid IP address")
	}
	return nil
}

func ruleIPv4(value any, _ string, _ any) error {
	s, ok := value.(string)
	if !ok {
		return ErrInvalidType
	}
	ip := net.ParseIP(s)
	if ip == nil || ip.To4() == nil {
		return fmt.Errorf("must be a valid IPv4 address")
	}
	return nil
}

func ruleIPv6(value any, _ string, _ any) error {
	s, ok := value.(string)
	if !ok {
		return ErrInvalidType
	}
	ip := net.ParseIP(s)
	if ip == nil || ip.To4() != nil {
		return fmt.Errorf("must be a valid IPv6 address")
	}
	return nil
}

func ruleAlpha(value any, _ string, _ any) error {
	s, ok := value.(string)
	if !ok {
		return ErrInvalidType
	}
	for _, r := range s {
		if !unicode.IsLetter(r) {
			return fmt.Errorf("must contain only alpha characters")
		}
	}
	return nil
}

func ruleAlphaNum(value any, _ string, _ any) error {
	s, ok := value.(string)
	if !ok {
		return ErrInvalidType
	}
	for _, r := range s {
		if !unicode.IsLetter(r) && !unicode.IsDigit(r) {
			return fmt.Errorf("must contain only alphanumeric characters")
		}
	}
	return nil
}

func ruleNumeric(value any, _ string, _ any) error {
	s, ok := value.(string)
	if !ok {
		return ErrInvalidType
	}
	if s == "" {
		return fmt.Errorf("must contain only numeric characters")
	}
	for _, r := range s {
		if !unicode.IsDigit(r) {
			return fmt.Errorf("must contain only numeric characters")
		}
	}
	return nil
}

func ruleContains(value any, param string, _ any) error {
	s, ok := value.(string)
	if !ok {
		return ErrInvalidType
	}
	if !strings.Contains(s, param) {
		return fmt.Errorf("must contain %q", param)
	}
	return nil
}

func ruleStartsWith(value any, param string, _ any) error {
	s, ok := value.(string)
	if !ok {
		return ErrInvalidType
	}
	if !strings.HasPrefix(s, param) {
		return fmt.Errorf("must start with %q", param)
	}
	return nil
}

func ruleEndsWith(value any, param string, _ any) error {
	s, ok := value.(string)
	if !ok {
		return ErrInvalidType
	}
	if !strings.HasSuffix(s, param) {
		return fmt.Errorf("must end with %q", param)
	}
	return nil
}

func ruleRegex(value any, param string, _ any) error {
	s, ok := value.(string)
	if !ok {
		return ErrInvalidType
	}
	re, err := regexp.Compile(param)
	if err != nil {
		return fmt.Errorf("regex: invalid pattern %q", param)
	}
	if !re.MatchString(s) {
		return fmt.Errorf("must match pattern %q", param)
	}
	return nil
}

// ──────────────────────────────────────────────
// Cross-field rules
// ──────────────────────────────────────────────

func ruleEqField(value any, param string, parent any) error {
	other := extractField(parent, param)
	if !reflect.DeepEqual(value, other) {
		return fmt.Errorf("must equal field %q", param)
	}
	return nil
}

func ruleNeField(value any, param string, parent any) error {
	other := extractField(parent, param)
	if reflect.DeepEqual(value, other) {
		return fmt.Errorf("must not equal field %q", param)
	}
	return nil
}

func ruleGtField(value any, param string, parent any) error {
	return compareFields(value, extractField(parent, param), "gt", func(a, b float64) bool { return a > b })
}

func ruleGteField(value any, param string, parent any) error {
	return compareFields(value, extractField(parent, param), "gte", func(a, b float64) bool { return a >= b })
}

func ruleLteField(value any, param string, parent any) error {
	return compareFields(value, extractField(parent, param), "lte", func(a, b float64) bool { return a <= b })
}

// ──────────────────────────────────────────────
// Unique (slice)
// ──────────────────────────────────────────────

func ruleUnique(value any, _ string, _ any) error {
	rv := reflect.ValueOf(value)
	if rv.Kind() != reflect.Slice && rv.Kind() != reflect.Array {
		return ErrInvalidType
	}
	seen := make(map[any]bool, rv.Len())
	for i := 0; i < rv.Len(); i++ {
		elem := rv.Index(i).Interface()
		if seen[elem] {
			return fmt.Errorf("elements must be unique (duplicate at index %d)", i)
		}
		seen[elem] = true
	}
	return nil
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

func parseNum(s string) int64 {
	n, _ := strconv.ParseInt(s, 10, 64)
	return n
}

// compareValue checks numeric or length constraints.
func compareValue(value any, threshold int64, ruleName string,
	intOK func(actual, threshold int64) bool,
	floatOK func(actual, threshold float64) bool,
) error {
	rv := reflect.ValueOf(value)
	switch rv.Kind() {
	case reflect.String, reflect.Slice, reflect.Array, reflect.Map:
		actual := int64(rv.Len())
		if !intOK(actual, threshold) {
			return fmt.Errorf("%s: length must satisfy %s=%d (got %d)", ruleName, ruleName, threshold, actual)
		}
		return nil
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		actual := rv.Int()
		if !intOK(actual, threshold) {
			return fmt.Errorf("%s: must satisfy %s=%d (got %d)", ruleName, ruleName, threshold, actual)
		}
		return nil
	case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64:
		actual := int64(rv.Uint())
		if !intOK(actual, threshold) {
			return fmt.Errorf("%s: must satisfy %s=%d (got %d)", ruleName, ruleName, threshold, actual)
		}
		return nil
	case reflect.Float32, reflect.Float64:
		actual := rv.Float()
		if !floatOK(actual, float64(threshold)) {
			return fmt.Errorf("%s: must satisfy %s=%d (got %f)", ruleName, ruleName, threshold, actual)
		}
		return nil
	default:
		return fmt.Errorf("%s: unsupported type %T", ruleName, value)
	}
}

func compareFields(a, b any, ruleName string, ok func(a, b float64) bool) error {
	af, aerr := toFloat(a)
	bf, berr := toFloat(b)
	if aerr != nil || berr != nil {
		return fmt.Errorf("%s: cannot compare non-numeric fields", ruleName)
	}
	if !ok(af, bf) {
		return fmt.Errorf("%s: field comparison failed (%f vs %f)", ruleName, af, bf)
	}
	return nil
}

func toFloat(v any) (float64, error) {
	return convert.ToFloat64(v)
}

// extractField navigates a struct (or pointer to struct) to find a
// field by dotted path (e.g. "Address.Street").
func extractField(parent any, path string) any {
	if parent == nil {
		return nil
	}
	rv := reflect.ValueOf(parent)
	for rv.Kind() == reflect.Ptr {
		if rv.IsNil() {
			return nil
		}
		rv = rv.Elem()
	}
	parts := strings.Split(path, ".")
	for _, part := range parts {
		if rv.Kind() != reflect.Struct {
			return nil
		}
		field := rv.FieldByName(part)
		if !field.IsValid() {
			return nil
		}
		rv = field
		for rv.Kind() == reflect.Ptr {
			if rv.IsNil() {
				return nil
			}
			rv = rv.Elem()
		}
	}
	return rv.Interface()
}

// ──────────────────────────────────────────────
// phone / uuid / slug / creditcard / json / base64 / hex
// ──────────────────────────────────────────────

// Pre-compiled regexes for rules that use regex matching.
var (
	phoneRegex      = regexp.MustCompile(`^1[3-9]\d{9}$`)
	uuidRegex       = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)
	uuidV4Regex     = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$`)
	slugRegex       = regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*$`)
	hexRegex        = regexp.MustCompile(`^[0-9a-fA-F]+$`)
)

// rulePhone validates a Chinese mobile phone number: 11 digits starting
// with 1[3-9].
func rulePhone(value any, _ string, _ any) error {
	s, ok := value.(string)
	if !ok {
		return ErrInvalidType
	}
	if !phoneRegex.MatchString(s) {
		return fmt.Errorf("must be a valid Chinese phone number (1[3-9]xxxxxxxxx)")
	}
	return nil
}

// ruleUUID validates a UUID string. By default it accepts any UUID
// version; when the param is "v4" it restricts to UUID v4 format.
func ruleUUID(value any, param string, _ any) error {
	s, ok := value.(string)
	if !ok {
		return ErrInvalidType
	}
	if strings.EqualFold(param, "v4") {
		if !uuidV4Regex.MatchString(s) {
			return fmt.Errorf("must be a valid UUID v4")
		}
		return nil
	}
	if !uuidRegex.MatchString(s) {
		return fmt.Errorf("must be a valid UUID")
	}
	return nil
}

// ruleSlug validates a URL slug: lowercase alphanumeric segments
// separated by single hyphens.
func ruleSlug(value any, _ string, _ any) error {
	s, ok := value.(string)
	if !ok {
		return ErrInvalidType
	}
	if !slugRegex.MatchString(s) {
		return fmt.Errorf("must be a valid slug (lowercase alphanumeric with hyphens)")
	}
	return nil
}

// ruleCreditCard validates a credit card number using the Luhn
// algorithm. Spaces and hyphens are stripped before validation.
func ruleCreditCard(value any, _ string, _ any) error {
	s, ok := value.(string)
	if !ok {
		return ErrInvalidType
	}
	// Strip spaces and hyphens.
	s = strings.ReplaceAll(s, " ", "")
	s = strings.ReplaceAll(s, "-", "")
	if len(s) < 13 || len(s) > 19 {
		return fmt.Errorf("must be a valid credit card number")
	}
	if !luhnCheck(s) {
		return fmt.Errorf("must be a valid credit card number (Luhn check failed)")
	}
	return nil
}

// luhnCheck implements the Luhn checksum algorithm.
func luhnCheck(s string) bool {
	sum := 0
	alt := false
	for i := len(s) - 1; i >= 0; i-- {
		c := s[i]
		if c < '0' || c > '9' {
			return false
		}
		d := int(c - '0')
		if alt {
			d *= 2
			if d > 9 {
				d -= 9
			}
		}
		sum += d
		alt = !alt
	}
	return sum%10 == 0
}

// ruleJSON validates that the string is valid JSON.
func ruleJSON(value any, _ string, _ any) error {
	s, ok := value.(string)
	if !ok {
		return ErrInvalidType
	}
	if !json.Valid([]byte(s)) {
		return fmt.Errorf("must be valid JSON")
	}
	return nil
}

// ruleBase64 validates that the string is valid standard Base64.
func ruleBase64(value any, _ string, _ any) error {
	s, ok := value.(string)
	if !ok {
		return ErrInvalidType
	}
	if s == "" {
		return fmt.Errorf("must be valid Base64")
	}
	if _, err := base64.StdEncoding.DecodeString(s); err != nil {
		return fmt.Errorf("must be valid Base64")
	}
	return nil
}

// ruleHex validates that the string contains only hexadecimal
// characters (0-9, a-f, A-F).
func ruleHex(value any, _ string, _ any) error {
	s, ok := value.(string)
	if !ok {
		return ErrInvalidType
	}
	if s == "" {
		return fmt.Errorf("must be valid hexadecimal")
	}
	if !hexRegex.MatchString(s) {
		return fmt.Errorf("must be valid hexadecimal")
	}
	return nil
}
