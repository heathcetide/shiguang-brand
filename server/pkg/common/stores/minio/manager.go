// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// MinIO ObjectStorageManager + MultipartUploader implementation.

package minio

import (
	"context"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common/stores"

	"github.com/minio/minio-go/v7"
)

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

// resolveBucket returns the configured default bucket when the given
// bucket is empty.
func (s *Store) resolveBucket(bucket string) string {
	if bucket == "" {
		return s.cfg.Bucket
	}
	return bucket
}

// ──────────────────────────────────────────────
// Bucket management
// ──────────────────────────────────────────────

// ListBuckets lists all MinIO buckets.
func (s *Store) ListBuckets(req *stores.ListBucketsRequest) (*stores.ListBucketsResponse, error) {
	ctx := context.Background()
	cli, err := s.client()
	if err != nil {
		return nil, err
	}

	buckets, err := cli.ListBuckets(ctx)
	if err != nil {
		return nil, fmt.Errorf("MinIO list buckets: %w", err)
	}

	var out []stores.BucketInfo
	for _, b := range buckets {
		name := b.Name
		if req != nil && req.Prefix != "" && !strings.HasPrefix(name, req.Prefix) {
			continue
		}
		created := b.CreationDate
		if created.IsZero() {
			created = time.Now()
		}
		out = append(out, stores.BucketInfo{
			Name:      name,
			Region:    b.BucketRegion,
			CreatedAt: created,
		})
	}

	if req != nil && req.MaxKeys > 0 && len(out) > req.MaxKeys {
		out = out[:req.MaxKeys]
	}

	return &stores.ListBucketsResponse{Buckets: out}, nil
}

// CreateBucket creates a new MinIO bucket.
func (s *Store) CreateBucket(req *stores.CreateBucketRequest) error {
	if req == nil || req.Name == "" {
		return fmt.Errorf("MinIO: bucket name is required")
	}
	ctx := context.Background()
	cli, err := s.client()
	if err != nil {
		return err
	}

	if err := cli.MakeBucket(ctx, req.Name, minio.MakeBucketOptions{Region: req.Region}); err != nil {
		return fmt.Errorf("MinIO create bucket: %w", err)
	}
	return nil
}

// DeleteBucket deletes an empty MinIO bucket.
func (s *Store) DeleteBucket(bucket string) error {
	ctx := context.Background()
	cli, err := s.client()
	if err != nil {
		return err
	}

	if err := cli.RemoveBucket(ctx, bucket); err != nil {
		return fmt.Errorf("MinIO delete bucket: %w", err)
	}
	return nil
}

// GetBucketInfo returns metadata about a MinIO bucket. MinIO does not
// expose a direct GetBucketInfo API, so the bucket list is filtered.
func (s *Store) GetBucketInfo(bucket string) (*stores.BucketInfo, error) {
	ctx := context.Background()
	cli, err := s.client()
	if err != nil {
		return nil, err
	}

	buckets, err := cli.ListBuckets(ctx)
	if err != nil {
		return nil, fmt.Errorf("MinIO list buckets: %w", err)
	}

	for _, b := range buckets {
		if b.Name == bucket {
			created := b.CreationDate
			if created.IsZero() {
				created = time.Now()
			}
			return &stores.BucketInfo{
				Name:      b.Name,
				Region:    b.BucketRegion,
				CreatedAt: created,
			}, nil
		}
	}

	return nil, fmt.Errorf("MinIO: bucket %q not found", bucket)
}

