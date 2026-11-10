// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package stores

import "time"

// ──────────────────────────────────────────────
// StorageStatsProvider — statistics & monitoring
// ──────────────────────────────────────────────

// StorageStatsProvider is implemented by backends that can report storage,
// CDN, API request, and origin-fetch statistics. Not all backends support
// every dimension — callers should check with SupportsStats or use the
// helper functions.
//
// Methods that accept a TimeRange return time-series data points; methods
// without a time range return the current snapshot.
type StorageStatsProvider interface {
	// ── Bucket storage statistics (snapshot) ──

	// GetBucketStats returns the current storage usage snapshot for a
	// bucket: total size, object count, and storage-class distribution.
	GetBucketStats(bucket string) (*BucketStats, error)

	// ── CDN statistics (time series) ──

	// GetCDNStats returns CDN traffic, bandwidth, request, and cache-hit
	// statistics over the given time range. If the backend has no CDN
	// integration it returns ErrStatsUnsupported.
	GetCDNStats(req *CDNStatsRequest) (*CDNStatsResponse, error)

	// ── API request statistics (time series) ──

	// GetAPIRequestStats returns API call counts, upload/download traffic,
	// and error rates over the given time range.
	GetAPIRequestStats(req *APIStatsRequest) (*APIStatsResponse, error)

	// ── Origin-fetch statistics (time series) ──

	// GetOriginFetchStats returns origin-pull traffic, request counts, and
	// failure rates over the given time range. If the backend has no CDN
	// it returns ErrStatsUnsupported.
	GetOriginFetchStats(req *OriginStatsRequest) (*OriginStatsResponse, error)
}

// ErrStatsUnsupported is returned when the backend cannot provide the
// requested statistics dimension (e.g. local filesystem has no CDN).
var ErrStatsUnsupported = &StoreError{Code: 501, Message: "statistics not supported by this storage backend"}

// ──────────────────────────────────────────────
// Time range
// ──────────────────────────────────────────────

// TimeRange specifies a query interval for time-series statistics.
type TimeRange struct {
	Start time.Time `json:"start"` // inclusive
	End   time.Time `json:"end"`   // inclusive
}

// Granularity is the aggregation interval for time-series data points.
type Granularity string

const (
	Granularity5Min  Granularity = "5min"  // 5-minute buckets
	GranularityHour  Granularity = "hour"  // hourly buckets
	GranularityDay   Granularity = "day"   // daily buckets
	GranularityMonth Granularity = "month" // monthly buckets
)

// ──────────────────────────────────────────────
// Bucket storage statistics (snapshot)
// ──────────────────────────────────────────────

// BucketStats is the current storage usage snapshot for a bucket.
type BucketStats struct {
	Bucket        string             `json:"bucket"`
	Region        string             `json:"region,omitempty"`
	Size          int64              `json:"size"`        // total storage in bytes
	ObjectCount   int64              `json:"objectCount"` // number of objects
	UpdatedAt     time.Time          `json:"updatedAt"`   // when the snapshot was taken
	StorageClasses []StorageClassUsage `json:"storageClasses,omitempty"`
}

// StorageClassUsage breaks down storage by class (e.g. STANDARD, IA, ARCHIVE).
type StorageClassUsage struct {
	Class       string `json:"class"`       // storage class name
	Size        int64  `json:"size"`        // bytes in this class
	ObjectCount int64  `json:"objectCount"` // objects in this class
}

// ──────────────────────────────────────────────
// CDN statistics (time series)
// ──────────────────────────────────────────────

// CDNStatsRequest holds parameters for querying CDN statistics.
type CDNStatsRequest struct {
	Bucket      string      `json:"bucket,omitempty"`      // filter by bucket (some providers)
	Domains     []string    `json:"domains,omitempty"`     // filter by CDN domain(s)
	Range       TimeRange   `json:"range"`                 // query interval
	Granularity Granularity `json:"granularity,omitempty"` // aggregation interval
}

// CDNStatsResponse holds CDN statistics time-series data.
type CDNStatsResponse struct {
	Domains    []string         `json:"domains,omitempty"`
	Points     []CDNStatsPoint  `json:"points"`
	Summary    CDNStatsSummary  `json:"summary"`
}

// CDNStatsPoint is a single time-series data point for CDN stats.
type CDNStatsPoint struct {
	Timestamp    time.Time `json:"timestamp"`
	Traffic      int64     `json:"traffic"`      // bytes served in this interval
	Bandwidth    float64   `json:"bandwidth"`    // peak bandwidth in bps
	Requests     int64     `json:"requests"`     // total requests
	HitRequests  int64     `json:"hitRequests"`  // cache hit requests
	MissRequests int64     `json:"missRequests"` // cache miss requests
}

// CDNStatsSummary aggregates CDN stats over the full query range.
type CDNStatsSummary struct {
	TotalTraffic      int64   `json:"totalTraffic"`      // total bytes
	TotalRequests     int64   `json:"totalRequests"`     // total requests
	TotalHitRequests  int64   `json:"totalHitRequests"`  // total cache hits
	HitRatio          float64 `json:"hitRatio"`          // 0..1
	AvgBandwidth      float64 `json:"avgBandwidth"`      // average bandwidth in bps
	PeakBandwidth     float64 `json:"peakBandwidth"`     // peak bandwidth in bps
	StatusCodes       map[int]int64 `json:"statusCodes,omitempty"` // HTTP status code → count
}

