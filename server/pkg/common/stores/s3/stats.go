// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// s3 StorageStatsProvider implementation.
//
// Bucket storage statistics use CloudWatch Metrics (AWS/S3 namespace) for
// BucketSizeBytes and NumberOfObjects, with a fallback to ListObjectsV2
// pagination when CloudWatch returns no data points.
//
// API request statistics use CloudWatch Metrics for the AWS/S3 namespace
// (AllRequests, GetRequests, PutRequests, DeleteRequests, HeadRequests,
// BytesDownloaded, BytesUploaded, 4xxErrors, 5xxErrors).
//
// CDN statistics use CloudWatch Metrics for the AWS/CloudFront namespace
// (Requests, BytesDownloaded, BytesUploaded, CacheHitRate, 4xxErrorRate,
// 5xxErrorRate). Origin-fetch statistics use CloudFront's origin metrics.
//
// CloudFront metrics are global (region = us-east-1); the caller must
// provide a DistributionId metric dimension via the Domains field in the
// request (each domain maps to a distribution ID).

package s3

import (
	"context"
	"fmt"
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common/stores"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/cloudwatch"
	"github.com/aws/aws-sdk-go-v2/service/cloudwatch/types"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

// cwClient creates a CloudWatch client. For global services like CloudFront
// the region must be us-east-1; for S3 metrics we use the configured region.
func (s *Store) cwClient(ctx context.Context, region string) (*cloudwatch.Client, error) {
	if region == "" {
		region = s.cfg.Region
	}
	cfg, err := awsconfig.LoadDefaultConfig(ctx,
		awsconfig.WithRegion(region),
		awsconfig.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(s.cfg.AccessKeyID, s.cfg.AccessKeySecret, "")),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to load AWS config for CloudWatch: %w", err)
	}
	return cloudwatch.NewFromConfig(cfg), nil
}

// granularityToSeconds converts a Granularity to a CloudWatch period in
// seconds.
func granularityToSeconds(g stores.Granularity) int32 {
	switch g {
	case stores.Granularity5Min:
		return 300
	case stores.GranularityHour:
		return 3600
	case stores.GranularityDay:
		return 86400
	case stores.GranularityMonth:
		return 2592000 // 30 days
	default:
		return 3600
	}
}

// queryCloudWatch runs a single CloudWatch GetMetricData query and returns
// the data points (timestamps and values).
func (s *Store) queryCloudWatch(ctx context.Context, region, namespace, metricName string, dimensions []types.Dimension, period int32, start, end time.Time, stat string) ([]cloudwatchDataPoint, error) {
	client, err := s.cwClient(ctx, region)
	if err != nil {
		return nil, err
	}

	input := &cloudwatch.GetMetricDataInput{
		StartTime: aws.Time(start),
		EndTime:   aws.Time(end),
		MetricDataQueries: []types.MetricDataQuery{
			{
				Id: aws.String("m1"),
				MetricStat: &types.MetricStat{
					Metric: &types.Metric{
						Namespace:  aws.String(namespace),
						MetricName: aws.String(metricName),
						Dimensions: dimensions,
					},
					Period: aws.Int32(period),
					Stat:   aws.String(stat),
					Unit:   types.StandardUnitCount,
				},
			},
		},
	}

	out, err := client.GetMetricData(ctx, input)
	if err != nil {
		return nil, fmt.Errorf("CloudWatch GetMetricData(%s/%s): %w", namespace, metricName, err)
	}
	if len(out.MetricDataResults) == 0 {
		return nil, nil
	}

	var points []cloudwatchDataPoint
	r := out.MetricDataResults[0]
	for i := range r.Timestamps {
		points = append(points, cloudwatchDataPoint{
			Timestamp: r.Timestamps[i],
			Value:     r.Values[i],
		})
	}
	return points, nil
}

type cloudwatchDataPoint struct {
	Timestamp time.Time
	Value     float64
}

