// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// oss StorageStatsProvider implementation.
//
// Bucket storage statistics use the OSS GetBucketStat API which returns
// total storage, object count, and per-storage-class breakdown.
//
// CDN statistics use the Alibaba Cloud CDN API (DescribeDomainBpsData,
// DescribeDomainTrafficData, DescribeDomainHitRateData, DescribeDomainQpsData).
//
// API request statistics use CloudMonitor (CMS) DescribeMetricList with
// the acs_oss namespace.
//
// Origin-fetch statistics use the Alibaba Cloud CDN API
// (DescribeDomainSrcBpsData, DescribeDomainSrcTrafficData).

package oss

import (
	"encoding/json"
	"fmt"
	"strconv"
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common/stores"

	"github.com/aliyun/aliyun-oss-go-sdk/oss"

	openapi "github.com/alibabacloud-go/darabonba-openapi/v2/client"
	openapiv1 "github.com/alibabacloud-go/darabonba-openapi/client"
	cdn "github.com/alibabacloud-go/cdn-20180510/v4/client"
	cms "github.com/alibabacloud-go/cms-20190101/v2/client"
	"github.com/alibabacloud-go/tea/tea"
)

// granularityToInterval converts a Granularity to an Alibaba Cloud CDN
// interval string (seconds).
func granularityToInterval(g stores.Granularity) string {
	switch g {
	case stores.Granularity5Min:
		return "300"
	case stores.GranularityHour:
		return "3600"
	case stores.GranularityDay:
		return "86400"
	case stores.GranularityMonth:
		return "2592000"
	default:
		return "3600"
	}
}

// granularityToPeriod converts a Granularity to a CMS period string.
func granularityToPeriod(g stores.Granularity) string {
	switch g {
	case stores.Granularity5Min:
		return "300"
	case stores.GranularityHour:
		return "3600"
	case stores.GranularityDay:
		return "86400"
	case stores.GranularityMonth:
		return "2592000"
	default:
		return "3600"
	}
}

// cdnClient creates an Alibaba Cloud CDN API client.
func (s *Store) cdnClient() (*cdn.Client, error) {
	if s.cfg.AccessKeyID == "" || s.cfg.AccessKeySecret == "" {
		return nil, fmt.Errorf("Alibaba Cloud credentials not configured")
	}
	cfg := &openapi.Config{
		AccessKeyId:     tea.String(s.cfg.AccessKeyID),
		AccessKeySecret: tea.String(s.cfg.AccessKeySecret),
		Endpoint:        tea.String("cdn.aliyuncs.com"),
	}
	return cdn.NewClient(cfg)
}

// cmsClient creates an Alibaba Cloud CloudMonitor client.
func (s *Store) cmsClient() (*cms.Client, error) {
	if s.cfg.AccessKeyID == "" || s.cfg.AccessKeySecret == "" {
		return nil, fmt.Errorf("Alibaba Cloud credentials not configured")
	}
	cfg := &openapiv1.Config{
		AccessKeyId:     tea.String(s.cfg.AccessKeyID),
		AccessKeySecret: tea.String(s.cfg.AccessKeySecret),
		Endpoint:        tea.String("metrics.cn-hangzhou.aliyuncs.com"),
	}
	return cms.NewClient(cfg)
}