// ──────────────────────────────────────────────
// API request statistics (time series)
// ──────────────────────────────────────────────

// APIStatsRequest holds parameters for querying API request statistics.
type APIStatsRequest struct {
	Bucket      string      `json:"bucket,omitempty"`
	Range       TimeRange   `json:"range"`
	Granularity Granularity `json:"granularity,omitempty"`
}

// APIStatsResponse holds API request statistics time-series data.
type APIStatsResponse struct {
	Points  []APIStatsPoint  `json:"points"`
	Summary APIStatsSummary  `json:"summary"`
}

// APIStatsPoint is a single time-series data point for API stats.
type APIStatsPoint struct {
	Timestamp       time.Time `json:"timestamp"`
	TotalRequests   int64     `json:"totalRequests"`
	GetRequests     int64     `json:"getRequests"`
	PutRequests     int64     `json:"putRequests"`
	DeleteRequests  int64     `json:"deleteRequests"`
	HeadRequests    int64     `json:"headRequests"`
	UploadBytes     int64     `json:"uploadBytes"`   // bytes uploaded
	DownloadBytes   int64     `json:"downloadBytes"` // bytes downloaded
	ErrorRequests   int64     `json:"errorRequests"` // 4xx+5xx
}

// APIStatsSummary aggregates API stats over the full query range.
type APIStatsSummary struct {
	TotalRequests   int64   `json:"totalRequests"`
	UploadBytes     int64   `json:"uploadBytes"`
	DownloadBytes   int64   `json:"downloadBytes"`
	ErrorRequests   int64   `json:"errorRequests"`
	ErrorRate       float64 `json:"errorRate"` // 0..1
}

// ──────────────────────────────────────────────
// Origin-fetch statistics (time series)
// ──────────────────────────────────────────────

// OriginStatsRequest holds parameters for querying origin-fetch statistics.
type OriginStatsRequest struct {
	Bucket      string      `json:"bucket,omitempty"`
	Domains     []string    `json:"domains,omitempty"`
	Range       TimeRange   `json:"range"`
	Granularity Granularity `json:"granularity,omitempty"`
}

// OriginStatsResponse holds origin-fetch statistics time-series data.
type OriginStatsResponse struct {
	Points  []OriginStatsPoint  `json:"points"`
	Summary OriginStatsSummary  `json:"summary"`
}

// OriginStatsPoint is a single time-series data point for origin-fetch stats.
type OriginStatsPoint struct {
	Timestamp       time.Time `json:"timestamp"`
	OriginTraffic   int64     `json:"originTraffic"`   // bytes pulled from origin
	OriginRequests  int64     `json:"originRequests"`  // requests to origin
	FailedRequests  int64     `json:"failedRequests"`  // failed origin requests
}

// OriginStatsSummary aggregates origin-fetch stats over the full query range.
type OriginStatsSummary struct {
	TotalOriginTraffic  int64   `json:"totalOriginTraffic"`
	TotalOriginRequests int64   `json:"totalOriginRequests"`
	TotalFailedRequests int64   `json:"totalFailedRequests"`
	FailureRate         float64 `json:"failureRate"` // 0..1
}

// ──────────────────────────────────────────────
// Helper functions
// ──────────────────────────────────────────────

// AsStatsProvider returns the given store as a StorageStatsProvider, or nil
// if the store does not implement the statistics interface.
func AsStatsProvider(s Store) StorageStatsProvider {
	if p, ok := s.(StorageStatsProvider); ok {
		return p
	}
	return nil
}

// SupportsStats reports whether the store implements StorageStatsProvider.
func SupportsStats(s Store) bool {
	_, ok := s.(StorageStatsProvider)
	return ok
}

// GetBucketStats is a convenience helper that calls GetBucketStats on the
// store if it implements StorageStatsProvider, otherwise returns
// ErrStatsUnsupported.
func GetBucketStats(s Store, bucket string) (*BucketStats, error) {
	if p, ok := s.(StorageStatsProvider); ok {
		return p.GetBucketStats(bucket)
	}
	return nil, ErrStatsUnsupported
}

// GetCDNStats is a convenience helper for CDN statistics.
func GetCDNStats(s Store, req *CDNStatsRequest) (*CDNStatsResponse, error) {
	if p, ok := s.(StorageStatsProvider); ok {
		return p.GetCDNStats(req)
	}
	return nil, ErrStatsUnsupported
}

// GetAPIRequestStats is a convenience helper for API request statistics.
func GetAPIRequestStats(s Store, req *APIStatsRequest) (*APIStatsResponse, error) {
	if p, ok := s.(StorageStatsProvider); ok {
		return p.GetAPIRequestStats(req)
	}
	return nil, ErrStatsUnsupported
}

// GetOriginFetchStats is a convenience helper for origin-fetch statistics.
func GetOriginFetchStats(s Store, req *OriginStatsRequest) (*OriginStatsResponse, error) {
	if p, ok := s.(StorageStatsProvider); ok {
		return p.GetOriginFetchStats(req)
	}
	return nil, ErrStatsUnsupported
}
