// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package timeutil provides time utilities:
//
//   - Formatting & parsing with timezone support
//   - Time ranges (start/end of day, week, month, year)
//   - Timers (stopwatch, countdown, debounce)
//   - Common duration helpers
//   - Business-day calculations
//
// # Quick start
//
//	// Format with timezone
//	timeutil.FormatIn(time.Now(), "2006-01-02 15:04:05", "Asia/Shanghai")
//
//	// Parse with timezone
//	t, err := timeutil.ParseIn("2026-08-15 10:00:00", "2006-01-02 15:04:05", "Asia/Shanghai")
//
//	// Start of day in local timezone
//	start := timeutil.StartOfDay(time.Now())
//
//	// Stopwatch
//	sw := timeutil.NewStopwatch()
//	sw.Start()
//	// ... do work ...
//	elapsed := sw.Elapsed()
package timeutil

import (
	"fmt"
	"sync"
	"time"
)

// ──────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────

// Common time formats.
const (
	LayoutDate      = "2006-01-02"
	LayoutDateTime  = "2006-01-02 15:04:05"
	LayoutTime      = "15:04:05"
	LayoutISO8601   = "2006-01-02T15:04:05Z07:00"
	LayoutRFC3339   = time.RFC3339
	LayoutRFC822    = "02 Jan 06 15:04 MST"
	LayoutRFC1123   = "Mon, 02 Jan 2006 15:04:05 MST"
	LayoutUnix      = "2006-01-02 15:04:05 -0700 MST"
	LayoutTimestamp = "20060102150405"
	LayoutSlash     = "2006/01/02 15:04:05"
	LayoutCNDate    = "2006年01月02日"
	LayoutCNTime    = "2006年01月02日 15时04分05秒"
)

// Common durations for convenience.
const (
	Nanosecond  = time.Nanosecond
	Microsecond = time.Microsecond
	Millisecond = time.Millisecond
	Second      = time.Second
	Minute      = time.Minute
	Hour        = time.Hour
	Day         = 24 * time.Hour
	Week        = 7 * 24 * time.Hour
)

// ──────────────────────────────────────────────
// Timezone helpers
// ──────────────────────────────────────────────

// Location returns the *time.Location for the given name.
// Returns time.Local if name is empty or "Local".
// Returns time.UTC if name is "UTC".
// Returns an error for unknown timezone names.
func Location(name string) (*time.Location, error) {
	switch name {
	case "", "Local":
		return time.Local, nil
	case "UTC":
		return time.UTC, nil
	}
	return time.LoadLocation(name)
}

// MustLocation is like Location but panics on error.
func MustLocation(name string) *time.Location {
	loc, err := Location(name)
	if err != nil {
		panic(fmt.Sprintf("timeutil: unknown location %q: %v", name, err))
	}
	return loc
}

// In converts a time to the given timezone.
func In(t time.Time, loc *time.Location) time.Time {
	return t.In(loc)
}

// InLocation converts a time to the named timezone.
func InLocation(t time.Time, name string) (time.Time, error) {
	loc, err := Location(name)
	if err != nil {
		return t, err
	}
	return t.In(loc), nil
}

// MustInLocation converts a time to the named timezone, panicking on error.
func MustInLocation(t time.Time, name string) time.Time {
	return t.In(MustLocation(name))
}

// ──────────────────────────────────────────────
// Formatting & parsing
// ──────────────────────────────────────────────

// Format formats a time using the given layout in the local timezone.
func Format(t time.Time, layout string) string {
	return t.Format(layout)
}

// FormatIn formats a time using the given layout in the specified timezone.
func FormatIn(t time.Time, layout, locName string) string {
	loc := MustLocation(locName)
	return t.In(loc).Format(layout)
}

// FormatUTC formats a time using the given layout in UTC.
func FormatUTC(t time.Time, layout string) string {
	return t.UTC().Format(layout)
}

// Parse parses a time string using the given layout in the local timezone.
func Parse(value, layout string) (time.Time, error) {
	return time.Parse(layout, value)
}

// ParseIn parses a time string using the given layout in the specified timezone.
// The parsed time is adjusted to the given location.
func ParseIn(value, layout, locName string) (time.Time, error) {
	loc, err := Location(locName)
	if err != nil {
		return time.Time{}, err
	}
	return time.ParseInLocation(layout, value, loc)
}

