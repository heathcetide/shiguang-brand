// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package antispam provides a comprehensive anti-spam toolkit combining
// keyword filtering (trie-based), in-memory rate limiting (sliding window),
// content scoring (heuristic signals), and a unified [Checker] that aggregates
// all of the above behind a single [Checker.Check] call.
//
// The package has zero third-party dependencies and is safe for concurrent use
// when each [Checker] is shared but not reconfigured after construction.
package antispam

import (
	"regexp"
	"strings"
	"sync"
	"time"
	"unicode"
)

// ──────────────────────────────────────────────
// KeywordFilter: trie-based sensitive-word filter
// ──────────────────────────────────────────────

// kfNode is a trie node for the keyword filter.
type kfNode struct {
	children map[rune]*kfNode
	isEnd    bool
}

func newKFNode() *kfNode {
	return &kfNode{children: make(map[rune]*kfNode)}
}

// KeywordFilter is a trie-based sensitive-word filter. It is safe for concurrent
// reads after keywords have been added; mutation methods (Add/AddMany/Remove/
// Clear) acquire a write lock.
type KeywordFilter struct {
	mu   sync.RWMutex
	root *kfNode
	size int
}

// NewKeywordFilter creates a filter preloaded with keywords. Duplicate or empty
// keywords are ignored.
func NewKeywordFilter(keywords []string) *KeywordFilter {
	kf := &KeywordFilter{root: newKFNode()}
	kf.AddMany(keywords)
	return kf
}

// Add inserts a single keyword. Empty strings are ignored. Adding an existing
// keyword is a no-op (size unchanged).
func (kf *KeywordFilter) Add(keyword string) {
	if keyword == "" {
		return
	}
	kf.mu.Lock()
	defer kf.mu.Unlock()
	if kf.insertLocked(keyword) {
		kf.size++
	}
}

// AddMany inserts multiple keywords.
func (kf *KeywordFilter) AddMany(keywords []string) {
	kf.mu.Lock()
	defer kf.mu.Unlock()
	for _, kw := range keywords {
		if kw == "" {
			continue
		}
		if kf.insertLocked(kw) {
			kf.size++
		}
	}
}

// insertLocked inserts a keyword without locking. Returns true when a new
// keyword was actually added.
func (kf *KeywordFilter) insertLocked(keyword string) bool {
	cur := kf.root
	for _, r := range keyword {
		child, ok := cur.children[r]
		if !ok {
			child = newKFNode()
			cur.children[r] = child
		}
		cur = child
	}
	if cur.isEnd {
		return false
	}
	cur.isEnd = true
	return true
}

// Remove deletes a keyword. Returns nothing; removing a non-existent keyword is
// a no-op.
func (kf *KeywordFilter) Remove(keyword string) {
	if keyword == "" {
		return
	}
	kf.mu.Lock()
	defer kf.mu.Unlock()
	runes := []rune(keyword)
	path := make([]*kfNode, 0, len(runes)+1)
	cur := kf.root
	path = append(path, cur)
	for _, r := range runes {
		child, ok := cur.children[r]
		if !ok {
			return
		}
		path = append(path, child)
		cur = child
	}
	if !cur.isEnd {
		return
	}
	cur.isEnd = false
	kf.size--
	for i := len(path) - 1; i >= 1; i-- {
		n := path[i]
		if len(n.children) == 0 && !n.isEnd {
			delete(path[i-1].children, runes[i-1])
		} else {
			break
		}
	}
}

// Match returns all keywords found in text, in order of first appearance and
// de-duplicated.
func (kf *KeywordFilter) Match(text string) []string {
	kf.mu.RLock()
	defer kf.mu.RUnlock()
	runes := []rune(text)
	seen := make(map[string]bool)
	var matched []string
	for i := 0; i < len(runes); i++ {
		if kw := kf.matchFrom(runes, i); kw != "" && !seen[kw] {
			seen[kw] = true
			matched = append(matched, kw)
		}
	}
	return matched
}

