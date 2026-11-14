// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package nltime parses natural-language time expressions into
// time.Time or time.Duration values.
//
// # Supported Expressions
//
//   - Relative: "3 days ago", "in 2 hours", "5 minutes from now"
//   - Absolute: "yesterday", "today", "tomorrow", "now"
//   - Short: "3d ago", "2h from now", "5m ago", "10s later"
//   - Named: "next monday", "last friday", "this weekend"
//   - Time of day: "3pm", "10:30", "noon", "midnight"
//   - Combined: "tomorrow at 3pm", "next monday 10:00"
//
// # Quick start
//
//	t, err := nltime.Parse("3 days ago", time.Now())
//	t, err := nltime.Parse("tomorrow at 3pm", time.Now())
//	d, err := nltime.ParseDuration("2 hours 30 minutes")
package nltime

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// ──────────────────────────────────────────────
// Parse
// ──────────────────────────────────────────────

// Parse parses a natural-language time expression relative to `now`.
// Returns the parsed time and an error if the expression is not understood.
func Parse(expr string, now time.Time) (time.Time, error) {
	expr = strings.TrimSpace(strings.ToLower(expr))
	if expr == "" {
		return time.Time{}, fmt.Errorf("nltime: empty expression")
	}

	if now.IsZero() {
		now = time.Now()
	}

	// Try simple keywords first.
	if t, ok := parseKeyword(expr, now); ok {
		return t, nil
	}

	// Try "X units ago/from now/later".
	if t, ok := parseRelative(expr, now); ok {
		return t, nil
	}

	// Try "next/last <weekday>".
	if t, ok := parseWeekdayRef(expr, now); ok {
		return t, nil
	}

	// Try "tomorrow at <time>" / "yesterday at <time>".
	if t, ok := parseCombinedDateTime(expr, now); ok {
		return t, nil
	}

	// Try time-of-day expressions.
	if t, ok := parseTimeOfDay(expr, now); ok {
		return t, nil
	}

	return time.Time{}, fmt.Errorf("nltime: cannot parse %q", expr)
}

// MustParse is like Parse but panics on error.
func MustParse(expr string, now time.Time) time.Time {
	t, err := Parse(expr, now)
	if err != nil {
		panic(err)
	}
	return t
}

// ──────────────────────────────────────────────
// Keywords
// ──────────────────────────────────────────────

func parseKeyword(expr string, now time.Time) (time.Time, bool) {
	switch expr {
	case "now":
		return now, true
	case "today":
		return startOfDay(now), true
	case "yesterday":
		return startOfDay(now.AddDate(0, 0, -1)), true
	case "tomorrow":
		return startOfDay(now.AddDate(0, 0, 1)), true
	case "noon":
		return time.Date(now.Year(), now.Month(), now.Day(), 12, 0, 0, 0, now.Location()), true
	case "midnight":
		return startOfDay(now), true
	case "this morning":
		return time.Date(now.Year(), now.Month(), now.Day(), 8, 0, 0, 0, now.Location()), true
	case "this afternoon":
		return time.Date(now.Year(), now.Month(), now.Day(), 14, 0, 0, 0, now.Location()), true
	case "this evening":
		return time.Date(now.Year(), now.Month(), now.Day(), 18, 0, 0, 0, now.Location()), true
	}
	return time.Time{}, false
}

// ──────────────────────────────────────────────
// Relative: "3 days ago", "in 2 hours", "5m from now"
// ──────────────────────────────────────────────

var relativeRe = regexp.MustCompile(`(?i)^(?:in\s+)?(\d+)\s*([a-z]+)\s*(?:ago|from\s+now|later|from\s+today|back)?$`)

func parseRelative(expr string, now time.Time) (time.Time, bool) {
	// Handle "ago" and "from now" / "later".
	m := relativeRe.FindStringSubmatch(expr)
	if m == nil {
		return time.Time{}, false
	}

	n, err := strconv.Atoi(m[1])
	if err != nil {
		return time.Time{}, false
	}

	unit := normalizeUnit(m[2])
	dur, ok := unitToDuration(n, unit)
	if !ok {
		return time.Time{}, false
	}

	// Determine direction.
	lower := strings.ToLower(expr)
	if strings.Contains(lower, "ago") || strings.Contains(lower, "back") {
		return now.Add(-dur), true
	}
	return now.Add(dur), true
}