// ParseLocal parses a time string using the given layout in the local timezone.
func ParseLocal(value, layout string) (time.Time, error) {
	return time.ParseInLocation(layout, value, time.Local)
}

// ParseUTC parses a time string using the given layout in UTC.
func ParseUTC(value, layout string) (time.Time, error) {
	return time.ParseInLocation(layout, value, time.UTC)
}

// MustParse parses a time string, panicking on error.
func MustParse(value, layout string) time.Time {
	t, err := time.Parse(layout, value)
	if err != nil {
		panic(fmt.Sprintf("timeutil: parse %q with layout %q: %v", value, layout, err))
	}
	return t
}

// FormatTimestamp returns the time as a Unix-style timestamp string
// (e.g. "20260815100000").
func FormatTimestamp(t time.Time) string {
	return t.Format(LayoutTimestamp)
}

// FormatDate returns the date part as "2006-01-02".
func FormatDate(t time.Time) string {
	return t.Format(LayoutDate)
}

// FormatDateTime returns the time as "2006-01-02 15:04:05".
func FormatDateTime(t time.Time) string {
	return t.Format(LayoutDateTime)
}

// ──────────────────────────────────────────────
// Time range helpers
// ──────────────────────────────────────────────

// StartOfDay returns the start of the day (00:00:00) for the given time.
func StartOfDay(t time.Time) time.Time {
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, t.Location())
}

// EndOfDay returns the end of the day (23:59:59.999999999) for the given time.
func EndOfDay(t time.Time) time.Time {
	return time.Date(t.Year(), t.Month(), t.Day(), 23, 59, 59, 999999999, t.Location())
}

// StartOfHour returns the start of the hour for the given time.
func StartOfHour(t time.Time) time.Time {
	return time.Date(t.Year(), t.Month(), t.Day(), t.Hour(), 0, 0, 0, t.Location())
}

// EndOfHour returns the end of the hour for the given time.
func EndOfHour(t time.Time) time.Time {
	return time.Date(t.Year(), t.Month(), t.Day(), t.Hour(), 59, 59, 999999999, t.Location())
}

// StartOfMinute returns the start of the minute for the given time.
func StartOfMinute(t time.Time) time.Time {
	return time.Date(t.Year(), t.Month(), t.Day(), t.Hour(), t.Minute(), 0, 0, t.Location())
}

// EndOfMinute returns the end of the minute for the given time.
func EndOfMinute(t time.Time) time.Time {
	return time.Date(t.Year(), t.Month(), t.Day(), t.Hour(), t.Minute(), 59, 999999999, t.Location())
}

// StartOfWeek returns the start of the week (Monday 00:00:00) for the given time.
func StartOfWeek(t time.Time) time.Time {
	// Go's Weekday: Sunday=0, Monday=1, ..., Saturday=6.
	// We want Monday as the first day.
	weekday := int(t.Weekday())
	if weekday == 0 {
		weekday = 7 // Sunday → 7
	}
	daysFromMonday := weekday - 1
	start := StartOfDay(t)
	return start.AddDate(0, 0, -daysFromMonday)
}

// EndOfWeek returns the end of the week (Sunday 23:59:59.999999999).
func EndOfWeek(t time.Time) time.Time {
	return StartOfWeek(t).AddDate(0, 0, 7).Add(-time.Nanosecond)
}

// StartOfMonth returns the start of the month (1st day 00:00:00).
func StartOfMonth(t time.Time) time.Time {
	return time.Date(t.Year(), t.Month(), 1, 0, 0, 0, 0, t.Location())
}

// EndOfMonth returns the end of the month (last day 23:59:59.999999999).
func EndOfMonth(t time.Time) time.Time {
	return StartOfMonth(t).AddDate(0, 1, 0).Add(-time.Nanosecond)
}

// StartOfYear returns January 1st 00:00:00 of the given time's year.
func StartOfYear(t time.Time) time.Time {
	return time.Date(t.Year(), 1, 1, 0, 0, 0, 0, t.Location())
}

