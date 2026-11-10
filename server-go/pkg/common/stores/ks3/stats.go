// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// ks3 StorageStatsProvider implementation.
//
// Bucket storage statistics paginate the KS3 ListObjects API to compute
// total size and object count.
//
// CDN, API request, and origin-fetch statistics require the Kingsoft Cloud
// CDN / Monitor APIs. The Kingsoft Cloud Go SDK (github.com/kingsoftcloud/sdk-go)
// provides CDN API clients (GetServerData, GetClientRequestData) but the
// response model is incomplete — the Data field lacks Value/Count fields
// needed to parse metric values. Until the SDK model is complete, these
// dimensions return ErrStatsUnsupported. Users can implement custom HTTP
// clients against the Kingsoft Cloud CDN API if needed.

package ks3

import (
	"fmt"
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common/stores"

	ks3aws "github.com/ks3sdklib/aws-sdk-go/aws"
	ks3s3 "github.com/ks3sdklib/aws-sdk-go/service/s3"
)

// GetBucketStats computes the total storage size and object count for a
// KS3 bucket by paginating ListObjects.
func (s *Store) GetBucketStats(bucket string) (*stores.BucketStats, error) {
	bucket = s.resolveBucket(bucket)
	client := s.client()

	var totalSize int64
	var objectCount int64
	marker := ""

	for {
		input := &ks3s3.ListObjectsInput{
			Bucket:  ks3aws.String(bucket),
			MaxKeys: ks3aws.Long(1000),
			Marker:  ks3aws.String(marker),
		}
		out, err := client.ListObjects(input)
		if err != nil {
			return nil, fmt.Errorf("failed to list KS3 objects: %w", err)
		}

		for _, obj := range out.Contents {
			if obj.Size != nil {
				totalSize += *obj.Size
			}
			objectCount++
		}

		if !ks3aws.ToBoolean(out.IsTruncated) {
			break
		}
		if out.NextMarker != nil {
			marker = ks3aws.ToString(out.NextMarker)
		} else if len(out.Contents) > 0 {
			marker = ks3aws.ToString(out.Contents[len(out.Contents)-1].Key)
		} else {
			break
		}
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

// GetCDNStats is not supported because the Kingsoft Cloud Go SDK's CDN
// response model is incomplete (missing Value fields in Data entries).
// Requires a custom HTTP client against the Kingsoft Cloud CDN API.
func (s *Store) GetCDNStats(req *stores.CDNStatsRequest) (*stores.CDNStatsResponse, error) {
	return nil, stores.ErrStatsUnsupported
}

// GetAPIRequestStats is not supported because the Kingsoft Cloud Go SDK
// does not expose KS3 API request metrics.
func (s *Store) GetAPIRequestStats(req *stores.APIStatsRequest) (*stores.APIStatsResponse, error) {
	return nil, stores.ErrStatsUnsupported
}

// GetOriginFetchStats is not supported because the Kingsoft Cloud Go SDK's
// CDN response model is incomplete. Requires a custom HTTP client.
func (s *Store) GetOriginFetchStats(req *stores.OriginStatsRequest) (*stores.OriginStatsResponse, error) {
	return nil, stores.ErrStatsUnsupported
}
