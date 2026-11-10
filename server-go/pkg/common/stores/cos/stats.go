// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// cos StorageStatsProvider implementation.
//
// Bucket storage statistics paginate the COS Bucket.Get (ListObjects) API.
//
// CDN statistics use the Tencent Cloud CDN API (DescribeCdnData) which
// supports flux (traffic), bandwidth, request, hitRequest, requestHitRate,
// and statusCode metrics.
//
// API request statistics use Tencent Cloud Monitor (GetMonitorData) with
// the Qce/Cos namespace.
//
// Origin-fetch statistics use the Tencent Cloud CDN API (DescribeOriginData).

package cos

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common/stores"

	"github.com/tencentyun/cos-go-sdk-v5"

	cdn "github.com/tencentcloud/tencentcloud-sdk-go/tencentcloud/cdn/v20180606"
	cdnCommon "github.com/tencentcloud/tencentcloud-sdk-go/tencentcloud/common"
	"github.com/tencentcloud/tencentcloud-sdk-go/tencentcloud/common/profile"
	monitor "github.com/tencentcloud/tencentcloud-sdk-go/tencentcloud/monitor/v20180724"
)

// granularityToInterval converts a Granularity to a Tencent Cloud CDN
// interval string (minutes).
func granularityToInterval(g stores.Granularity) string {
	switch g {
	case stores.Granularity5Min:
		return "5min"
	case stores.GranularityHour:
		return "hour"
	case stores.GranularityDay:
		return "day"
	case stores.GranularityMonth:
		return "day"
	default:
		return "hour"
	}
}

// granularityToPeriod converts a Granularity to a Tencent Cloud Monitor
// period (seconds as uint64).
func granularityToPeriod(g stores.Granularity) uint64 {
	switch g {
	case stores.Granularity5Min:
		return 300
	case stores.GranularityHour:
		return 3600
	case stores.GranularityDay:
		return 86400
	case stores.GranularityMonth:
		return 2592000
	default:
		return 3600
	}
}

// cdnClient creates a Tencent Cloud CDN API client.
func (s *Store) cdnClient() (*cdn.Client, error) {
	if s.cfg.SecretID == "" || s.cfg.SecretKey == "" {
		return nil, fmt.Errorf("Tencent Cloud credentials not configured")
	}
	credential := cdnCommon.NewCredential(s.cfg.SecretID, s.cfg.SecretKey)
	cpf := profile.NewClientProfile()
	return cdn.NewClient(credential, "", cpf)
}

// monitorClient creates a Tencent Cloud Monitor client.
// COS monitoring data is centralized in Guangzhou (ap-guangzhou) regardless
// of the bucket's actual region, per Tencent Cloud documentation.
func (s *Store) monitorClient() (*monitor.Client, error) {
	if s.cfg.SecretID == "" || s.cfg.SecretKey == "" {
		return nil, fmt.Errorf("Tencent Cloud credentials not configured")
	}
	credential := cdnCommon.NewCredential(s.cfg.SecretID, s.cfg.SecretKey)
	cpf := profile.NewClientProfile()
	// COS monitoring data is always in ap-guangzhou.
	return monitor.NewClient(credential, "ap-guangzhou", cpf)
}

// extractAppID extracts the APPID from a COS bucket name.
// COS bucket names follow the format "<name>-<appid>", e.g.
// "filmingfilmsinyaan-1389816353" → "1389816353".
func (s *Store) extractAppID(bucket string) string {
	idx := strings.LastIndex(bucket, "-")
	if idx < 0 || idx == len(bucket)-1 {
		return ""
	}
	suffix := bucket[idx+1:]
	// APPID is always numeric.
	for _, c := range suffix {
		if c < '0' || c > '9' {
			return ""
		}
	}
	return suffix
}

