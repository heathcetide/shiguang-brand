// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package elasticsearch implements the search.Engine interface using
// Elasticsearch 8.x as a remote search backend.
//
// Basic usage:
//
//	eng, err := elasticsearch.New(elasticsearch.Config{
//	    Addresses: []string{"http://localhost:9200"},
//	    IndexName: "myindex",
//	})
//	if err != nil { log.Fatal(err) }
//	defer eng.Close()
//
//	eng.Index(ctx, search.Doc{
//	    ID:   "doc1",
//	    Type: "article",
//	    Fields: map[string]any{
//	        "title":   "Hello World",
//	        "content": "This is a test document",
//	    },
//	})
//
//	res, _ := eng.Search(ctx, search.NewKeywordSearch("hello", 10))
package elasticsearch

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common/search"

	es "github.com/elastic/go-elasticsearch/v8"
	"github.com/elastic/go-elasticsearch/v8/esapi"
)

// Config holds Elasticsearch engine configuration.
type Config struct {
	// Addresses is the list of Elasticsearch node URLs.
	Addresses []string

	// Username for basic auth (optional).
	Username string

	// Password for basic auth (optional).
	Password string

	// IndexName is the Elasticsearch index name to use.
	// If empty, defaults to "ling_base_search".
	IndexName string

	// DefaultSearchFields are the fields searched when SearchRequest.SearchFields
	// is not specified.
	DefaultSearchFields []string

	// QueryTimeout is the max duration for search/index operations.
	// 0 means no timeout (use context deadline from caller).
	QueryTimeout time.Duration

	// BatchSize is the number of documents per bulk request.
	// 0 defaults to 100.
	BatchSize int

	// AutoCreateIndex: if true, the index is created on Connect with
	// default mappings. Default: true.
	AutoCreateIndex bool
}

// engine implements search.Engine using Elasticsearch.
type engine struct {
	cfg    Config
	client *es.Client
	mu     sync.RWMutex
	closed bool
	stats  engineStats
}

type engineStats struct {
	IndexOps  uint64
	SearchOps uint64
	DeleteOps uint64
	BatchOps  uint64
	mu        sync.Mutex
}

func (s *engineStats) incIndex()  { s.mu.Lock(); s.IndexOps++; s.mu.Unlock() }
func (s *engineStats) incSearch() { s.mu.Lock(); s.SearchOps++; s.mu.Unlock() }
func (s *engineStats) incDelete() { s.mu.Lock(); s.DeleteOps++; s.mu.Unlock() }
func (s *engineStats) incBatch()  { s.mu.Lock(); s.BatchOps++; s.mu.Unlock() }