// matchFrom returns the longest keyword starting at position i, or "".
func (kf *KeywordFilter) matchFrom(runes []rune, i int) string {
	cur := kf.root
	var longest string
	for j := i; j < len(runes); j++ {
		child, ok := cur.children[runes[j]]
		if !ok {
			break
		}
		cur = child
		if cur.isEnd {
			longest = string(runes[i : j+1])
		}
	}
	return longest
}

// Contains reports whether text contains any registered keyword.
func (kf *KeywordFilter) Contains(text string) bool {
	kf.mu.RLock()
	defer kf.mu.RUnlock()
	runes := []rune(text)
	for i := 0; i < len(runes); i++ {
		if kf.matchFrom(runes, i) != "" {
			return true
		}
	}
	return false
}

// Replace substitutes every occurrence of any keyword in text with replacement.
// Each keyword occurrence is replaced by a single instance of replacement (not
// length-matched). When replacement is empty, keywords are removed.
func (kf *KeywordFilter) Replace(text, replacement string) string {
	kf.mu.RLock()
	defer kf.mu.RUnlock()
	runes := []rune(text)
	var b strings.Builder
	i := 0
	for i < len(runes) {
		kw := kf.matchFrom(runes, i)
		if kw != "" {
			b.WriteString(replacement)
			i += len([]rune(kw))
		} else {
			b.WriteRune(runes[i])
			i++
		}
	}
	return b.String()
}

// Count returns the number of registered keywords.
func (kf *KeywordFilter) Count() int {
	kf.mu.RLock()
	defer kf.mu.RUnlock()
	return kf.size
}

// Clear removes all keywords.
func (kf *KeywordFilter) Clear() {
	kf.mu.Lock()
	defer kf.mu.Unlock()
	kf.root = newKFNode()
	kf.size = 0
}

// ──────────────────────────────────────────────
// RateLimiter: in-memory sliding-window counter
// ──────────────────────────────────────────────

// rlEntry tracks the timestamps of requests within the current window for a key.
type rlEntry struct {
	timestamps []time.Time
}

// RateLimiter is an in-memory sliding-window rate limiter. It records the
// timestamps of every request for a key and counts how many fall within the
// most recent [window]. It is safe for concurrent use.
type RateLimiter struct {
	mu       sync.Mutex
	window   time.Duration
	maxCount int
	entries  map[string]*rlEntry
}

// NewRateLimiter creates a limiter that allows at most maxCount requests per
// key within any window of length window. A non-positive maxCount disables the
// limiter (Allow always returns true).
func NewRateLimiter(window time.Duration, maxCount int) *RateLimiter {
	return &RateLimiter{
		window:   window,
		maxCount: maxCount,
		entries:  make(map[string]*rlEntry),
	}
}

// Allow reports whether key may proceed. When allowed, the request is recorded;
// when denied, it is not.
func (rl *RateLimiter) Allow(key string) bool {
	if rl.maxCount <= 0 {
		return true
	}
	rl.mu.Lock()
	defer rl.mu.Unlock()
	now := time.Now()
	cutoff := now.Add(-rl.window)
	e, ok := rl.entries[key]
	if !ok {
		e = &rlEntry{}
		rl.entries[key] = e
	}
	// Drop timestamps outside the window.
	e.timestamps = trimBefore(e.timestamps, cutoff)
	if len(e.timestamps) >= rl.maxCount {
		return false
	}
	e.timestamps = append(e.timestamps, now)
	return true
}

// Count returns the number of requests recorded for key within the current
// window (without recording a new request).
func (rl *RateLimiter) Count(key string) int {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	e, ok := rl.entries[key]
	if !ok {
		return 0
	}
	cutoff := time.Now().Add(-rl.window)
	e.timestamps = trimBefore(e.timestamps, cutoff)
	return len(e.timestamps)
}

// Reset clears the recorded requests for key.
func (rl *RateLimiter) Reset(key string) {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	delete(rl.entries, key)
}

// Cleanup removes all entries whose timestamps have fully expired (i.e. no
// request within the window). This is useful to bound memory usage.
func (rl *RateLimiter) Cleanup() {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	cutoff := time.Now().Add(-rl.window)
	for k, e := range rl.entries {
		e.timestamps = trimBefore(e.timestamps, cutoff)
		if len(e.timestamps) == 0 {
			delete(rl.entries, k)
		}
	}
}

