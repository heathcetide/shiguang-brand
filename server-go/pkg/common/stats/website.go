// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package stats

import "time"

// WebsiteMetrics is a convenience wrapper that provides ready-made methods
// for common website indicators (PV, UV, VV, IP, DAU, MAU, etc.) on top of
// a Collector. It does NOT store any state itself — all data goes through
// the underlying Collector.
//
// This is an opinionated layer; you can also use the Collector primitives
// directly for custom metrics.
type WebsiteMetrics struct {
	c Collector
}

// NewWebsiteMetrics creates a WebsiteMetrics wrapper over the given collector.
func NewWebsiteMetrics(c Collector) *WebsiteMetrics {
	return &WebsiteMetrics{c: c}
}

// ──────────────────────────────────────────────
// Basic traffic: PV / UV / VV / IP
// ──────────────────────────────────────────────

// RecordPV increments the page view counter for the given date and path.
func (w *WebsiteMetrics) RecordPV(date, path string) {
	w.c.Counter("pv:" + date + ":" + path).Incr()
}

// GetPV returns the page view count for the given date and path.
func (w *WebsiteMetrics) GetPV(date, path string) int64 {
	return w.c.Counter("pv:" + date + ":" + path).Get()
}

// RecordUV adds a user to the UV HyperLogLog for the given date.
func (w *WebsiteMetrics) RecordUV(date, userID string) {
	w.c.HLL("uv:" + date).Add(userID)
}

// GetUV returns the estimated unique visitor count for the given date.
func (w *WebsiteMetrics) GetUV(date string) uint64 {
	return w.c.HLL("uv:" + date).Estimate()
}

// RecordIP adds an IP to the IP HyperLogLog for the given date.
func (w *WebsiteMetrics) RecordIP(date, ip string) {
	w.c.HLL("ip:" + date).Add(ip)
}

// GetIP returns the estimated unique IP count for the given date.
func (w *WebsiteMetrics) GetIP(date string) uint64 {
	return w.c.HLL("ip:" + date).Estimate()
}

// RecordVV increments the visit view (session) counter for the given date.
func (w *WebsiteMetrics) RecordVV(date string) {
	w.c.Counter("vv:" + date).Incr()
}

// GetVV returns the visit view count for the given date.
func (w *WebsiteMetrics) GetVV(date string) int64 {
	return w.c.Counter("vv:" + date).Get()
}

// ──────────────────────────────────────────────
// Session-based: bounce rate / avg duration / pages per visit
// ──────────────────────────────────────────────

// RecordBounce increments the bounce (single-page session) counter.
func (w *WebsiteMetrics) RecordBounce(date string) {
	w.c.Counter("bounce:" + date).Incr()
}

// GetBounceRate returns the bounce rate = bounces / VV.
func (w *WebsiteMetrics) GetBounceRate(date string) float64 {
	vv := w.GetVV(date)
	if vv == 0 {
		return 0
	}
	bounces := w.c.Counter("bounce:" + date).Get()
	return float64(bounces) / float64(vv)
}

// RecordSessionDuration adds a session duration sample (in seconds) for the given date.
func (w *WebsiteMetrics) RecordSessionDuration(date string, durationSeconds int64) {
	w.c.Timer("session_duration:" + date).Record(durationSeconds * int64(time.Second))
}

// GetAvgSessionDuration returns the average session duration in seconds.
func (w *WebsiteMetrics) GetAvgSessionDuration(date string) float64 {
	return w.c.Timer("session_duration:"+date).Mean() / float64(time.Second)
}

// GetPagesPerVisit returns the average pages per visit = total PV / total VV.
func (w *WebsiteMetrics) GetPagesPerVisit(date string) float64 {
	vv := w.GetVV(date)
	if vv == 0 {
		return 0
	}
	// Sum all PV for the date across all paths.
	// This requires knowing all paths; in practice, use a daily PV total counter.
	totalPV := w.c.Counter("pv_total:" + date).Get()
	return float64(totalPV) / float64(vv)
}

// RecordPVTotal increments the total PV counter for a date (all paths combined).
func (w *WebsiteMetrics) RecordPVTotal(date string) {
	w.c.Counter("pv_total:" + date).Incr()
}

// ──────────────────────────────────────────────
// User behavior: CTR / CVR / Retention / DAU / MAU / New users / Churn
// ──────────────────────────────────────────────

// RecordClick increments the click counter for an event on a date.
func (w *WebsiteMetrics) RecordClick(date, event string) {
	w.c.Counter("click:" + date + ":" + event).Incr()
}

// RecordImpression increments the impression counter for an event on a date.
func (w *WebsiteMetrics) RecordImpression(date, event string) {
	w.c.Counter("impression:" + date + ":" + event).Incr()
}

// GetCTR returns the click-through rate = clicks / impressions.
func (w *WebsiteMetrics) GetCTR(date, event string) float64 {
	impressions := w.c.Counter("impression:" + date + ":" + event).Get()
	if impressions == 0 {
		return 0
	}
	clicks := w.c.Counter("click:" + date + ":" + event).Get()
	return float64(clicks) / float64(impressions)
}

// RecordConversion increments the conversion counter for a goal on a date.
func (w *WebsiteMetrics) RecordConversion(date, goal string) {
	w.c.Counter("conversion:" + date + ":" + goal).Incr()
}