// SetBucketPrivate sets the access policy of a MinIO bucket. MinIO uses
// bucket policies (JSON) rather than ACLs.
func (s *Store) SetBucketPrivate(bucket string, isPrivate bool) error {
	ctx := context.Background()
	cli, err := s.client()
	if err != nil {
		return err
	}

	var policy string
	if isPrivate {
		// A private policy denies all anonymous access.
		policy = fmt.Sprintf(`{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DenyAllAnonymous",
      "Effect": "Deny",
      "Principal": {"AWS": ["*"]},
      "Action": ["s3:GetObject"],
      "Resource": ["arn:aws:s3:::%s/*"]
    }
  ]
}`, bucket)
	} else {
		// A public-read policy allows anonymous GetObject.
		policy = fmt.Sprintf(`{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PublicReadGetObject",
      "Effect": "Allow",
      "Principal": {"AWS": ["*"]},
      "Action": ["s3:GetObject"],
      "Resource": ["arn:aws:s3:::%s/*"]
    }
  ]
}`, bucket)
	}

	if err := cli.SetBucketPolicy(ctx, bucket, policy); err != nil {
		return fmt.Errorf("MinIO set bucket policy: %w", err)
	}
	return nil
}

// GetBucketDomains returns the domain names bound to a MinIO bucket.
// MinIO does not expose custom domain configuration, so an empty slice
// is returned.
func (s *Store) GetBucketDomains(bucket string) ([]string, error) {
	return nil, nil
}

// ──────────────────────────────────────────────
// Object management
// ──────────────────────────────────────────────

// ListFiles lists objects in a MinIO bucket.
func (s *Store) ListFiles(bucket string, req *stores.ListFilesRequest) (*stores.ListFilesResponse, error) {
	ctx := context.Background()
	cli, err := s.client()
	if err != nil {
		return nil, err
	}

	bucket = s.resolveBucket(bucket)

	opts := minio.ListObjectsOptions{Recursive: true}
	if req != nil {
		if req.Prefix != "" {
			opts.Prefix = req.Prefix
		}
		if req.Delimiter != "" {
			// MinIO does not support a custom delimiter; "/" is the
			// only delimiter and is controlled via Recursive.
			opts.Recursive = false
		}
		if req.Limit > 0 {
			opts.MaxKeys = req.Limit
		}
		if req.Marker != "" {
			opts.StartAfter = req.Marker
		}
	}

	resp := &stores.ListFilesResponse{}
	count := 0
	for obj := range cli.ListObjects(ctx, bucket, opts) {
		if obj.Err != nil {
			return nil, fmt.Errorf("MinIO list objects: %w", obj.Err)
		}
		resp.Files = append(resp.Files, stores.FileInfo{
			Key:          obj.Key,
			Size:         obj.Size,
			LastModified: obj.LastModified,
			ETag:         obj.ETag,
			ContentType:  obj.ContentType,
			StorageClass: obj.StorageClass,
			IsLatest:     true,
			PublicURL:    s.PublicURL(obj.Key),
		})
		count++
		if req != nil && req.Limit > 0 && count >= req.Limit {
			break
		}
	}

	return resp, nil
}

// GetFileInfo returns metadata for a single MinIO object.
func (s *Store) GetFileInfo(bucket, key string) (*stores.FileInfo, error) {
	ctx := context.Background()
	cli, err := s.client()
	if err != nil {
		return nil, err
	}

	bucket = s.resolveBucket(bucket)
	info, err := cli.StatObject(ctx, bucket, key, minio.StatObjectOptions{})
	if err != nil {
		if minio.ToErrorResponse(err).Code == "NoSuchKey" {
			return nil, stores.ErrAttachmentNotExist
		}
		return nil, fmt.Errorf("MinIO stat object: %w", err)
	}

	fi := &stores.FileInfo{
		Key:          key,
		Size:         info.Size,
		LastModified: info.LastModified,
		ETag:         info.ETag,
		ContentType:  info.ContentType,
		StorageClass: info.StorageClass,
		IsLatest:     true,
		PublicURL:    s.PublicURL(key),
	}
	if len(info.UserMetadata) > 0 {
		fi.Metadata = make(map[string]string, len(info.UserMetadata))
		for k, v := range info.UserMetadata {
			fi.Metadata[k] = v
		}
	}
	return fi, nil
}

