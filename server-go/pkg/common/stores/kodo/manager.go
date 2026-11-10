// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Kodo ObjectStorageManager + MultipartUploader implementation.

package kodo

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common/stores"

	"github.com/qiniu/go-sdk/v7/storage"
)

// resolveBucket returns the configured default bucket when the given
// bucket name is empty.
func (s *Store) resolveBucket(bucket string) string {
	if bucket == "" {
		return s.cfg.BucketName
	}
	return bucket
}

// ──────────────────────────────────────────────
// Bucket management
// ──────────────────────────────────────────────

// ListBuckets lists all Kodo buckets accessible by the configured
// credentials.
func (s *Store) ListBuckets(req *stores.ListBucketsRequest) (*stores.ListBucketsResponse, error) {
	cfg := s.makeConfig()
	bm := storage.NewBucketManager(s.mac(), &cfg)

	names, err := bm.Buckets(true)
	if err != nil {
		return nil, fmt.Errorf("Kodo list buckets: %w", err)
	}

	var buckets []stores.BucketInfo
	for _, name := range names {
		if req != nil && req.Prefix != "" && !strings.HasPrefix(name, req.Prefix) {
			continue
		}
		info := stores.BucketInfo{Name: name}
		// Best-effort: fetch per-bucket metadata (region, private flag,
		// creation time). Ignore individual errors so a single failing
		// bucket doesn't abort the whole listing.
		if bi, e := bm.GetBucketInfo(name); e == nil {
			info.Region = bi.Region
			if bi.Region == "" {
				info.Region = bi.Zone
			}
			info.IsPrivate = bi.IsPrivate()
			if !bi.Ctime.IsZero() {
				info.CreatedAt = bi.Ctime
			}
		}
		buckets = append(buckets, info)
	}

	if req != nil && req.MaxKeys > 0 && len(buckets) > req.MaxKeys {
		buckets = buckets[:req.MaxKeys]
	}

	return &stores.ListBucketsResponse{Buckets: buckets}, nil
}

// CreateBucket creates a new Kodo bucket. Qiniu exposes a CreateBucket
// API that requires a region ID; the configured Region (or the request
// region) is used as the region ID.
func (s *Store) CreateBucket(req *stores.CreateBucketRequest) error {
	if req == nil || req.Name == "" {
		return fmt.Errorf("Kodo: bucket name is required")
	}

	regionID := storage.RegionID(req.Region)
	if string(regionID) == "" {
		regionID = storage.RegionID(s.cfg.Region)
	}
	if string(regionID) == "" {
		return fmt.Errorf("Kodo: region is required to create a bucket")
	}

	cfg := s.makeConfig()
	bm := storage.NewBucketManager(s.mac(), &cfg)
	if err := bm.CreateBucket(req.Name, regionID); err != nil {
		return fmt.Errorf("Kodo create bucket: %w", err)
	}

	// Apply the requested privacy setting if the bucket was created as
	// private. Public is the Qiniu default.
	if req.IsPrivate {
		if err := bm.MakeBucketPrivate(req.Name); err != nil {
			return fmt.Errorf("Kodo set bucket private: %w", err)
		}
	}

	if len(req.Tags) > 0 {
		if err := bm.SetTagging(req.Name, req.Tags); err != nil {
			return fmt.Errorf("Kodo set bucket tags: %w", err)
		}
	}
	return nil
}

// DeleteBucket deletes an empty Kodo bucket.
func (s *Store) DeleteBucket(bucket string) error {
	if bucket == "" {
		return fmt.Errorf("Kodo: bucket name is required")
	}
	cfg := s.makeConfig()
	bm := storage.NewBucketManager(s.mac(), &cfg)
	if err := bm.DropBucket(bucket); err != nil {
		return fmt.Errorf("Kodo delete bucket: %w", err)
	}
	return nil
}

// GetBucketInfo returns metadata about a Kodo bucket.
func (s *Store) GetBucketInfo(bucket string) (*stores.BucketInfo, error) {
	if bucket == "" {
		return nil, fmt.Errorf("Kodo: bucket name is required")
	}
	cfg := s.makeConfig()
	bm := storage.NewBucketManager(s.mac(), &cfg)

	bi, err := bm.GetBucketInfo(bucket)
	if err != nil {
		return nil, fmt.Errorf("Kodo get bucket info: %w", err)
	}

	info := &stores.BucketInfo{
		Name:      bucket,
		Region:    bi.Region,
		IsPrivate: bi.IsPrivate(),
	}
	if bi.Region == "" {
		info.Region = bi.Zone
	}
	if !bi.Ctime.IsZero() {
		info.CreatedAt = bi.Ctime
	}

	// Best-effort: fetch bound domains.
	if domains, e := bm.ListBucketDomains(bucket); e == nil {
		for _, d := range domains {
			info.Domains = append(info.Domains, d.Domain)
		}
	}

	// Best-effort: fetch bucket tags.
	if tags, e := bm.GetTagging(bucket); e == nil {
		info.Tags = tags
	}
	return info, nil
}