// normalizeUnit normalizes unit aliases.
func normalizeUnit(u string) string {
	switch strings.ToLower(u) {
	case "s", "sec", "secs", "second", "seconds":
		return "second"
	case "m", "min", "mins", "minute", "minutes":
		return "minute"
	case "h", "hr", "hrs", "hour", "hours":
		return "hour"
	case "d", "day", "days":
		return "day"
	case "w", "wk", "week", "weeks":
		return "week"
	case "mo", "mon", "month", "months":
		return "month"
	case "y", "yr", "year", "years":
		return "year"
	}
	return u
}

// unitToDuration converts a count + unit to a time.Duration.
// For months and years, it uses approximate durations (30/365 days).
func unitToDuration(n int, unit string) (time.Duration, bool) {
	switch unit {
	case "second":
		return time.Duration(n) * time.Second, true
	case "minute":
		return time.Duration(n) * time.Minute, true
	case "hour":
		return time.Duration(n) * time.Hour, true
	case "day":
		return time.Duration(n) * 24 * time.Hour, true
	case "week":
		return time.Duration(n) * 7 * 24 * time.Hour, true
	case "month":
		return time.Duration(n) * 30 * 24 * time.Hour, true // approximate
	case "year":
		return time.Duration(n) * 365 * 24 * time.Hour, true // approximate
	}
	return 0, false
}

// ──────────────────────────────────────────────
// Weekday references: "next monday", "last friday"
// ──────────────────────────────────────────────

var weekdayRefRe = regexp.MustCompile(`(?i)^(next|last|this|previous)\s+(\w+)$`)

func parseWeekdayRef(expr string, now time.Time) (time.Time, bool) {
	m := weekdayRefRe.FindStringSubmatch(expr)
	if m == nil {
		return time.Time{}, false
	}

	dir := strings.ToLower(m[1])
	wdName := strings.ToLower(m[2])

	// Check if it's a weekday name.
	wd, ok := parseWeekdayName(wdName)
	if !ok {
		// Check for "weekend".
		if wdName == "weekend" {
			return nextWeekend(now, dir), true
		}
		return time.Time{}, false
	}

	switch dir {
	case "next":
		return nextWeekday(now, wd), true
	case "last", "previous":
		return lastWeekday(now, wd), true
	case "this":
		// "this monday" = the monday of the current week.
		return thisWeekday(now, wd), true
	}
	return time.Time{}, false
}

// parseWeekdayName converts a weekday name to time.Weekday.
func parseWeekdayName(s string) (time.Weekday, bool) {
	weekdays := map[string]time.Weekday{
		"sunday":    time.Sunday,
		"sun":       time.Sunday,
		"monday":    time.Monday,
		"mon":       time.Monday,
		"tuesday":   time.Tuesday,
		"tue":       time.Tuesday,
		"tues":      time.Tuesday,
		"wednesday": time.Wednesday,
		"wed":       time.Wednesday,
		"thursday":  time.Thursday,
		"thu":       time.Thursday,
		"thur":      time.Thursday,
		"thurs":     time.Thursday,
		"friday":    time.Friday,
		"fri":       time.Friday,
		"saturday":  time.Saturday,
		"sat":       time.Saturday,
	}
	wd, ok := weekdays[strings.ToLower(s)]
	return wd, ok
}

// nextWeekday returns the next occurrence of the given weekday after now.
func nextWeekday(now time.Time, wd time.Weekday) time.Time {
	daysAhead := (int(wd) - int(now.Weekday()) + 7) % 7
	if daysAhead == 0 {
		daysAhead = 7 // next week's same day
	}
	return startOfDay(now.AddDate(0, 0, daysAhead))
}

// lastWeekday returns the previous occurrence of the given weekday before now.
func lastWeekday(now time.Time, wd time.Weekday) time.Time {
	daysBack := (int(now.Weekday()) - int(wd) + 7) % 7
	if daysBack == 0 {
		daysBack = 7
	}
	return startOfDay(now.AddDate(0, 0, -daysBack))
}

// thisWeekday returns the weekday of the current week.
func thisWeekday(now time.Time, wd time.Weekday) time.Time {
	// Week starts on Monday.
	currentWeekday := int(now.Weekday())
	if currentWeekday == 0 {
		currentWeekday = 7 // Sunday
	}
	targetWeekday := int(wd)
	if targetWeekday == 0 {
		targetWeekday = 7
	}
	delta := targetWeekday - currentWeekday
	return startOfDay(now.AddDate(0, 0, delta))
}

