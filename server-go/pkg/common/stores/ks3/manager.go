// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// KS3 ObjectStorageManager + MultipartUploader implementation.

package ks3

import (
	"bytes"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common/stores"

	ks3aws "github.com/ks3sdklib/aws-sdk-go/aws"
	ks3s3 "github.com/ks3sdklib/aws-sdk-go/service/s3"
)

// ──────────────────────────────────────────────
// Bucket management
// ──────────────────────────────────────────────

// resolveBucket returns the configured bucket name when the given bucket
// is empty, otherwise it returns the given bucket unchanged.
func (s *Store) resolveBucket(bucket string) string {
	if bucket == "" {
		return s.cfg.BucketName
	}
	return bucket
}

// ListBuckets lists all KS3 buckets accessible by the configured credentials.
func (s *Store) ListBuckets(req *stores.ListBucketsRequest) (*stores.ListBucketsResponse, error) {
	client := s.client()

	input := &ks3s3.ListBucketsInput{}
	if req != nil {
		if req.Prefix != "" {
			input.Prefixes = []string{req.Prefix}
		}
		if req.Region != "" {
			input.Regions = []string{req.Region}
		}
	}

	out, err := client.ListBuckets(input)
	if err != nil {
		return nil, fmt.Errorf("failed to list KS3 buckets: %w", err)
	}

	var buckets []stores.BucketInfo
	for _, b := range out.Buckets {
		name := ks3aws.ToString(b.Name)
		if req != nil && req.Prefix != "" && !strings.HasPrefix(name, req.Prefix) {
			continue
		}
		created := time.Now()
		if b.CreationDate != nil {
			created = *b.CreationDate
		}
		info := stores.BucketInfo{
			Name:      name,
			CreatedAt: created,
		}
		if b.Region != nil {
			info.Region = ks3aws.ToString(b.Region)
		}
		buckets = append(buckets, info)
	}

	if req != nil && req.MaxKeys > 0 && len(buckets) > req.MaxKeys {
		buckets = buckets[:req.MaxKeys]
	}

	return &stores.ListBucketsResponse{Buckets: buckets}, nil
}

// CreateBucket creates a new KS3 bucket.
func (s *Store) CreateBucket(req *stores.CreateBucketRequest) error {
	if req == nil || req.Name == "" {
		return fmt.Errorf("bucket name is required")
	}
	client := s.client()

	input := &ks3s3.CreateBucketInput{
		Bucket: ks3aws.String(req.Name),
	}
	if req.Region != "" {
		input.CreateBucketConfiguration = &ks3s3.CreateBucketConfiguration{
			LocationConstraint: ks3aws.String(req.Region),
		}
	}
	if req.IsPrivate {
		input.ACL = ks3aws.String("private")
	} else {
		input.ACL = ks3aws.String("public-read")
	}

	if _, err := client.CreateBucket(input); err != nil {
		return fmt.Errorf("failed to create KS3 bucket: %w", err)
	}
	return nil
}

// DeleteBucket deletes an empty KS3 bucket.
func (s *Store) DeleteBucket(bucket string) error {
	client := s.client()
	if _, err := client.DeleteBucket(&ks3s3.DeleteBucketInput{
		Bucket: ks3aws.String(bucket),
	}); err != nil {
		return fmt.Errorf("failed to delete KS3 bucket: %w", err)
	}
	return nil
}