// EndOfYear returns December 31st 23:59:59.999999999 of the given time's year.
func EndOfYear(t time.Time) time.Time {
	return StartOfYear(t).AddDate(1, 0, 0).Add(-time.Nanosecond)
}

// DaysInMonth returns the number of days in the month of the given time.
func DaysInMonth(t time.Time) int {
	return EndOfMonth(t).Day()
}

// IsLeapYear returns true if the year of the given time is a leap year.
func IsLeapYear(t time.Time) bool {
	y := t.Year()
	return y%4 == 0 && (y%100 != 0 || y%400 == 0)
}

// ──────────────────────────────────────────────
// Time comparison & ranges
// ──────────────────────────────────────────────

// TimeRange represents a half-open time range [Start, End).
type TimeRange struct {
	Start, End time.Time
}

// NewTimeRange creates a TimeRange from start and end times.
func NewTimeRange(start, end time.Time) TimeRange {
	return TimeRange{Start: start, End: end}
}

// Duration returns the duration of the range.
func (r TimeRange) Duration() time.Duration {
	return r.End.Sub(r.Start)
}

// Contains returns true if the range contains the given time.
func (r TimeRange) Contains(t time.Time) bool {
	return !t.Before(r.Start) && t.Before(r.End)
}

// ContainsInclusive returns true if the range contains the given time,
// inclusive of the end boundary.
func (r TimeRange) ContainsInclusive(t time.Time) bool {
	return !t.Before(r.Start) && !t.After(r.End)
}

// Overlaps returns true if this range overlaps with another.
func (r TimeRange) Overlaps(other TimeRange) bool {
	return r.Start.Before(other.End) && other.Start.Before(r.End)
}

// Intersect returns the intersection of two ranges, or ok=false if they
// don't overlap.
func (r TimeRange) Intersect(other TimeRange) (TimeRange, bool) {
	if !r.Overlaps(other) {
		return TimeRange{}, false
	}
	start := maxTime(r.Start, other.Start)
	end := minTime(r.End, other.End)
	return TimeRange{Start: start, End: end}, true
}

// Split splits the range into n equal sub-ranges.
// Panics if n <= 0.
func (r TimeRange) Split(n int) []TimeRange {
	if n <= 0 {
		panic("timeutil: Split requires n > 0")
	}
	dur := r.Duration() / time.Duration(n)
	result := make([]TimeRange, n)
	for i := 0; i < n; i++ {
		result[i] = TimeRange{
			Start: r.Start.Add(time.Duration(i) * dur),
			End:   r.Start.Add(time.Duration(i+1) * dur),
		}
	}
	// Ensure the last end matches exactly.
	if n > 0 {
		result[n-1].End = r.End
	}
	return result
}

// TodayRange returns the time range for today [StartOfDay, EndOfDay].
func TodayRange() TimeRange {
	now := time.Now()
	return TimeRange{Start: StartOfDay(now), End: EndOfDay(now)}
}

// YesterdayRange returns the time range for yesterday.
func YesterdayRange() TimeRange {
	now := time.Now()
	yesterday := now.AddDate(0, 0, -1)
	return TimeRange{Start: StartOfDay(yesterday), End: EndOfDay(yesterday)}
}

// ThisWeekRange returns the time range for the current week.
func ThisWeekRange() TimeRange {
	now := time.Now()
	return TimeRange{Start: StartOfWeek(now), End: EndOfWeek(now)}
}

// ThisMonthRange returns the time range for the current month.
func ThisMonthRange() TimeRange {
	now := time.Now()
	return TimeRange{Start: StartOfMonth(now), End: EndOfMonth(now)}
}

// ThisYearRange returns the time range for the current year.
func ThisYearRange() TimeRange {
	now := time.Now()
	return TimeRange{Start: StartOfYear(now), End: EndOfYear(now)}
}

func maxTime(a, b time.Time) time.Time {
	if a.After(b) {
		return a
	}
	return b
}

func minTime(a, b time.Time) time.Time {
	if a.Before(b) {
		return a
	}
	return b
}

// ──────────────────────────────────────────────
// Duration helpers
// ──────────────────────────────────────────────