// GetBucketStats computes the total storage size and object count for a
// COS bucket by paginating the Bucket.Get API.
func (s *Store) GetBucketStats(bucket string) (*stores.BucketStats, error) {
	ctx := context.Background()
	bucket = s.resolveBucket(bucket)
	c, err := s.clientForBucket(bucket, "")
	if err != nil {
		return nil, err
	}

	var totalSize int64
	var objectCount int64
	var classes map[string]*stores.StorageClassUsage

	marker := ""
	for {
		opt := &cos.BucketGetOptions{Marker: marker, MaxKeys: 1000}
		out, _, err := c.Bucket.Get(ctx, opt)
		if err != nil {
			return nil, fmt.Errorf("COS list objects: %w", err)
		}
		for _, obj := range out.Contents {
			totalSize += obj.Size
			objectCount++
			class := obj.StorageClass
			if class == "" {
				class = "STANDARD"
			}
			if classes == nil {
				classes = make(map[string]*stores.StorageClassUsage)
			}
			if sc, ok := classes[class]; ok {
				sc.Size += obj.Size
				sc.ObjectCount++
			} else {
				classes[class] = &stores.StorageClassUsage{Class: class, Size: obj.Size, ObjectCount: 1}
			}
		}
		if !out.IsTruncated {
			break
		}
		marker = out.NextMarker
	}

	var scList []stores.StorageClassUsage
	for _, sc := range classes {
		scList = append(scList, *sc)
	}

	return &stores.BucketStats{
		Bucket:         bucket,
		Region:         s.cfg.Region,
		Size:           totalSize,
		ObjectCount:    objectCount,
		UpdatedAt:      time.Now(),
		StorageClasses: scList,
	}, nil
}

