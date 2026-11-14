// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// kodo StorageStatsProvider implementation.
//
// Bucket storage statistics use the Qiniu data statistics API
// (/v6/space for storage size, /v6/count for object count) which is more
// efficient than paginating ListFiles. Falls back to ListFiles if the
// statistics API is unavailable.
//
// CDN statistics use the Qiniu Fusion CDN API (CdnManager.GetBandwidthData,
// CdnManager.GetFluxData) which returns bandwidth and traffic data by
// domain and timestamp.
//
// API request statistics use the Qiniu data statistics API:
//   - /v6/blob_io with select=hits for GET request count
//   - /v6/rs_put for PUT request count
//   - /v6/blob_io with select=flow&$metric=flow_out for download traffic
//
// Origin-fetch statistics use the Qiniu data statistics API:
//   - /v6/blob_io with select=flow&$metric=cdn_flow_out for CDN origin-pull traffic
//   - /v6/blob_io with select=hits&$metric=hits for GET requests (approximation)

package kodo

import (
	"fmt"
	"strings"
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common/stores"

	qbox "github.com/qiniu/go-sdk/v7/auth/qbox"
	"github.com/qiniu/go-sdk/v7/cdn"
	"github.com/qiniu/go-sdk/v7/storage"

	"github.com/br41n10/qiniu-stats-go-sdk/kodo/stats"
)

// granularityToQiniu converts a Granularity to a Qiniu CDN granularity
// string.
func granularityToQiniu(g stores.Granularity) string {
	switch g {
	case stores.Granularity5Min:
		return "5min"
	case stores.GranularityHour:
		return "hour"
	case stores.GranularityDay:
		return "day"
	case stores.GranularityMonth:
		return "month"
	default:
		return "hour"
	}
}

// cdnManager creates a Qiniu CDN manager.
func (s *Store) cdnManager() *cdn.CdnManager {
	mac := qbox.NewMac(s.cfg.AccessKey, s.cfg.SecretKey)
	return cdn.NewCdnManager(mac)
}

// statsManager creates a Qiniu data statistics manager.
func (s *Store) statsManager() *stats.StatsManager {
	mac := qbox.NewMac(s.cfg.AccessKey, s.cfg.SecretKey)
	return stats.NewStatManager(mac)
}

// statsRegion maps the user-facing Region config to the Qiniu statistics
// API region code. The stats API uses short codes like "z0" (华东),
// "z1" (华北), "z2" (华南), or empty string for all regions. User-friendly
// names like "huanan" are not recognized, so we map them. When the region
// is empty or unrecognized, we pass empty string (all regions).
func (s *Store) statsRegion() string {
	switch strings.ToLower(s.cfg.Region) {
	case "z0", "huadong", "east":
		return "z0"
	case "z1", "huabei", "north":
		return "z1"
	case "z2", "huanan", "south":
		return "z2"
	case "z3", "beimei", "na0":
		return "z3"
	default:
		return ""
	}
}

// domainHost extracts the hostname from the configured Domain (e.g.
// "https://cdn.example.com" → "cdn.example.com"). Used for Qiniu stats
// API domain filters.
func (s *Store) domainHost() string {
	d := s.cfg.Domain
	d = strings.TrimPrefix(d, "https://")
	d = strings.TrimPrefix(d, "http://")
	d = strings.TrimSuffix(d, "/")
	return strings.TrimSpace(d)
}

// GetBucketStats returns the current storage usage snapshot for a Kodo
// bucket. It first tries the Qiniu /v6/space and /v6/count statistics
// APIs, then falls back to paginating ListFiles.
func (s *Store) GetBucketStats(bucket string) (*stores.BucketStats, error) {
	bucket = s.resolveBucket(bucket)

	// Try statistics API first.
	if st, err := s.getBucketStatsFromAPI(bucket); err == nil && st != nil {
		return st, nil
	}

	// Fallback: paginate ListFiles.
	return s.getBucketStatsFromList(bucket)
}