// New creates a new Elasticsearch-backed search.Engine.
// It connects to the cluster and optionally creates the index.
func New(cfg Config) (search.Engine, error) {
	if len(cfg.Addresses) == 0 {
		return nil, fmt.Errorf("elasticsearch: at least one address is required")
	}
	if cfg.IndexName == "" {
		cfg.IndexName = "ling_base_search"
	}
	if cfg.BatchSize <= 0 {
		cfg.BatchSize = 100
	}

	client, err := es.NewClient(es.Config{
		Addresses: cfg.Addresses,
		Username:  cfg.Username,
		Password:  cfg.Password,
	})
	if err != nil {
		return nil, fmt.Errorf("elasticsearch: create client: %w", err)
	}

	eng := &engine{cfg: cfg, client: client}

	// Ping the cluster.
	resp, err := client.Ping()
	if err != nil {
		return nil, fmt.Errorf("elasticsearch: ping cluster: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("elasticsearch: ping returned status %d", resp.StatusCode)
	}

	// Auto-create index with default mapping.
	if cfg.AutoCreateIndex {
		if err := eng.ensureIndex(context.Background()); err != nil {
			return nil, fmt.Errorf("elasticsearch: ensure index: %w", err)
		}
	}

	return eng, nil
}

// ensureIndex creates the Elasticsearch index if it doesn't exist.
func (e *engine) ensureIndex(ctx context.Context) error {
	// Check if index exists.
	existsResp, err := esapi.IndicesExistsRequest{
		Index: []string{e.cfg.IndexName},
	}.Do(ctx, e.client)
	if err != nil {
		return fmt.Errorf("check index exists: %w", err)
	}
	defer existsResp.Body.Close()

	if existsResp.StatusCode == 200 {
		return nil // Index already exists.
	}

	// Create index with default mapping.
	mapping := defaultIndexMapping()
	body, _ := json.Marshal(mapping)

	createResp, err := esapi.IndicesCreateRequest{
		Index: e.cfg.IndexName,
		Body:  bytes.NewReader(body),
	}.Do(ctx, e.client)
	if err != nil {
		return fmt.Errorf("create index: %w", err)
	}
	defer createResp.Body.Close()

	if createResp.IsError() {
		return fmt.Errorf("create index: %s", createResp.String())
	}
	return nil
}

// defaultIndexMapping returns a default Elasticsearch index mapping
// that supports dynamic fields with text and keyword sub-fields.
func defaultIndexMapping() map[string]any {
	return map[string]any{
		"mappings": map[string]any{
			"dynamic": true,
			"properties": map[string]any{
				"type": map[string]any{
					"type": "keyword",
				},
				"title": map[string]any{
					"type":     "text",
					"analyzer": "standard",
					"fields": map[string]any{
						"keyword": map[string]any{
							"type":         "keyword",
							"ignore_above": 256,
						},
					},
				},
				"description": map[string]any{
					"type":     "text",
					"analyzer": "standard",
				},
				"content": map[string]any{
					"type":     "text",
					"analyzer": "standard",
				},
				"category": map[string]any{
					"type": "keyword",
				},
				"tags": map[string]any{
					"type": "keyword",
				},
				"author": map[string]any{
					"type": "keyword",
				},
				"userId": map[string]any{
					"type": "keyword",
				},
				"createdAt": map[string]any{
					"type": "date",
				},
				"views": map[string]any{
					"type": "integer",
				},
			},
		},
	}
}

func (e *engine) guard() error {
	e.mu.RLock()
	defer e.mu.RUnlock()
	if e.closed {
		return search.ErrClosed
	}
	return nil
}

func (e *engine) withTimeout(ctx context.Context, d time.Duration) (context.Context, context.CancelFunc) {
	if ctx == nil {
		ctx = context.Background()
	}
	if d <= 0 {
		return ctx, func() {}
	}
	return context.WithTimeout(ctx, d)
}

// ============================================================
// Index
// ============================================================

func (e *engine) Index(ctx context.Context, doc search.Doc) error {
	if err := e.guard(); err != nil {
		return err
	}
	if doc.ID == "" {
		return search.ErrEmptyDocID
	}
	e.stats.incIndex()

	c, cancel := e.withTimeout(ctx, e.cfg.QueryTimeout)
	defer cancel()

	data := make(map[string]any, len(doc.Fields)+1)
	for k, v := range doc.Fields {
		data[k] = v
	}
	if doc.Type != "" {
		data["type"] = doc.Type
	}
	body, err := json.Marshal(data)
	if err != nil {
		return fmt.Errorf("elasticsearch: marshal doc: %w", err)
	}

	req := esapi.IndexRequest{
		Index:      e.cfg.IndexName,
		DocumentID: doc.ID,
		Body:       bytes.NewReader(body),
		Refresh:    "true",
	}
	resp, err := req.Do(c, e.client)
	if err != nil {
		return fmt.Errorf("elasticsearch: index doc %s: %w", doc.ID, err)
	}
	defer resp.Body.Close()

	if resp.IsError() {
		return fmt.Errorf("elasticsearch: index doc %s: %s", doc.ID, resp.String())
	}
	return nil
}

// ============================================================
// IndexBatch
// ============================================================

func (e *engine) IndexBatch(ctx context.Context, docs []search.Doc) error {
	if err := e.guard(); err != nil {
		return err
	}
	for _, d := range docs {
		if d.ID == "" {
			return fmt.Errorf("elasticsearch: batch contains document with empty id")
		}
	}
	e.stats.incBatch()

	c, cancel := e.withTimeout(ctx, 0)
	defer cancel()

	bs := e.cfg.BatchSize
	for i := 0; i < len(docs); i += bs {
		end := i + bs
		if end > len(docs) {
			end = len(docs)
		}
		if err := e.bulkIndex(c, docs[i:end]); err != nil {
			return err
		}
	}
	return nil
}

func (e *engine) bulkIndex(ctx context.Context, docs []search.Doc) error {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)

	for _, d := range docs {
		// Action line
		action := map[string]any{
			"index": map[string]any{
				"_index": e.cfg.IndexName,
				"_id":    d.ID,
			},
		}
		if err := enc.Encode(action); err != nil {
			return fmt.Errorf("elasticsearch: encode bulk action: %w", err)
		}

		// Source line
		data := make(map[string]any, len(d.Fields)+1)
		for k, v := range d.Fields {
			data[k] = v
		}
		if d.Type != "" {
			data["type"] = d.Type
		}
		if err := enc.Encode(data); err != nil {
			return fmt.Errorf("elasticsearch: encode bulk doc: %w", err)
		}
	}

	req := esapi.BulkRequest{
		Body:    bytes.NewReader(buf.Bytes()),
		Refresh: "true",
	}
	resp, err := req.Do(ctx, e.client)
	if err != nil {
		return fmt.Errorf("elasticsearch: bulk index: %w", err)
	}
	defer resp.Body.Close()

	if resp.IsError() {
		return fmt.Errorf("elasticsearch: bulk index: %s", resp.String())
	}

	// Parse response for individual errors.
	var bulkResp struct {
		Errors bool `json:"errors"`
		Items  []map[string]struct {
			Error any `json:"error,omitempty"`
		} `json:"items"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&bulkResp); err != nil {
		return nil // Non-fatal: response parsing error.
	}
	if bulkResp.Errors {
		for _, item := range bulkResp.Items {
			if idx, ok := item["index"]; ok && idx.Error != nil {
				return fmt.Errorf("elasticsearch: bulk item error: %v", idx.Error)
			}
		}
	}
	return nil
}

// ============================================================
// Delete
// ============================================================

func (e *engine) Delete(ctx context.Context, id string) error {
	if err := e.guard(); err != nil {
		return err
	}
	if id == "" {
		return search.ErrEmptyDocID
	}
	e.stats.incDelete()

	c, cancel := e.withTimeout(ctx, e.cfg.QueryTimeout)
	defer cancel()

	req := esapi.DeleteRequest{
		Index:      e.cfg.IndexName,
		DocumentID: id,
		Refresh:    "true",
	}
	resp, err := req.Do(c, e.client)
	if err != nil {
		return fmt.Errorf("elasticsearch: delete doc %s: %w", id, err)
	}
	defer resp.Body.Close()

	if resp.IsError() && resp.StatusCode != 404 {
		return fmt.Errorf("elasticsearch: delete doc %s: %s", id, resp.String())
	}
	return nil
}

// ============================================================
// Search
// ============================================================

func (e *engine) Search(ctx context.Context, req search.SearchRequest) (search.SearchResult, error) {
	if err := e.guard(); err != nil {
		return search.SearchResult{}, err
	}
	e.stats.incSearch()

	c, cancel := e.withTimeout(ctx, e.cfg.QueryTimeout)
	defer cancel()

	if req.Size <= 0 {
		req.Size = 10
	}
	if req.From < 0 {
		req.From = 0
	}

	query := buildESQuery(req, e.cfg.DefaultSearchFields)

	body := map[string]any{
		"query": query,
		"from":  req.From,
		"size":  req.Size,
	}

	// Source field selection
	if len(req.IncludeFields) > 0 || len(req.ExcludeFields) > 0 {
		src := map[string]any{}
		if len(req.IncludeFields) > 0 {
			src["includes"] = req.IncludeFields
		}
		if len(req.ExcludeFields) > 0 {
			src["excludes"] = req.ExcludeFields
		}
		body["_source"] = src
	} else {
		body["_source"] = true
	}

	// Sorting
	if len(req.SortBy) > 0 {
		sortArr := make([]any, 0, len(req.SortBy))
		for _, s := range req.SortBy {
			sortArr = append(sortArr, s)
		}
		body["sort"] = sortArr
	}

	// SearchAfter (cursor-based pagination)
	if len(req.SearchAfter) > 0 {
		body["search_after"] = req.SearchAfter
	}

	// Track total hits
	if req.TrackTotalHits != nil {
		body["track_total_hits"] = *req.TrackTotalHits
	} else {
		body["track_total_hits"] = true
	}

	// Min score
	if req.MinScore > 0 {
		body["min_score"] = req.MinScore
	}

	// Explain
	if req.Explain {
		body["explain"] = true
	}

	// Version
	if req.Version {
		body["version"] = true
	}

	// Highlight
	if req.Highlight {
		hlFields := req.HighlightFields
		if len(hlFields) == 0 {
			hlFields = []string{"title", "content", "description"}
		}
		hl := map[string]any{
			"fields":              make(map[string]any),
			"require_field_match": false,
		}
		for _, f := range hlFields {
			hl["fields"].(map[string]any)[f] = map[string]any{
				"pre_tags":  []string{"<em>"},
				"post_tags": []string{"</em>"},
			}
		}
		if req.FragmentSize > 0 {
			hl["fragment_size"] = req.FragmentSize
		}
		if req.MaxFragments > 0 {
			hl["number_of_fragments"] = req.MaxFragments
		}
		body["highlight"] = hl
	}

	// Facets (legacy) + Aggregations (rich)
	aggs := make(map[string]any)
	if len(req.Facets) > 0 {
		for _, f := range req.Facets {
			size := f.Size
			if size <= 0 {
				size = 10
			}
			aggs[f.Name] = map[string]any{
				"terms": map[string]any{
					"field": f.Field,
					"size":  size,
				},
			}
		}
	}
	if len(req.Aggregations) > 0 {
		for k, v := range buildAggregations(req.Aggregations) {
			aggs[k] = v
		}
	}
	if len(aggs) > 0 {
		body["aggs"] = aggs
	}

	bodyBytes, err := json.Marshal(body)
	if err != nil {
		return search.SearchResult{}, fmt.Errorf("elasticsearch: marshal query: %w", err)
	}

	searchReq := esapi.SearchRequest{
		Index: []string{e.cfg.IndexName},
		Body:  bytes.NewReader(bodyBytes),
	}
	resp, err := searchReq.Do(c, e.client)
	if err != nil {
		return search.SearchResult{}, fmt.Errorf("elasticsearch: search: %w", err)
	}
	defer resp.Body.Close()

	if resp.IsError() {
		return search.SearchResult{}, fmt.Errorf("elasticsearch: search: %s", resp.String())
	}

	result, err := parseSearchResponse(resp.Body)
	if err != nil {
		return search.SearchResult{}, err
	}

	// Also populate Facets from terms aggregations (backward compat)
	if result.Aggregations != nil {
		result.Facets = map[string]search.FacetResult{}
		for name, agg := range result.Aggregations {
			if len(agg.Buckets) > 0 {
				fr := search.FacetResult{Total: len(agg.Buckets)}
				for _, b := range agg.Buckets {
					term := fmt.Sprintf("%v", b.Key)
					fr.Terms = append(fr.Terms, search.FacetTerm{
						Term:  term,
						Count: b.Count,
					})
				}
				result.Facets[name] = fr
			}
		}
	}

	return result, nil
}

// ============================================================
// buildESQuery converts a SearchRequest to an Elasticsearch query DSL.
// ============================================================

func buildESQuery(req search.SearchRequest, defaultFields []string) map[string]any {
	var must, should, mustNot []map[string]any

	// Keyword search
	keyword := strings.TrimSpace(req.Keyword)
	if keyword != "" {
		fields := req.SearchFields
		if len(fields) == 0 {
			fields = defaultFields
		}
		if len(fields) == 0 {
			fields = []string{"title", "content", "description", "name"}
		}
		must = append(must, map[string]any{
			"multi_match": map[string]any{
				"query":  keyword,
				"fields": fields,
			},
		})
	}

	// QueryString
	if req.QueryString != nil {
		qs := map[string]any{
			"query": req.QueryString.Query,
		}
		if len(req.QueryString.Fields) > 0 {
			qs["fields"] = req.QueryString.Fields
		}
		if req.QueryString.Boost != nil {
			qs["boost"] = *req.QueryString.Boost
		}
		should = append(should, map[string]any{"query_string": qs})
	}

	// Term filters
	for f, vs := range req.MustTerms {
		termField := esTermField(f)
		if len(vs) == 1 {
			must = append(must, map[string]any{
				"term": map[string]any{termField: vs[0]},
			})
		} else {
			must = append(must, map[string]any{
				"terms": map[string]any{termField: vs},
			})
		}
	}
	for f, vs := range req.MustNotTerms {
		termField := esTermField(f)
		for _, v := range vs {
			mustNot = append(mustNot, map[string]any{
				"term": map[string]any{termField: v},
			})
		}
	}
	for f, vs := range req.ShouldTerms {
		termField := esTermField(f)
		for _, v := range vs {
			should = append(should, map[string]any{
				"term": map[string]any{termField: v},
			})
		}
	}

	// Match clauses
	for _, m := range req.Matches {
		mq := map[string]any{
			"query": m.Query,
		}
		if m.Field != "" {
			should = append(should, map[string]any{
				"match": map[string]any{m.Field: mq},
			})
		} else {
			should = append(should, map[string]any{"match": mq})
		}
	}

	// Phrase clauses
	for _, p := range req.Phrases {
		pq := map[string]any{
			"query": p.Phrase,
		}
		if p.Field != "" {
			should = append(should, map[string]any{
				"match_phrase": map[string]any{p.Field: pq},
			})
		}
	}

	// Prefix clauses
	for _, pr := range req.Prefixes {
		if pr.Field != "" {
			// Use .keyword sub-field for prefix on text fields
			prefixField := pr.Field
			if !strings.HasSuffix(prefixField, ".keyword") {
				prefixField = pr.Field + ".keyword"
			}
			should = append(should, map[string]any{
				"prefix": map[string]any{prefixField: pr.Prefix},
			})
		}
	}

	// Wildcard clauses
	for _, w := range req.Wildcards {
		if w.Field != "" {
			wildcardField := w.Field
			if !strings.HasSuffix(wildcardField, ".keyword") {
				wildcardField = w.Field + ".keyword"
			}
			should = append(should, map[string]any{
				"wildcard": map[string]any{wildcardField: w.Pattern},
			})
		}
	}

	// Regex clauses
	for _, r := range req.Regexps {
		if r.Field != "" {
			regexField := r.Field
			if !strings.HasSuffix(regexField, ".keyword") {
				regexField = r.Field + ".keyword"
			}
			should = append(should, map[string]any{
				"regexp": map[string]any{regexField: r.Pattern},
			})
		}
	}

	// Fuzzy clauses
	for _, fz := range req.Fuzzies {
		fq := map[string]any{
			"value": fz.Term,
		}
		if fz.Fuzziness > 0 {
			fq["fuzziness"] = fz.Fuzziness
		}
		if fz.Field != "" {
			should = append(should, map[string]any{
				"fuzzy": map[string]any{fz.Field: fq},
			})
		}
	}

	// Numeric range filters
	for _, r := range req.NumericRanges {
		rng := map[string]any{}
		if r.GTE != nil {
			rng["gte"] = *r.GTE
		}
		if r.GT != nil {
			rng["gt"] = *r.GT
		}
		if r.LTE != nil {
			rng["lte"] = *r.LTE
		}
		if r.LT != nil {
			rng["lt"] = *r.LT
		}
		must = append(must, map[string]any{
			"range": map[string]any{r.Field: rng},
		})
	}

	// Time range filters
	for _, r := range req.TimeRanges {
		rng := map[string]any{}
		if r.From != nil {
			rng["gte"] = r.From.Format(time.RFC3339Nano)
		}
		if r.To != nil {
			rng["lte"] = r.To.Format(time.RFC3339Nano)
		}
		must = append(must, map[string]any{
			"range": map[string]any{r.Field: rng},
		})
	}

	// Build bool query
	boolQ := map[string]any{}
	if len(must) > 0 {
		boolQ["must"] = must
	}
	if len(mustNot) > 0 {
		boolQ["must_not"] = mustNot
	}
	if len(should) > 0 {
		if req.MinShould > 0 {
			boolQ["should"] = should
			boolQ["minimum_should_match"] = req.MinShould
		} else {
			boolQ["should"] = should
		}
	}

	// If no clauses, match all
	if len(boolQ) == 0 {
		return map[string]any{"match_all": map[string]any{}}
	}

	return map[string]any{"bool": boolQ}
}

// esTermField returns the .keyword sub-field for text fields,
// or the original field for keyword/numeric/date fields.
func esTermField(field string) string {
	// Known keyword fields that don't need .keyword suffix
	keywordFields := map[string]bool{
		"type": true, "category": true, "tags": true,
		"author": true, "userId": true, "url": true, "icon": true,
	}
	if keywordFields[field] {
		return field
	}
	if strings.HasSuffix(field, ".keyword") {
		return field
	}
	// For text fields like title/content/description, use .keyword
	textFields := map[string]bool{
		"title": true, "content": true, "description": true,
		"name": true, "body": true,
	}
	if textFields[field] {
		return field + ".keyword"
	}
	return field
}

// ============================================================
// DocCount
// ============================================================

func (e *engine) DocCount(ctx context.Context) (uint64, error) {
	if err := e.guard(); err != nil {
		return 0, err
	}

	c, cancel := e.withTimeout(ctx, e.cfg.QueryTimeout)
	defer cancel()

	req := esapi.CountRequest{
		Index: []string{e.cfg.IndexName},
	}
	resp, err := req.Do(c, e.client)
	if err != nil {
		return 0, fmt.Errorf("elasticsearch: count: %w", err)
	}
	defer resp.Body.Close()

	if resp.IsError() {
		return 0, fmt.Errorf("elasticsearch: count: %s", resp.String())
	}

	var countResp struct {
		Count uint64 `json:"count"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&countResp); err != nil {
		return 0, fmt.Errorf("elasticsearch: decode count: %w", err)
	}
	return countResp.Count, nil
}