// GetBucketInfo returns metadata about a KS3 bucket.
func (s *Store) GetBucketInfo(bucket string) (*stores.BucketInfo, error) {
	client := s.client()

	locOut, err := client.GetBucketLocation(&ks3s3.GetBucketLocationInput{
		Bucket: ks3aws.String(bucket),
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get KS3 bucket location: %w", err)
	}

	region := ks3aws.ToString(locOut.LocationConstraint)
	if region == "" {
		region = s.cfg.Region
	}

	info := &stores.BucketInfo{
		Name:   bucket,
		Region: region,
	}

	// Try to get bucket tagging (may fail if no tags are configured).
	tagOut, err := client.GetBucketTagging(&ks3s3.GetBucketTaggingInput{
		Bucket: ks3aws.String(bucket),
	})
	if err == nil && tagOut != nil && tagOut.Tagging != nil {
		tags := make(map[string]string, len(tagOut.Tagging.TagSet))
		for _, t := range tagOut.Tagging.TagSet {
			tags[ks3aws.ToString(t.Key)] = ks3aws.ToString(t.Value)
		}
		info.Tags = tags
	}

	return info, nil
}

// SetBucketPrivate sets the ACL of a KS3 bucket.
func (s *Store) SetBucketPrivate(bucket string, isPrivate bool) error {
	client := s.client()

	acl := "private"
	if !isPrivate {
		acl = "public-read"
	}
	if _, err := client.PutBucketACL(&ks3s3.PutBucketACLInput{
		Bucket: ks3aws.String(bucket),
		ACL:    ks3aws.String(acl),
	}); err != nil {
		return fmt.Errorf("failed to set KS3 bucket ACL: %w", err)
	}
	return nil
}

// GetBucketDomains returns the domain names associated with a KS3 bucket.
// For KS3, this returns the configured custom domain (if any) and the
// default bucket endpoint.
func (s *Store) GetBucketDomains(bucket string) ([]string, error) {
	var domains []string

	if s.cfg.Domain != "" {
		domain := strings.TrimSuffix(s.cfg.Domain, "/")
		if !strings.HasPrefix(domain, "http://") && !strings.HasPrefix(domain, "https://") {
			domain = "https://" + domain
		}
		domains = append(domains, domain)
	}

	endpoint := strings.TrimPrefix(strings.TrimPrefix(s.cfg.Endpoint, "https://"), "http://")
	if endpoint != "" {
		domains = append(domains, fmt.Sprintf("https://%s.%s", bucket, endpoint))
	}

	return domains, nil
}

// ──────────────────────────────────────────────
// Object management
// ──────────────────────────────────────────────

// ListFiles lists objects in a KS3 bucket.
func (s *Store) ListFiles(bucket string, req *stores.ListFilesRequest) (*stores.ListFilesResponse, error) {
	bucket = s.resolveBucket(bucket)
	client := s.client()

	input := &ks3s3.ListObjectsInput{
		Bucket: ks3aws.String(bucket),
	}
	if req != nil {
		if req.Prefix != "" {
			input.Prefix = ks3aws.String(req.Prefix)
		}
		if req.Delimiter != "" {
			input.Delimiter = ks3aws.String(req.Delimiter)
		}
		if req.Limit > 0 {
			input.MaxKeys = ks3aws.Long(int64(req.Limit))
		}
		if req.Marker != "" {
			input.Marker = ks3aws.String(req.Marker)
		}
	}

	out, err := client.ListObjects(input)
	if err != nil {
		return nil, fmt.Errorf("failed to list KS3 objects: %w", err)
	}

	resp := &stores.ListFilesResponse{
		IsTruncated: ks3aws.ToBoolean(out.IsTruncated),
	}
	if out.NextMarker != nil {
		resp.Marker = ks3aws.ToString(out.NextMarker)
	} else if out.IsTruncated != nil && *out.IsTruncated && len(out.Contents) > 0 {
		// Without a delimiter, use the last key as the next marker.
		resp.Marker = ks3aws.ToString(out.Contents[len(out.Contents)-1].Key)
	}

	for _, obj := range out.Contents {
		file := stores.FileInfo{
			Key:       ks3aws.ToString(obj.Key),
			ETag:      ks3aws.ToString(obj.ETag),
			IsLatest:  true,
			PublicURL: s.PublicURL(ks3aws.ToString(obj.Key)),
		}
		if obj.Size != nil {
			file.Size = *obj.Size
		}
		if obj.LastModified != nil {
			file.LastModified = *obj.LastModified
		}
		if obj.StorageClass != nil {
			file.StorageClass = ks3aws.ToString(obj.StorageClass)
		}
		resp.Files = append(resp.Files, file)
	}

	for _, prefix := range out.CommonPrefixes {
		resp.CommonPrefixes = append(resp.CommonPrefixes, ks3aws.ToString(prefix.Prefix))
	}

	return resp, nil
}

// GetFileInfo returns metadata for a single KS3 object.
func (s *Store) GetFileInfo(bucket, key string) (*stores.FileInfo, error) {
	bucket = s.resolveBucket(bucket)
	client := s.client()

	out, err := client.HeadObject(&ks3s3.HeadObjectInput{
		Bucket: ks3aws.String(bucket),
		Key:    ks3aws.String(key),
	})
	if err != nil {
		if strings.Contains(err.Error(), "NotFound") || strings.Contains(err.Error(), "404") || strings.Contains(err.Error(), "NoSuchKey") {
			return nil, stores.ErrAttachmentNotExist
		}
		return nil, fmt.Errorf("failed to head KS3 object: %w", err)
	}

	info := &stores.FileInfo{
		Key:       key,
		PublicURL: s.PublicURL(key),
		IsLatest:  true,
	}
	if out.ContentLength != nil {
		info.Size = *out.ContentLength
	}
	if out.LastModified != nil {
		info.LastModified = *out.LastModified
	}
	if out.ETag != nil {
		info.ETag = ks3aws.ToString(out.ETag)
	}
	if out.ContentType != nil {
		info.ContentType = ks3aws.ToString(out.ContentType)
	}
	if out.VersionID != nil {
		info.VersionID = ks3aws.ToString(out.VersionID)
	}
	if out.Metadata != nil {
		info.Metadata = make(map[string]string, len(out.Metadata))
		for k, v := range out.Metadata {
			if v != nil {
				info.Metadata[k] = *v
			}
		}
	}

	return info, nil
}

// UploadFile uploads data to a KS3 bucket.
func (s *Store) UploadFile(bucket, key string, reader io.Reader, size int64) error {
	bucket = s.resolveBucket(bucket)
	data, err := io.ReadAll(reader)
	if err != nil {
		return fmt.Errorf("failed to read upload body: %w", err)
	}
	client := s.client()

	input := &ks3s3.PutObjectInput{
		Bucket: ks3aws.String(bucket),
		Key:    ks3aws.String(key),
		Body:   bytes.NewReader(data),
	}
	if size > 0 {
		input.ContentLength = ks3aws.Long(size)
	}

	if _, err := client.PutObject(input); err != nil {
		return fmt.Errorf("failed to upload object to KS3: %w", err)
	}
	return nil
}

// DeleteFile deletes an object from a KS3 bucket.
func (s *Store) DeleteFile(bucket, key string) error {
	bucket = s.resolveBucket(bucket)
	client := s.client()

	if _, err := client.DeleteObject(&ks3s3.DeleteObjectInput{
		Bucket: ks3aws.String(bucket),
		Key:    ks3aws.String(key),
	}); err != nil {
		return fmt.Errorf("failed to delete object from KS3: %w", err)
	}
	return nil
}

// CopyFile copies an object within or across KS3 buckets.
func (s *Store) CopyFile(req *stores.CopyObjectRequest) error {
	if req == nil {
		return fmt.Errorf("copy request is nil")
	}
	client := s.client()

	srcBucket := s.resolveBucket(req.SrcBucket)
	dstBucket := s.resolveBucket(req.DestBucket)

	input := &ks3s3.CopyObjectInput{
		Bucket:       ks3aws.String(dstBucket),
		Key:          ks3aws.String(req.DestKey),
		SourceBucket: ks3aws.String(srcBucket),
		SourceKey:    ks3aws.String(req.SrcKey),
	}
	if req.ContentType != "" {
		input.ContentType = ks3aws.String(req.ContentType)
		input.MetadataDirective = ks3aws.String("REPLACE")
	}
	if req.Metadata != nil {
		input.Metadata = make(map[string]*string, len(req.Metadata))
		for k, v := range req.Metadata {
			val := v
			input.Metadata[k] = &val
		}
	}

	if _, err := client.CopyObject(input); err != nil {
		return fmt.Errorf("failed to copy object in KS3: %w", err)
	}
	return nil
}

// MoveFile moves an object within or across KS3 buckets.
func (s *Store) MoveFile(req *stores.CopyObjectRequest) error {
	if err := s.CopyFile(req); err != nil {
		return err
	}
	return s.DeleteFile(req.SrcBucket, req.SrcKey)
}

// GetFileURL returns an expiring URL for accessing a KS3 object.
func (s *Store) GetFileURL(bucket, key string, expires time.Duration) (string, error) {
	bucket = s.resolveBucket(bucket)
	client := s.client()

	u, err := client.GeneratePresignedUrl(&ks3s3.GeneratePresignedUrlInput{
		Bucket:     ks3aws.String(bucket),
		Key:        ks3aws.String(key),
		HTTPMethod: ks3s3.GET,
		Expires:    int64(expires / time.Second),
	})
	if err != nil {
		return "", fmt.Errorf("failed to presign KS3 get: %w", err)
	}
	return u, nil
}

// ──────────────────────────────────────────────
// Multipart upload
// ──────────────────────────────────────────────

// InitiateMultipartUpload starts a multipart upload and returns an upload ID.
func (s *Store) InitiateMultipartUpload(bucket string, req *stores.InitiateMultipartUploadRequest) (*stores.InitiateMultipartUploadResponse, error) {
	if req == nil {
		return nil, fmt.Errorf("request is nil")
	}
	bucket = s.resolveBucket(bucket)
	client := s.client()

	input := &ks3s3.CreateMultipartUploadInput{
		Bucket: ks3aws.String(bucket),
		Key:    ks3aws.String(req.Key),
	}
	if req.ContentType != "" {
		input.ContentType = ks3aws.String(req.ContentType)
	}
	if req.Metadata != nil {
		input.Metadata = make(map[string]*string, len(req.Metadata))
		for k, v := range req.Metadata {
			val := v
			input.Metadata[k] = &val
		}
	}

	out, err := client.CreateMultipartUpload(input)
	if err != nil {
		return nil, fmt.Errorf("failed to initiate KS3 multipart upload: %w", err)
	}

	return &stores.InitiateMultipartUploadResponse{
		UploadID: ks3aws.ToString(out.UploadID),
		Key:      req.Key,
	}, nil
}

// UploadPart uploads a single part of a multipart upload.
func (s *Store) UploadPart(bucket, key string, req *stores.UploadPartRequest) (*stores.UploadPartResponse, error) {
	if req == nil {
		return nil, fmt.Errorf("request is nil")
	}
	bucket = s.resolveBucket(bucket)
	client := s.client()

	data, err := io.ReadAll(req.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read part body: %w", err)
	}

	out, err := client.UploadPart(&ks3s3.UploadPartInput{
		Bucket:     ks3aws.String(bucket),
		Key:        ks3aws.String(key),
		UploadID:   ks3aws.String(req.UploadID),
		PartNumber: ks3aws.Long(int64(req.PartNumber)),
		Body:       bytes.NewReader(data),
	})
	if err != nil {
		return nil, fmt.Errorf("failed to upload part to KS3: %w", err)
	}

	return &stores.UploadPartResponse{
		ETag: ks3aws.ToString(out.ETag),
	}, nil
}

// CompleteMultipartUpload finalizes a multipart upload by combining all
// uploaded parts.
func (s *Store) CompleteMultipartUpload(bucket, key string, req *stores.CompleteMultipartUploadRequest) (*stores.CompleteMultipartUploadResponse, error) {
	if req == nil {
		return nil, fmt.Errorf("request is nil")
	}
	bucket = s.resolveBucket(bucket)
	client := s.client()

	var parts []*ks3s3.CompletedPart
	for _, p := range req.Parts {
		parts = append(parts, &ks3s3.CompletedPart{
			ETag:       ks3aws.String(p.ETag),
			PartNumber: ks3aws.Long(int64(p.PartNumber)),
		})
	}

	out, err := client.CompleteMultipartUpload(&ks3s3.CompleteMultipartUploadInput{
		Bucket:          ks3aws.String(bucket),
		Key:             ks3aws.String(key),
		UploadID:        ks3aws.String(req.UploadID),
		MultipartUpload: &ks3s3.CompletedMultipartUpload{Parts: parts},
	})
	if err != nil {
		return nil, fmt.Errorf("failed to complete KS3 multipart upload: %w", err)
	}

	resp := &stores.CompleteMultipartUploadResponse{
		Bucket: bucket,
		Key:    key,
	}
	if out.Location != nil {
		resp.Location = ks3aws.ToString(out.Location)
	}
	if out.ETag != nil {
		resp.ETag = ks3aws.ToString(out.ETag)
	}
	return resp, nil
}

// AbortMultipartUpload cancels a multipart upload and discards uploaded parts.
func (s *Store) AbortMultipartUpload(bucket, key, uploadID string) error {
	bucket = s.resolveBucket(bucket)
	client := s.client()

	if _, err := client.AbortMultipartUpload(&ks3s3.AbortMultipartUploadInput{
		Bucket:   ks3aws.String(bucket),
		Key:      ks3aws.String(key),
		UploadID: ks3aws.String(uploadID),
	}); err != nil {
		return fmt.Errorf("failed to abort KS3 multipart upload: %w", err)
	}
	return nil
}

// ListParts lists the parts that have been uploaded for a multipart upload.
func (s *Store) ListParts(bucket, key string, req *stores.ListPartsRequest) (*stores.ListPartsResponse, error) {
	if req == nil {
		return nil, fmt.Errorf("request is nil")
	}
	bucket = s.resolveBucket(bucket)
	client := s.client()

	input := &ks3s3.ListPartsInput{
		Bucket:   ks3aws.String(bucket),
		Key:      ks3aws.String(key),
		UploadID: ks3aws.String(req.UploadID),
	}
	if req.MaxParts > 0 {
		input.MaxParts = ks3aws.Long(int64(req.MaxParts))
	}
	if req.PartNumberMarker > 0 {
		input.PartNumberMarker = ks3aws.Long(int64(req.PartNumberMarker))
	}

	out, err := client.ListParts(input)
	if err != nil {
		return nil, fmt.Errorf("failed to list KS3 parts: %w", err)
	}

	resp := &stores.ListPartsResponse{
		Bucket:      bucket,
		Key:         key,
		UploadID:    req.UploadID,
		IsTruncated: ks3aws.ToBoolean(out.IsTruncated),
	}
	if out.MaxParts != nil {
		resp.MaxParts = int(*out.MaxParts)
	}
	if out.PartNumberMarker != nil {
		resp.PartNumberMarker = int(*out.PartNumberMarker)
	}
	if out.NextPartNumberMarker != nil {
		resp.NextPartNumberMarker = int(*out.NextPartNumberMarker)
	}

	for _, p := range out.Parts {
		resp.Parts = append(resp.Parts, stores.CompletedPart{
			PartNumber: int(ks3aws.ToLong(p.PartNumber)),
			ETag:       ks3aws.ToString(p.ETag),
		})
	}

	return resp, nil
}