// SetBucketPrivate sets the access control of a Kodo bucket.
func (s *Store) SetBucketPrivate(bucket string, isPrivate bool) error {
	if bucket == "" {
		return fmt.Errorf("Kodo: bucket name is required")
	}
	cfg := s.makeConfig()
	bm := storage.NewBucketManager(s.mac(), &cfg)

	var err error
	if isPrivate {
		err = bm.MakeBucketPrivate(bucket)
	} else {
		err = bm.MakeBucketPublic(bucket)
	}
	if err != nil {
		return fmt.Errorf("Kodo set bucket acl: %w", err)
	}
	return nil
}

// GetBucketDomains returns the domain names bound to a Kodo bucket.
func (s *Store) GetBucketDomains(bucket string) ([]string, error) {
	if bucket == "" {
		return nil, fmt.Errorf("Kodo: bucket name is required")
	}
	cfg := s.makeConfig()
	bm := storage.NewBucketManager(s.mac(), &cfg)

	infos, err := bm.ListBucketDomains(bucket)
	if err != nil {
		return nil, fmt.Errorf("Kodo get bucket domains: %w", err)
	}
	domains := make([]string, 0, len(infos))
	for _, d := range infos {
		domains = append(domains, d.Domain)
	}
	return domains, nil
}

// ──────────────────────────────────────────────
// Object management
// ──────────────────────────────────────────────

// ListFiles lists objects in a Kodo bucket with optional prefix,
// delimiter, and pagination.
func (s *Store) ListFiles(bucket string, req *stores.ListFilesRequest) (*stores.ListFilesResponse, error) {
	bucket = s.resolveBucket(bucket)
	cfg := s.makeConfig()
	bm := storage.NewBucketManager(s.mac(), &cfg)

	var prefix, delimiter, marker string
	limit := 0
	if req != nil {
		prefix = req.Prefix
		delimiter = req.Delimiter
		marker = req.Marker
		limit = req.Limit
	}

	entries, commonPrefixes, nextMarker, hasNext, err := bm.ListFiles(bucket, prefix, delimiter, marker, limit)
	if err != nil {
		return nil, fmt.Errorf("Kodo list files: %w", err)
	}

	resp := &stores.ListFilesResponse{
		Marker:         nextMarker,
		IsTruncated:    hasNext,
		CommonPrefixes: commonPrefixes,
	}
	for _, item := range entries {
		if item.IsEmpty() {
			continue
		}
		resp.Files = append(resp.Files, stores.FileInfo{
			Key:          item.Key,
			Size:         item.Fsize,
			LastModified: time.Unix(item.PutTime/1e7, 0),
			ETag:         item.Hash,
			ContentType:  item.MimeType,
			IsLatest:     true,
			PublicURL:    s.PublicURL(item.Key),
		})
	}
	return resp, nil
}

// GetFileInfo returns metadata for a single Kodo object.
func (s *Store) GetFileInfo(bucket, key string) (*stores.FileInfo, error) {
	bucket = s.resolveBucket(bucket)
	cfg := s.makeConfig()
	bm := storage.NewBucketManager(s.mac(), &cfg)

	fi, err := bm.Stat(bucket, key)
	if err != nil {
		if e, ok := err.(*storage.ErrorInfo); ok && e.Code == 612 {
			return nil, stores.ErrAttachmentNotExist
		}
		return nil, fmt.Errorf("Kodo stat object: %w", err)
	}

	return &stores.FileInfo{
		Key:          key,
		Size:         fi.Fsize,
		LastModified: time.Unix(fi.PutTime/1e7, 0),
		ETag:         fi.Hash,
		ContentType:  fi.MimeType,
		IsLatest:     true,
		PublicURL:    s.PublicURL(key),
	}, nil
}

// UploadFile uploads data to a Kodo bucket via form upload.
func (s *Store) UploadFile(bucket, key string, reader io.Reader, size int64) error {
	bucket = s.resolveBucket(bucket)

	// Kodo's form uploader requires the full payload in memory (it does
	// not stream arbitrary io.Reader). Read the body first; if a size
	// hint was provided and is non-negative use it, otherwise read all.
	data, err := io.ReadAll(reader)
	if err != nil {
		return fmt.Errorf("Kodo read upload body: %w", err)
	}
	if size < 0 {
		size = int64(len(data))
	}

	cfg := s.makeConfig()
	uploader := storage.NewFormUploader(&cfg)

	policy := storage.PutPolicy{Scope: bucket, Expires: 3600}
	token := policy.UploadToken(s.mac())

	ret := storage.PutRet{}
	extra := storage.PutExtra{}
	if err := uploader.Put(context.Background(), &ret, token, key, bytes.NewReader(data), size, &extra); err != nil {
		return fmt.Errorf("Kodo upload object: %w", err)
	}
	return nil
}

