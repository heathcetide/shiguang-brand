// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// obs StorageStatsProvider implementation.
//
// Bucket storage statistics paginate the OBS ListObjectsV2 API to compute
// total size and object count.
//
// CDN statistics use the Huawei Cloud CDN API (ShowDomainStats) which
// supports metrics like bw (bandwidth), flux (traffic), req_num (requests),
// hit_num (hit requests), hit_flux (hit traffic), and HTTP status codes.
//
// API request statistics use the Huawei Cloud OBS monitoring API. Since
// the standard SDK does not expose granular API request metrics, this
// returns ErrStatsUnsupported.
//
// Origin-fetch statistics use the Huawei Cloud CDN API (ShowDomainStats
// with bs_flux and bs_num metrics).

package obs

import (
	"context"
	"fmt"
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common/stores"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"

	"github.com/huaweicloud/huaweicloud-sdk-go-v3/core"
	"github.com/huaweicloud/huaweicloud-sdk-go-v3/core/auth"
	"github.com/huaweicloud/huaweicloud-sdk-go-v3/core/region"
	cdn "github.com/huaweicloud/huaweicloud-sdk-go-v3/services/cdn/v1"
	cdnmodel "github.com/huaweicloud/huaweicloud-sdk-go-v3/services/cdn/v1/model"
	cdnregion "github.com/huaweicloud/huaweicloud-sdk-go-v3/services/cdn/v1/region"
)

// granularityToHuawei converts a Granularity to a Huawei Cloud CDN
// interval (seconds as int64).
func granularityToHuawei(g stores.Granularity) int64 {
	switch g {
	case stores.Granularity5Min:
		return 300
	case stores.GranularityHour:
		return 3600
	case stores.GranularityDay:
		return 86400
	case stores.GranularityMonth:
		return 86400
	default:
		return 3600
	}
}

// cdnClient creates a Huawei Cloud CDN API client.
func (s *Store) cdnClient() (*cdn.CdnClient, error) {
	if s.cfg.AccessKeyID == "" || s.cfg.AccessKeySecret == "" {
		return nil, fmt.Errorf("Huawei Cloud credentials not configured")
	}

	// Huawei CDN is a global service; use cn-north-1 as default region.
	reg, err := cdnregion.SafeValueOf("cn-north-1")
	if err != nil {
		// Fallback: create a custom region.
		reg = region.NewRegion("cn-north-1", "https://cdn.myhuaweicloud.com")
	}

	cred := auth.NewBasicCredentialsBuilder().
		WithAk(s.cfg.AccessKeyID).
		WithSk(s.cfg.AccessKeySecret).
		Build()

	hcClient := core.NewHcHttpClientBuilder().
		WithRegion(reg).
		WithCredential(cred).
		Build()

	return cdn.NewCdnClient(hcClient), nil
}

// GetBucketStats computes the total storage size and object count for an
// OBS bucket by paginating ListObjectsV2.
func (s *Store) GetBucketStats(bucket string) (*stores.BucketStats, error) {
	ctx := context.Background()
	client, err := s.client(ctx)
	if err != nil {
		return nil, err
	}
	bucket = s.resolveBucket(bucket)

	var totalSize int64
	var objectCount int64
	var classes map[string]*stores.StorageClassUsage

	paginator := s3.NewListObjectsV2Paginator(client, &s3.ListObjectsV2Input{
		Bucket: aws.String(bucket),
	})
	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			return nil, err
		}
		for _, obj := range page.Contents {
			size := aws.ToInt64(obj.Size)
			totalSize += size
			objectCount++
			class := string(obj.StorageClass)
			if class == "" {
				class = "STANDARD"
			}
			if classes == nil {
				classes = make(map[string]*stores.StorageClassUsage)
			}
			if sc, ok := classes[class]; ok {
				sc.Size += size
				sc.ObjectCount++
			} else {
				classes[class] = &stores.StorageClassUsage{Class: class, Size: size, ObjectCount: 1}
			}
		}
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