// ParseDuration parses a duration string. Supports standard Go duration
// syntax (e.g. "1h30m", "500ms") and additional units:
//   - "d" for days (e.g. "3d" = 72h)
//   - "w" for weeks (e.g. "2w" = 336h)
func ParseDuration(s string) (time.Duration, error) {
	// Try standard parsing first.
	if d, err := time.ParseDuration(s); err == nil {
		return d, nil
	}
	// Custom parsing for 'd' and 'w' suffixes.
	return parseCustomDuration(s)
}

// DurationToHuman returns a human-readable duration string.
// e.g. "2h30m", "1d4h", "30s", "500ms".
func DurationToHuman(d time.Duration) string {
	if d < 0 {
		return "-" + DurationToHuman(-d)
	}
	switch {
	case d >= Week:
		weeks := int(d / Week)
		rem := d % Week
		if rem > 0 {
			return fmt.Sprintf("%dw%s", weeks, DurationToHuman(rem))
		}
		return fmt.Sprintf("%dw", weeks)
	case d >= Day:
		days := int(d / Day)
		rem := d % Day
		if rem > 0 {
			return fmt.Sprintf("%dd%s", days, DurationToHuman(rem))
		}
		return fmt.Sprintf("%dd", days)
	case d >= Hour:
		hours := int(d / Hour)
		rem := d % Hour
		if rem > 0 {
			return fmt.Sprintf("%dh%s", hours, DurationToHuman(rem))
		}
		return fmt.Sprintf("%dh", hours)
	case d >= Minute:
		mins := int(d / Minute)
		rem := d % Minute
		if rem > 0 {
			return fmt.Sprintf("%dm%s", mins, DurationToHuman(rem))
		}
		return fmt.Sprintf("%dm", mins)
	case d >= Second:
		secs := int(d / Second)
		rem := d % Second
		if rem > 0 {
			return fmt.Sprintf("%ds%s", secs, DurationToHuman(rem))
		}
		return fmt.Sprintf("%ds", secs)
	case d >= Millisecond:
		return fmt.Sprintf("%dms", d/Millisecond)
	case d >= Microsecond:
		return fmt.Sprintf("%dµs", d/Microsecond)
	default:
		return fmt.Sprintf("%dns", d)
	}
}

// parseCustomDuration handles 'd' (days) and 'w' (weeks) suffixes.
func parseCustomDuration(s string) (time.Duration, error) {
	if len(s) == 0 {
		return 0, fmt.Errorf("timeutil: empty duration")
	}
	var total time.Duration
	i := 0
	for i < len(s) {
		// Skip whitespace.
		if s[i] == ' ' {
			i++
			continue
		}
		// Parse number.
		numStart := i
		for i < len(s) && (s[i] >= '0' && s[i] <= '9' || s[i] == '.') {
			i++
		}
		if i == numStart {
			return 0, fmt.Errorf("timeutil: invalid duration %q", s)
		}
		numStr := s[numStart:i]
		// Parse unit.
		unitStart := i
		for i < len(s) && !((s[i] >= '0' && s[i] <= '9') || s[i] == '.' || s[i] == ' ') {
			i++
		}
		unit := s[unitStart:i]
		// Convert.
		switch unit {
		case "d":
			n, err := parseFloat(numStr)
			if err != nil {
				return 0, err
			}
			total += time.Duration(n * float64(Day))
		case "w":
			n, err := parseFloat(numStr)
			if err != nil {
				return 0, err
			}
			total += time.Duration(n * float64(Week))
		case "h", "m", "s", "ms", "µs", "us", "ns":
			// Re-parse with standard parser for the remaining part.
			sub, err := time.ParseDuration(numStr + unit)
			if err != nil {
				return 0, err
			}
			total += sub
		default:
			return 0, fmt.Errorf("timeutil: unknown unit %q in duration %q", unit, s)
		}
	}
	return total, nil
}

func parseFloat(s string) (float64, error) {
	var f float64
	if _, err := fmt.Sscanf(s, "%f", &f); err != nil {
		return 0, err
	}
	return f, nil
}

// ──────────────────────────────────────────────
// Stopwatch (timer)
// ──────────────────────────────────────────────

// Stopwatch is a simple stopwatch that can be started, stopped, and reset.
// It is safe for concurrent use.
type Stopwatch struct {
	mu       sync.Mutex
	start    time.Time
	running  bool
	elapsed  time.Duration
	lapStart time.Time
	laps     []time.Duration
}