func (s *Store) getBucketStatsFromAPI(bucket string) (*stores.BucketStats, error) {
	mgr := s.statsManager()
	now := time.Now()
	beginDate := now.Add(-24 * time.Hour).Format("2006-01-02")
	endDate := now.Format("2006-01-02")
	region := s.statsRegion()

	// Get standard storage space.
	spaceResp, err := mgr.Space(beginDate, endDate, "day", bucket, region)
	if err != nil {
		return nil, err
	}

	// Get standard storage file count.
	countResp, err := mgr.Count(beginDate, endDate, "day", bucket, region)
	if err != nil {
		return nil, err
	}

	var size int64
	if len(spaceResp.Datas) > 0 {
		size = spaceResp.Datas[len(spaceResp.Datas)-1]
	}

	var objectCount int64
	if len(countResp.Datas) > 0 {
		objectCount = countResp.Datas[len(countResp.Datas)-1]
	}

	return &stores.BucketStats{
		Bucket:      bucket,
		Region:      s.cfg.Region,
		Size:        size,
		ObjectCount: objectCount,
		UpdatedAt:   time.Now(),
		StorageClasses: []stores.StorageClassUsage{
			{Class: "STANDARD", Size: size, ObjectCount: objectCount},
		},
	}, nil
}

func (s *Store) getBucketStatsFromList(bucket string) (*stores.BucketStats, error) {
	cfg := s.makeConfig()
	mac := qbox.NewMac(s.cfg.AccessKey, s.cfg.SecretKey)
	mgr := storage.NewBucketManager(mac, &cfg)

	var totalSize int64
	var objectCount int64
	marker := ""
	limit := 1000

	for {
		entries, _, nextMarker, hasNext, err := mgr.ListFiles(bucket, "", "", marker, limit)
		if err != nil {
			return nil, fmt.Errorf("failed to list Kodo files: %w", err)
		}
		for _, entry := range entries {
			totalSize += entry.Fsize
			objectCount++
		}
		if !hasNext {
			break
		}
		marker = nextMarker
	}

	return &stores.BucketStats{
		Bucket:      bucket,
		Region:      s.cfg.Region,
		Size:        totalSize,
		ObjectCount: objectCount,
		UpdatedAt:   time.Now(),
		StorageClasses: []stores.StorageClassUsage{
			{Class: "STANDARD", Size: totalSize, ObjectCount: objectCount},
		},
	}, nil
}

// GetCDNStats returns CDN statistics from the Qiniu Fusion CDN API.
func (s *Store) GetCDNStats(req *stores.CDNStatsRequest) (*stores.CDNStatsResponse, error) {
	if req == nil {
		return nil, fmt.Errorf("request is required")
	}
	mgr := s.cdnManager()

	startDate := req.Range.Start.Format("2006-01-02")
	endDate := req.Range.End.Format("2006-01-02")
	granularity := granularityToQiniu(req.Granularity)

	// Get bandwidth data.
	bwResp, err := mgr.GetBandwidthData(startDate, endDate, granularity, req.Domains)
	if err != nil {
		return nil, fmt.Errorf("Qiniu CDN GetBandwidthData: %w", err)
	}

	// Get flux (traffic) data.
	fluxResp, err := mgr.GetFluxData(startDate, endDate, granularity, req.Domains)
	if err != nil {
		return nil, fmt.Errorf("Qiniu CDN GetFluxData: %w", err)
	}

	// Merge by timestamp.
	pointsMap := make(map[time.Time]*stores.CDNStatsPoint)

	parseTimes := func(times []string) []time.Time {
		var ts []time.Time
		for _, t := range times {
			if parsed, err := time.Parse("2006-01-02 15:04:05", t); err == nil {
				ts = append(ts, parsed)
			} else if parsed, err := time.Parse("2006-01-02", t); err == nil {
				ts = append(ts, parsed)
			}
		}
		return ts
	}

	bwTimes := parseTimes(bwResp.Time)
	fluxTimes := parseTimes(fluxResp.Time)

	for _, domain := range req.Domains {
		if data, ok := bwResp.Data[domain]; ok {
			for i, v := range data.DomainChina {
				if i < len(bwTimes) {
					pt := pointsMap[bwTimes[i]]
					if pt == nil {
						pt = &stores.CDNStatsPoint{Timestamp: bwTimes[i]}
						pointsMap[bwTimes[i]] = pt
					}
					pt.Bandwidth += float64(v)
				}
			}
		}
		if data, ok := fluxResp.Data[domain]; ok {
			for i, v := range data.DomainChina {
				if i < len(fluxTimes) {
					pt := pointsMap[fluxTimes[i]]
					if pt == nil {
						pt = &stores.CDNStatsPoint{Timestamp: fluxTimes[i]}
						pointsMap[fluxTimes[i]] = pt
					}
					pt.Traffic += int64(v)
				}
			}
		}
	}

	var allPoints []stores.CDNStatsPoint
	for _, pt := range pointsMap {
		allPoints = append(allPoints, *pt)
	}
	sortCDNPointsByTime(allPoints)

	summary := stores.CDNStatsSummary{}
	for _, p := range allPoints {
		summary.TotalTraffic += p.Traffic
		if p.Bandwidth > summary.PeakBandwidth {
			summary.PeakBandwidth = p.Bandwidth
		}
	}

	return &stores.CDNStatsResponse{
		Domains: req.Domains,
		Points:  allPoints,
		Summary: summary,
	}, nil
}

