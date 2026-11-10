// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// local StorageStatsProvider implementation.
//
// The local filesystem backend can report bucket (directory) storage usage
// by walking the filesystem. CDN, API request, and origin-fetch statistics
// are not applicable to a local store and return ErrStatsUnsupported.

package local

import (
	"os"
	"path/filepath"
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common/stores"
)

// GetBucketStats walks the bucket directory and returns the total size and
// object count. For the local store, "bucket" maps to a subdirectory under
// the root; an empty bucket uses the root itself.
func (s *Store) GetBucketStats(bucket string) (*stores.BucketStats, error) {
	dir := s.bucketPath(bucket)
	if bucket == "" {
		dir = s.root
	}
	if _, err := os.Stat(dir); err != nil {
		if os.IsNotExist(err) {
			return nil, stores.ErrAttachmentNotExist
		}
		return nil, err
	}

	var totalSize int64
	var objectCount int64
	walkErr := filepath.Walk(dir, func(p string, fi os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if !fi.IsDir() {
			totalSize += fi.Size()
			objectCount++
		}
		return nil
	})
	if walkErr != nil {
		return nil, walkErr
	}

	return &stores.BucketStats{
		Bucket:      bucket,
		Size:        totalSize,
		ObjectCount: objectCount,
		UpdatedAt:   time.Now(),
		StorageClasses: []stores.StorageClassUsage{
			{Class: "LOCAL", Size: totalSize, ObjectCount: objectCount},
		},
		Region: "local",
	}, nil
}

// GetCDNStats is not supported by the local filesystem backend.
func (s *Store) GetCDNStats(req *stores.CDNStatsRequest) (*stores.CDNStatsResponse, error) {
	return nil, stores.ErrStatsUnsupported
}

// GetAPIRequestStats is not supported by the local filesystem backend.
func (s *Store) GetAPIRequestStats(req *stores.APIStatsRequest) (*stores.APIStatsResponse, error) {
	return nil, stores.ErrStatsUnsupported
}

// GetOriginFetchStats is not supported by the local filesystem backend.
func (s *Store) GetOriginFetchStats(req *stores.OriginStatsRequest) (*stores.OriginStatsResponse, error) {
	return nil, stores.ErrStatsUnsupported
}