// GetCDNStats returns CDN statistics from the Huawei Cloud CDN API.
func (s *Store) GetCDNStats(req *stores.CDNStatsRequest) (*stores.CDNStatsResponse, error) {
	if req == nil {
		return nil, fmt.Errorf("request is required")
	}
	client, err := s.cdnClient()
	if err != nil {
		return nil, err
	}

	domainName := "all"
	if len(req.Domains) > 0 {
		domainName = req.Domains[0]
	}
	interval := granularityToHuawei(req.Granularity)
	startTime := req.Range.Start.UnixMilli()
	endTime := req.Range.End.UnixMilli()

	// Query CDN metrics: flux (traffic), bw (bandwidth), req_num, hit_num.
	metrics := []string{"flux", "bw", "req_num", "hit_num"}
	pointsMap := make(map[time.Time]*stores.CDNStatsPoint)

	for _, statType := range metrics {
		resp, err := client.ShowDomainStats(&cdnmodel.ShowDomainStatsRequest{
			Action:     "detail",
			StartTime:  startTime,
			EndTime:    endTime,
			DomainName: domainName,
			StatType:   statType,
			Interval:   &interval,
		})
		if err != nil {
			continue
		}
		if resp.Result == nil {
			continue
		}

		// Result is map[string]interface{} with domain → list of data points.
		for domain, data := range resp.Result {
			dataList, ok := data.([]interface{})
			if !ok {
				continue
			}
			for _, item := range dataList {
				dp, ok := item.(map[string]interface{})
				if !ok {
					continue
				}
				tsFloat, ok := dp["start_time"].(float64)
				if !ok {
					continue
				}
				ts := time.Unix(int64(tsFloat)/1000, 0)
				pt := pointsMap[ts]
				if pt == nil {
					pt = &stores.CDNStatsPoint{Timestamp: ts}
					pointsMap[ts] = pt
				}
				val, _ := dp["value"].(float64)
				switch statType {
				case "flux":
					pt.Traffic += int64(val)
				case "bw":
					pt.Bandwidth = val
				case "req_num":
					pt.Requests += int64(val)
				case "hit_num":
					pt.HitRequests += int64(val)
					pt.MissRequests = pt.Requests - pt.HitRequests
				}
				_ = domain
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

// GetAPIRequestStats returns API request statistics. Huawei Cloud OBS
// does not expose granular API request metrics via the standard SDK; this
// returns ErrStatsUnsupported.
func (s *Store) GetAPIRequestStats(req *stores.APIStatsRequest) (*stores.APIStatsResponse, error) {
	return nil, stores.ErrStatsUnsupported
}

// GetOriginFetchStats returns origin-fetch statistics from the Huawei
// Cloud CDN API (ShowDomainStats with bs_flux and bs_num metrics).
func (s *Store) GetOriginFetchStats(req *stores.OriginStatsRequest) (*stores.OriginStatsResponse, error) {
	if req == nil {
		return nil, fmt.Errorf("request is required")
	}
	client, err := s.cdnClient()
	if err != nil {
		return nil, err
	}

	domainName := "all"
	if len(req.Domains) > 0 {
		domainName = req.Domains[0]
	}
	interval := granularityToHuawei(req.Granularity)
	startTime := req.Range.Start.UnixMilli()
	endTime := req.Range.End.UnixMilli()

	// Origin metrics: bs_flux (origin traffic), bs_num (origin requests).
	metrics := []string{"bs_flux", "bs_num"}
	pointsMap := make(map[time.Time]*stores.OriginStatsPoint)

	for _, statType := range metrics {
		resp, err := client.ShowDomainStats(&cdnmodel.ShowDomainStatsRequest{
			Action:     "detail",
			StartTime:  startTime,
			EndTime:    endTime,
			DomainName: domainName,
			StatType:   statType,
			Interval:   &interval,
		})
		if err != nil {
			continue
		}
		if resp.Result == nil {
			continue
		}

		for _, data := range resp.Result {
			dataList, ok := data.([]interface{})
			if !ok {
				continue
			}
			for _, item := range dataList {
				dp, ok := item.(map[string]interface{})
				if !ok {
					continue
				}
				tsFloat, ok := dp["start_time"].(float64)
				if !ok {
					continue
				}
				ts := time.Unix(int64(tsFloat)/1000, 0)
				pt := pointsMap[ts]
				if pt == nil {
					pt = &stores.OriginStatsPoint{Timestamp: ts}
					pointsMap[ts] = pt
				}
				val, _ := dp["value"].(float64)
				switch statType {
				case "bs_flux":
					pt.OriginTraffic += int64(val)
				case "bs_num":
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
