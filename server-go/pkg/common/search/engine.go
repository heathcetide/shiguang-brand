// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package search

import (
	"context"
	"errors"
	"time"
)

// Sentinel errors for the search engine.
var (
	ErrClosed       = errors.New("search engine closed")
	ErrEmptyDocID   = errors.New("document id cannot be empty")
	ErrNilDoc       = errors.New("document cannot be nil")
	ErrIndexNotOpen = errors.New("index is not open")
)

// Engine defines the full-text search interface.
// Implementations include:
//   - bleve (in-process, disk or memory)
//   - elasticsearch (remote cluster)
type Engine interface {
	// Index adds or updates a single document.
	Index(ctx context.Context, doc Doc) error
	// IndexBatch adds or updates multiple documents in batches.
	IndexBatch(ctx context.Context, docs []Doc) error
	// Delete removes a document by ID.
	Delete(ctx context.Context, id string) error
	// Search executes a search request and returns matching hits.
	Search(ctx context.Context, req SearchRequest) (SearchResult, error)
	// GetAutoCompleteSuggestions returns prefix-based suggestions.
	GetAutoCompleteSuggestions(ctx context.Context, keyword string) ([]string, error)
	// GetSearchSuggestions returns match-based suggestions.
	GetSearchSuggestions(ctx context.Context, keyword string) ([]string, error)
	// DocCount returns the total number of documents in the index.
	DocCount(ctx context.Context) (uint64, error)
	// Stats returns index statistics.
	Stats() map[string]any
	// Close releases index resources.
	Close() error
}

// ExtendedEngine defines additional operations beyond basic CRUD.
// Not all backends implement this — use a type assertion to check:
//
//	if ee, ok := eng.(search.ExtendedEngine); ok {
//	    doc, err := ee.GetByID(ctx, "doc1")
//	}
type ExtendedEngine interface {
	Engine

	// GetByID retrieves a single document by ID.
	GetByID(ctx context.Context, id string) (Doc, error)

	// Update partially updates a document (merge fields).
	Update(ctx context.Context, id string, fields map[string]any) error

	// BulkDelete removes multiple documents by ID.
	BulkDelete(ctx context.Context, ids []string) error

	// BulkUpdate partially updates multiple documents.
	BulkUpdate(ctx context.Context, updates map[string]map[string]any) error

	// DeleteByQuery removes all documents matching the search request.
	DeleteByQuery(ctx context.Context, req SearchRequest) (int64, error)

	// UpdateByQuery updates all documents matching the search request
	// with the given fields (partial merge).
	UpdateByQuery(ctx context.Context, req SearchRequest, fields map[string]any) (int64, error)

	// Scroll returns a cursor for deep pagination. Call ScrollNext with
	// the returned scrollID to fetch subsequent pages.
	Scroll(ctx context.Context, req SearchRequest, keepAlive time.Duration) (ScrollResult, error)

	// ScrollNext fetches the next batch of results using a scroll ID.
	ScrollNext(ctx context.Context, scrollID string, keepAlive time.Duration) (ScrollResult, error)

	// ClearScroll releases server-side resources for a scroll context.
	ClearScroll(ctx context.Context, scrollID string) error

	// SearchAfter performs cursor-based pagination using sort values
	// from the last hit. More efficient than scroll for sequential access.
	SearchAfter(ctx context.Context, req SearchRequest, after []any) (SearchResult, error)

	// Refresh makes recent index/delete operations visible to search.
	Refresh(ctx context.Context) error

	// Flush persists index changes to disk (backend-dependent).
	Flush(ctx context.Context) error

	// HealthCheck returns nil if the backend is healthy.
	HealthCheck(ctx context.Context) error
}

// ScrollResult holds one page of scroll results plus the scroll ID
// for fetching the next page.
type ScrollResult struct {
	ScrollID string
	Total    uint64
	Hits     []Hit
	Took     time.Duration
}

// AggregationRequest defines a named aggregation to compute during search.
type AggregationRequest struct {
	// Name is the aggregation name in the response.
	Name string

	// Type is the aggregation type:
	// "terms", "histogram", "date_histogram", "stats", "cardinality",
	// "avg", "sum", "min", "max", "percentiles"
	Type string

	// Field is the field to aggregate on.
	Field string

	// Size is the number of buckets for terms aggregations (default 10).
	Size int

	// Interval is the bucket interval for histogram/date_histogram.
	// For date_histogram, use "1d", "1h", "1m", etc.
	Interval string

	// Format is the date format for date_histogram key (e.g. "yyyy-MM-dd").
	Format string

	// Percentiles is the list of percentiles for the percentiles aggregation.
	Percentiles []float64
}

// AggregationResult holds the result of an aggregation.
type AggregationResult struct {
	// Name matches the AggregationRequest.Name.
	Name string

	// Buckets for bucket aggregations (terms, histogram, date_histogram).
	Buckets []AggregationBucket

	// Stats for metrics aggregations (stats, avg, sum, min, max).
	Stats *AggregationStats

	// Percentiles for percentiles aggregation.
	Percentiles map[string]float64

	// Cardinality for cardinality aggregation.
	Cardinality int64
}

// AggregationBucket is a single bucket in a bucket aggregation.
type AggregationBucket struct {
	Key   any `json:"key"`
	Count int `json:"count"`
}

// AggregationStats holds basic statistics for a metrics aggregation.
type AggregationStats struct {
	Count int64   `json:"count"`
	Min   float64 `json:"min"`
	Max   float64 `json:"max"`
	Avg   float64 `json:"avg"`
	Sum   float64 `json:"sum"`
}

// CompletionSuggestionRequest defines a completion field suggestion.
type CompletionSuggestionRequest struct {
	// Field is the completion field name.
	Field string

	// Prefix is the prefix to match.
	Prefix string

	// Size is the max number of suggestions (default 5).
	Size int

	// Fuzzy enables fuzzy matching for the prefix.
	Fuzzy bool

	// Fuzziness is the max edit distance (1-2, default 1).
	Fuzziness int
}

// CompletionSuggestion is a single completion suggestion result.
type CompletionSuggestion struct {
	Text  string
	Score float64
}

// TermSuggestionRequest defines a term-level suggestion for spell correction.
type TermSuggestionRequest struct {
	// Field is the text field to suggest on.
	Field string

	// Text is the input text to correct.
	Text string

	// Size is the max number of suggestions per term (default 5).
	Size int

	// SuggestMode: "missing" (default), "popular", "always".
	SuggestMode string
}

// TermSuggestion is a single term suggestion result.
type TermSuggestion struct {
	Text        string
	Suggestions []string
}