// NewStopwatch creates a new stopwatch. The stopwatch is not running.
func NewStopwatch() *Stopwatch {
	return &Stopwatch{}
}

// Start begins timing. If already running, it is a no-op.
func (s *Stopwatch) Start() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.running {
		s.start = time.Now()
		s.running = true
	}
}

// Stop stops timing and returns the total elapsed duration.
// If not running, it returns the accumulated elapsed time.
func (s *Stopwatch) Stop() time.Duration {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.running {
		s.elapsed += time.Since(s.start)
		s.running = false
	}
	return s.elapsed
}

// Reset resets the stopwatch, clearing all elapsed time and laps.
func (s *Stopwatch) Reset() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.elapsed = 0
	s.running = false
	s.laps = nil
}

// Elapsed returns the total elapsed time, including the current running
// period if the stopwatch is running.
func (s *Stopwatch) Elapsed() time.Duration {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.running {
		return s.elapsed + time.Since(s.start)
	}
	return s.elapsed
}

// IsRunning returns true if the stopwatch is currently running.
func (s *Stopwatch) IsRunning() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.running
}

// Lap records a lap time and returns the duration since the last lap
// (or since Start if this is the first lap).
func (s *Stopwatch) Lap() time.Duration {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.running {
		return 0
	}
	now := time.Now()
	var lapDuration time.Duration
	if len(s.laps) == 0 && s.lapStart.IsZero() {
		lapDuration = now.Sub(s.start)
	} else if !s.lapStart.IsZero() {
		lapDuration = now.Sub(s.lapStart)
	} else {
		lapDuration = now.Sub(s.start)
	}
	s.lapStart = now
	s.laps = append(s.laps, lapDuration)
	return lapDuration
}

// Laps returns all recorded lap times.
func (s *Stopwatch) Laps() []time.Duration {
	s.mu.Lock()
	defer s.mu.Unlock()
	laps := make([]time.Duration, len(s.laps))
	copy(laps, s.laps)
	return laps
}

// ──────────────────────────────────────────────
// Countdown timer
// ──────────────────────────────────────────────

// Countdown is a countdown timer that calls a function when the
// countdown reaches zero. It is not reusable; create a new one for
// each countdown.
type Countdown struct {
	dur    time.Duration
	timer  *time.Timer
	done   chan struct{}
	cancel chan struct{}
}

// NewCountdown creates a countdown timer that fires fn after dur.
// The timer starts immediately.
func NewCountdown(dur time.Duration, fn func()) *Countdown {
	c := &Countdown{
		dur:    dur,
		done:   make(chan struct{}),
		cancel: make(chan struct{}),
	}
	c.timer = time.AfterFunc(dur, func() {
		fn()
		close(c.done)
	})
	return c
}

// Stop cancels the countdown. Returns true if the countdown was
// successfully stopped (i.e., it hadn't fired yet).
func (c *Countdown) Stop() bool {
	stopped := c.timer.Stop()
	if stopped {
		close(c.cancel)
	}
	return stopped
}

// Done returns a channel that is closed when the countdown fires.
func (c *Countdown) Done() <-chan struct{} {
	return c.done
}

// Remaining returns the time remaining until the countdown fires.
// Returns 0 if the countdown has fired or been stopped.
func (c *Countdown) Remaining() time.Duration {
	select {
	case <-c.done:
		return 0
	case <-c.cancel:
		return 0
	default:
		// Approximate remaining time.
		return c.dur
	}
}

// ──────────────────────────────────────────────
// Debounce
// ──────────────────────────────────────────────

// Debounce creates a debounced function that delays invoking fn until
// after wait duration has elapsed since the last time it was invoked.
// The returned function is safe for concurrent use.
func Debounce(wait time.Duration, fn func()) func() {
	var mu sync.Mutex
	var timer *time.Timer
	return func() {
		mu.Lock()
		defer mu.Unlock()
		if timer != nil {
			timer.Stop()
		}
		timer = time.AfterFunc(wait, fn)
	}
}

// ──────────────────────────────────────────────
// Business day calculations
// ──────────────────────────────────────────────

