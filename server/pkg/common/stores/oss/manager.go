// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// OSS ObjectStorageManager + MultipartUploader implementation.

package oss

import (
	"fmt"
	"io"
	"strconv"
	"strings"
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common/stores"

	"github.com/aliyun/aliyun-oss-go-sdk/oss"
)

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

// resolveBucket returns the configured default bucket name when the given
// bucket is empty, otherwise it returns the given bucket unchanged.
func (s *Store) resolveBucket(bucket string) string {
	if bucket == "" {
		return s.cfg.BucketName
	}
	return bucket
}

// client creates and returns a new OSS client built from the store config.
func (s *Store) client() (*oss.Client, error) {
	if s.cfg.AccessKeyID == "" || s.cfg.AccessKeySecret == "" || s.cfg.Endpoint == "" {
		return nil, fmt.Errorf("OSS credentials not configured")
	}
	client, err := oss.New(s.cfg.Endpoint, s.cfg.AccessKeyID, s.cfg.AccessKeySecret)
	if err != nil {
		return nil, fmt.Errorf("failed to create OSS client: %v", err)
	}
	return client, nil
}

// bucketByName returns an OSS bucket handle for the given bucket name. If the
// name is empty the configured default bucket is used.
func (s *Store) bucketByName(name string) (*oss.Bucket, error) {
	client, err := s.client()
	if err != nil {
		return nil, err
	}
	return client.Bucket(s.resolveBucket(name))
}

// ──────────────────────────────────────────────
// Bucket management
// ──────────────────────────────────────────────

// ListBuckets lists all OSS buckets accessible by the configured credentials.
func (s *Store) ListBuckets(req *stores.ListBucketsRequest) (*stores.ListBucketsResponse, error) {
	client, err := s.client()
	if err != nil {
		return nil, err
	}

	var opts []oss.Option
	if req != nil {
		if req.Prefix != "" {
			opts = append(opts, oss.Prefix(req.Prefix))
		}
		if req.MaxKeys > 0 {
			opts = append(opts, oss.MaxKeys(req.MaxKeys))
		}
	}

	result, err := client.ListBuckets(opts...)
	if err != nil {
		return nil, fmt.Errorf("OSS list buckets: %v", err)
	}

	resp := &stores.ListBucketsResponse{
		IsTruncated: result.IsTruncated,
		NextMarker:  result.NextMarker,
	}
	for _, b := range result.Buckets {
		resp.Buckets = append(resp.Buckets, stores.BucketInfo{
			Name:      b.Name,
			Region:    b.Location,
			CreatedAt: b.CreationDate,
		})
	}

	return resp, nil
}

// CreateBucket creates a new OSS bucket.
func (s *Store) CreateBucket(req *stores.CreateBucketRequest) error {
	if req == nil || req.Name == "" {
		return fmt.Errorf("OSS bucket name is required")
	}
	client, err := s.client()
	if err != nil {
		return err
	}

	var opts []oss.Option
	if req.IsPrivate {
		opts = append(opts, oss.ACL(oss.ACLPrivate))
	} else {
		opts = append(opts, oss.ACL(oss.ACLPublicRead))
	}

	if err := client.CreateBucket(req.Name, opts...); err != nil {
		return fmt.Errorf("OSS create bucket: %v", err)
	}
	return nil
}

// DeleteBucket deletes an empty OSS bucket.
func (s *Store) DeleteBucket(bucket string) error {
	client, err := s.client()
	if err != nil {
		return err
	}
	if err := client.DeleteBucket(bucket); err != nil {
		return fmt.Errorf("OSS delete bucket: %v", err)
	}
	return nil
}

// GetBucketInfo returns metadata about an OSS bucket.
func (s *Store) GetBucketInfo(bucket string) (*stores.BucketInfo, error) {
	client, err := s.client()
	if err != nil {
		return nil, err
	}

	result, err := client.GetBucketInfo(bucket)
	if err != nil {
		return nil, fmt.Errorf("OSS get bucket info: %v", err)
	}

	bi := result.BucketInfo
	info := &stores.BucketInfo{
		Name:         bi.Name,
		Region:       bi.Location,
		CreatedAt:    bi.CreationDate,
		IsPrivate:    bi.ACL == string(oss.ACLPrivate),
		StorageClass: bi.StorageClass,
		Versioning:   bi.Versioning == "Enabled",
	}
	return info, nil
}

