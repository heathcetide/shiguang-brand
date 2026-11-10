// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// minio StorageStatsProvider implementation.
//
// MinIO does not expose a single "bucket stat" RPC; GetBucketStats uses
// the ListObjects channel to compute total size and object count. CDN,
// API request, and origin-fetch statistics are not applicable to a
// self-hosted MinIO deployment and return ErrStatsUnsupported.

package minio

import (
	"context"
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common/stores"

	"github.com/minio/minio-go/v7"
)

// GetBucketStats computes the total storage size and object count for a
// MinIO bucket by iterating ListObjects.
func (s *Store) GetBucketStats(bucket string) (*stores.BucketStats, error) {
	ctx := context.Background()
	cli, err := s.client()
	if err != nil {
		return nil, err
	}
	bucket = s.resolveBucket(bucket)

	var totalSize int64
	var objectCount int64

	opts := minio.ListObjectsOptions{Recursive: true}
	for obj := range cli.ListObjects(ctx, bucket, opts) {
		if obj.Err != nil {
			return nil, obj.Err
		}
		totalSize += obj.Size
		objectCount++
	}

	return &stores.BucketStats{
		Bucket:      bucket,
		Size:        totalSize,
		ObjectCount: objectCount,
		UpdatedAt:   time.Now(),
		StorageClasses: []stores.StorageClassUsage{
			{Class: "STANDARD", Size: totalSize, ObjectCount: objectCount},
		},
	}, nil
}

// GetCDNStats is not supported by the MinIO backend.
func (s *Store) GetCDNStats(req *stores.CDNStatsRequest) (*stores.CDNStatsResponse, error) {
	return nil, stores.ErrStatsUnsupported
}

// GetAPIRequestStats is not supported by the MinIO backend.
func (s *Store) GetAPIRequestStats(req *stores.APIStatsRequest) (*stores.APIStatsResponse, error) {
	return nil, stores.ErrStatsUnsupported
}

// GetOriginFetchStats is not supported by the MinIO backend.
func (s *Store) GetOriginFetchStats(req *stores.OriginStatsRequest) (*stores.OriginStatsResponse, error) {
	return nil, stores.ErrStatsUnsupported
}