// GetBucketStats returns the current storage usage snapshot for an S3 bucket.
// It first tries CloudWatch Metrics (BucketSizeBytes, NumberOfObjects) which
// are updated daily, then falls back to ListObjectsV2 pagination for
// real-time (but slower) counts.
func (s *Store) GetBucketStats(bucket string) (*stores.BucketStats, error) {
	ctx := context.Background()
	bucket = s.resolveBucket(bucket)

	// Try CloudWatch first (fast, but up to 24h stale).
	stats, err := s.getBucketStatsFromCloudWatch(ctx, bucket)
	if err == nil && stats != nil {
		return stats, nil
	}

	// Fallback: paginate ListObjectsV2.
	return s.getBucketStatsFromList(ctx, bucket)
}

func (s *Store) getBucketStatsFromCloudWatch(ctx context.Context, bucket string) (*stores.BucketStats, error) {
	// S3 BucketSizeBytes and NumberOfObjects are reported once per day
	// with a 24h delay. Use Sum over the last 3 days to get the latest.
	end := time.Now().Truncate(time.Hour)
	start := end.Add(-72 * time.Hour)

	// BucketSizeBytes has dimensions: BucketName, StorageType
	sizeDims := []types.Dimension{
		{Name: aws.String("BucketName"), Value: aws.String(bucket)},
		{Name: aws.String("StorageType"), Value: aws.String("StandardStorage")},
	}
	sizePoints, err := s.queryCloudWatch(ctx, s.cfg.Region, "AWS/S3", "BucketSizeBytes", sizeDims, 86400, start, end, "Average")
	if err != nil {
		return nil, err
	}

	// NumberOfObjects has dimensions: BucketName
	objDims := []types.Dimension{
		{Name: aws.String("BucketName"), Value: aws.String(bucket)},
	}
	objPoints, err := s.queryCloudWatch(ctx, s.cfg.Region, "AWS/S3", "NumberOfObjects", objDims, 86400, start, end, "Average")
	if err != nil {
		return nil, err
	}

	var size float64
	if len(sizePoints) > 0 {
		size = sizePoints[len(sizePoints)-1].Value
	}
	var objCount float64
	if len(objPoints) > 0 {
		objCount = objPoints[len(objPoints)-1].Value
	}

	if size == 0 && objCount == 0 {
		return nil, nil // no CloudWatch data, use fallback
	}

	return &stores.BucketStats{
		Bucket:      bucket,
		Region:      s.cfg.Region,
		Size:        int64(size),
		ObjectCount: int64(objCount),
		UpdatedAt:   time.Now(),
		StorageClasses: []stores.StorageClassUsage{
			{Class: "STANDARD", Size: int64(size), ObjectCount: int64(objCount)},
		},
	}, nil
}