// SetBucketPrivate sets the access control of an OSS bucket.
func (s *Store) SetBucketPrivate(bucket string, isPrivate bool) error {
	client, err := s.client()
	if err != nil {
		return err
	}

	acl := oss.ACLPrivate
	if !isPrivate {
		acl = oss.ACLPublicRead
	}
	if err := client.SetBucketACL(bucket, acl); err != nil {
		return fmt.Errorf("OSS set bucket acl: %v", err)
	}
	return nil
}

// GetBucketDomains returns the domain names bound to an OSS bucket.
// OSS does not expose a direct API for listing bound domains, so an empty
// slice is returned.
func (s *Store) GetBucketDomains(bucket string) ([]string, error) {
	_ = bucket
	return []string{}, nil
}

// ──────────────────────────────────────────────
// Object management
// ──────────────────────────────────────────────

// ListFiles lists objects in an OSS bucket with optional prefix, marker,
// delimiter, and pagination.
func (s *Store) ListFiles(bucket string, req *stores.ListFilesRequest) (*stores.ListFilesResponse, error) {
	bk, err := s.bucketByName(bucket)
	if err != nil {
		return nil, err
	}

	var opts []oss.Option
	if req != nil {
		if req.Prefix != "" {
			opts = append(opts, oss.Prefix(req.Prefix))
		}
		if req.Marker != "" {
			opts = append(opts, oss.Marker(req.Marker))
		}
		if req.Delimiter != "" {
			opts = append(opts, oss.Delimiter(req.Delimiter))
		}
		if req.Limit > 0 {
			opts = append(opts, oss.MaxKeys(req.Limit))
		}
	}

	result, err := bk.ListObjects(opts...)
	if err != nil {
		return nil, fmt.Errorf("OSS list objects: %v", err)
	}

	resp := &stores.ListFilesResponse{
		Marker:         result.NextMarker,
		IsTruncated:    result.IsTruncated,
		CommonPrefixes: result.CommonPrefixes,
	}
	for _, obj := range result.Objects {
		resp.Files = append(resp.Files, stores.FileInfo{
			Key:          obj.Key,
			Size:         obj.Size,
			LastModified: obj.LastModified,
			ETag:         strings.Trim(obj.ETag, `"`),
			StorageClass: obj.StorageClass,
			IsLatest:     true,
			PublicURL:    s.PublicURL(obj.Key),
		})
	}

	return resp, nil
}

// GetFileInfo returns metadata for a single OSS object.
func (s *Store) GetFileInfo(bucket, key string) (*stores.FileInfo, error) {
	bk, err := s.bucketByName(bucket)
	if err != nil {
		return nil, err
	}

	header, err := bk.GetObjectMeta(key)
	if err != nil {
		if strings.Contains(err.Error(), "NoSuchKey") || strings.Contains(err.Error(), "Not Found") {
			return nil, stores.ErrAttachmentNotExist
		}
		return nil, fmt.Errorf("OSS get object meta: %v", err)
	}

	info := &stores.FileInfo{
		Key:       key,
		IsLatest:  true,
		PublicURL: s.PublicURL(key),
	}
	if cl := header.Get(oss.HTTPHeaderContentLength); cl != "" {
		if v, err := strconv.ParseInt(cl, 10, 64); err == nil {
			info.Size = v
		}
	}
	info.ContentType = header.Get(oss.HTTPHeaderContentType)
	info.ETag = strings.Trim(header.Get(oss.HTTPHeaderEtag), `"`)
	if lm := header.Get(oss.HTTPHeaderLastModified); lm != "" {
		if t, err := time.Parse(time.RFC1123, lm); err == nil {
			info.LastModified = t
		}
	}

	return info, nil
}

// UploadFile uploads data to an OSS bucket.
func (s *Store) UploadFile(bucket, key string, reader io.Reader, size int64) error {
	bk, err := s.bucketByName(bucket)
	if err != nil {
		return err
	}

	var opts []oss.Option
	if size > 0 {
		opts = append(opts, oss.ContentLength(size))
	}
	if err := bk.PutObject(key, reader, opts...); err != nil {
		return fmt.Errorf("OSS put object: %v", err)
	}
	return nil
}