// trimBefore returns timestamps with all entries before cutoff removed. It
// reuses the underlying slice capacity when possible.
func trimBefore(ts []time.Time, cutoff time.Time) []time.Time {
	idx := 0
	for idx < len(ts) && ts[idx].Before(cutoff) {
		idx++
	}
	if idx == 0 {
		return ts
	}
	// Shift to front to keep the slice compact over time.
	copy(ts, ts[idx:])
	return ts[:len(ts)-idx]
}

// ──────────────────────────────────────────────
// ContentScorer: heuristic spam scoring
// ──────────────────────────────────────────────

// urlPattern matches http(s) URLs.
var urlPattern = regexp.MustCompile(`(?i)\bhttps?://[^\s]+`)

// spamThreshold is the score at or above which content is considered spam.
const spamThreshold = 60

// ContentScorer computes a 0-100 spam score for a piece of text based on
// several heuristic signals. It is stateless and safe for concurrent use.
type ContentScorer struct{}

// NewContentScorer creates a new scorer.
func NewContentScorer() *ContentScorer {
	return &ContentScorer{}
}

// Score returns a spam score in [0, 100]. Higher means more likely spam.
//
// Signals (each capped and summed, then clamped to 100):
//   - Repeated-character runs (e.g. "aaaaa") add up to 30 points.
//   - Consecutive punctuation runs (e.g. "!!!???") add up to 25 points.
//   - URL count (each URL adds 15) adds up to 30 points.
//   - Uppercase ratio among letters adds up to 15 points.
//   - Special-character ratio adds up to 20 points.
func (cs *ContentScorer) Score(content string) int {
	if content == "" {
		return 0
	}
	runes := []rune(content)
	n := len(runes)
	score := 0

	// Repeated characters: count runes that are part of a run of length >= 4.
	repeated := 0
	runLen := 1
	for i := 1; i < n; i++ {
		if runes[i] == runes[i-1] {
			runLen++
		} else {
			if runLen >= 4 {
				repeated += runLen
			}
			runLen = 1
		}
	}
	if runLen >= 4 {
		repeated += runLen
	}
	if n > 0 {
		repeatRatio := float64(repeated) / float64(n)
		score += minInt(30, int(repeatRatio*100))
	}

	// Consecutive punctuation runs.
	maxPunctRun := 0
	curPunct := 0
	for _, r := range runes {
		if unicode.IsPunct(r) || r == '！' || r == '？' || r == '。' {
			curPunct++
			if curPunct > maxPunctRun {
				maxPunctRun = curPunct
			}
		} else {
			curPunct = 0
		}
	}
	if maxPunctRun >= 3 {
		score += minInt(25, (maxPunctRun-2)*5)
	}

	// URL count.
	urls := urlPattern.FindAllString(content, -1)
	if len(urls) > 0 {
		score += minInt(30, len(urls)*15)
	}

	// Uppercase ratio among letters.
	letters := 0
	upper := 0
	for _, r := range runes {
		if unicode.IsLetter(r) {
			letters++
			if unicode.IsUpper(r) {
				upper++
			}
		}
	}
	if letters > 0 {
		upperRatio := float64(upper) / float64(letters)
		if upperRatio > 0.5 {
			score += minInt(15, int(upperRatio*15))
		}
	}

	// Special-character ratio (non-letter, non-digit, non-space).
	special := 0
	for _, r := range runes {
		if !unicode.IsLetter(r) && !unicode.IsDigit(r) && !unicode.IsSpace(r) {
			special++
		}
	}
	if n > 0 {
		specRatio := float64(special) / float64(n)
		score += minInt(20, int(specRatio*50))
	}

	if score > 100 {
		score = 100
	}
	if score < 0 {
		score = 0
	}
	return score
}

// IsSpam reports whether score is at or above the spam threshold (60).
func (cs *ContentScorer) IsSpam(score int) bool {
	return score >= spamThreshold
}

