// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package elasticsearch

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common/search"

	"github.com/elastic/go-elasticsearch/v8/esapi"
)

// formatDuration converts a Go time.Duration to Elasticsearch's
// time units format (e.g. "1m", "30s", "1h").
func formatDuration(d time.Duration) string {
	if d <= 0 {
		return "1m"
	}
	seconds := int64(d.Seconds())
	if seconds >= 3600 && seconds%3600 == 0 {
		return fmt.Sprintf("%dh", seconds/3600)
	}
	if seconds >= 60 && seconds%60 == 0 {
		return fmt.Sprintf("%dm", seconds/60)
	}
	return fmt.Sprintf("%ds", seconds)
}

// ============================================================
// GetByID
// ============================================================

func (e *engine) GetByID(ctx context.Context, id string) (search.Doc, error) {
	if err := e.guard(); err != nil {
		return search.Doc{}, err
	}
	if id == "" {
		return search.Doc{}, search.ErrEmptyDocID
	}

	c, cancel := e.withTimeout(ctx, e.cfg.QueryTimeout)
	defer cancel()

	req := esapi.GetRequest{
		Index:      e.cfg.IndexName,
		DocumentID: id,
	}
	resp, err := req.Do(c, e.client)
	if err != nil {
		return search.Doc{}, fmt.Errorf("elasticsearch: get doc %s: %w", id, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == 404 {
		return search.Doc{}, fmt.Errorf("elasticsearch: document %s not found", id)
	}
	if resp.IsError() {
		return search.Doc{}, fmt.Errorf("elasticsearch: get doc %s: %s", id, resp.String())
	}

	var result struct {
		Found  bool           `json:"found"`
		Source map[string]any `json:"_source"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return search.Doc{}, fmt.Errorf("elasticsearch: decode get response: %w", err)
	}

	doc := search.Doc{
		ID:     id,
		Fields: result.Source,
	}
	if t, ok := result.Source["type"].(string); ok {
		doc.Type = t
	}
	return doc, nil
}

// ============================================================
// Update (partial)
// ============================================================

func (e *engine) Update(ctx context.Context, id string, fields map[string]any) error {
	if err := e.guard(); err != nil {
		return err
	}
	if id == "" {
		return search.ErrEmptyDocID
	}

	c, cancel := e.withTimeout(ctx, e.cfg.QueryTimeout)
	defer cancel()

	body := map[string]any{
		"doc": fields,
	}
	bodyBytes, _ := json.Marshal(body)

	req := esapi.UpdateRequest{
		Index:      e.cfg.IndexName,
		DocumentID: id,
		Body:       bytes.NewReader(bodyBytes),
		Refresh:    "true",
	}
	resp, err := req.Do(c, e.client)
	if err != nil {
		return fmt.Errorf("elasticsearch: update doc %s: %w", id, err)
	}
	defer resp.Body.Close()

	if resp.IsError() {
		return fmt.Errorf("elasticsearch: update doc %s: %s", id, resp.String())
	}
	return nil
}

// ============================================================
// BulkDelete
// ============================================================

func (e *engine) BulkDelete(ctx context.Context, ids []string) error {
	if err := e.guard(); err != nil {
		return err
	}
	if len(ids) == 0 {
		return nil
	}

	c, cancel := e.withTimeout(ctx, 0)
	defer cancel()

	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	for _, id := range ids {
		action := map[string]any{
			"delete": map[string]any{
				"_index": e.cfg.IndexName,
				"_id":    id,
			},
		}
		if err := enc.Encode(action); err != nil {
			return fmt.Errorf("elasticsearch: encode bulk delete: %w", err)
		}
	}

	req := esapi.BulkRequest{
		Body:    bytes.NewReader(buf.Bytes()),
		Refresh: "true",
	}
	resp, err := req.Do(c, e.client)
	if err != nil {
		return fmt.Errorf("elasticsearch: bulk delete: %w", err)
	}
	defer resp.Body.Close()

	if resp.IsError() {
		return fmt.Errorf("elasticsearch: bulk delete: %s", resp.String())
	}

	var bulkResp struct {
		Errors bool `json:"errors"`
	}
	json.NewDecoder(resp.Body).Decode(&bulkResp)
	if bulkResp.Errors {
		// 404 for non-existent docs is OK in bulk delete
	}
	return nil
}

// ============================================================
// BulkUpdate
// ============================================================

func (e *engine) BulkUpdate(ctx context.Context, updates map[string]map[string]any) error {
	if err := e.guard(); err != nil {
		return err
	}
	if len(updates) == 0 {
		return nil
	}

	c, cancel := e.withTimeout(ctx, 0)
	defer cancel()

	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	for id, fields := range updates {
		action := map[string]any{
			"update": map[string]any{
				"_index": e.cfg.IndexName,
				"_id":    id,
			},
		}
		if err := enc.Encode(action); err != nil {
			return fmt.Errorf("elasticsearch: encode bulk update action: %w", err)
		}
		doc := map[string]any{"doc": fields}
		if err := enc.Encode(doc); err != nil {
			return fmt.Errorf("elasticsearch: encode bulk update doc: %w", err)
		}
	}

	req := esapi.BulkRequest{
		Body:    bytes.NewReader(buf.Bytes()),
		Refresh: "true",
	}
	resp, err := req.Do(c, e.client)
	if err != nil {
		return fmt.Errorf("elasticsearch: bulk update: %w", err)
	}
	defer resp.Body.Close()

	if resp.IsError() {
		return fmt.Errorf("elasticsearch: bulk update: %s", resp.String())
	}
	return nil
}

// ============================================================
// DeleteByQuery
// ============================================================

func (e *engine) DeleteByQuery(ctx context.Context, req search.SearchRequest) (int64, error) {
	if err := e.guard(); err != nil {
		return 0, err
	}

	c, cancel := e.withTimeout(ctx, 0)
	defer cancel()

	query := buildESQuery(req, e.cfg.DefaultSearchFields)
	body := map[string]any{"query": query}
	bodyBytes, _ := json.Marshal(body)

	r := esapi.DeleteByQueryRequest{
		Index: []string{e.cfg.IndexName},
		Body:  bytes.NewReader(bodyBytes),
	}
	resp, err := r.Do(c, e.client)
	if err != nil {
		return 0, fmt.Errorf("elasticsearch: delete by query: %w", err)
	}
	defer resp.Body.Close()

	if resp.IsError() {
		return 0, fmt.Errorf("elasticsearch: delete by query: %s", resp.String())
	}

	var result struct {
		Deleted int64 `json:"deleted"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return 0, fmt.Errorf("elasticsearch: decode delete by query: %w", err)
	}
	return result.Deleted, nil
}

// ============================================================
// UpdateByQuery
// ============================================================

func (e *engine) UpdateByQuery(ctx context.Context, req search.SearchRequest, fields map[string]any) (int64, error) {
	if err := e.guard(); err != nil {
		return 0, err
	}

	c, cancel := e.withTimeout(ctx, 0)
	defer cancel()

	query := buildESQuery(req, e.cfg.DefaultSearchFields)

	// Build a painless script for partial update
	var scriptParts []string
	params := make(map[string]any)
	for k, v := range fields {
		paramKey := "p_" + strings.ReplaceAll(k, ".", "_")
		scriptParts = append(scriptParts, fmt.Sprintf("ctx._source.%s = params.%s", k, paramKey))
		params[paramKey] = v
	}
	script := strings.Join(scriptParts, "; ")

	body := map[string]any{
		"query": query,
		"script": map[string]any{
			"source": script,
			"lang":   "painless",
			"params": params,
		},
	}
	bodyBytes, _ := json.Marshal(body)

	r := esapi.UpdateByQueryRequest{
		Index: []string{e.cfg.IndexName},
		Body:  bytes.NewReader(bodyBytes),
	}
	resp, err := r.Do(c, e.client)
	if err != nil {
		return 0, fmt.Errorf("elasticsearch: update by query: %w", err)
	}
	defer resp.Body.Close()

	if resp.IsError() {
		return 0, fmt.Errorf("elasticsearch: update by query: %s", resp.String())
	}

	var result struct {
		Updated int64 `json:"updated"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return 0, fmt.Errorf("elasticsearch: decode update by query: %w", err)
	}
	return result.Updated, nil
}

// ============================================================
// Scroll API
// ============================================================

func (e *engine) Scroll(ctx context.Context, req search.SearchRequest, keepAlive time.Duration) (search.ScrollResult, error) {
	if err := e.guard(); err != nil {
		return search.ScrollResult{}, err
	}

	c, cancel := e.withTimeout(ctx, 0)
	defer cancel()

	if req.Size <= 0 {
		req.Size = 100
	}
	if keepAlive <= 0 {
		keepAlive = 1 * time.Minute
	}

	query := buildESQuery(req, e.cfg.DefaultSearchFields)
	body := map[string]any{
		"query": query,
		"size":  req.Size,
	}
	if len(req.SortBy) > 0 {
		sortArr := make([]any, 0, len(req.SortBy))
		for _, s := range req.SortBy {
			sortArr = append(sortArr, s)
		}
		body["sort"] = sortArr
	}
	if len(req.IncludeFields) > 0 {
		body["_source"] = req.IncludeFields
	}

	bodyBytes, _ := json.Marshal(body)

	r := esapi.SearchRequest{
		Index:  []string{e.cfg.IndexName},
		Body:   bytes.NewReader(bodyBytes),
		Scroll: keepAlive,
	}
	resp, err := r.Do(c, e.client)
	if err != nil {
		return search.ScrollResult{}, fmt.Errorf("elasticsearch: scroll: %w", err)
	}
	defer resp.Body.Close()

	if resp.IsError() {
		return search.ScrollResult{}, fmt.Errorf("elasticsearch: scroll: %s", resp.String())
	}

	return parseScrollResponse(resp.Body)
}

func (e *engine) ScrollNext(ctx context.Context, scrollID string, keepAlive time.Duration) (search.ScrollResult, error) {
	if err := e.guard(); err != nil {
		return search.ScrollResult{}, err
	}
	if scrollID == "" {
		return search.ScrollResult{}, fmt.Errorf("elasticsearch: scroll ID is empty")
	}

	c, cancel := e.withTimeout(ctx, 0)
	defer cancel()

	if keepAlive <= 0 {
		keepAlive = 1 * time.Minute
	}

	body := map[string]any{
		"scroll":    formatDuration(keepAlive),
		"scroll_id": scrollID,
	}
	bodyBytes, _ := json.Marshal(body)

	r := esapi.ScrollRequest{
		Body: bytes.NewReader(bodyBytes),
	}
	resp, err := r.Do(c, e.client)
	if err != nil {
		return search.ScrollResult{}, fmt.Errorf("elasticsearch: scroll next: %w", err)
	}
	defer resp.Body.Close()

	if resp.IsError() {
		return search.ScrollResult{}, fmt.Errorf("elasticsearch: scroll next: %s", resp.String())
	}

	return parseScrollResponse(resp.Body)
}

func (e *engine) ClearScroll(ctx context.Context, scrollID string) error {
	if err := e.guard(); err != nil {
		return err
	}
	if scrollID == "" {
		return nil
	}

	c, cancel := e.withTimeout(ctx, e.cfg.QueryTimeout)
	defer cancel()

	body := map[string]any{
		"scroll_id": []string{scrollID},
	}
	bodyBytes, _ := json.Marshal(body)

	r := esapi.ClearScrollRequest{
		Body: bytes.NewReader(bodyBytes),
	}
	resp, err := r.Do(c, e.client)
	if err != nil {
		return fmt.Errorf("elasticsearch: clear scroll: %w", err)
	}
	defer resp.Body.Close()

	if resp.IsError() {
		return fmt.Errorf("elasticsearch: clear scroll: %s", resp.String())
	}
	return nil
}

func parseScrollResponse(body interface {
	Read(p []byte) (n int, err error)
}) (search.ScrollResult, error) {
	var esResp struct {
		ScrollID string `json:"_scroll_id"`
		Took     int64  `json:"took"`
		Hits     struct {
			Total struct {
				Value uint64 `json:"value"`
			} `json:"total"`
			Hits []struct {
				ID     string         `json:"_id"`
				Score  *float64       `json:"_score"`
				Source map[string]any `json:"_source"`
			} `json:"hits"`
		} `json:"hits"`
	}
	if err := json.NewDecoder(body).Decode(&esResp); err != nil {
		return search.ScrollResult{}, fmt.Errorf("elasticsearch: decode scroll response: %w", err)
	}

	result := search.ScrollResult{
		ScrollID: esResp.ScrollID,
		Total:    esResp.Hits.Total.Value,
		Took:     time.Duration(esResp.Took) * time.Millisecond,
		Hits:     make([]search.Hit, 0, len(esResp.Hits.Hits)),
	}
	for _, h := range esResp.Hits.Hits {
		hit := search.Hit{
			ID:     h.ID,
			Fields: h.Source,
		}
		if h.Score != nil {
			hit.Score = *h.Score
		}
		result.Hits = append(result.Hits, hit)
	}
	return result, nil
}

// ============================================================
// SearchAfter
// ============================================================

func (e *engine) SearchAfter(ctx context.Context, req search.SearchRequest, after []any) (search.SearchResult, error) {
	if err := e.guard(); err != nil {
		return search.SearchResult{}, err
	}

	// SearchAfter requires sort fields
	if len(req.SortBy) == 0 {
		req.SortBy = []string{"_id"}
	}
	req.SearchAfter = after

	return e.Search(ctx, req)
}

// ============================================================
// Refresh / Flush
// ============================================================

func (e *engine) Refresh(ctx context.Context) error {
	if err := e.guard(); err != nil {
		return err
	}

	c, cancel := e.withTimeout(ctx, e.cfg.QueryTimeout)
	defer cancel()

	r := esapi.IndicesRefreshRequest{
		Index: []string{e.cfg.IndexName},
	}
	resp, err := r.Do(c, e.client)
	if err != nil {
		return fmt.Errorf("elasticsearch: refresh: %w", err)
	}
	defer resp.Body.Close()

	if resp.IsError() {
		return fmt.Errorf("elasticsearch: refresh: %s", resp.String())
	}
	return nil
}

func (e *engine) Flush(ctx context.Context) error {
	if err := e.guard(); err != nil {
		return err
	}

	c, cancel := e.withTimeout(ctx, e.cfg.QueryTimeout)
	defer cancel()

	r := esapi.IndicesFlushRequest{
		Index: []string{e.cfg.IndexName},
	}
	resp, err := r.Do(c, e.client)
	if err != nil {
		return fmt.Errorf("elasticsearch: flush: %w", err)
	}
	defer resp.Body.Close()

	if resp.IsError() {
		return fmt.Errorf("elasticsearch: flush: %s", resp.String())
	}
	return nil
}

// ============================================================
// HealthCheck
// ============================================================

func (e *engine) HealthCheck(ctx context.Context) error {
	if err := e.guard(); err != nil {
		return err
	}

	c, cancel := e.withTimeout(ctx, 5*time.Second)
	defer cancel()

	resp, err := e.client.Ping(
		e.client.Ping.WithContext(c),
	)
	if err != nil {
		return fmt.Errorf("elasticsearch: health check: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return fmt.Errorf("elasticsearch: health check returned status %d", resp.StatusCode)
	}
	return nil
}

// ============================================================
// Aggregations (in Search)
// ============================================================

func buildAggregations(aggs []search.AggregationRequest) map[string]any {
	result := make(map[string]any, len(aggs))
	for _, a := range aggs {
		switch a.Type {
		case "terms":
			size := a.Size
			if size <= 0 {
				size = 10
			}
			result[a.Name] = map[string]any{
				"terms": map[string]any{
					"field": a.Field,
					"size":  size,
				},
			}
		case "histogram":
			interval := a.Interval
			if interval == "" {
				interval = "1.0"
			}
			result[a.Name] = map[string]any{
				"histogram": map[string]any{
					"field":    a.Field,
					"interval": parseFloat(interval),
				},
			}
		case "date_histogram":
			agg := map[string]any{
				"field": a.Field,
			}
			if a.Interval != "" {
				agg["calendar_interval"] = a.Interval
			}
			if a.Format != "" {
				agg["format"] = a.Format
			}
			result[a.Name] = map[string]any{
				"date_histogram": agg,
			}
		case "stats":
			result[a.Name] = map[string]any{
				"stats": map[string]any{
					"field": a.Field,
				},
			}
		case "avg":
			result[a.Name] = map[string]any{
				"avg": map[string]any{"field": a.Field},
			}
		case "sum":
			result[a.Name] = map[string]any{
				"sum": map[string]any{"field": a.Field},
			}
		case "min":
			result[a.Name] = map[string]any{
				"min": map[string]any{"field": a.Field},
			}
		case "max":
			result[a.Name] = map[string]any{
				"max": map[string]any{"field": a.Field},
			}
		case "cardinality":
			result[a.Name] = map[string]any{
				"cardinality": map[string]any{"field": a.Field},
			}
		case "percentiles":
			agg := map[string]any{"field": a.Field}
			if len(a.Percentiles) > 0 {
				agg["percents"] = a.Percentiles
			}
			result[a.Name] = map[string]any{
				"percentiles": agg,
			}
		}
	}
	return result
}

func parseFloat(s string) float64 {
	f, _ := strconv.ParseFloat(s, 64)
	return f
}

func parseAggregations(aggs map[string]json.RawMessage) map[string]search.AggregationResult {
	result := make(map[string]search.AggregationResult, len(aggs))
	for name, raw := range aggs {
		var aggResult search.AggregationResult
		aggResult.Name = name

		// Try to parse as bucket aggregation
		var bucketAgg struct {
			Buckets []struct {
				Key   any `json:"key"`
				Count int `json:"doc_count"`
			} `json:"buckets"`
		}
		if err := json.Unmarshal(raw, &bucketAgg); err == nil && len(bucketAgg.Buckets) > 0 {
			for _, b := range bucketAgg.Buckets {
				aggResult.Buckets = append(aggResult.Buckets, search.AggregationBucket{
					Key:   b.Key,
					Count: b.Count,
				})
			}
		}

		// Try to parse as stats aggregation
		var statsAgg struct {
			Count int64   `json:"count"`
			Min   float64 `json:"min"`
			Max   float64 `json:"max"`
			Avg   float64 `json:"avg"`
			Sum   float64 `json:"sum"`
		}
		if err := json.Unmarshal(raw, &statsAgg); err == nil && statsAgg.Count > 0 {
			aggResult.Stats = &search.AggregationStats{
				Count: statsAgg.Count,
				Min:   statsAgg.Min,
				Max:   statsAgg.Max,
				Avg:   statsAgg.Avg,
				Sum:   statsAgg.Sum,
			}
		}

		// Try to parse as cardinality
		var cardinalityAgg struct {
			Value int64 `json:"value"`
		}
		if err := json.Unmarshal(raw, &cardinalityAgg); err == nil && cardinalityAgg.Value > 0 {
			// Check if it's a cardinality (no buckets, no stats count)
			if len(aggResult.Buckets) == 0 && aggResult.Stats == nil {
				aggResult.Cardinality = cardinalityAgg.Value
			}
		}

		// Try to parse as percentiles
		var percentilesAgg struct {
			Values map[string]float64 `json:"values"`
		}
		if err := json.Unmarshal(raw, &percentilesAgg); err == nil && len(percentilesAgg.Values) > 0 {
			if len(aggResult.Buckets) == 0 && aggResult.Stats == nil && aggResult.Cardinality == 0 {
				aggResult.Percentiles = percentilesAgg.Values
			}
		}

		result[name] = aggResult
	}
	return result
}

// ============================================================
// Completion Suggester
// ============================================================

func (e *engine) CompletionSuggest(ctx context.Context, req search.CompletionSuggestionRequest) ([]search.CompletionSuggestion, error) {
	if err := e.guard(); err != nil {
		return nil, err
	}
	if req.Prefix == "" || req.Field == "" {
		return []search.CompletionSuggestion{}, nil
	}

	c, cancel := e.withTimeout(ctx, e.cfg.QueryTimeout)
	defer cancel()

	size := req.Size
	if size <= 0 {
		size = 5
	}

	completion := map[string]any{
		"prefix": req.Prefix,
		"completion": map[string]any{
			"field": req.Field,
			"size":  size,
		},
	}
	if req.Fuzzy {
		fuzzy := map[string]any{"fuzziness": 1}
		if req.Fuzziness > 0 {
			fuzzy["fuzziness"] = req.Fuzziness
		}
		completion["completion"].(map[string]any)["fuzzy"] = fuzzy
	}

	body := map[string]any{
		"suggest": map[string]any{
			"completion-suggest": completion,
		},
	}
	bodyBytes, _ := json.Marshal(body)

	r := esapi.SearchRequest{
		Index: []string{e.cfg.IndexName},
		Body:  bytes.NewReader(bodyBytes),
	}
	resp, err := r.Do(c, e.client)
	if err != nil {
		return nil, fmt.Errorf("elasticsearch: completion suggest: %w", err)
	}
	defer resp.Body.Close()

	if resp.IsError() {
		return nil, fmt.Errorf("elasticsearch: completion suggest: %s", resp.String())
	}

	var esResp struct {
		Suggest map[string][]struct {
			Text    string `json:"text"`
			Options []struct {
				Text  string  `json:"text"`
				Score float64 `json:"_score"`
			} `json:"options"`
		} `json:"suggest"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&esResp); err != nil {
		return nil, fmt.Errorf("elasticsearch: decode completion suggest: %w", err)
	}

	suggestions := make([]search.CompletionSuggestion, 0)
	if entries, ok := esResp.Suggest["completion-suggest"]; ok && len(entries) > 0 {
		for _, opt := range entries[0].Options {
			suggestions = append(suggestions, search.CompletionSuggestion{
				Text:  opt.Text,
				Score: opt.Score,
			})
		}
	}
	return suggestions, nil
}

// ============================================================
// Term Suggester
// ============================================================

func (e *engine) TermSuggest(ctx context.Context, req search.TermSuggestionRequest) ([]search.TermSuggestion, error) {
	if err := e.guard(); err != nil {
		return nil, err
	}
	if req.Text == "" || req.Field == "" {
		return []search.TermSuggestion{}, nil
	}

	c, cancel := e.withTimeout(ctx, e.cfg.QueryTimeout)
	defer cancel()

	size := req.Size
	if size <= 0 {
		size = 5
	}

	suggestMode := req.SuggestMode
	if suggestMode == "" {
		suggestMode = "missing"
	}

	term := map[string]any{
		"text": req.Text,
		"term": map[string]any{
			"field":        req.Field,
			"size":         size,
			"suggest_mode": suggestMode,
		},
	}

	body := map[string]any{
		"suggest": map[string]any{
			"term-suggest": term,
		},
	}
	bodyBytes, _ := json.Marshal(body)

	r := esapi.SearchRequest{
		Index: []string{e.cfg.IndexName},
		Body:  bytes.NewReader(bodyBytes),
	}
	resp, err := r.Do(c, e.client)
	if err != nil {
		return nil, fmt.Errorf("elasticsearch: term suggest: %w", err)
	}
	defer resp.Body.Close()

	if resp.IsError() {
		return nil, fmt.Errorf("elasticsearch: term suggest: %s", resp.String())
	}

	var esResp struct {
		Suggest map[string][]struct {
			Text    string `json:"text"`
			Options []struct {
				Text string `json:"text"`
			} `json:"options"`
		} `json:"suggest"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&esResp); err != nil {
		return nil, fmt.Errorf("elasticsearch: decode term suggest: %w", err)
	}

	suggestions := make([]search.TermSuggestion, 0)
	if entries, ok := esResp.Suggest["term-suggest"]; ok {
		for _, entry := range entries {
			ts := search.TermSuggestion{Text: entry.Text}
			for _, opt := range entry.Options {
				ts.Suggestions = append(ts.Suggestions, opt.Text)
			}
			suggestions = append(suggestions, ts)
		}
	}
	return suggestions, nil
}

// ============================================================
// Index Management
// ============================================================

// CreateIndex creates a new Elasticsearch index with the given settings/mappings.
func (e *engine) CreateIndex(ctx context.Context, indexName string, mapping map[string]any) error {
	if err := e.guard(); err != nil {
		return err
	}

	c, cancel := e.withTimeout(ctx, e.cfg.QueryTimeout)
	defer cancel()

	if mapping == nil {
		mapping = defaultIndexMapping()
	}
	body, _ := json.Marshal(mapping)

	r := esapi.IndicesCreateRequest{
		Index: indexName,
		Body:  bytes.NewReader(body),
	}
	resp, err := r.Do(c, e.client)
	if err != nil {
		return fmt.Errorf("elasticsearch: create index %s: %w", indexName, err)
	}
	defer resp.Body.Close()

	if resp.IsError() {
		return fmt.Errorf("elasticsearch: create index %s: %s", indexName, resp.String())
	}
	return nil
}

// DeleteIndex deletes an Elasticsearch index.
func (e *engine) DeleteIndex(ctx context.Context, indexName string) error {
	if err := e.guard(); err != nil {
		return err
	}

	c, cancel := e.withTimeout(ctx, e.cfg.QueryTimeout)
	defer cancel()

	r := esapi.IndicesDeleteRequest{
		Index: []string{indexName},
	}
	resp, err := r.Do(c, e.client)
	if err != nil {
		return fmt.Errorf("elasticsearch: delete index %s: %w", indexName, err)
	}
	defer resp.Body.Close()

	if resp.IsError() && resp.StatusCode != 404 {
		return fmt.Errorf("elasticsearch: delete index %s: %s", indexName, resp.String())
	}
	return nil
}

// IndexExists checks if an index exists.
func (e *engine) IndexExists(ctx context.Context, indexName string) (bool, error) {
	if err := e.guard(); err != nil {
		return false, err
	}

	c, cancel := e.withTimeout(ctx, e.cfg.QueryTimeout)
	defer cancel()

	r := esapi.IndicesExistsRequest{
		Index: []string{indexName},
	}
	resp, err := r.Do(c, e.client)
	if err != nil {
		return false, fmt.Errorf("elasticsearch: check index exists %s: %w", indexName, err)
	}
	defer resp.Body.Close()

	return resp.StatusCode == 200, nil
}

// ============================================================
// Alias Management
// ============================================================

// AddAlias creates an alias pointing to the engine's index.
func (e *engine) AddAlias(ctx context.Context, alias string) error {
	if err := e.guard(); err != nil {
		return err
	}

	c, cancel := e.withTimeout(ctx, e.cfg.QueryTimeout)
	defer cancel()

	actions := []map[string]any{
		{"add": map[string]any{
			"index": e.cfg.IndexName,
			"alias": alias,
		}},
	}
	body, _ := json.Marshal(map[string]any{"actions": actions})

	r := esapi.IndicesUpdateAliasesRequest{
		Body: bytes.NewReader(body),
	}
	resp, err := r.Do(c, e.client)
	if err != nil {
		return fmt.Errorf("elasticsearch: add alias %s: %w", alias, err)
	}
	defer resp.Body.Close()

	if resp.IsError() {
		return fmt.Errorf("elasticsearch: add alias %s: %s", alias, resp.String())
	}
	return nil
}

// RemoveAlias removes an alias from the engine's index.
func (e *engine) RemoveAlias(ctx context.Context, alias string) error {
	if err := e.guard(); err != nil {
		return err
	}

	c, cancel := e.withTimeout(ctx, e.cfg.QueryTimeout)
	defer cancel()

	actions := []map[string]any{
		{"remove": map[string]any{
			"index": e.cfg.IndexName,
			"alias": alias,
		}},
	}
	body, _ := json.Marshal(map[string]any{"actions": actions})

	r := esapi.IndicesUpdateAliasesRequest{
		Body: bytes.NewReader(body),
	}
	resp, err := r.Do(c, e.client)
	if err != nil {
		return fmt.Errorf("elasticsearch: remove alias %s: %w", alias, err)
	}
	defer resp.Body.Close()

	if resp.IsError() {
		return fmt.Errorf("elasticsearch: remove alias %s: %s", alias, resp.String())
	}
	return nil
}

// SwapAlias atomically swaps an alias from oldIndex to newIndex.
func (e *engine) SwapAlias(ctx context.Context, alias, oldIndex, newIndex string) error {
	if err := e.guard(); err != nil {
		return err
	}

	c, cancel := e.withTimeout(ctx, e.cfg.QueryTimeout)
	defer cancel()

	actions := []map[string]any{
		{"remove": map[string]any{"index": oldIndex, "alias": alias}},
		{"add": map[string]any{"index": newIndex, "alias": alias}},
	}
	body, _ := json.Marshal(map[string]any{"actions": actions})

	r := esapi.IndicesUpdateAliasesRequest{
		Body: bytes.NewReader(body),
	}
	resp, err := r.Do(c, e.client)
	if err != nil {
		return fmt.Errorf("elasticsearch: swap alias %s: %w", alias, err)
	}
	defer resp.Body.Close()

	if resp.IsError() {
		return fmt.Errorf("elasticsearch: swap alias %s: %s", alias, resp.String())
	}
	return nil
}

// ============================================================
// Cluster Health
// ============================================================

// ClusterHealth returns the cluster health status.
func (e *engine) ClusterHealth(ctx context.Context) (map[string]any, error) {
	if err := e.guard(); err != nil {
		return nil, err
	}

	c, cancel := e.withTimeout(ctx, 10*time.Second)
	defer cancel()

	r := esapi.ClusterHealthRequest{}
	resp, err := r.Do(c, e.client)
	if err != nil {
		return nil, fmt.Errorf("elasticsearch: cluster health: %w", err)
	}
	defer resp.Body.Close()

	if resp.IsError() {
		return nil, fmt.Errorf("elasticsearch: cluster health: %s", resp.String())
	}

	var health map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&health); err != nil {
		return nil, fmt.Errorf("elasticsearch: decode cluster health: %w", err)
	}
	return health, nil
}

// IndexStats returns statistics for the engine's index.
func (e *engine) IndexStats(ctx context.Context) (map[string]any, error) {
	if err := e.guard(); err != nil {
		return nil, err
	}

	c, cancel := e.withTimeout(ctx, e.cfg.QueryTimeout)
	defer cancel()

	r := esapi.IndicesStatsRequest{
		Index: []string{e.cfg.IndexName},
	}
	resp, err := r.Do(c, e.client)
	if err != nil {
		return nil, fmt.Errorf("elasticsearch: index stats: %w", err)
	}
	defer resp.Body.Close()

	if resp.IsError() {
		return nil, fmt.Errorf("elasticsearch: index stats: %s", resp.String())
	}

	var stats map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&stats); err != nil {
		return nil, fmt.Errorf("elasticsearch: decode index stats: %w", err)
	}
	return stats, nil
}

// ============================================================
// Multi-Index Search
// ============================================================

// MultiIndexSearch searches across multiple indices.
func (e *engine) MultiIndexSearch(ctx context.Context, indices []string, req search.SearchRequest) (search.SearchResult, error) {
	if err := e.guard(); err != nil {
		return search.SearchResult{}, err
	}
	if len(indices) == 0 {
		indices = []string{e.cfg.IndexName}
	}

	c, cancel := e.withTimeout(ctx, e.cfg.QueryTimeout)
	defer cancel()

	if req.Size <= 0 {
		req.Size = 10
	}

	query := buildESQuery(req, e.cfg.DefaultSearchFields)
	body := map[string]any{
		"query": query,
		"from":  req.From,
		"size":  req.Size,
	}
	bodyBytes, _ := json.Marshal(body)

	r := esapi.SearchRequest{
		Index: indices,
		Body:  bytes.NewReader(bodyBytes),
	}
	resp, err := r.Do(c, e.client)
	if err != nil {
		return search.SearchResult{}, fmt.Errorf("elasticsearch: multi-index search: %w", err)
	}
	defer resp.Body.Close()

	if resp.IsError() {
		return search.SearchResult{}, fmt.Errorf("elasticsearch: multi-index search: %s", resp.String())
	}

	return parseSearchResponse(resp.Body)
}

// parseSearchResponse parses an ES search response body into SearchResult.
func parseSearchResponse(body interface {
	Read(p []byte) (n int, err error)
}) (search.SearchResult, error) {
	var esResp struct {
		Took int64 `json:"took"`
		Hits struct {
			Total struct {
				Value uint64 `json:"value"`
			} `json:"total"`
			MaxScore *float64 `json:"max_score"`
			Hits     []struct {
				ID        string              `json:"_id"`
				Score     *float64            `json:"_score"`
				Source    map[string]any      `json:"_source"`
				Index     string              `json:"_index"`
				Sort      []any               `json:"sort"`
				Version   int64               `json:"_version,omitempty"`
				Highlight map[string][]string `json:"highlight"`
			} `json:"hits"`
		} `json:"hits"`
		Aggregations map[string]json.RawMessage `json:"aggregations"`
	}

	if err := json.NewDecoder(body).Decode(&esResp); err != nil {
		return search.SearchResult{}, fmt.Errorf("elasticsearch: decode response: %w", err)
	}

	result := search.SearchResult{
		Total:        esResp.Hits.Total.Value,
		Took:         time.Duration(esResp.Took) * time.Millisecond,
		Hits:         make([]search.Hit, 0, len(esResp.Hits.Hits)),
		Aggregations: map[string]search.AggregationResult{},
	}
	if esResp.Hits.MaxScore != nil {
		result.MaxScore = *esResp.Hits.MaxScore
	}

	for _, h := range esResp.Hits.Hits {
		hit := search.Hit{
			ID:        h.ID,
			Fields:    h.Source,
			Fragments: h.Highlight,
			Sort:      h.Sort,
			Version:   h.Version,
			Index:     h.Index,
		}
		if h.Score != nil {
			hit.Score = *h.Score
		}
		result.Hits = append(result.Hits, hit)
	}

	if esResp.Aggregations != nil {
		result.Aggregations = parseAggregations(esResp.Aggregations)
	}

	return result, nil
}
