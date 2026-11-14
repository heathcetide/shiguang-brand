// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package cron provides cron expression parsing and next-fire-time
// calculation. It implements the standard 5-field cron syntax plus
// optional seconds and descriptors.
//
// # Supported Syntax
//
// Standard 5-field:  minute hour day-of-month month day-of-week
// Optional 6-field:  second minute hour day-of-month month day-of-week
//
//   - *     matches any value
//   - 5     literal value
//   - 1,3,5 comma-separated list
//   - 1-5   range
//   - */2   step (every 2 units)
//   - 1-10/3 range with step
//   - 5L    last weekday of month (e.g. "5L" = last Friday)
//   - 15W   nearest weekday to day 15
//
// # Quick start
//
//	expr, err := cron.Parse("*/5 * * * *")
//	next := expr.Next(time.Now())
//
//	// 6-field with seconds
//	expr, err := cron.Parse("0 */30 * * * *")
//
//	// Descriptors
//	expr, err := cron.Parse("@hourly")
//	expr, err := cron.Parse("@every 10s")
package cron

import (
	"fmt"
	"strconv"
	"strings"
	"time"
)

// ──────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────

// Field bounds.
var (
	minuteBounds = bounds{0, 59}
	hourBounds   = bounds{0, 23}
	domBounds    = bounds{1, 31}
	monthBounds  = bounds{1, 12}
	dowBounds    = bounds{0, 6} // 0=Sun, 6=Sat
	secondBounds = bounds{0, 59}
)

type bounds struct{ min, max int }

// Month and weekday names for named parsing.
var (
	monthNames = map[string]int{
		"jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
		"jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
	}
	dowNames = map[string]int{
		"sun": 0, "mon": 1, "tue": 2, "wed": 3, "thu": 4, "fri": 5, "sat": 6,
	}
)

// ──────────────────────────────────────────────
// Expression
// ──────────────────────────────────────────────

// Expression represents a parsed cron expression.
type Expression struct {
	second     uint64 // bitmask of seconds (0-59)
	minute     uint64 // bitmask of minutes (0-59)
	hour       uint64 // bitmask of hours (0-23)
	dayOfMonth uint64 // bitmask of days (1-31)
	month      uint64 // bitmask of months (1-12)
	dayOfWeek  uint64 // bitmask of weekdays (0-6)

	hasSeconds bool

	// Special flags
	lastDOM       bool // L in day-of-month
	lastDOW       int  // xL in day-of-week (-1 if not set)
	nearestW      int  // xW in day-of-month (-1 if not set)
	domRestricted bool // day-of-month is not *
	dowRestricted bool // day-of-week is not *

	// @every duration
	everyDuration time.Duration
	isEvery       bool

	// Original text
	original string
}

// String returns the original expression text.
func (e *Expression) String() string {
	return e.original
}

// HasSeconds returns true if the expression includes a seconds field.
func (e *Expression) HasSeconds() bool {
	return e.hasSeconds
}

// IsEvery returns true if the expression is an @every descriptor.
func (e *Expression) IsEvery() bool {
	return e.isEvery
}

// EveryDuration returns the duration for @every expressions.
// Returns 0 for non-@every expressions.
func (e *Expression) EveryDuration() time.Duration {
	return e.everyDuration
}

// ──────────────────────────────────────────────
// Parsing
// ──────────────────────────────────────────────

// Parse parses a cron expression string.
// Supports 5-field, 6-field, and descriptor (@hourly, @every, etc.) syntax.
func Parse(expr string) (*Expression, error) {
	expr = strings.TrimSpace(expr)
	if expr == "" {
		return nil, fmt.Errorf("cron: empty expression")
	}

	// Check for descriptors.
	if strings.HasPrefix(expr, "@") {
		return parseDescriptor(expr)
	}

	fields := strings.Fields(expr)
	var e Expression
	e.original = expr
	e.lastDOW = -1
	e.nearestW = -1

	switch len(fields) {
	case 5:
		e.hasSeconds = false
		fields = append([]string{"0"}, fields...) // prepend second=0
	case 6:
		e.hasSeconds = true
	default:
		return nil, fmt.Errorf("cron: expected 5 or 6 fields, got %d", len(fields))
	}

	var err error

	e.second, err = parseField(fields[0], secondBounds, nil)
	if err != nil {
		return nil, fmt.Errorf("cron: second field: %w", err)
	}

	e.minute, err = parseField(fields[1], minuteBounds, nil)
	if err != nil {
		return nil, fmt.Errorf("cron: minute field: %w", err)
	}

	e.hour, err = parseField(fields[2], hourBounds, nil)
	if err != nil {
		return nil, fmt.Errorf("cron: hour field: %w", err)
	}

	// day-of-month: may contain L or W
	e.dayOfMonth, e.lastDOM, e.nearestW, err = parseDOMField(fields[3])
	if err != nil {
		return nil, fmt.Errorf("cron: day-of-month field: %w", err)
	}
	e.domRestricted = fields[3] != "*"

	// month: supports names
	e.month, err = parseField(fields[4], monthBounds, monthNames)
	if err != nil {
		return nil, fmt.Errorf("cron: month field: %w", err)
	}

	// day-of-week: supports names and L
	e.dayOfWeek, e.lastDOW, err = parseDOWField(fields[5])
	if err != nil {
		return nil, fmt.Errorf("cron: day-of-week field: %w", err)
	}
	e.dowRestricted = fields[5] != "*"

	return &e, nil
}