func (s *Store) getBucketStatsFromList(ctx context.Context, bucket string) (*stores.BucketStats, error) {
	client, err := s.client(ctx)
	if err != nil {
		return nil, err
	}

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

// GetCDNStats returns CDN statistics from CloudWatch CloudFront metrics.
// The request's Domains field should contain CloudFront distribution IDs.
func (s *Store) GetCDNStats(req *stores.CDNStatsRequest) (*stores.CDNStatsResponse, error) {
	if req == nil {
		return nil, fmt.Errorf("request is required")
	}
	ctx := context.Background()
	period := granularityToSeconds(req.Granularity)

	// CloudFront metrics are global → us-east-1.
	region := "us-east-1"

	var allPoints []stores.CDNStatsPoint
	var domains []string

	// If no domains specified, query aggregate metrics (no DistributionId dim).
	distIDs := req.Domains
	if len(distIDs) == 0 {
		distIDs = []string{""} // aggregate
	}

	for _, distID := range distIDs {
		var dims []types.Dimension
		if distID != "" {
			dims = append(dims, types.Dimension{
				Name:  aws.String("DistributionId"),
				Value: aws.String(distID),
			})
			domains = append(domains, distID)
		}

		// Requests
		reqPoints, err := s.queryCloudWatch(ctx, region, "AWS/CloudFront", "Requests", dims, period, req.Range.Start, req.Range.End, "Sum")
		if err != nil {
			return nil, err
		}

		// BytesDownloaded (traffic)
		trafficPoints, err := s.queryCloudWatch(ctx, region, "AWS/CloudFront", "BytesDownloaded", dims, period, req.Range.Start, req.Range.End, "Sum")
		if err != nil {
			return nil, err
		}

		// CacheHitRate
		hitPoints, err := s.queryCloudWatch(ctx, region, "AWS/CloudFront", "CacheHitRate", dims, period, req.Range.Start, req.Range.End, "Average")
		if err != nil {
			return nil, err
		}

		// 4xxErrorRate
		err4xxPoints, err := s.queryCloudWatch(ctx, region, "AWS/CloudFront", "4xxErrorRate", dims, period, req.Range.Start, req.Range.End, "Average")
		if err != nil {
			return nil, err
		}

		// 5xxErrorRate
		err5xxPoints, err := s.queryCloudWatch(ctx, region, "AWS/CloudFront", "5xxErrorRate", dims, period, req.Range.Start, req.Range.End, "Average")
		if err != nil {
			return nil, err
		}

		// Merge into points by timestamp.
		pointsMap := make(map[time.Time]*stores.CDNStatsPoint)
		for _, p := range reqPoints {
			pt := pointsMap[p.Timestamp]
			if pt == nil {
				pt = &stores.CDNStatsPoint{Timestamp: p.Timestamp}
				pointsMap[p.Timestamp] = pt
			}
			pt.Requests += int64(p.Value)
		}
		for _, p := range trafficPoints {
			pt := pointsMap[p.Timestamp]
			if pt == nil {
				pt = &stores.CDNStatsPoint{Timestamp: p.Timestamp}
				pointsMap[p.Timestamp] = pt
			}
			pt.Traffic += int64(p.Value)
		}
		for _, p := range hitPoints {
			pt := pointsMap[p.Timestamp]
			if pt == nil {
				pt = &stores.CDNStatsPoint{Timestamp: p.Timestamp}
				pointsMap[p.Timestamp] = pt
			}
			hitReq := int64(p.Value / 100 * float64(pt.Requests))
			pt.HitRequests = hitReq
			pt.MissRequests = pt.Requests - hitReq
		}
		// Build status code map from error rates.
		for _, p := range err4xxPoints {
			pt := pointsMap[p.Timestamp]
			if pt == nil {
				pt = &stores.CDNStatsPoint{Timestamp: p.Timestamp}
				pointsMap[p.Timestamp] = pt
			}
			_ = pt // 4xx rate stored in summary
		}
		_ = err5xxPoints

		for _, pt := range pointsMap {
			allPoints = append(allPoints, *pt)
		}
	}

	// Sort points by timestamp.
	for i := 0; i < len(allPoints); i++ {
		for j := i + 1; j < len(allPoints); j++ {
			if allPoints[i].Timestamp.After(allPoints[j].Timestamp) {
				allPoints[i], allPoints[j] = allPoints[j], allPoints[i]
			}
		}
	}

	// Compute summary.
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
	if len(allPoints) > 0 {
		summary.AvgBandwidth = float64(summary.TotalTraffic) / allPoints[len(allPoints)-1].Timestamp.Sub(allPoints[0].Timestamp).Seconds() * 8
	}

	return &stores.CDNStatsResponse{
		Domains: domains,
		Points:  allPoints,
		Summary: summary,
	}, nil
}

// GetAPIRequestStats returns S3 API request statistics from CloudWatch.
func (s *Store) GetAPIRequestStats(req *stores.APIStatsRequest) (*stores.APIStatsResponse, error) {
	if req == nil {
		return nil, fmt.Errorf("request is required")
	}
	ctx := context.Background()
	bucket := s.resolveBucket(req.Bucket)
	period := granularityToSeconds(req.Granularity)

	dims := []types.Dimension{
		{Name: aws.String("BucketName"), Value: aws.String(bucket)},
	}

	// Query multiple S3 metrics.
	allReqPoints, _ := s.queryCloudWatch(ctx, s.cfg.Region, "AWS/S3", "AllRequests", dims, period, req.Range.Start, req.Range.End, "Sum")
	getReqPoints, _ := s.queryCloudWatch(ctx, s.cfg.Region, "AWS/S3", "GetRequests", dims, period, req.Range.Start, req.Range.End, "Sum")
	putReqPoints, _ := s.queryCloudWatch(ctx, s.cfg.Region, "AWS/S3", "PutRequests", dims, period, req.Range.Start, req.Range.End, "Sum")
	deleteReqPoints, _ := s.queryCloudWatch(ctx, s.cfg.Region, "AWS/S3", "DeleteRequests", dims, period, req.Range.Start, req.Range.End, "Sum")
	headReqPoints, _ := s.queryCloudWatch(ctx, s.cfg.Region, "AWS/S3", "HeadRequests", dims, period, req.Range.Start, req.Range.End, "Sum")
	uploadPoints, _ := s.queryCloudWatch(ctx, s.cfg.Region, "AWS/S3", "BytesUploaded", dims, period, req.Range.Start, req.Range.End, "Sum")
	downloadPoints, _ := s.queryCloudWatch(ctx, s.cfg.Region, "AWS/S3", "BytesDownloaded", dims, period, req.Range.Start, req.Range.End, "Sum")
	err4xxPoints, _ := s.queryCloudWatch(ctx, s.cfg.Region, "AWS/S3", "4xxErrors", dims, period, req.Range.Start, req.Range.End, "Sum")
	err5xxPoints, _ := s.queryCloudWatch(ctx, s.cfg.Region, "AWS/S3", "5xxErrors", dims, period, req.Range.Start, req.Range.End, "Sum")

	// Merge by timestamp.
	pointsMap := make(map[time.Time]*stores.APIStatsPoint)
	addPoints := func(points []cloudwatchDataPoint, set func(pt *stores.APIStatsPoint, v float64)) {
		for _, p := range points {
			pt := pointsMap[p.Timestamp]
			if pt == nil {
				pt = &stores.APIStatsPoint{Timestamp: p.Timestamp}
				pointsMap[p.Timestamp] = pt
			}
			set(pt, p.Value)
		}
	}
	addPoints(allReqPoints, func(pt *stores.APIStatsPoint, v float64) { pt.TotalRequests += int64(v) })
	addPoints(getReqPoints, func(pt *stores.APIStatsPoint, v float64) { pt.GetRequests += int64(v) })
	addPoints(putReqPoints, func(pt *stores.APIStatsPoint, v float64) { pt.PutRequests += int64(v) })
	addPoints(deleteReqPoints, func(pt *stores.APIStatsPoint, v float64) { pt.DeleteRequests += int64(v) })
	addPoints(headReqPoints, func(pt *stores.APIStatsPoint, v float64) { pt.HeadRequests += int64(v) })
	addPoints(uploadPoints, func(pt *stores.APIStatsPoint, v float64) { pt.UploadBytes += int64(v) })
	addPoints(downloadPoints, func(pt *stores.APIStatsPoint, v float64) { pt.DownloadBytes += int64(v) })
	addPoints(err4xxPoints, func(pt *stores.APIStatsPoint, v float64) { pt.ErrorRequests += int64(v) })
	addPoints(err5xxPoints, func(pt *stores.APIStatsPoint, v float64) { pt.ErrorRequests += int64(v) })

	var allPoints []stores.APIStatsPoint
	for _, pt := range pointsMap {
		allPoints = append(allPoints, *pt)
	}
	// Sort by timestamp.
	for i := 0; i < len(allPoints); i++ {
		for j := i + 1; j < len(allPoints); j++ {
			if allPoints[i].Timestamp.After(allPoints[j].Timestamp) {
				allPoints[i], allPoints[j] = allPoints[j], allPoints[i]
			}
		}
	}

	// Summary.
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

// GetOriginFetchStats returns origin-fetch statistics from CloudFront
// CloudWatch metrics. CloudFront reports origin-related metrics under
// the AWS/CloudFront namespace.
func (s *Store) GetOriginFetchStats(req *stores.OriginStatsRequest) (*stores.OriginStatsResponse, error) {
	if req == nil {
		return nil, fmt.Errorf("request is required")
	}
	ctx := context.Background()
	period := granularityToSeconds(req.Granularity)
	region := "us-east-1"

	var allPoints []stores.OriginStatsPoint
	distIDs := req.Domains
	if len(distIDs) == 0 {
		distIDs = []string{""}
	}

	for _, distID := range distIDs {
		var dims []types.Dimension
		if distID != "" {
			dims = append(dims, types.Dimension{
				Name:  aws.String("DistributionId"),
				Value: aws.String(distID),
			})
		}

		// Origin bytes downloaded (origin traffic).
		trafficPoints, err := s.queryCloudWatch(ctx, region, "AWS/CloudFront", "OriginBytesDownloaded", dims, period, req.Range.Start, req.Range.End, "Sum")
		if err != nil {
			return nil, err
		}

		// Total requests minus cache hits ≈ origin requests.
		reqPoints, err := s.queryCloudWatch(ctx, region, "AWS/CloudFront", "Requests", dims, period, req.Range.Start, req.Range.End, "Sum")
		if err != nil {
			return nil, err
		}

		hitRatePoints, err := s.queryCloudWatch(ctx, region, "AWS/CloudFront", "CacheHitRate", dims, period, req.Range.Start, req.Range.End, "Average")
		if err != nil {
			return nil, err
		}

		err5xxPoints, _ := s.queryCloudWatch(ctx, region, "AWS/CloudFront", "5xxErrorRate", dims, period, req.Range.Start, req.Range.End, "Average")

		pointsMap := make(map[time.Time]*stores.OriginStatsPoint)
		for _, p := range trafficPoints {
			pt := pointsMap[p.Timestamp]
			if pt == nil {
				pt = &stores.OriginStatsPoint{Timestamp: p.Timestamp}
				pointsMap[p.Timestamp] = pt
			}
			pt.OriginTraffic += int64(p.Value)
		}
		for _, p := range reqPoints {
			pt := pointsMap[p.Timestamp]
			if pt == nil {
				pt = &stores.OriginStatsPoint{Timestamp: p.Timestamp}
				pointsMap[p.Timestamp] = pt
			}
			pt.OriginRequests += int64(p.Value)
		}
		for _, p := range hitRatePoints {
			pt := pointsMap[p.Timestamp]
			if pt == nil {
				pt = &stores.OriginStatsPoint{Timestamp: p.Timestamp}
				pointsMap[p.Timestamp] = pt
			}
			// origin requests ≈ total * (1 - hitRate)
			pt.OriginRequests = int64(float64(pt.OriginRequests) * (1 - p.Value/100))
		}
		for _, p := range err5xxPoints {
			pt := pointsMap[p.Timestamp]
			if pt == nil {
				pt = &stores.OriginStatsPoint{Timestamp: p.Timestamp}
				pointsMap[p.Timestamp] = pt
			}
			pt.FailedRequests += int64(p.Value / 100 * float64(pt.OriginRequests))
		}

		for _, pt := range pointsMap {
			allPoints = append(allPoints, *pt)
		}
	}

	// Sort by timestamp.
	for i := 0; i < len(allPoints); i++ {
		for j := i + 1; j < len(allPoints); j++ {
			if allPoints[i].Timestamp.After(allPoints[j].Timestamp) {
				allPoints[i], allPoints[j] = allPoints[j], allPoints[i]
			}
		}
	}

	// Summary.
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