// GetAPIRequestStats returns API request statistics from the Qiniu data
// statistics API.
//
//   - PUT requests: /v6/rs_put (bucket filter, no region)
//   - Origin GET requests: /v6/blob_io?select=hits&$metric=hits (bucket filter)
//   - CDN download traffic: /v6/blob_io?select=flow&$metric=cdn_flow_out (domain filter)
//   - Direct download traffic: /v6/blob_io?select=flow&$metric=flow_out (bucket filter)
//
// For CDN-enabled buckets, origin GET hits and direct flow_out are typically 0
// because traffic flows through CDN. CDN download traffic is captured via
// cdn_flow_out with the domain filter.
func (s *Store) GetAPIRequestStats(req *stores.APIStatsRequest) (*stores.APIStatsResponse, error) {
	if req == nil {
		return nil, fmt.Errorf("request is required")
	}
	mgr := s.statsManager()
	bucket := s.resolveBucket(req.Bucket)
	domain := s.domainHost()
	granularity := granularityToQiniu(req.Granularity)
	beginDate := req.Range.Start.Format("2006-01-02")
	endDate := req.Range.End.Format("2006-01-02")

	pointsMap := make(map[time.Time]*stores.APIStatsPoint)

	// Origin GET request count (may be 0 for CDN-enabled buckets).
	getResp, err := mgr.BlobIO(beginDate, endDate, granularity, "hits", bucket, "", "", "", "hits")
	if err == nil {
		for _, r := range getResp {
			pt := pointsMap[r.Time]
			if pt == nil {
				pt = &stores.APIStatsPoint{Timestamp: r.Time}
				pointsMap[r.Time] = pt
			}
			pt.GetRequests += r.Values.Hits
			pt.TotalRequests += r.Values.Hits
		}
	}

	// CDN download traffic (cdn_flow_out, domain filter).
	if domain != "" {
		cdnDlResp, err := mgr.BlobIO(beginDate, endDate, granularity, "flow", "", domain, "", "", "cdn_flow_out")
		if err == nil {
			for _, r := range cdnDlResp {
				pt := pointsMap[r.Time]
				if pt == nil {
					pt = &stores.APIStatsPoint{Timestamp: r.Time}
					pointsMap[r.Time] = pt
				}
				pt.DownloadBytes += r.Values.Flow
			}
		}
	}

	// Direct download traffic (flow_out, bucket filter).
	dlResp, err := mgr.BlobIO(beginDate, endDate, granularity, "flow", bucket, "", "", "", "flow_out")
	if err == nil {
		for _, r := range dlResp {
			pt := pointsMap[r.Time]
			if pt == nil {
				pt = &stores.APIStatsPoint{Timestamp: r.Time}
				pointsMap[r.Time] = pt
			}
			pt.DownloadBytes += r.Values.Flow
		}
	}

	// PUT request count (bucket filter, no region).
	putResp, err := mgr.RsPut(beginDate, endDate, granularity, bucket, "", "")
	if err == nil {
		for _, r := range putResp {
			pt := pointsMap[r.Time]
			if pt == nil {
				pt = &stores.APIStatsPoint{Timestamp: r.Time}
				pointsMap[r.Time] = pt
			}
			pt.PutRequests += r.Values.Hits
			pt.TotalRequests += r.Values.Hits
		}
	}

	// Storage type change request count.
	chTypeResp, err := mgr.RsChType(beginDate, endDate, granularity, bucket, "")
	if err == nil {
		for _, r := range chTypeResp {
			pt := pointsMap[r.Time]
			if pt == nil {
				pt = &stores.APIStatsPoint{Timestamp: r.Time}
				pointsMap[r.Time] = pt
			}
			pt.TotalRequests += r.Values.Hits
		}
	}

	var allPoints []stores.APIStatsPoint
	for _, pt := range pointsMap {
		allPoints = append(allPoints, *pt)
	}
	sortAPIPointsByTime(allPoints)

	summary := stores.APIStatsSummary{}
	for _, p := range allPoints {
		summary.TotalRequests += p.TotalRequests
		summary.DownloadBytes += p.DownloadBytes
	}

	return &stores.APIStatsResponse{Points: allPoints, Summary: summary}, nil
}

