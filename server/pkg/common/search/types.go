// Package search provides a full-text search engine abstraction built on top
// of Bleve. It supports indexing, batch indexing, deletion, complex queries
// (keyword, term, phrase, prefix, wildcard, regex, fuzzy, range), facets,
// highlighting, and auto-complete suggestions.
//
// Basic usage:
//
//	eng, err := search.NewDefault("/tmp/myindex")
//	if err != nil { log.Fatal(err) }
//	defer eng.Close()
//
//	eng.Index(ctx, search.Doc{
//	    ID:   "doc1",
//	    Type: "article",
//	    Fields: map[string]any{
//	        "title":   "Hello World",
//	        "content": "This is a test document",
//	        "tags":    "test,example",
//	    },
//	})
//
//	res, _ := eng.Search(ctx, search.SearchRequest{
//	    Keyword: "hello",
//	    Size:    10,
//	})
//	for _, hit := range res.Hits {
//	    fmt.Println(hit.ID, hit.Score)
//	}
package search

import "time"

// Config holds search engine configuration.
type Config struct {
	// IndexPath is the filesystem path for the Bleve index.
	// Leave empty for in-memory indexes (use NewMemory).
	IndexPath string

	// DefaultAnalyzer is the Bleve analyzer name (e.g. "standard", "keyword").
	// Empty defaults to "standard".
	DefaultAnalyzer string

	// DefaultSearchFields are the fields searched when SearchRequest.SearchFields
	// is not specified.
	DefaultSearchFields []string

	// OpenTimeout is the timeout for opening an existing index (unused in current impl).
	OpenTimeout time.Duration

	// QueryTimeout is the max duration for individual index/search operations.
	// 0 means no timeout.
	QueryTimeout time.Duration

	// BatchSize is the number of documents per batch in IndexBatch.
	// 0 defaults to 100.
	BatchSize int
}

// Doc represents a document to be indexed.
type Doc struct {
	ID     string         `json:"id"`
	Type   string         `json:"type"`
	Fields map[string]any `json:"fields"`
}

// -------- Filters --------

// NumericRangeFilter filters documents by a numeric field range.
type NumericRangeFilter struct {
	Field   string
	GTE, GT *float64
	LTE, LT *float64
}

// TimeRangeFilter filters documents by a time field range.
type TimeRangeFilter struct {
	Field   string
	From    *time.Time
	To      *time.Time
	IncFrom bool
	IncTo   bool
}

// -------- Advanced query clauses --------

// ClauseMatch matches a single field with a text query.
type ClauseMatch struct {
	Field    string
	Query    string
	Boost    *float64
	Operator string // "and"/"or", default "or"
}

// ClausePhrase matches an exact phrase in a field.
type ClausePhrase struct {
	Field  string
	Phrase string
	Slop   int // allowed word distance
	Boost  *float64
}

// ClausePrefix matches documents where a field starts with a prefix.
type ClausePrefix struct {
	Field  string
	Prefix string
	Boost  *float64
}

// ClauseWildcard matches documents using wildcard patterns (* and ?).
type ClauseWildcard struct {
	Field   string
	Pattern string
	Boost   *float64
}

// ClauseRegex matches documents using a regular expression.
type ClauseRegex struct {
	Field   string
	Pattern string
	Boost   *float64
}

// ClauseFuzzy matches documents with fuzzy (edit-distance) matching.
type ClauseFuzzy struct {
	Field     string
	Term      string
	Fuzziness int // 0, 1, 2…
	Prefix    int // prefix length to match exactly
	Boost     *float64
}

// ClauseQueryString uses Bleve's query string syntax directly.
type ClauseQueryString struct {
	Query  string
	Fields []string // if non-empty, expands to field:(q) OR ...
	Boost  *float64
}

// -------- Facet --------

// FacetRequest requests a term facet aggregation.
type FacetRequest struct {
	Name  string // result name
	Field string // field to facet on
	Size  int    // top N terms
}

// -------- Search request/result --------

