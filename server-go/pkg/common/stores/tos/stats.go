// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// tos StorageStatsProvider implementation.
//
// Bucket storage statistics paginate the TOS ListObjectsV2 API to compute
// total size and object count.
//
// CDN statistics use the Volcengine CDN API (DescribeEdgeData) which
// supports metrics like flux (traffic), bandwidth, request, hitRequest,
// hitRate, and statusCode.
//
// API request statistics use the Volcengine TOS monitoring API. Since the
// standard SDK does not expose granular API request metrics, this returns
// ErrStatsUnsupported.
//
// Origin-fetch statistics use the Volcengine CDN API (DescribeOriginData).

package tos

import (
	"context"
	"fmt"
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common/stores"

	"github.com/volcengine/volcengine-go-sdk/service/cdn"
	"github.com/volcengine/volcengine-go-sdk/volcengine"
	"github.com/volcengine/volcengine-go-sdk/volcengine/credentials"
	"github.com/volcengine/volcengine-go-sdk/volcengine/session"

	"github.com/volcengine/ve-tos-golang-sdk/v2/tos"
)

// granularityToVolcengine converts a Granularity to a Volcengine CDN
// interval string.
func granularityToVolcengine(g stores.Granularity) string {
	switch g {
	case stores.Granularity5Min:
		return "5min"
	case stores.GranularityHour:
		return "1hour"
	case stores.GranularityDay:
		return "1day"
	case stores.GranularityMonth:
		return "1day"
	default:
		return "1hour"
	}
}