// DeleteFile deletes an object from an OSS bucket.
func (s *Store) DeleteFile(bucket, key string) error {
	bk, err := s.bucketByName(bucket)
	if err != nil {
		return err
	}
	if err := bk.DeleteObject(key); err != nil {
		return fmt.Errorf("OSS delete object: %v", err)
	}
	return nil
}

// CopyFile copies an object within or across OSS buckets.
func (s *Store) CopyFile(req *stores.CopyObjectRequest) error {
	if req == nil {
		return fmt.Errorf("OSS copy request is nil")
	}

	srcBucket := s.resolveBucket(req.SrcBucket)
	dstBucket := s.resolveBucket(req.DestBucket)

	dst, err := s.bucketByName(dstBucket)
	if err != nil {
		return err
	}

	var opts []oss.Option
	if req.ContentType != "" {
		opts = append(opts, oss.ContentType(req.ContentType))
		opts = append(opts, oss.MetadataDirective(oss.MetaReplace))
	}
	for k, v := range req.Metadata {
		opts = append(opts, oss.Meta(k, v))
	}

	if _, err := dst.CopyObjectFrom(srcBucket, req.SrcKey, req.DestKey, opts...); err != nil {
		return fmt.Errorf("OSS copy object: %v", err)
	}
	return nil
}

// MoveFile moves (renames) an object within or across OSS buckets.
func (s *Store) MoveFile(req *stores.CopyObjectRequest) error {
	if err := s.CopyFile(req); err != nil {
		return err
	}
	return s.DeleteFile(req.SrcBucket, req.SrcKey)
}

// GetFileURL returns an expiring URL for accessing an OSS object.
func (s *Store) GetFileURL(bucket, key string, expires time.Duration) (string, error) {
	bk, err := s.bucketByName(bucket)
	if err != nil {
		return "", err
	}
	u, err := bk.SignURL(key, oss.HTTPGet, int64(expires/time.Second))
	if err != nil {
		return "", fmt.Errorf("OSS sign url: %v", err)
	}
	return u, nil
}

// ──────────────────────────────────────────────
// Multipart upload
// ──────────────────────────────────────────────

// InitiateMultipartUpload starts a multipart upload and returns an upload ID.
func (s *Store) InitiateMultipartUpload(bucket string, req *stores.InitiateMultipartUploadRequest) (*stores.InitiateMultipartUploadResponse, error) {
	if req == nil {
		return nil, fmt.Errorf("OSS request is nil")
	}
	bk, err := s.bucketByName(bucket)
	if err != nil {
		return nil, err
	}

	var opts []oss.Option
	if req.ContentType != "" {
		opts = append(opts, oss.ContentType(req.ContentType))
	}
	for k, v := range req.Metadata {
		opts = append(opts, oss.Meta(k, v))
	}

	imur, err := bk.InitiateMultipartUpload(req.Key, opts...)
	if err != nil {
		return nil, fmt.Errorf("OSS initiate multipart upload: %v", err)
	}

	return &stores.InitiateMultipartUploadResponse{
		UploadID: imur.UploadID,
		Key:      imur.Key,
	}, nil
}

// UploadPart uploads a single part of a multipart upload.
func (s *Store) UploadPart(bucket, key string, req *stores.UploadPartRequest) (*stores.UploadPartResponse, error) {
	if req == nil {
		return nil, fmt.Errorf("OSS request is nil")
	}
	bk, err := s.bucketByName(bucket)
	if err != nil {
		return nil, err
	}

	imur := oss.InitiateMultipartUploadResult{
		Bucket:   s.resolveBucket(bucket),
		Key:      key,
		UploadID: req.UploadID,
	}

	// Determine the part size from the reader when possible; OSS requires a
	// part size hint. When unknown, use a large value so the full reader is
	// consumed.
	partSize := int64(-1)
	if rs, ok := req.Body.(io.Seeker); ok {
		if pos, err := rs.Seek(0, io.SeekCurrent); err == nil {
			if end, err := rs.Seek(0, io.SeekEnd); err == nil {
				partSize = end - pos
				_, _ = rs.Seek(pos, io.SeekStart)
			}
		}
	}
	if partSize <= 0 {
		// Fallback: read all and use the actual byte count.
		data, rerr := io.ReadAll(req.Body)
		if rerr != nil {
			return nil, fmt.Errorf("OSS read part body: %v", rerr)
		}
		partSize = int64(len(data))
		req.Body = io.NopCloser(strings.NewReader(string(data)))
	}

	part, err := bk.UploadPart(imur, req.Body, partSize, req.PartNumber)
	if err != nil {
		return nil, fmt.Errorf("OSS upload part: %v", err)
	}

	return &stores.UploadPartResponse{
		ETag: strings.Trim(part.ETag, `"`),
	}, nil
}