// GetBucketStats returns the current storage usage snapshot for a bucket
// using the OSS GetBucketStat API.
func (s *Store) GetBucketStats(bucket string) (*stores.BucketStats, error) {
	if s.cfg.AccessKeyID == "" || s.cfg.AccessKeySecret == "" || s.cfg.Endpoint == "" {
		return nil, fmt.Errorf("OSS credentials not configured")
	}
	client, err := oss.New(s.cfg.Endpoint, s.cfg.AccessKeyID, s.cfg.AccessKeySecret)
	if err != nil {
		return nil, fmt.Errorf("failed to create OSS client: %v", err)
	}
	bucket = s.resolveBucket(bucket)

	stat, err := client.GetBucketStat(bucket)
	if err != nil {
		return nil, fmt.Errorf("failed to get bucket stat: %w", err)
	}

	var classes []stores.StorageClassUsage
	if stat.StandardStorage > 0 || stat.StandardObjectCount > 0 {
		classes = append(classes, stores.StorageClassUsage{
			Class:       "STANDARD",
			Size:        stat.StandardStorage,
			ObjectCount: stat.StandardObjectCount,
		})
	}
	if stat.InfrequentAccessStorage > 0 || stat.InfrequentAccessObjectCount > 0 {
		classes = append(classes, stores.StorageClassUsage{
			Class:       "IA",
			Size:        stat.InfrequentAccessStorage,
			ObjectCount: stat.InfrequentAccessObjectCount,
		})
	}
	if stat.ArchiveStorage > 0 || stat.ArchiveObjectCount > 0 {
		classes = append(classes, stores.StorageClassUsage{
			Class:       "ARCHIVE",
			Size:        stat.ArchiveStorage,
			ObjectCount: stat.ArchiveObjectCount,
		})
	}
	if stat.ColdArchiveStorage > 0 || stat.ColdArchiveObjectCount > 0 {
		classes = append(classes, stores.StorageClassUsage{
			Class:       "COLD_ARCHIVE",
			Size:        stat.ColdArchiveStorage,
			ObjectCount: stat.ColdArchiveObjectCount,
		})
	}

	return &stores.BucketStats{
		Bucket:         bucket,
		Size:           stat.Storage,
		ObjectCount:    stat.ObjectCount,
		UpdatedAt:      time.Now(),
		StorageClasses: classes,
	}, nil
}