// GetCDNStats returns CDN statistics from the Tencent Cloud CDN API.
func (s *Store) GetCDNStats(req *stores.CDNStatsRequest) (*stores.CDNStatsResponse, error) {
	if req == nil {
		return nil, fmt.Errorf("request is required")
	}
	client, err := s.cdnClient()
	if err != nil {
		return nil, err
	}

	interval := granularityToInterval(req.Granularity)
	startTime := req.Range.Start.Format("2006-01-02 15:04:00")
	endTime := req.Range.End.Format("2006-01-02 15:04:00")

	// Query multiple CDN metrics.
	metrics := []string{"flux", "bandwidth", "request", "hitRequest", "requestHitRate"}
	pointsMap := make(map[time.Time]*stores.CDNStatsPoint)

	for _, metric := range metrics {
		resp, err := client.DescribeCdnData(&cdn.DescribeCdnDataRequest{
			StartTime:  &startTime,
			EndTime:    &endTime,
			Metric:     &metric,
			Interval:   &interval,
			Domains:    cdnCommon.StringPtrs(req.Domains),
		})
		if err != nil {
			continue
		}
		if resp.Response == nil || resp.Response.Data == nil {
			continue
		}

		for _, rd := range resp.Response.Data {
			if rd.CdnData == nil {
				continue
			}
			for _, cd := range rd.CdnData {
				if cd.DetailData == nil {
					continue
				}
				for _, td := range cd.DetailData {
					ts, err := time.Parse("2006-01-02 15:04:00", *td.Time)
					if err != nil {
						continue
					}
					pt := pointsMap[ts]
					if pt == nil {
						pt = &stores.CDNStatsPoint{Timestamp: ts}
						pointsMap[ts] = pt
					}
					v := *td.Value
					switch metric {
					case "flux":
						pt.Traffic += int64(v)
					case "bandwidth":
						pt.Bandwidth = v
					case "request":
						pt.Requests += int64(v)
					case "hitRequest":
						pt.HitRequests += int64(v)
						pt.MissRequests = pt.Requests - pt.HitRequests
					}
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

// GetAPIRequestStats returns COS API request statistics from Tencent
// Cloud Monitor.
func (s *Store) GetAPIRequestStats(req *stores.APIStatsRequest) (*stores.APIStatsResponse, error) {
	if req == nil {
		return nil, fmt.Errorf("request is required")
	}
	client, err := s.monitorClient()
	if err != nil {
		return nil, err
	}
	bucket := s.resolveBucket(req.Bucket)
	appID := s.extractAppID(bucket)
	period := granularityToPeriod(req.Granularity)
	startTime := req.Range.Start.Format("2006-01-02T15:04:00+08:00")
	endTime := req.Range.End.Format("2006-01-02T15:04:00+08:00")

	// COS metrics in Tencent Cloud Monitor (QCE/COS namespace).
	// Metric names verified via DescribeBaseMetrics API.
	metrics := []struct {
		name string
		set  func(pt *stores.APIStatsPoint, v float64)
	}{
		{"GetRequests", func(pt *stores.APIStatsPoint, v float64) { pt.GetRequests += int64(v); pt.TotalRequests += int64(v) }},
		{"PutRequests", func(pt *stores.APIStatsPoint, v float64) { pt.PutRequests += int64(v); pt.TotalRequests += int64(v) }},
		{"HeadRequests", func(pt *stores.APIStatsPoint, v float64) { pt.HeadRequests += int64(v); pt.TotalRequests += int64(v) }},
		{"TotalRequests", func(pt *stores.APIStatsPoint, v float64) { pt.TotalRequests += int64(v) }},
		{"InternetTrafficUp", func(pt *stores.APIStatsPoint, v float64) { pt.UploadBytes += int64(v) }},
		{"InternetTrafficDown", func(pt *stores.APIStatsPoint, v float64) { pt.DownloadBytes += int64(v) }},
		{"4xxResponse", func(pt *stores.APIStatsPoint, v float64) { pt.ErrorRequests += int64(v) }},
		{"5xxResponse", func(pt *stores.APIStatsPoint, v float64) { pt.ErrorRequests += int64(v) }},
	}

	// Build dimensions: appid + bucket (required by COS Monitor API).
	dims := []*monitor.Dimension{{
		Name:  &[]string{"bucket"}[0],
		Value: &bucket,
	}}
	if appID != "" {
		dims = append(dims, &monitor.Dimension{
			Name:  &[]string{"appid"}[0],
			Value: &appID,
		})
	}

	pointsMap := make(map[time.Time]*stores.APIStatsPoint)

	for _, m := range metrics {
		resp, err := client.GetMonitorData(&monitor.GetMonitorDataRequest{
			Namespace:  &[]string{"Qce/Cos"}[0],
			MetricName: &m.name,
			Period:     &period,
			StartTime:  &startTime,
			EndTime:    &endTime,
			Instances: []*monitor.Instance{{
				Dimensions: dims,
			}},
		})
		if err != nil {
			continue
		}
		if resp.Response == nil || resp.Response.DataPoints == nil {
			continue
		}

		for _, dp := range resp.Response.DataPoints {
			if dp.Timestamps == nil || dp.Values == nil {
				continue
			}
			for i, ts := range dp.Timestamps {
				t := time.Unix(int64(*ts), 0)
				pt := pointsMap[t]
				if pt == nil {
					pt = &stores.APIStatsPoint{Timestamp: t}
					pointsMap[t] = pt
				}
				m.set(pt, *dp.Values[i])
			}
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
		summary.UploadBytes += p.UploadBytes
		summary.DownloadBytes += p.DownloadBytes
		summary.ErrorRequests += p.ErrorRequests
	}
	if summary.TotalRequests > 0 {
		summary.ErrorRate = float64(summary.ErrorRequests) / float64(summary.TotalRequests)
	}

	return &stores.APIStatsResponse{Points: allPoints, Summary: summary}, nil
}

// GetOriginFetchStats returns origin-fetch statistics from the Tencent
// Cloud CDN API (DescribeOriginData).
func (s *Store) GetOriginFetchStats(req *stores.OriginStatsRequest) (*stores.OriginStatsResponse, error) {
	if req == nil {
		return nil, fmt.Errorf("request is required")
	}
	client, err := s.cdnClient()
	if err != nil {
		return nil, err
	}

	interval := granularityToInterval(req.Granularity)
	startTime := req.Range.Start.Format("2006-01-02 15:04:00")
	endTime := req.Range.End.Format("2006-01-02 15:04:00")

	// Origin metrics: flux (origin traffic), request (origin requests).
	metrics := []string{"flux", "request"}
	pointsMap := make(map[time.Time]*stores.OriginStatsPoint)

	for _, metric := range metrics {
		resp, err := client.DescribeOriginData(&cdn.DescribeOriginDataRequest{
			StartTime: &startTime,
			EndTime:   &endTime,
			Metric:    &metric,
			Interval:  &interval,
			Domains:   cdnCommon.StringPtrs(req.Domains),
		})
		if err != nil {
			continue
		}
		if resp.Response == nil || resp.Response.Data == nil {
			continue
		}

		for _, rd := range resp.Response.Data {
			if rd.OriginData == nil {
				continue
			}
			for _, od := range rd.OriginData {
				if od.DetailData == nil {
					continue
				}
				for _, td := range od.DetailData {
					ts, err := time.Parse("2006-01-02 15:04:00", *td.Time)
					if err != nil {
						continue
					}
					pt := pointsMap[ts]
					if pt == nil {
						pt = &stores.OriginStatsPoint{Timestamp: ts}
						pointsMap[ts] = pt
					}
					v := *td.Value
					switch metric {
					case "flux":
						pt.OriginTraffic += int64(v)
					case "request":
						pt.OriginRequests += int64(v)
					}
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