// DeleteFile deletes an object from a Kodo bucket.
func (s *Store) DeleteFile(bucket, key string) error {
	bucket = s.resolveBucket(bucket)
	cfg := s.makeConfig()
	bm := storage.NewBucketManager(s.mac(), &cfg)
	if err := bm.Delete(bucket, key); err != nil {
		return fmt.Errorf("Kodo delete object: %w", err)
	}
	return nil
}

// CopyFile copies an object within or across Kodo buckets.
func (s *Store) CopyFile(req *stores.CopyObjectRequest) error {
	if req == nil {
		return fmt.Errorf("Kodo: copy request is nil")
	}
	srcBucket := s.resolveBucket(req.SrcBucket)
	dstBucket := s.resolveBucket(req.DestBucket)

	cfg := s.makeConfig()
	bm := storage.NewBucketManager(s.mac(), &cfg)
	if err := bm.Copy(srcBucket, req.SrcKey, dstBucket, req.DestKey, true); err != nil {
		return fmt.Errorf("Kodo copy object: %w", err)
	}
	return nil
}

// MoveFile moves (renames) an object within or across Kodo buckets.
func (s *Store) MoveFile(req *stores.CopyObjectRequest) error {
	if req == nil {
		return fmt.Errorf("Kodo: move request is nil")
	}
	srcBucket := s.resolveBucket(req.SrcBucket)
	dstBucket := s.resolveBucket(req.DestBucket)

	cfg := s.makeConfig()
	bm := storage.NewBucketManager(s.mac(), &cfg)
	if err := bm.Move(srcBucket, req.SrcKey, dstBucket, req.DestKey, true); err != nil {
		return fmt.Errorf("Kodo move object: %w", err)
	}
	return nil
}

// GetFileURL returns an expiring URL for accessing a (possibly private)
// Kodo object.
func (s *Store) GetFileURL(bucket, key string, expires time.Duration) (string, error) {
	// Kodo URLs are domain-based and not bucket-scoped, so the bucket
	// parameter only matters for resolving the configured domain. When
	// no domain is configured we cannot build a URL.
	if s.cfg.Domain == "" {
		return "", fmt.Errorf("Kodo: domain is not configured")
	}
	deadline := time.Now().Add(expires).Unix()
	return storage.MakePrivateURL(s.mac(), s.normalizedDomain(), key, deadline), nil
}

// ──────────────────────────────────────────────
// Multipart upload
// ──────────────────────────────────────────────

// Qiniu Kodo does not expose an explicit initiate/upload-part/complete
// multipart API in the v7 SDK the way S3 does. Instead the
// ResumeUploader handles chunked/resumable uploads internally. The
// methods below implement the MultipartUploader interface by either
// delegating to the resume uploader (where a single-shot upload is
// possible) or returning descriptive errors so callers know that Kodo
// manages multipart state automatically.

// InitiateMultipartUpload starts a multipart upload. Because Kodo's
// resume uploader manages upload state internally, this returns a
// descriptive error indicating that explicit upload IDs are not used.
func (s *Store) InitiateMultipartUpload(bucket string, req *stores.InitiateMultipartUploadRequest) (*stores.InitiateMultipartUploadResponse, error) {
	if req == nil {
		return nil, fmt.Errorf("Kodo: request is nil")
	}
	return nil, fmt.Errorf("Kodo: explicit multipart upload is not supported by the v7 SDK; use UploadFile or the resume uploader which handles chunking automatically")
}

// UploadPart uploads a single part of a multipart upload.
func (s *Store) UploadPart(bucket, key string, req *stores.UploadPartRequest) (*stores.UploadPartResponse, error) {
	if req == nil {
		return nil, fmt.Errorf("Kodo: request is nil")
	}
	return nil, fmt.Errorf("Kodo: explicit multipart upload is not supported by the v7 SDK; use UploadFile or the resume uploader which handles chunking automatically")
}

// CompleteMultipartUpload finalizes a multipart upload.
func (s *Store) CompleteMultipartUpload(bucket, key string, req *stores.CompleteMultipartUploadRequest) (*stores.CompleteMultipartUploadResponse, error) {
	if req == nil {
		return nil, fmt.Errorf("Kodo: request is nil")
	}
	return nil, fmt.Errorf("Kodo: explicit multipart upload is not supported by the v7 SDK; use UploadFile or the resume uploader which handles chunking automatically")
}

// AbortMultipartUpload cancels a multipart upload. Kodo's resume
// uploader does not maintain server-side state that needs aborting, so
// this is a no-op.
func (s *Store) AbortMultipartUpload(bucket, key, uploadID string) error {
	return nil
}

// ListParts lists the parts of a multipart upload.
func (s *Store) ListParts(bucket, key string, req *stores.ListPartsRequest) (*stores.ListPartsResponse, error) {
	if req == nil {
		return nil, fmt.Errorf("Kodo: request is nil")
	}
	return nil, fmt.Errorf("Kodo: explicit multipart upload is not supported by the v7 SDK; use UploadFile or the resume uploader which handles chunking automatically")
}