// GetCDNStats returns CDN statistics from the Alibaba Cloud CDN API.
func (s *Store) GetCDNStats(req *stores.CDNStatsRequest) (*stores.CDNStatsResponse, error) {
	if req == nil {
		return nil, fmt.Errorf("request is required")
	}
	client, err := s.cdnClient()
	if err != nil {
		return nil, err
	}

	domainName := ""
	if len(req.Domains) > 0 {
		domainName = req.Domains[0]
	}
	interval := granularityToInterval(req.Granularity)
	startTime := req.Range.Start.UTC().Format("2006-01-02T15:04:05Z")
	endTime := req.Range.End.UTC().Format("2006-01-02T15:04:05Z")

	// Bandwidth data
	bpsResp, err := client.DescribeDomainBpsData(&cdn.DescribeDomainBpsDataRequest{
		DomainName: tea.String(domainName),
		StartTime:  tea.String(startTime),
		EndTime:    tea.String(endTime),
		Interval:   tea.String(interval),
	})
	if err != nil {
		return nil, fmt.Errorf("CDN DescribeDomainBpsData: %w", err)
	}

	// Traffic data
	trafficResp, err := client.DescribeDomainTrafficData(&cdn.DescribeDomainTrafficDataRequest{
		DomainName: tea.String(domainName),
		StartTime:  tea.String(startTime),
		EndTime:    tea.String(endTime),
		Interval:   tea.String(interval),
	})
	if err != nil {
		return nil, fmt.Errorf("CDN DescribeDomainTrafficData: %w", err)
	}

	// Hit rate data
	hitResp, err := client.DescribeDomainHitRateData(&cdn.DescribeDomainHitRateDataRequest{
		DomainName: tea.String(domainName),
		StartTime:  tea.String(startTime),
		EndTime:    tea.String(endTime),
		Interval:   tea.String(interval),
	})
	if err != nil {
		return nil, fmt.Errorf("CDN DescribeDomainHitRateData: %w", err)
	}

	// QPS data
	qpsResp, err := client.DescribeDomainQpsData(&cdn.DescribeDomainQpsDataRequest{
		DomainName: tea.String(domainName),
		StartTime:  tea.String(startTime),
		EndTime:    tea.String(endTime),
		Interval:   tea.String(interval),
	})
	if err != nil {
		return nil, fmt.Errorf("CDN DescribeDomainQpsData: %w", err)
	}

	// Merge data points by timestamp.
	pointsMap := make(map[time.Time]*stores.CDNStatsPoint)

	if bpsResp.Body.BpsDataPerInterval != nil {
		for _, dm := range bpsResp.Body.BpsDataPerInterval.DataModule {
			ts, v := parseCDNDataModule(dm.TimeStamp, dm.Value)
			if ts.IsZero() {
				continue
			}
			pt := pointsMap[ts]
			if pt == nil {
				pt = &stores.CDNStatsPoint{Timestamp: ts}
				pointsMap[ts] = pt
			}
			pt.Bandwidth = v
		}
	}

	if trafficResp.Body.TrafficDataPerInterval != nil {
		for _, dm := range trafficResp.Body.TrafficDataPerInterval.DataModule {
			ts, v := parseCDNDataModule(dm.TimeStamp, dm.Value)
			if ts.IsZero() {
				continue
			}
			pt := pointsMap[ts]
			if pt == nil {
				pt = &stores.CDNStatsPoint{Timestamp: ts}
				pointsMap[ts] = pt
			}
			pt.Traffic = int64(v)
		}
	}

	if qpsResp.Body.QpsDataInterval != nil {
		for _, dm := range qpsResp.Body.QpsDataInterval.DataModule {
			ts, v := parseCDNDataModule(dm.TimeStamp, dm.Value)
			if ts.IsZero() {
				continue
			}
			pt := pointsMap[ts]
			if pt == nil {
				pt = &stores.CDNStatsPoint{Timestamp: ts}
				pointsMap[ts] = pt
			}
			pt.Requests = int64(v * float64(parseIntervalSeconds(interval)))
		}
	}

	if hitResp.Body.HitRateInterval != nil {
		for _, dm := range hitResp.Body.HitRateInterval.DataModule {
			ts, v := parseCDNDataModule(dm.TimeStamp, dm.Value)
			if ts.IsZero() {
				continue
			}
			pt := pointsMap[ts]
			if pt == nil {
				pt = &stores.CDNStatsPoint{Timestamp: ts}
				pointsMap[ts] = pt
			}
			hitReq := int64(v / 100 * float64(pt.Requests))
			pt.HitRequests = hitReq
			pt.MissRequests = pt.Requests - hitReq
		}
	}

	var allPoints []stores.CDNStatsPoint
	for _, pt := range pointsMap {
		allPoints = append(allPoints, *pt)
	}
	sortPointsByTime(allPoints)

	// Summary
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

// GetAPIRequestStats returns OSS API request statistics from CloudMonitor.
func (s *Store) GetAPIRequestStats(req *stores.APIStatsRequest) (*stores.APIStatsResponse, error) {
	if req == nil {
		return nil, fmt.Errorf("request is required")
	}
	client, err := s.cmsClient()
	if err != nil {
		return nil, err
	}
	bucket := s.resolveBucket(req.Bucket)
	period := granularityToPeriod(req.Granularity)
	startTime := req.Range.Start.UTC().Format("2006-01-02T15:04:05Z")
	endTime := req.Range.End.UTC().Format("2006-01-02T15:04:05Z")

	dims := fmt.Sprintf(`[{"bucket":"%s"}]`, bucket)

	// Query multiple OSS metrics from CloudMonitor.
	metrics := []struct {
		name string
		unit string
	}{
		{"TotalRequestCount", "Count"},
		{"GetRequestCount", "Count"},
		{"PutRequestCount", "Count"},
		{"DeleteRequestCount", "Count"},
		{"HeadRequestCount", "Count"},
		{"UploadBytes", "Bytes"},
		{"DownloadBytes", "Bytes"},
		{"ErrorCodeCount", "Count"},
	}

	pointsMap := make(map[time.Time]*stores.APIStatsPoint)

	for _, m := range metrics {
		resp, err := client.DescribeMetricList(&cms.DescribeMetricListRequest{
			Namespace:  tea.String("acs_oss"),
			MetricName: tea.String(m.name),
			Period:     tea.String(period),
			StartTime:  tea.String(startTime),
			EndTime:    tea.String(endTime),
			Dimensions: tea.String(dims),
		})
		if err != nil {
			continue // skip metrics that fail
		}
		if resp.Body == nil || resp.Body.Datapoints == nil {
			continue
		}

		var datapoints []cmsDatapoint
		if err := json.Unmarshal([]byte(*resp.Body.Datapoints), &datapoints); err != nil {
			continue
		}

		for _, dp := range datapoints {
			ts := time.Unix(dp.Timestamp/1000, 0)
			pt := pointsMap[ts]
			if pt == nil {
				pt = &stores.APIStatsPoint{Timestamp: ts}
				pointsMap[ts] = pt
			}
			v, _ := strconv.ParseFloat(fmt.Sprintf("%v", dp.Value), 64)
			switch m.name {
			case "TotalRequestCount":
				pt.TotalRequests += int64(v)
			case "GetRequestCount":
				pt.GetRequests += int64(v)
			case "PutRequestCount":
				pt.PutRequests += int64(v)
			case "DeleteRequestCount":
				pt.DeleteRequests += int64(v)
			case "HeadRequestCount":
				pt.HeadRequests += int64(v)
			case "UploadBytes":
				pt.UploadBytes += int64(v)
			case "DownloadBytes":
				pt.DownloadBytes += int64(v)
			case "ErrorCodeCount":
				pt.ErrorRequests += int64(v)
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

// GetOriginFetchStats returns origin-fetch statistics from the Alibaba
// Cloud CDN API (DescribeDomainSrcBpsData, DescribeDomainSrcTrafficData).
func (s *Store) GetOriginFetchStats(req *stores.OriginStatsRequest) (*stores.OriginStatsResponse, error) {
	if req == nil {
		return nil, fmt.Errorf("request is required")
	}
	client, err := s.cdnClient()
	if err != nil {
		return nil, err
	}

	domainName := ""
	if len(req.Domains) > 0 {
		domainName = req.Domains[0]
	}
	interval := granularityToInterval(req.Granularity)
	startTime := req.Range.Start.UTC().Format("2006-01-02T15:04:05Z")
	endTime := req.Range.End.UTC().Format("2006-01-02T15:04:05Z")

	// Origin bandwidth
	srcBpsResp, err := client.DescribeDomainSrcBpsData(&cdn.DescribeDomainSrcBpsDataRequest{
		DomainName: tea.String(domainName),
		StartTime:  tea.String(startTime),
		EndTime:    tea.String(endTime),
		Interval:   tea.String(interval),
	})
	if err != nil {
		return nil, fmt.Errorf("CDN DescribeDomainSrcBpsData: %w", err)
	}

	// Origin traffic
	srcTrafficResp, err := client.DescribeDomainSrcTrafficData(&cdn.DescribeDomainSrcTrafficDataRequest{
		DomainName: tea.String(domainName),
		StartTime:  tea.String(startTime),
		EndTime:    tea.String(endTime),
		Interval:   tea.String(interval),
	})
	if err != nil {
		return nil, fmt.Errorf("CDN DescribeDomainSrcTrafficData: %w", err)
	}

	pointsMap := make(map[time.Time]*stores.OriginStatsPoint)

	if srcBpsResp.Body.SrcBpsDataPerInterval != nil {
		for _, dm := range srcBpsResp.Body.SrcBpsDataPerInterval.DataModule {
			ts, v := parseCDNDataModule(dm.TimeStamp, dm.Value)
			if ts.IsZero() {
				continue
			}
			pt := pointsMap[ts]
			if pt == nil {
				pt = &stores.OriginStatsPoint{Timestamp: ts}
				pointsMap[ts] = pt
			}
			// BPS * interval = traffic
			pt.OriginTraffic += int64(v * float64(parseIntervalSeconds(interval)))
			pt.OriginRequests++ // approximate
		}
	}

	if srcTrafficResp.Body.SrcTrafficDataPerInterval != nil {
		for _, dm := range srcTrafficResp.Body.SrcTrafficDataPerInterval.DataModule {
			ts, v := parseCDNDataModule(dm.TimeStamp, dm.Value)
			if ts.IsZero() {
				continue
			}
			pt := pointsMap[ts]
			if pt == nil {
				pt = &stores.OriginStatsPoint{Timestamp: ts}
				pointsMap[ts] = pt
			}
			pt.OriginTraffic = int64(v)
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

type cmsDatapoint struct {
	Timestamp int64       `json:"timestamp"`
	Value     interface{} `json:"Value"`
}

func parseCDNDataModule(tsStr, valStr *string) (time.Time, float64) {
	if tsStr == nil || valStr == nil {
		return time.Time{}, 0
	}
	ts, err := time.Parse("2006-01-02T15:04:05Z", *tsStr)
	if err != nil {
		// Try Unix timestamp
		if unix, err2 := strconv.ParseInt(*tsStr, 10, 64); err2 == nil {
			ts = time.Unix(unix, 0)
		} else {
			return time.Time{}, 0
		}
	}
	v, err := strconv.ParseFloat(*valStr, 64)
	if err != nil {
		return ts, 0
	}
	return ts, v
}

func parseIntervalSeconds(interval string) int {
	n, _ := strconv.Atoi(interval)
	if n <= 0 {
		return 3600
	}
	return n
}

func sortPointsByTime(points []stores.CDNStatsPoint) {
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