// nextWeekend returns the next or last weekend (Saturday).
func nextWeekend(now time.Time, dir string) time.Time {
	if dir == "next" {
		return nextWeekday(now, time.Saturday)
	}
	return lastWeekday(now, time.Saturday)
}

// ──────────────────────────────────────────────
// Combined: "tomorrow at 3pm", "yesterday at 10:30"
// ──────────────────────────────────────────────

var combinedRe = regexp.MustCompile(`(?i)^(yesterday|today|tomorrow)\s+at\s+(.+)$`)

func parseCombinedDateTime(expr string, now time.Time) (time.Time, bool) {
	m := combinedRe.FindStringSubmatch(expr)
	if m == nil {
		return time.Time{}, false
	}

	dayKeyword := strings.ToLower(m[1])
	timePart := strings.TrimSpace(m[2])

	// Get the base day.
	var baseDay time.Time
	switch dayKeyword {
	case "yesterday":
		baseDay = now.AddDate(0, 0, -1)
	case "today":
		baseDay = now
	case "tomorrow":
		baseDay = now.AddDate(0, 0, 1)
	}

	// Parse the time part.
	hour, minute, ok := parseTimeString(timePart)
	if !ok {
		return time.Time{}, false
	}

	return time.Date(baseDay.Year(), baseDay.Month(), baseDay.Day(),
		hour, minute, 0, 0, now.Location()), true
}

// ──────────────────────────────────────────────
// Time of day: "3pm", "10:30", "10:30am"
// ──────────────────────────────────────────────

var timeRe = regexp.MustCompile(`^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$`)

func parseTimeOfDay(expr string, now time.Time) (time.Time, bool) {
	hour, minute, ok := parseTimeString(expr)
	if !ok {
		return time.Time{}, false
	}
	return time.Date(now.Year(), now.Month(), now.Day(),
		hour, minute, 0, 0, now.Location()), true
}

// parseTimeString parses a time string like "3pm", "10:30", "10:30am".
// Returns hour (0-23), minute (0-59), and ok.
func parseTimeString(s string) (int, int, bool) {
	s = strings.TrimSpace(strings.ToLower(s))
	if s == "noon" {
		return 12, 0, true
	}
	if s == "midnight" {
		return 0, 0, true
	}

	m := timeRe.FindStringSubmatch(s)
	if m == nil {
		return 0, 0, false
	}

	hour, err := strconv.Atoi(m[1])
	if err != nil || hour < 0 || hour > 23 {
		return 0, 0, false
	}

	minute := 0
	if m[2] != "" {
		minute, err = strconv.Atoi(m[2])
		if err != nil || minute < 0 || minute > 59 {
			return 0, 0, false
		}
	}

	// Handle AM/PM.
	ampm := m[3]
	if ampm == "pm" && hour < 12 {
		hour += 12
	} else if ampm == "am" && hour == 12 {
		hour = 0
	}

	return hour, minute, true
}

// ──────────────────────────────────────────────
// ParseDuration: "2 hours 30 minutes", "1d 2h"
// ──────────────────────────────────────────────

var durationPartRe = regexp.MustCompile(`(\d+)\s*([a-z]+)`)

// ParseDuration parses a natural-language duration string.
// Supports compound expressions like "2 hours 30 minutes" or "1d 2h 30m".
// Returns the total duration.
func ParseDuration(expr string) (time.Duration, error) {
	expr = strings.ToLower(strings.TrimSpace(expr))
	if expr == "" {
		return 0, fmt.Errorf("nltime: empty duration")
	}

	// Try standard Go duration first.
	if d, err := time.ParseDuration(expr); err == nil {
		return d, nil
	}

	matches := durationPartRe.FindAllStringSubmatch(expr, -1)
	if len(matches) == 0 {
		return 0, fmt.Errorf("nltime: cannot parse duration %q", expr)
	}

	var total time.Duration
	for _, m := range matches {
		n, err := strconv.Atoi(m[1])
		if err != nil {
			return 0, fmt.Errorf("nltime: invalid number %q", m[1])
		}
		unit := normalizeUnit(m[2])
		dur, ok := unitToDuration(n, unit)
		if !ok {
			return 0, fmt.Errorf("nltime: unknown unit %q", m[2])
		}
		total += dur
	}
	return total, nil
}

// MustParseDuration is like ParseDuration but panics on error.
func MustParseDuration(expr string) time.Duration {
	d, err := ParseDuration(expr)
	if err != nil {
		panic(err)
	}
	return d
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

func startOfDay(t time.Time) time.Time {
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, t.Location())
}