// ──────────────────────────────────────────────
// Checker: unified anti-spam checker
// ──────────────────────────────────────────────

// Result describes the outcome of a [Checker.Check] call.
type Result struct {
	Passed           bool     // true when the content passed all checks
	Score            int      // content spam score (0-100)
	Reasons          []string // human-readable reasons for failure (empty when passed)
	MatchedKeywords  []string // keywords matched in the content (always populated when a filter exists)
}

// Checker is a configurable anti-spam checker combining keyword filtering, rate
// limiting, length validation, banned regex patterns, and content scoring.
type Checker struct {
	keywordFilter  *KeywordFilter
	rateLimiter    *RateLimiter
	contentScorer  *ContentScorer
	minLength      int
	maxLength      int
	bannedPatterns []*regexp.Regexp
}

// CheckerOption configures a Checker.
type CheckerOption func(*Checker)

// WithKeywords registers the given keywords with the internal keyword filter.
func WithKeywords(keywords []string) CheckerOption {
	return func(c *Checker) {
		if c.keywordFilter == nil {
			c.keywordFilter = NewKeywordFilter(nil)
		}
		c.keywordFilter.AddMany(keywords)
	}
}

// WithRateLimit enables per-userID rate limiting: at most maxCount requests per
// userID within window.
func WithRateLimit(window time.Duration, maxCount int) CheckerOption {
	return func(c *Checker) {
		c.rateLimiter = NewRateLimiter(window, maxCount)
	}
}

// WithMinLength sets the minimum allowed content length (in runes).
func WithMinLength(min int) CheckerOption {
	return func(c *Checker) {
		c.minLength = min
	}
}

// WithMaxLength sets the maximum allowed content length (in runes). A value
// <= 0 means no upper limit.
func WithMaxLength(max int) CheckerOption {
	return func(c *Checker) {
		c.maxLength = max
	}
}

// WithBannedPatterns registers regex patterns whose match in content causes
// failure.
func WithBannedPatterns(patterns []*regexp.Regexp) CheckerOption {
	return func(c *Checker) {
		c.bannedPatterns = append(c.bannedPatterns, patterns...)
	}
}

// NewChecker creates a Checker applying the given options.
func NewChecker(opts ...CheckerOption) *Checker {
	c := &Checker{
		contentScorer: NewContentScorer(),
	}
	for _, opt := range opts {
		opt(c)
	}
	return c
}

// Check evaluates content for a given userID and returns a Result. The Result
// is always non-nil. When all checks pass, Result.Passed is true.
func (c *Checker) Check(content string, userID string) *Result {
	res := &Result{Passed: true}

	// Length checks (rune-aware).
	runeLen := len([]rune(content))
	if c.minLength > 0 && runeLen < c.minLength {
		res.Passed = false
		res.Reasons = append(res.Reasons, "content too short")
	}
	if c.maxLength > 0 && runeLen > c.maxLength {
		res.Passed = false
		res.Reasons = append(res.Reasons, "content too long")
	}

	// Keyword filter.
	if c.keywordFilter != nil {
		matched := c.keywordFilter.Match(content)
		res.MatchedKeywords = matched
		if len(matched) > 0 {
			res.Passed = false
			res.Reasons = append(res.Reasons, "contains banned keywords")
		}
	}

	// Banned regex patterns.
	for _, p := range c.bannedPatterns {
		if p != nil && p.MatchString(content) {
			res.Passed = false
			res.Reasons = append(res.Reasons, "matches banned pattern: "+p.String())
			break
		}
	}

	// Rate limit.
	if c.rateLimiter != nil {
		if !c.rateLimiter.Allow(userID) {
			res.Passed = false
			res.Reasons = append(res.Reasons, "rate limit exceeded")
		}
	}

	// Content scoring.
	res.Score = c.contentScorer.Score(content)
	if c.contentScorer.IsSpam(res.Score) {
		res.Passed = false
		res.Reasons = append(res.Reasons, "content flagged as spam")
	}

	return res
}

// ──────────────────────────────────────────────
// helpers
// ──────────────────────────────────────────────

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}