// AddBusinessDays adds n business days (Mon-Fri) to the given time,
// preserving the time-of-day. Negative n subtracts business days.
func AddBusinessDays(t time.Time, n int) time.Time {
	result := t
	step := 1
	if n < 0 {
		step = -1
		n = -n
	}
	for i := 0; i < n; {
		result = result.AddDate(0, 0, step)
		if IsBusinessDay(result) {
			i++
		}
	}
	return result
}

// IsBusinessDay returns true if the given time is a weekday (Mon-Fri).
func IsBusinessDay(t time.Time) bool {
	wd := t.Weekday()
	return wd >= time.Monday && wd <= time.Friday
}

// IsWeekend returns true if the given time is a weekend (Sat or Sun).
func IsWeekend(t time.Time) bool {
	wd := t.Weekday()
	return wd == time.Saturday || wd == time.Sunday
}

// NextBusinessDay returns the next business day after the given time.
func NextBusinessDay(t time.Time) time.Time {
	result := t.AddDate(0, 0, 1)
	for !IsBusinessDay(result) {
		result = result.AddDate(0, 0, 1)
	}
	return result
}

// PreviousBusinessDay returns the previous business day before the given time.
func PreviousBusinessDay(t time.Time) time.Time {
	result := t.AddDate(0, 0, -1)
	for !IsBusinessDay(result) {
		result = result.AddDate(0, 0, -1)
	}
	return result
}

// BusinessDaysBetween returns the number of business days between two times
// (exclusive of both endpoints). Returns 0 if start >= end.
func BusinessDaysBetween(start, end time.Time) int {
	if !start.Before(end) {
		return 0
	}
	count := 0
	current := start
	for current.Before(end) {
		current = current.AddDate(0, 0, 1)
		if IsBusinessDay(current) && current.Before(end) {
			count++
		}
	}
	return count
}

// ──────────────────────────────────────────────
// Misc helpers
// ──────────────────────────────────────────────

// Now returns the current local time.
func Now() time.Time { return time.Now() }

// NowUTC returns the current UTC time.
func NowUTC() time.Time { return time.Now().UTC() }

// UnixNow returns the current Unix timestamp in seconds.
func UnixNow() int64 { return time.Now().Unix() }

// MillisNow returns the current Unix timestamp in milliseconds.
func MillisNow() int64 { return time.Now().UnixMilli() }

// MicrosNow returns the current Unix timestamp in microseconds.
func MicrosNow() int64 { return time.Now().UnixMicro() }

// FromUnix converts a Unix timestamp (seconds) to time.Time.
func FromUnix(sec int64) time.Time { return time.Unix(sec, 0) }

// FromMillis converts a Unix timestamp (milliseconds) to time.Time.
func FromMillis(ms int64) time.Time { return time.UnixMilli(ms) }

// FromMicros converts a Unix timestamp (microseconds) to time.Time.
func FromMicros(us int64) time.Time { return time.UnixMicro(us) }

// Age returns the duration between the given time and now.
func Age(t time.Time) time.Duration { return time.Since(t) }

// IsExpired returns true if the given time is before now.
func IsExpired(t time.Time) bool { return t.Before(time.Now()) }

// IsZero returns true if the given time is the zero value.
func IsZero(t time.Time) bool { return t.IsZero() }

// Clamp ensures a time is within a range. If t is before start, returns
// start. If t is after end, returns end. Otherwise returns t.
func Clamp(t, start, end time.Time) time.Time {
	if t.Before(start) {
		return start
	}
	if t.After(end) {
		return end
	}
	return t
}

// Max returns the later of two times.
func Max(a, b time.Time) time.Time { return maxTime(a, b) }

// Min returns the earlier of two times.
func Min(a, b time.Time) time.Time { return minTime(a, b) }

// Yesterday returns the time 24 hours ago.
func Yesterday() time.Time { return time.Now().AddDate(0, 0, -1) }

// CalculateAge returns the age in years given a birthday.
func CalculateAge(birthday time.Time) int {
	now := time.Now()
	age := now.Year() - birthday.Year()
	if now.YearDay() < birthday.YearDay() {
		age--
	}
	return age
}

// AddDuration returns the Unix timestamp after adding d to now.
func AddDuration(d time.Duration) int64 { return time.Now().Add(d).Unix() }