// UploadFile uploads data to a MinIO bucket.
func (s *Store) UploadFile(bucket, key string, reader io.Reader, size int64) error {
	ctx := context.Background()
	cli, err := s.client()
	if err != nil {
		return err
	}

	bucket = s.resolveBucket(bucket)
	if _, err := cli.PutObject(ctx, bucket, key, reader, size, minio.PutObjectOptions{}); err != nil {
		return fmt.Errorf("MinIO put object: %w", err)
	}
	return nil
}

// DeleteFile deletes an object from a MinIO bucket.
func (s *Store) DeleteFile(bucket, key string) error {
	ctx := context.Background()
	cli, err := s.client()
	if err != nil {
		return err
	}

	bucket = s.resolveBucket(bucket)
	if err := cli.RemoveObject(ctx, bucket, key, minio.RemoveObjectOptions{}); err != nil {
		return fmt.Errorf("MinIO delete object: %w", err)
	}
	return nil
}

// CopyFile copies an object within or across MinIO buckets.
func (s *Store) CopyFile(req *stores.CopyObjectRequest) error {
	if req == nil {
		return fmt.Errorf("MinIO: copy request is nil")
	}
	ctx := context.Background()
	cli, err := s.client()
	if err != nil {
		return err
	}

	srcBucket := s.resolveBucket(req.SrcBucket)
	dstBucket := s.resolveBucket(req.DestBucket)

	dst := minio.CopyDestOptions{Bucket: dstBucket, Object: req.DestKey}
	if req.ContentType != "" {
		dst.ContentType = req.ContentType
		dst.ReplaceMetadata = true
	}
	if len(req.Metadata) > 0 {
		dst.UserMetadata = req.Metadata
		dst.ReplaceMetadata = true
	}
	src := minio.CopySrcOptions{Bucket: srcBucket, Object: req.SrcKey}

	if _, err := cli.CopyObject(ctx, dst, src); err != nil {
		return fmt.Errorf("MinIO copy object: %w", err)
	}
	return nil
}

// MoveFile moves an object within or across MinIO buckets.
func (s *Store) MoveFile(req *stores.CopyObjectRequest) error {
	if err := s.CopyFile(req); err != nil {
		return err
	}
	return s.DeleteFile(req.SrcBucket, req.SrcKey)
}

// GetFileURL returns an expiring URL for a MinIO object.
func (s *Store) GetFileURL(bucket, key string, expires time.Duration) (string, error) {
	ctx := context.Background()
	cli, err := s.client()
	if err != nil {
		return "", err
	}

	bucket = s.resolveBucket(bucket)
	u, err := cli.PresignedGetObject(ctx, bucket, key, expires, nil)
	if err != nil {
		return "", fmt.Errorf("MinIO presign get: %w", err)
	}
	return u.String(), nil
}

// ──────────────────────────────────────────────
// Multipart upload
// ──────────────────────────────────────────────

// core returns a minio.Core wrapper around the client, which exposes
// the low-level S3 multipart upload primitives.
func (s *Store) core() (*minio.Core, error) {
	cli, err := s.client()
	if err != nil {
		return nil, err
	}
	return &minio.Core{Client: cli}, nil
}

// InitiateMultipartUpload starts a multipart upload.
func (s *Store) InitiateMultipartUpload(bucket string, req *stores.InitiateMultipartUploadRequest) (*stores.InitiateMultipartUploadResponse, error) {
	if req == nil {
		return nil, fmt.Errorf("MinIO: request is nil")
	}
	ctx := context.Background()
	core, err := s.core()
	if err != nil {
		return nil, err
	}

	bucket = s.resolveBucket(bucket)
	opts := minio.PutObjectOptions{}
	if req.ContentType != "" {
		opts.ContentType = req.ContentType
	}
	if len(req.Metadata) > 0 {
		opts.UserMetadata = req.Metadata
	}

	uploadID, err := core.NewMultipartUpload(ctx, bucket, req.Key, opts)
	if err != nil {
		return nil, fmt.Errorf("MinIO initiate multipart upload: %w", err)
	}

	return &stores.InitiateMultipartUploadResponse{
		UploadID: uploadID,
		Key:      req.Key,
	}, nil
}

