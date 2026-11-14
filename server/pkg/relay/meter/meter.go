// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package meter provides usage metering for AI API calls.
// It records per-call usage (tokens, images, audio seconds, video seconds)
// and provides aggregation/query capabilities.
//
// This package focuses on **metering** (how much was used), not pricing.
// Cost calculation is intentionally left out — the consuming application
// can compute cost from usage data using its own pricing rules.
package meter

import (
	"context"
	"sync"
	"time"
)

// Usage holds metering data for a single API call. All providers must
// populate this struct in their response handling.
type Usage struct {
	// Token counts (text models).
	InputTokens  int `json:"input_tokens"`
	OutputTokens int `json:"output_tokens"`
	TotalTokens  int `json:"total_tokens"`
	CachedTokens int `json:"cached_tokens,omitempty"` // prompt cache hit

	// Cache creation tokens (Claude-specific).
	CacheCreationTokens int `json:"cache_creation_tokens,omitempty"`
	CacheCreation5m     int `json:"cache_creation_5m_tokens,omitempty"`
	CacheCreation1h     int `json:"cache_creation_1h_tokens,omitempty"`

	// Reasoning/thinking tokens.
	ReasoningTokens int `json:"reasoning_tokens,omitempty"`

	// Non-text modality counts.
	ImageCount   int     `json:"image_count,omitempty"`
	AudioSeconds float64 `json:"audio_seconds,omitempty"`
	VideoSeconds float64 `json:"video_seconds,omitempty"`

	// Request count (for async tasks and other non-token calls).
	RequestCount int `json:"request_count,omitempty"`

	// Source provider format, for debugging.
	Source string `json:"source,omitempty"`
}

// Merge adds another Usage's counts into this one.
func (u *Usage) Merge(other Usage) {
	u.InputTokens += other.InputTokens
	u.OutputTokens += other.OutputTokens
	u.TotalTokens += other.TotalTokens
	u.CachedTokens += other.CachedTokens
	u.CacheCreationTokens += other.CacheCreationTokens
	u.CacheCreation5m += other.CacheCreation5m
	u.CacheCreation1h += other.CacheCreation1h
	u.ReasoningTokens += other.ReasoningTokens
	u.ImageCount += other.ImageCount
	u.AudioSeconds += other.AudioSeconds
	u.VideoSeconds += other.VideoSeconds
	u.RequestCount += other.RequestCount
}

// mergeUsage is a helper that merges two Usage values and returns the result.
func mergeUsage(a, b Usage) Usage {
	a.Merge(b)
	return a
}

// UsageRecord is a stored metering event.
type UsageRecord struct {
	ID        string    `json:"id,omitempty"`
	Provider  string    `json:"provider"`
	Model     string    `json:"model"`
	Mode      int       `json:"mode,omitempty"` // relay mode
	Usage     Usage     `json:"usage"`
	Timestamp time.Time `json:"timestamp"`
}

// UsageQuery filters usage records.
type UsageQuery struct {
	Provider string
	Model    string
	Mode     int
	Start    time.Time
	End      time.Time
}

// UsageStats is an aggregated usage summary.
type UsageStats struct {
	TotalRecords int              `json:"total_records"`
	TotalUsage   Usage            `json:"total_usage"`
	ByProvider   map[string]Usage `json:"by_provider,omitempty"`
	ByModel      map[string]Usage `json:"by_model,omitempty"`
	ByMode       map[int]Usage    `json:"by_mode,omitempty"`
	TimeRange    [2]time.Time     `json:"time_range,omitempty"`
}

// UsageAggregate is one bucket in a grouped aggregation.
type UsageAggregate struct {
	Key   string `json:"key"`
	Usage Usage  `json:"usage"`
	Count int    `json:"count"`
}