// cdnClient creates a Volcengine CDN API client.
func (s *Store) cdnClient() (*cdn.CDN, error) {
	if s.cfg.AccessKeyID == "" || s.cfg.AccessKeySecret == "" {
		return nil, fmt.Errorf("Volcengine credentials not configured")
	}
	sess, err := session.NewSession(&volcengine.Config{
		Credentials: credentials.NewStaticCredentials(s.cfg.AccessKeyID, s.cfg.AccessKeySecret, ""),
		Region:      volcengine.String(s.cfg.Region),
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create Volcengine session: %w", err)
	}
	return cdn.New(sess), nil
}

// GetBucketStats computes the total storage size and object count for a
// TOS bucket by paginating ListObjectsV2.
func (s *Store) GetBucketStats(bucket string) (*stores.BucketStats, error) {
	ctx := context.Background()
	client, err := s.client(ctx)
	if err != nil {
		return nil, err
	}
	bucket = s.resolveBucket(bucket)

	var totalSize int64
	var objectCount int64
	marker := ""

	for {
		input := &tos.ListObjectsV2Input{
			Bucket: bucket,
			ListObjectsInput: tos.ListObjectsInput{
				MaxKeys: 1000,
				Marker:  marker,
			},
		}
		out, err := client.ListObjectsV2(ctx, input)
		if err != nil {
			return nil, fmt.Errorf("TOS list objects: %w", err)
		}
		for _, obj := range out.Contents {
			totalSize += obj.Size
			objectCount++
		}
		if !out.IsTruncated {
			break
		}
		marker = out.NextMarker
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

// GetCDNStats returns CDN statistics from the Volcengine CDN API.
func (s *Store) GetCDNStats(req *stores.CDNStatsRequest) (*stores.CDNStatsResponse, error) {
	if req == nil {
		return nil, fmt.Errorf("request is required")
	}
	client, err := s.cdnClient()
	if err != nil {
		return nil, err
	}

	domain := ""
	if len(req.Domains) > 0 {
		domain = req.Domains[0]
	}
	interval := granularityToVolcengine(req.Granularity)
	startTime := req.Range.Start.Unix()
	endTime := req.Range.End.Unix()

	// Query multiple CDN metrics.
	metrics := []string{"flux", "bandwidth", "request", "hitRequest", "hitRate"}
	pointsMap := make(map[time.Time]*stores.CDNStatsPoint)

	for _, metric := range metrics {
		out, err := client.DescribeEdgeData(&cdn.DescribeEdgeDataInput{
			StartTime: &startTime,
			EndTime:   &endTime,
			Metric:    &metric,
			Interval:  &interval,
			Domain:    &domain,
		})
		if err != nil {
			continue
		}
		if out.MetricDataList == nil {
			continue
		}

		for _, mdl := range out.MetricDataList {
			if mdl.Values == nil {
				continue
			}
			for _, v := range mdl.Values {
				if v.TimeStamp == nil || v.Value == nil {
					continue
				}
				ts := time.Unix(*v.TimeStamp, 0)
				pt := pointsMap[ts]
				if pt == nil {
					pt = &stores.CDNStatsPoint{Timestamp: ts}
					pointsMap[ts] = pt
				}
				val := *v.Value
				switch metric {
				case "flux":
					pt.Traffic += int64(val)
				case "bandwidth":
					pt.Bandwidth = val
				case "request":
					pt.Requests += int64(val)
				case "hitRequest":
					pt.HitRequests += int64(val)
					pt.MissRequests = pt.Requests - pt.HitRequests
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
		summary.TotalRequests += p.Requests
		summary.TotalHitRequests += p.HitRequests
		if p.Bandwidth > summary.PeakBandwidth {
			summary.PeakBandwidth = p.Bandwidth
		}
	}
	if summary.TotalRequests > 0 {
		summary.HitRatio = float64(summary.TotalHitRequests) / float64(summary.TotalRequests)
	}

	return &stores.CDNStatsResponse{
		Domains: req.Domains,
		Points:  allPoints,
		Summary: summary,
	}, nil
}

// GetAPIRequestStats returns API request statistics. Volcengine TOS does
// not expose granular API request metrics via the standard SDK; this
// returns ErrStatsUnsupported.
func (s *Store) GetAPIRequestStats(req *stores.APIStatsRequest) (*stores.APIStatsResponse, error) {
	return nil, stores.ErrStatsUnsupported
}

// GetOriginFetchStats returns origin-fetch statistics from the Volcengine
// CDN API (DescribeOriginData).
func (s *Store) GetOriginFetchStats(req *stores.OriginStatsRequest) (*stores.OriginStatsResponse, error) {
	if req == nil {
		return nil, fmt.Errorf("request is required")
	}
	client, err := s.cdnClient()
	if err != nil {
		return nil, err
	}

	domain := ""
	if len(req.Domains) > 0 {
		domain = req.Domains[0]
	}
	interval := granularityToVolcengine(req.Granularity)
	startTime := req.Range.Start.Unix()
	endTime := req.Range.End.Unix()

	// Origin metrics: flux (origin traffic), request (origin requests).
	metrics := []string{"flux", "request"}
	pointsMap := make(map[time.Time]*stores.OriginStatsPoint)

	for _, metric := range metrics {
		out, err := client.DescribeOriginData(&cdn.DescribeOriginDataInput{
			StartTime: &startTime,
			EndTime:   &endTime,
			Metric:    &metric,
			Interval:  &interval,
			Domain:    &domain,
		})
		if err != nil {
			continue
		}
		if out.MetricDataList == nil {
			continue
		}

		for _, mdl := range out.MetricDataList {
			if mdl.Values == nil {
				continue
			}
			for _, v := range mdl.Values {
				if v.TimeStamp == nil || v.Value == nil {
					continue
				}
				ts := time.Unix(*v.TimeStamp, 0)
				pt := pointsMap[ts]
				if pt == nil {
					pt = &stores.OriginStatsPoint{Timestamp: ts}
					pointsMap[ts] = pt
				}
				val := *v.Value
				switch metric {
				case "flux":
					pt.OriginTraffic += int64(val)
				case "request":
					pt.OriginRequests += int64(val)
				}
			}
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
		summary.TotalFailedRequests += p.FailedRequests
	}
	if summary.TotalOriginRequests > 0 {
		summary.FailureRate = float64(summary.TotalFailedRequests) / float64(summary.TotalOriginRequests)
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

func sortOriginPointsByTime(points []stores.OriginStatsPoint) {
	for i := 0; i < len(points); i++ {
		for j := i + 1; j < len(points); j++ {
			if points[i].Timestamp.After(points[j].Timestamp) {
				points[i], points[j] = points[j], points[i]
			}
		}
	}
}