// MustParse is like Parse but panics on error.
func MustParse(expr string) *Expression {
	e, err := Parse(expr)
	if err != nil {
		panic(err)
	}
	return e
}

// parseField parses a cron field into a bitmask.
func parseField(field string, b bounds, names map[string]int) (uint64, error) {
	if field == "*" {
		return allBits(b), nil
	}

	var bits uint64
	for _, part := range strings.Split(field, ",") {
		partBits, err := parsePart(part, b, names)
		if err != nil {
			return 0, err
		}
		bits |= partBits
	}
	return bits, nil
}

// parsePart parses a single part of a cron field (e.g. "1-5", "*/2", "3").
func parsePart(part string, b bounds, names map[string]int) (uint64, error) {
	// Handle step.
	var rangePart, stepStr string
	if idx := strings.Index(part, "/"); idx >= 0 {
		rangePart = part[:idx]
		stepStr = part[idx+1:]
	} else {
		rangePart = part
	}

	step := 1
	if stepStr != "" {
		s, err := strconv.Atoi(stepStr)
		if err != nil || s <= 0 {
			return 0, fmt.Errorf("invalid step %q", stepStr)
		}
		step = s
	}

	// Handle range or single value.
	var low, high int
	if rangePart == "*" {
		low = b.min
		high = b.max
	} else if idx := strings.Index(rangePart, "-"); idx >= 0 {
		lowStr := rangePart[:idx]
		highStr := rangePart[idx+1:]
		low = parseValue(lowStr, names)
		high = parseValue(highStr, names)
		if low < 0 || high < 0 {
			return 0, fmt.Errorf("invalid range %q", rangePart)
		}
	} else {
		v := parseValue(rangePart, names)
		if v < 0 {
			return 0, fmt.Errorf("invalid value %q", rangePart)
		}
		low = v
		if stepStr == "" {
			high = v
		} else {
			high = b.max
		}
	}

	// Validate bounds.
	if low < b.min || high > b.max || low > high {
		return 0, fmt.Errorf("value out of range [%d-%d]: %d-%d", b.min, b.max, low, high)
	}

	var bits uint64
	for i := low; i <= high; i += step {
		bits |= 1 << uint(i)
	}
	return bits, nil
}

// parseValue parses a single value, supporting named values.
func parseValue(s string, names map[string]int) int {
	s = strings.ToLower(strings.TrimSpace(s))
	if names != nil {
		if v, ok := names[s]; ok {
			return v
		}
	}
	v, err := strconv.Atoi(s)
	if err != nil {
		return -1
	}
	return v
}

// parseDOMField parses the day-of-month field, handling L and W.
func parseDOMField(field string) (bits uint64, lastDOM bool, nearestW int, err error) {
	nearestW = -1

	if field == "*" {
		return allBits(domBounds), false, -1, nil
	}

	// Check for L (last day of month).
	if field == "L" {
		return 0, true, -1, nil
	}

	// Check for xW (nearest weekday).
	if strings.HasSuffix(field, "W") {
		dayStr := field[:len(field)-1]
		day, e := strconv.Atoi(dayStr)
		if e != nil || day < 1 || day > 31 {
			return 0, false, -1, fmt.Errorf("invalid W day %q", field)
		}
		return 0, false, day, nil
	}

	// Normal parsing.
	bits, err = parseField(field, domBounds, nil)
	return bits, false, -1, err
}