// GetOriginFetchStats returns origin-fetch statistics from the Qiniu data
// statistics API.
//
//   - CDN origin-pull traffic: /v6/blob_io?select=flow&$metric=cdn_flow_out (domain filter)
//   - Origin GET requests: /v6/blob_io?select=hits&$metric=hits (bucket filter)
//
// For CDN-enabled buckets, origin GET hits may be 0 (CDN serves cached
// content). CDN origin-pull traffic (cdn_flow_out) reflects actual
// origin-fetch bandwidth.
func (s *Store) GetOriginFetchStats(req *stores.OriginStatsRequest) (*stores.OriginStatsResponse, error) {
	if req == nil {
		return nil, fmt.Errorf("request is required")
	}
	mgr := s.statsManager()
	bucket := s.resolveBucket(req.Bucket)
	domain := s.domainHost()
	granularity := granularityToQiniu(req.Granularity)
	beginDate := req.Range.Start.Format("2006-01-02")
	endDate := req.Range.End.Format("2006-01-02")

	pointsMap := make(map[time.Time]*stores.OriginStatsPoint)

	// CDN origin-pull traffic (cdn_flow_out, domain filter).
	if domain != "" {
		originFlowResp, err := mgr.BlobIO(beginDate, endDate, granularity, "flow", "", domain, "", "", "cdn_flow_out")
		if err == nil {
			for _, r := range originFlowResp {
				pt := pointsMap[r.Time]
				if pt == nil {
					pt = &stores.OriginStatsPoint{Timestamp: r.Time}
					pointsMap[r.Time] = pt
				}
				pt.OriginTraffic += r.Values.Flow
			}
		}
	}

	// Origin GET request count (bucket filter, may be 0 for CDN buckets).
	getResp, err := mgr.BlobIO(beginDate, endDate, granularity, "hits", bucket, "", "", "", "hits")
	if err == nil {
		for _, r := range getResp {
			pt := pointsMap[r.Time]
			if pt == nil {
				pt = &stores.OriginStatsPoint{Timestamp: r.Time}
				pointsMap[r.Time] = pt
			}
			pt.OriginRequests += r.Values.Hits
		}
	}

	var allPoints []stores.OriginStatsPoint
	for _, pt := range pointsMap {
		allPoints = append(allPoints, *pt)
	}
	sortOriginPointsByTime(allPoints)

	summary := stores.OriginStatsSummary{}
	for _, p := range allPoints {
		summary.TotalOriginTraffic += p.OriginTraffic
		summary.TotalOriginRequests += p.OriginRequests
	}

	return &stores.OriginStatsResponse{Points: allPoints, Summary: summary}, nil
}

// ─── helpers ───

func sortCDNPointsByTime(points []stores.CDNStatsPoint) {
	for i := 0; i < len(points); i++ {
		for j := i + 1; j < len(points); j++ {
			if points[i].Timestamp.After(points[j].Timestamp) {
				points[i], points[j] = points[j], points[i]
			}
		}
	}
}

func sortAPIPointsByTime(points []stores.APIStatsPoint) {
	for i := 0; i < len(points); i++ {
		for j := i + 1; j < len(points); j++ {
			if points[i].Timestamp.After(points[j].Timestamp) {
				points[i], points[j] = points[j], points[i]
			}
		}
	}
}

func sortOriginPointsByTime(points []stores.OriginStatsPoint) {
	for i := 0; i < len(points); i++ {
		for j := i + 1; j < len(points); j++ {
			if points[i].Timestamp.After(points[j].Timestamp) {
				points[i], points[j] = points[j], points[i]
			}
		}
	}
}