// CompleteMultipartUpload finalizes a multipart upload by combining all
// uploaded parts.
func (s *Store) CompleteMultipartUpload(bucket, key string, req *stores.CompleteMultipartUploadRequest) (*stores.CompleteMultipartUploadResponse, error) {
	if req == nil {
		return nil, fmt.Errorf("OSS request is nil")
	}
	bk, err := s.bucketByName(bucket)
	if err != nil {
		return nil, err
	}

	imur := oss.InitiateMultipartUploadResult{
		Bucket:   s.resolveBucket(bucket),
		Key:      key,
		UploadID: req.UploadID,
	}

	var parts []oss.UploadPart
	for _, p := range req.Parts {
		parts = append(parts, oss.UploadPart{
			PartNumber: p.PartNumber,
			ETag:       p.ETag,
		})
	}

	result, err := bk.CompleteMultipartUpload(imur, parts)
	if err != nil {
		return nil, fmt.Errorf("OSS complete multipart upload: %v", err)
	}

	return &stores.CompleteMultipartUploadResponse{
		Location: result.Location,
		Bucket:   result.Bucket,
		Key:      result.Key,
		ETag:     strings.Trim(result.ETag, `"`),
	}, nil
}

// AbortMultipartUpload cancels a multipart upload and discards uploaded parts.
func (s *Store) AbortMultipartUpload(bucket, key, uploadID string) error {
	bk, err := s.bucketByName(bucket)
	if err != nil {
		return err
	}

	imur := oss.InitiateMultipartUploadResult{
		Bucket:   s.resolveBucket(bucket),
		Key:      key,
		UploadID: uploadID,
	}

	if err := bk.AbortMultipartUpload(imur); err != nil {
		return fmt.Errorf("OSS abort multipart upload: %v", err)
	}
	return nil
}

// ListParts lists the parts that have been uploaded for a multipart upload.
func (s *Store) ListParts(bucket, key string, req *stores.ListPartsRequest) (*stores.ListPartsResponse, error) {
	if req == nil {
		return nil, fmt.Errorf("OSS request is nil")
	}
	bk, err := s.bucketByName(bucket)
	if err != nil {
		return nil, err
	}

	imur := oss.InitiateMultipartUploadResult{
		Bucket:   s.resolveBucket(bucket),
		Key:      key,
		UploadID: req.UploadID,
	}

	var opts []oss.Option
	if req.MaxParts > 0 {
		opts = append(opts, oss.MaxParts(req.MaxParts))
	}
	if req.PartNumberMarker > 0 {
		opts = append(opts, oss.PartNumberMarker(req.PartNumberMarker))
	}

	result, err := bk.ListUploadedParts(imur, opts...)
	if err != nil {
		return nil, fmt.Errorf("OSS list parts: %v", err)
	}

	resp := &stores.ListPartsResponse{
		Bucket:           result.Bucket,
		Key:              result.Key,
		UploadID:         result.UploadID,
		MaxParts:         result.MaxParts,
		IsTruncated:      result.IsTruncated,
		PartNumberMarker: req.PartNumberMarker,
	}
	if next := result.NextPartNumberMarker; next != "" {
		if v, err := strconv.Atoi(next); err == nil {
			resp.NextPartNumberMarker = v
		}
	}
	for _, p := range result.UploadedParts {
		resp.Parts = append(resp.Parts, stores.CompletedPart{
			PartNumber: p.PartNumber,
			ETag:       strings.Trim(p.ETag, `"`),
		})
	}

	return resp, nil
}