// SearchRequest defines a search query with all supported features.
type SearchRequest struct {
	// Keyword is the simple keyword search (legacy interface).
	Keyword      string
	SearchFields []string

	// Structured term filters.
	MustTerms    map[string][]string
	MustNotTerms map[string][]string
	ShouldTerms  map[string][]string

	// Numeric and time range filters.
	NumericRanges []NumericRangeFilter
	TimeRanges    []TimeRangeFilter

	// Advanced query clauses.
	QueryString *ClauseQueryString
	Matches     []ClauseMatch
	Phrases     []ClausePhrase
	Prefixes    []ClausePrefix
	Wildcards   []ClauseWildcard
	Regexps     []ClauseRegex
	Fuzzies     []ClauseFuzzy

	// MinShould is the minimum number of should clauses that must match.
	MinShould int

	// Facets to compute.
	Facets []FacetRequest

	// Aggregations to compute (richer than Facets).
	Aggregations []AggregationRequest

	// Sorting and pagination.
	SortBy []string
	From   int
	Size   int

	// SearchAfter provides cursor-based pagination using sort values
	// from the last hit. Only supported by ExtendedEngine backends.
	SearchAfter []any

	// Field selection and highlighting.
	IncludeFields   []string
	ExcludeFields   []string
	Highlight       bool
	HighlightFields []string
	FragmentSize    int
	MaxFragments    int

	// TrackTotalHits: if true, the engine returns the exact total hit
	// count (may be expensive for large result sets). Default: true.
	TrackTotalHits *bool

	// MinScore: if > 0, only return hits with score >= MinScore.
	MinScore float64

	// Explain: if true, return score explanation for each hit.
	Explain bool

	// Version: if true, return document version for each hit.
	Version bool
}

// Hit represents a single search result.
type Hit struct {
	ID        string              `json:"id"`
	Score     float64             `json:"score"`
	Fields    map[string]any      `json:"fields"`
	Fragments map[string][]string `json:"fragments,omitempty"`
	Sort      []any               `json:"sort,omitempty"` // sort values for SearchAfter
	Version   int64               `json:"version,omitempty"`
	Index     string              `json:"index,omitempty"` // source index (multi-index search)
}

// FacetTerm is a single term in a facet result.
type FacetTerm struct {
	Term  string `json:"term"`
	Count int    `json:"count"`
}

// FacetResult holds the result of a facet aggregation.
type FacetResult struct {
	Total int         `json:"total"`
	Terms []FacetTerm `json:"terms"`
}

// SearchResult is the response to a SearchRequest.
type SearchResult struct {
	Total        uint64                       `json:"total"`
	Took         time.Duration                `json:"took"`
	Hits         []Hit                        `json:"hits"`
	Facets       map[string]FacetResult       `json:"facets,omitempty"`
	Aggregations map[string]AggregationResult `json:"aggregations,omitempty"`
	MaxScore     float64                      `json:"maxScore,omitempty"`
}

// -------- Helper constructors --------

// NewDoc creates a Doc with the given ID, type, and fields.
func NewDoc(id, docType string, fields map[string]any) Doc {
	return Doc{ID: id, Type: docType, Fields: fields}
}

// NewKeywordSearch creates a simple keyword search request.
func NewKeywordSearch(keyword string, size int) SearchRequest {
	if size <= 0 {
		size = 10
	}
	return SearchRequest{Keyword: keyword, Size: size}
}

// NewTermSearch creates a search request that filters by exact term match.
func NewTermSearch(field, value string, size int) SearchRequest {
	if size <= 0 {
		size = 10
	}
	return SearchRequest{
		MustTerms: map[string][]string{field: {value}},
		Size:      size,
	}
}

// NewMatchSearch creates a search request with a match clause on a specific field.
func NewMatchSearch(field, query string, size int) SearchRequest {
	if size <= 0 {
		size = 10
	}
	return SearchRequest{
		Matches: []ClauseMatch{{Field: field, Query: query}},
		Size:    size,
	}
}

// NewPhraseSearch creates a search request with a phrase clause.
func NewPhraseSearch(field, phrase string, size int) SearchRequest {
	if size <= 0 {
		size = 10
	}
	return SearchRequest{
		Phrases: []ClausePhrase{{Field: field, Phrase: phrase}},
		Size:    size,
	}
}