// UploadPart uploads a single part of a multipart upload.
func (s *Store) UploadPart(bucket, key string, req *stores.UploadPartRequest) (*stores.UploadPartResponse, error) {
	if req == nil {
		return nil, fmt.Errorf("MinIO: request is nil")
	}
	ctx := context.Background()
	core, err := s.core()
	if err != nil {
		return nil, err
	}

	bucket = s.resolveBucket(bucket)
	part, err := core.PutObjectPart(ctx, bucket, key, req.UploadID, req.PartNumber, req.Body, -1, minio.PutObjectPartOptions{})
	if err != nil {
		return nil, fmt.Errorf("MinIO upload part: %w", err)
	}

	return &stores.UploadPartResponse{
		ETag: part.ETag,
	}, nil
}

// CompleteMultipartUpload finalizes a multipart upload.
func (s *Store) CompleteMultipartUpload(bucket, key string, req *stores.CompleteMultipartUploadRequest) (*stores.CompleteMultipartUploadResponse, error) {
	if req == nil {
		return nil, fmt.Errorf("MinIO: request is nil")
	}
	ctx := context.Background()
	core, err := s.core()
	if err != nil {
		return nil, err
	}

	bucket = s.resolveBucket(bucket)
	var parts []minio.CompletePart
	for _, p := range req.Parts {
		parts = append(parts, minio.CompletePart{
			PartNumber: p.PartNumber,
			ETag:       p.ETag,
		})
	}

	info, err := core.CompleteMultipartUpload(ctx, bucket, key, req.UploadID, parts, minio.PutObjectOptions{})
	if err != nil {
		return nil, fmt.Errorf("MinIO complete multipart upload: %w", err)
	}

	return &stores.CompleteMultipartUploadResponse{
		Location: info.Location,
		Bucket:   bucket,
		Key:      key,
		ETag:     info.ETag,
	}, nil
}

// AbortMultipartUpload cancels a multipart upload.
func (s *Store) AbortMultipartUpload(bucket, key, uploadID string) error {
	ctx := context.Background()
	core, err := s.core()
	if err != nil {
		return err
	}

	bucket = s.resolveBucket(bucket)
	if err := core.AbortMultipartUpload(ctx, bucket, key, uploadID); err != nil {
		return fmt.Errorf("MinIO abort multipart upload: %w", err)
	}
	return nil
}

// ListParts lists the parts of a multipart upload.
func (s *Store) ListParts(bucket, key string, req *stores.ListPartsRequest) (*stores.ListPartsResponse, error) {
	if req == nil {
		return nil, fmt.Errorf("MinIO: request is nil")
	}
	ctx := context.Background()
	core, err := s.core()
	if err != nil {
		return nil, err
	}

	bucket = s.resolveBucket(bucket)
	maxParts := req.MaxParts
	partNumberMarker := req.PartNumberMarker

	result, err := core.ListObjectParts(ctx, bucket, key, req.UploadID, partNumberMarker, maxParts)
	if err != nil {
		return nil, fmt.Errorf("MinIO list parts: %w", err)
	}

	resp := &stores.ListPartsResponse{
		Bucket:               bucket,
		Key:                  key,
		UploadID:             req.UploadID,
		MaxParts:             result.MaxParts,
		IsTruncated:          result.IsTruncated,
		PartNumberMarker:     result.PartNumberMarker,
		NextPartNumberMarker: result.NextPartNumberMarker,
	}
	for _, p := range result.ObjectParts {
		resp.Parts = append(resp.Parts, stores.CompletedPart{
			PartNumber: p.PartNumber,
			ETag:       p.ETag,
		})
	}

	return resp, nil
}