// Meter is the interface for recording and querying usage.
type Meter interface {
	// Record stores a usage event.
	Record(ctx context.Context, record *UsageRecord) error

	// Query returns aggregated usage statistics matching the query.
	Query(ctx context.Context, q *UsageQuery) (*UsageStats, error)

	// Aggregate groups usage by the given dimension ("provider", "model", "mode").
	Aggregate(ctx context.Context, q *UsageQuery, groupBy string) ([]UsageAggregate, error)

	// Close releases resources.
	Close() error
}

// NewMemoryMeter creates an in-memory Meter.
func NewMemoryMeter() Meter {
	return &memoryMeter{}
}

type memoryMeter struct {
	mu      sync.RWMutex
	records []UsageRecord
}

func (m *memoryMeter) Record(ctx context.Context, record *UsageRecord) error {
	if record.Timestamp.IsZero() {
		record.Timestamp = time.Now()
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.records = append(m.records, *record)
	return nil
}

func (m *memoryMeter) Query(ctx context.Context, q *UsageQuery) (*UsageStats, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	stats := &UsageStats{
		ByProvider: make(map[string]Usage),
		ByModel:    make(map[string]Usage),
		ByMode:     make(map[int]Usage),
	}
	var minT, maxT time.Time
	for _, r := range m.records {
		if !matchQuery(r, q) {
			continue
		}
		stats.TotalRecords++
		stats.TotalUsage.Merge(r.Usage)
		stats.ByProvider[r.Provider] = mergeUsage(stats.ByProvider[r.Provider], r.Usage)
		stats.ByModel[r.Model] = mergeUsage(stats.ByModel[r.Model], r.Usage)
		stats.ByMode[r.Mode] = mergeUsage(stats.ByMode[r.Mode], r.Usage)
		if minT.IsZero() || r.Timestamp.Before(minT) {
			minT = r.Timestamp
		}
		if maxT.IsZero() || r.Timestamp.After(maxT) {
			maxT = r.Timestamp
		}
	}
	if !minT.IsZero() {
		stats.TimeRange = [2]time.Time{minT, maxT}
	}
	return stats, nil
}

func (m *memoryMeter) Aggregate(ctx context.Context, q *UsageQuery, groupBy string) ([]UsageAggregate, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	groups := make(map[string]*UsageAggregate)
	for _, r := range m.records {
		if !matchQuery(r, q) {
			continue
		}
		var key string
		switch groupBy {
		case "provider":
			key = r.Provider
		case "model":
			key = r.Model
		case "mode":
			key = modeName(r.Mode)
		case "provider/model":
			key = r.Provider + "/" + r.Model
		default:
			key = r.Provider + "/" + r.Model
		}
		g, ok := groups[key]
		if !ok {
			g = &UsageAggregate{Key: key}
			groups[key] = g
		}
		g.Usage = mergeUsage(g.Usage, r.Usage)
		g.Count++
	}
	result := make([]UsageAggregate, 0, len(groups))
	for _, g := range groups {
		result = append(result, *g)
	}
	return result, nil
}

func (m *memoryMeter) Close() error { return nil }

func matchQuery(r UsageRecord, q *UsageQuery) bool {
	if q == nil {
		return true
	}
	if q.Provider != "" && r.Provider != q.Provider {
		return false
	}
	if q.Model != "" && r.Model != q.Model {
		return false
	}
	if q.Mode != 0 && r.Mode != q.Mode {
		return false
	}
	if !q.Start.IsZero() && r.Timestamp.Before(q.Start) {
		return false
	}
	if !q.End.IsZero() && r.Timestamp.After(q.End) {
		return false
	}
	return true
}

// modeName converts a relay mode int to a human-readable name.
func modeName(mode int) string {
	switch mode {
	case 1:
		return "chat"
	case 2:
		return "embeddings"
	case 3:
		return "image"
	case 4:
		return "audio_speech"
	case 5:
		return "audio_transcription"
	case 6:
		return "audio_translation"
	case 7:
		return "rerank"
	case 8:
		return "realtime"
	case 9:
		return "responses"
	case 10:
		return "task"
	default:
		return "unknown"
	}
}