// parseDOWField parses the day-of-week field, handling L.
func parseDOWField(field string) (bits uint64, lastDOW int, err error) {
	lastDOW = -1

	if field == "*" {
		return allBits(dowBounds), -1, nil
	}

	// Check for xL (last weekday of month).
	if strings.HasSuffix(field, "L") {
		dayStr := field[:len(field)-1]
		day := parseValue(dayStr, dowNames)
		if day < 0 || day > 6 {
			return 0, -1, fmt.Errorf("invalid L weekday %q", field)
		}
		return 0, day, nil
	}

	bits, err = parseField(field, dowBounds, dowNames)
	return bits, -1, err
}

// allBits returns a bitmask with all bits set in the range [min, max].
func allBits(b bounds) uint64 {
	var bits uint64
	for i := b.min; i <= b.max; i++ {
		bits |= 1 << uint(i)
	}
	return bits
}

// ──────────────────────────────────────────────
// Descriptors
// ──────────────────────────────────────────────

// parseDescriptor parses @-style descriptors.
func parseDescriptor(expr string) (*Expression, error) {
	parts := strings.Fields(expr)
	if len(parts) == 0 {
		return nil, fmt.Errorf("cron: empty descriptor")
	}

	desc := strings.ToLower(parts[0])
	e := &Expression{original: expr, lastDOW: -1, nearestW: -1}

	switch desc {
	case "@yearly", "@annually":
		return parseDescriptorFields(e, "0", "0", "0", "1", "1", "*")
	case "@monthly":
		return parseDescriptorFields(e, "0", "0", "0", "1", "*", "*")
	case "@weekly":
		return parseDescriptorFields(e, "0", "0", "0", "*", "*", "0")
	case "@daily", "@midnight":
		return parseDescriptorFields(e, "0", "0", "0", "*", "*", "*")
	case "@hourly":
		return parseDescriptorFields(e, "0", "0", "*", "*", "*", "*")
	case "@every":
		if len(parts) < 2 {
			return nil, fmt.Errorf("cron: @every requires a duration")
		}
		dur, err := time.ParseDuration(parts[1])
		if err != nil {
			return nil, fmt.Errorf("cron: @every invalid duration %q: %w", parts[1], err)
		}
		if dur <= 0 {
			return nil, fmt.Errorf("cron: @every duration must be positive")
		}
		e.isEvery = true
		e.everyDuration = dur
		return e, nil
	default:
		return nil, fmt.Errorf("cron: unknown descriptor %q", desc)
	}
}

// parseDescriptorFields fills in the expression fields from string values.
func parseDescriptorFields(e *Expression, sec, min, hr, dom, mon, dow string) (*Expression, error) {
	var err error
	e.second, err = parseField(sec, secondBounds, nil)
	if err != nil {
		return nil, err
	}
	e.minute, err = parseField(min, minuteBounds, nil)
	if err != nil {
		return nil, err
	}
	e.hour, err = parseField(hr, hourBounds, nil)
	if err != nil {
		return nil, err
	}
	e.dayOfMonth, err = parseField(dom, domBounds, nil)
	if err != nil {
		return nil, err
	}
	e.month, err = parseField(mon, monthBounds, nil)
	if err != nil {
		return nil, err
	}
	e.dayOfWeek, err = parseField(dow, dowBounds, dowNames)
	if err != nil {
		return nil, err
	}
	e.domRestricted = dom != "*"
	e.dowRestricted = dow != "*"
	return e, nil
}

// ──────────────────────────────────────────────
// Next: calculate next fire time
// ──────────────────────────────────────────────