// GetCVR returns the conversion rate = conversions / visits.
func (w *WebsiteMetrics) GetCVR(date, goal string) float64 {
	visits := w.GetVV(date)
	if visits == 0 {
		return 0
	}
	conversions := w.c.Counter("conversion:" + date + ":" + goal).Get()
	return float64(conversions) / float64(visits)
}

// RecordDAU adds a user to the DAU HyperLogLog for the given date.
func (w *WebsiteMetrics) RecordDAU(date, userID string) {
	w.c.HLL("dau:" + date).Add(userID)
}

// GetDAU returns the estimated daily active users for the given date.
func (w *WebsiteMetrics) GetDAU(date string) uint64 {
	return w.c.HLL("dau:" + date).Estimate()
}

// RecordMAU adds a user to the MAU HyperLogLog for the given month.
func (w *WebsiteMetrics) RecordMAU(month, userID string) {
	w.c.HLL("mau:" + month).Add(userID)
}

// GetMAU returns the estimated monthly active users for the given month.
func (w *WebsiteMetrics) GetMAU(month string) uint64 {
	return w.c.HLL("mau:" + month).Estimate()
}

// RecordDailyUserSet adds a user to the exact daily set (for retention calculation).
// Uses Set (not HLL) because retention requires exact intersection.
func (w *WebsiteMetrics) RecordDailyUserSet(date, userID string) {
	w.c.Set("daily_users:" + date).Add(userID)
}

// GetRetention returns the retention rate between two dates.
// retention = |users on both dates| / |users on the earlier date|.
func (w *WebsiteMetrics) GetRetention(dateA, dateB string) float64 {
	setA := w.c.Set("daily_users:" + dateA)
	base := setA.Count()
	if base == 0 {
		return 0
	}
	setB := w.c.Set("daily_users:" + dateB)
	intersect := setA.Intersect(setB)
	return float64(intersect) / float64(base)
}

// IsNewUser checks if the user is new (not seen before) and records them.
// Uses a global HLL for approximate new-user detection.
func (w *WebsiteMetrics) IsNewUser(userID string) bool {
	// HLL doesn't support exact "has" check; use a Set for exact detection.
	// For large scale, accept approximate: compare allUsers estimate before/after Add.
	before := w.c.HLL("all_users").Estimate()
	w.c.HLL("all_users").Add(userID)
	after := w.c.HLL("all_users").Estimate()
	return after > before
}

// GetTotalUsers returns the estimated total unique users (all time).
func (w *WebsiteMetrics) GetTotalUsers() uint64 {
	return w.c.HLL("all_users").Estimate()
}

// ──────────────────────────────────────────────
// Performance: response time / QPS / error rate / first screen
// ──────────────────────────────────────────────

// RecordResponseTime adds a response time sample (in nanoseconds) for the given date.
func (w *WebsiteMetrics) RecordResponseTime(date string, durationNs int64) {
	w.c.Timer("response_time:" + date).Record(durationNs)
}

// RecordResponseTimeMs adds a response time sample in milliseconds.
func (w *WebsiteMetrics) RecordResponseTimeMs(date string, ms float64) {
	w.c.Timer("response_time:" + date).RecordMs(ms)
}

// GetResponseTimeP50 returns the P50 response time in milliseconds.
func (w *WebsiteMetrics) GetResponseTimeP50(date string) float64 {
	return w.c.Timer("response_time:"+date).Percentile(50) / float64(time.Millisecond)
}

// GetResponseTimeP95 returns the P95 response time in milliseconds.
func (w *WebsiteMetrics) GetResponseTimeP95(date string) float64 {
	return w.c.Timer("response_time:"+date).Percentile(95) / float64(time.Millisecond)
}

// GetResponseTimeP99 returns the P99 response time in milliseconds.
func (w *WebsiteMetrics) GetResponseTimeP99(date string) float64 {
	return w.c.Timer("response_time:"+date).Percentile(99) / float64(time.Millisecond)
}

// RecordRequest increments the total request counter for the given date.
func (w *WebsiteMetrics) RecordRequest(date string) {
	w.c.Counter("requests:" + date).Incr()
}

// RecordError increments the error counter for the given date.
func (w *WebsiteMetrics) RecordError(date string) {
	w.c.Counter("errors:" + date).Incr()
}

// GetQPS returns the average QPS = total requests / seconds in a day.
func (w *WebsiteMetrics) GetQPS(date string) float64 {
	requests := w.c.Counter("requests:" + date).Get()
	return float64(requests) / 86400.0 // 24h * 3600s
}

// GetErrorRate returns the error rate = errors / requests.
func (w *WebsiteMetrics) GetErrorRate(date string) float64 {
	requests := w.c.Counter("requests:" + date).Get()
	if requests == 0 {
		return 0
	}
	errors := w.c.Counter("errors:" + date).Get()
	return float64(errors) / float64(requests)
}

// RecordFirstScreen adds a first screen load time sample (in milliseconds).
func (w *WebsiteMetrics) RecordFirstScreen(date string, ms float64) {
	w.c.Timer("first_screen:" + date).RecordMs(ms)
}

// GetFirstScreenP50 returns the P50 first screen load time in milliseconds.
func (w *WebsiteMetrics) GetFirstScreenP50(date string) float64 {
	return w.c.Timer("first_screen:"+date).Percentile(50) / float64(time.Millisecond)
}

// GetFirstScreenP95 returns the P95 first screen load time in milliseconds.
func (w *WebsiteMetrics) GetFirstScreenP95(date string) float64 {
	return w.c.Timer("first_screen:"+date).Percentile(95) / float64(time.Millisecond)
}