// ============================================================
// Suggestions
// ============================================================

func (e *engine) GetAutoCompleteSuggestions(ctx context.Context, keyword string) ([]string, error) {
	if err := e.guard(); err != nil {
		return nil, err
	}
	if keyword == "" {
		return []string{}, nil
	}

	c, cancel := e.withTimeout(ctx, e.cfg.QueryTimeout)
	defer cancel()

	body := map[string]any{
		"query": map[string]any{
			"prefix": map[string]any{
				"title.keyword": keyword,
			},
		},
		"_source": []string{"title", "name", "content"},
		"size":    10,
	}
	bodyBytes, _ := json.Marshal(body)

	req := esapi.SearchRequest{
		Index: []string{e.cfg.IndexName},
		Body:  bytes.NewReader(bodyBytes),
	}
	resp, err := req.Do(c, e.client)
	if err != nil {
		return nil, fmt.Errorf("elasticsearch: autocomplete: %w", err)
	}
	defer resp.Body.Close()

	if resp.IsError() {
		return nil, fmt.Errorf("elasticsearch: autocomplete: %s", resp.String())
	}

	var esResp struct {
		Hits struct {
			Hits []struct {
				Source map[string]any `json:"_source"`
			} `json:"hits"`
		} `json:"hits"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&esResp); err != nil {
		return nil, fmt.Errorf("elasticsearch: decode autocomplete: %w", err)
	}

	suggestions := make([]string, 0, len(esResp.Hits.Hits))
	for _, h := range esResp.Hits.Hits {
		for _, field := range []string{"title", "name", "content"} {
			if v, ok := h.Source[field].(string); ok && v != "" {
				suggestions = append(suggestions, v)
				break
			}
		}
	}
	return suggestions, nil
}

func (e *engine) GetSearchSuggestions(ctx context.Context, keyword string) ([]string, error) {
	if err := e.guard(); err != nil {
		return nil, err
	}
	if keyword == "" {
		return []string{}, nil
	}

	c, cancel := e.withTimeout(ctx, e.cfg.QueryTimeout)
	defer cancel()

	body := map[string]any{
		"query": map[string]any{
			"multi_match": map[string]any{
				"query":  keyword,
				"fields": []string{"title", "name", "content"},
			},
		},
		"_source": []string{"title", "name", "content"},
		"size":    10,
	}
	bodyBytes, _ := json.Marshal(body)

	req := esapi.SearchRequest{
		Index: []string{e.cfg.IndexName},
		Body:  bytes.NewReader(bodyBytes),
	}
	resp, err := req.Do(c, e.client)
	if err != nil {
		return nil, fmt.Errorf("elasticsearch: search suggestions: %w", err)
	}
	defer resp.Body.Close()

	if resp.IsError() {
		return nil, fmt.Errorf("elasticsearch: search suggestions: %s", resp.String())
	}

	var esResp struct {
		Hits struct {
			Hits []struct {
				Source map[string]any `json:"_source"`
			} `json:"hits"`
		} `json:"hits"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&esResp); err != nil {
		return nil, fmt.Errorf("elasticsearch: decode suggestions: %w", err)
	}

	suggestions := make([]string, 0, len(esResp.Hits.Hits))
	for _, h := range esResp.Hits.Hits {
		for _, field := range []string{"title", "name", "content"} {
			if v, ok := h.Source[field].(string); ok && v != "" {
				suggestions = append(suggestions, v)
				break
			}
		}
	}
	return suggestions, nil
}

// ============================================================
// Stats
// ============================================================

func (e *engine) Stats() map[string]any {
	e.mu.RLock()
	defer e.mu.RUnlock()

	stats := map[string]any{
		"closed":  e.closed,
		"backend": "elasticsearch",
		"index":   e.cfg.IndexName,
	}
	e.stats.mu.Lock()
	stats["indexOps"] = e.stats.IndexOps
	stats["searchOps"] = e.stats.SearchOps
	stats["deleteOps"] = e.stats.DeleteOps
	stats["batchOps"] = e.stats.BatchOps
	e.stats.mu.Unlock()
	return stats
}

// ============================================================
// Close
// ============================================================

func (e *engine) Close() error {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.closed {
		return nil
	}
	e.closed = true
	return nil
}