// Next returns the next time after t that the expression should fire.
// If t is zero, it uses time.Now(). Returns an error if no future
// fire time is found within 5 years.
func (e *Expression) Next(t time.Time) (time.Time, error) {
	if e.isEvery {
		if t.IsZero() {
			t = time.Now()
		}
		return t.Truncate(e.everyDuration).Add(e.everyDuration), nil
	}

	if t.IsZero() {
		t = time.Now()
	}

	// Start from the next second.
	t = t.Add(time.Second - time.Duration(t.Nanosecond())*time.Nanosecond)

	// Limit search to 5 years.
	limit := t.AddDate(5, 0, 0)

	for {
		// Check month.
		if !bitSet(e.month, int(t.Month())) {
			// Advance to the first of next month with valid month.
			t = time.Date(t.Year(), t.Month(), 1, 0, 0, 0, 0, t.Location()).AddDate(0, 1, 0)
			if t.After(limit) {
				return time.Time{}, fmt.Errorf("cron: no fire time found within 5 years")
			}
			continue
		}

		// Check day.
		if !e.matchDay(t) {
			t = time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, t.Location()).AddDate(0, 0, 1)
			continue
		}

		// Check hour.
		if !bitSet(e.hour, t.Hour()) {
			t = t.Add(time.Hour - time.Duration(t.Minute())*time.Minute - time.Duration(t.Second())*time.Second)
			continue
		}

		// Check minute.
		if !bitSet(e.minute, t.Minute()) {
			t = t.Add(time.Minute - time.Duration(t.Second())*time.Second)
			continue
		}

		// Check second (if 6-field).
		if e.hasSeconds {
			if !bitSet(e.second, t.Second()) {
				t = t.Add(time.Second)
				continue
			}
		} else if t.Second() != 0 {
			t = t.Add(time.Second)
			continue
		}

		// All fields match.
		return t, nil
	}
}

// matchDay checks if the day-of-month and day-of-week match.
func (e *Expression) matchDay(t time.Time) bool {
	// Handle special day-of-month flags.
	if e.lastDOM {
		// Last day of month.
		lastDay := lastDayOfMonth(t)
		return t.Day() == lastDay
	}

	if e.nearestW > 0 {
		// Nearest weekday to the given day.
		target := e.nearestW
		lastDay := lastDayOfMonth(t)
		if target > lastDay {
			target = lastDay
		}
		// Find nearest weekday (Mon-Fri) to target.
		targetDate := time.Date(t.Year(), t.Month(), target, 0, 0, 0, 0, t.Location())
		wd := targetDate.Weekday()
		var nearestDay int
		switch wd {
		case time.Saturday:
			if target == 1 {
				nearestDay = 3 // Monday
			} else {
				nearestDay = target - 1 // Friday
			}
		case time.Sunday:
			if target == lastDay {
				nearestDay = lastDay - 2 // Friday
			} else {
				nearestDay = target + 1 // Monday
			}
		default:
			nearestDay = target
		}
		return t.Day() == nearestDay
	}

	// Standard DOM/DOW matching.
	// Cron behavior: if both DOM and DOW are restricted, match if EITHER matches.
	// If only one is restricted, match that one.
	domMatch := bitSet(e.dayOfMonth, t.Day())
	dowMatch := bitSet(e.dayOfWeek, int(t.Weekday()))

	if e.lastDOW >= 0 {
		// Last specific weekday of month.
		wd := int(t.Weekday())
		if wd != e.lastDOW {
			return false
		}
		// Check if this is the last occurrence.
		nextWeek := t.AddDate(0, 0, 7)
		return nextWeek.Month() != t.Month()
	}

	if e.domRestricted && e.dowRestricted {
		return domMatch || dowMatch
	}
	if e.domRestricted {
		return domMatch
	}
	if e.dowRestricted {
		return dowMatch
	}
	return true // both are *
}

// bitSet returns true if bit n is set in the bitmask.
func bitSet(bits uint64, n int) bool {
	return bits&(1<<uint(n)) != 0
}

// lastDayOfMonth returns the last day of the month for the given time.
func lastDayOfMonth(t time.Time) int {
	return time.Date(t.Year(), t.Month(), 1, 0, 0, 0, 0, t.Location()).
		AddDate(0, 1, 0).Add(-time.Nanosecond).Day()
}

// ──────────────────────────────────────────────
// Schedule helper
// ──────────────────────────────────────────────

// Schedule represents a sequence of fire times.
type Schedule struct {
	expr *Expression
	last time.Time
}

// NewSchedule creates a schedule from a parsed expression.
func NewSchedule(expr *Expression) *Schedule {
	return &Schedule{expr: expr}
}

// Next returns the next fire time after the last call to Next.
// The first call returns the next fire time after time.Now().
func (s *Schedule) Next() (time.Time, error) {
	t := s.last
	if t.IsZero() {
		t = time.Now()
	}
	next, err := s.expr.Next(t)
	if err != nil {
		return time.Time{}, err
	}
	s.last = next
	return next, nil
}

// Reset resets the schedule so the next call to Next uses time.Now().
func (s *Schedule) Reset() {
	s.last = time.Time{}
}

// ──────────────────────────────────────────────
// Validation
// ──────────────────────────────────────────────

// Validate checks if a cron expression is valid without fully parsing it.
func Validate(expr string) error {
	_, err := Parse(expr)
	return err
}
