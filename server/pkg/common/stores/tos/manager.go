// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// TOS ObjectStorageManager + MultipartUploader implementation.

package tos

import (
	"context"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common/stores"

	"github.com/volcengine/ve-tos-golang-sdk/v2/tos"
	"github.com/volcengine/ve-tos-golang-sdk/v2/tos/enum"
)

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

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

// ListBuckets lists all TOS buckets accessible by the configured credentials.
func (s *Store) ListBuckets(req *stores.ListBucketsRequest) (*stores.ListBucketsResponse, error) {
	ctx := context.Background()
	client, err := s.client(ctx)
	if err != nil {
		return nil, err
	}

	out, err := client.ListBuckets(ctx, &tos.ListBucketsInput{})
	if err != nil {
		return nil, fmt.Errorf("TOS list buckets: %w", err)
	}

	var buckets []stores.BucketInfo
	for _, b := range out.Buckets {
		name := b.Name
		if req != nil && req.Prefix != "" && !strings.HasPrefix(name, req.Prefix) {
			continue
		}
		created := time.Now()
		if t, err := time.Parse(time.RFC3339, b.CreationDate); err == nil {
			created = t
		}
		buckets = append(buckets, stores.BucketInfo{
			Name:      name,
			Region:    b.Location,
			CreatedAt: created,
		})
	}

	if req != nil && req.MaxKeys > 0 && len(buckets) > req.MaxKeys {
		buckets = buckets[:req.MaxKeys]
	}

	return &stores.ListBucketsResponse{Buckets: buckets}, nil
}

// CreateBucket creates a new TOS bucket.
func (s *Store) CreateBucket(req *stores.CreateBucketRequest) error {
	if req == nil || req.Name == "" {
		return fmt.Errorf("TOS: bucket name is required")
	}
	ctx := context.Background()
	client, err := s.client(ctx)
	if err != nil {
		return err
	}

	input := &tos.CreateBucketV2Input{
		Bucket: req.Name,
	}
	if req.IsPrivate {
		input.ACL = enum.ACLPrivate
	} else {
		input.ACL = enum.ACLPublicRead
	}
	if req.StorageClass != "" {
		input.StorageClass = enum.StorageClassType(req.StorageClass)
	}

	if _, err = client.CreateBucketV2(ctx, input); err != nil {
		return fmt.Errorf("TOS create bucket: %w", err)
	}

	// Apply tags if provided.
	if len(req.Tags) > 0 {
		var tagSet tos.TagSet
		for k, v := range req.Tags {
			tagSet.Tags = append(tagSet.Tags, tos.Tag{Key: k, Value: v})
		}
		if _, err = client.PutBucketTagging(ctx, &tos.PutBucketTaggingInput{
			Bucket: req.Name,
			TagSet: tagSet,
		}); err != nil {
			return fmt.Errorf("TOS put bucket tagging: %w", err)
		}
	}

	return nil
}

// DeleteBucket deletes an empty TOS bucket.
func (s *Store) DeleteBucket(bucket string) error {
	ctx := context.Background()
	client, err := s.client(ctx)
	if err != nil {
		return err
	}
	if _, err = client.DeleteBucket(ctx, &tos.DeleteBucketInput{Bucket: bucket}); err != nil {
		return fmt.Errorf("TOS delete bucket: %w", err)
	}
	return nil
}

// GetBucketInfo returns metadata about a TOS bucket.
func (s *Store) GetBucketInfo(bucket string) (*stores.BucketInfo, error) {
	ctx := context.Background()
	client, err := s.client(ctx)
	if err != nil {
		return nil, err
	}

	locOut, err := client.GetBucketLocation(ctx, &tos.GetBucketLocationInput{Bucket: bucket})
	if err != nil {
		return nil, fmt.Errorf("TOS get bucket location: %w", err)
	}

	info := &stores.BucketInfo{
		Name:   bucket,
		Region: locOut.Region,
	}

	// Try to get bucket ACL to determine privacy. Default to private.
	info.IsPrivate = true
	aclOut, err := client.GetBucketACL(ctx, &tos.GetBucketACLInput{Bucket: bucket})
	if err == nil && aclOut != nil {
		for _, g := range aclOut.Grants {
			if (g.Permission == enum.PermissionRead || g.Permission == enum.PermissionFullControl) &&
				g.GranteeV2.Type == enum.GranteeGroup && g.GranteeV2.Canned == enum.CannedAllUsers {
				// If anyone (AllUsers) has read access, treat as non-private.
				info.IsPrivate = false
				break
			}
		}
	}

	// Try to get bucket tagging (may fail if no tags).
	tagOut, err := client.GetBucketTagging(ctx, &tos.GetBucketTaggingInput{Bucket: bucket})
	if err == nil && tagOut != nil {
		tags := make(map[string]string, len(tagOut.TagSet.Tags))
		for _, t := range tagOut.TagSet.Tags {
			tags[t.Key] = t.Value
		}
		info.Tags = tags
	}

	return info, nil
}

// SetBucketPrivate sets the ACL of a TOS bucket.
func (s *Store) SetBucketPrivate(bucket string, isPrivate bool) error {
	ctx := context.Background()
	client, err := s.client(ctx)
	if err != nil {
		return err
	}

	acl := enum.ACLPublicRead
	if isPrivate {
		acl = enum.ACLPrivate
	}
	if _, err = client.PutBucketACL(ctx, &tos.PutBucketACLInput{
		Bucket:  bucket,
		ACLType: acl,
	}); err != nil {
		return fmt.Errorf("TOS set bucket acl: %w", err)
	}
	return nil
}

// GetBucketDomains returns the domain names associated with a TOS bucket.
// For TOS, this returns the bucket's extranet endpoint if available.
func (s *Store) GetBucketDomains(bucket string) ([]string, error) {
	ctx := context.Background()
	client, err := s.client(ctx)
	if err != nil {
		return nil, err
	}

	var domains []string
	locOut, err := client.GetBucketLocation(ctx, &tos.GetBucketLocationInput{Bucket: bucket})
	if err == nil && locOut != nil && locOut.ExtranetEndpoint != "" {
		domains = append(domains, locOut.ExtranetEndpoint)
	}

	return domains, nil
}

// ──────────────────────────────────────────────
// Object management
// ──────────────────────────────────────────────

// ListFiles lists objects in a TOS bucket.
func (s *Store) ListFiles(bucket string, req *stores.ListFilesRequest) (*stores.ListFilesResponse, error) {
	ctx := context.Background()
	client, err := s.client(ctx)
	if err != nil {
		return nil, err
	}

	bucket = s.resolveBucket(bucket)
	input := &tos.ListObjectsV2Input{
		Bucket: bucket,
	}
	if req != nil {
		if req.Prefix != "" {
			input.Prefix = req.Prefix
		}
		if req.Delimiter != "" {
			input.Delimiter = req.Delimiter
		}
		if req.Limit > 0 {
			input.MaxKeys = req.Limit
		}
		if req.Marker != "" {
			input.Marker = req.Marker
		}
	}

	out, err := client.ListObjectsV2(ctx, input)
	if err != nil {
		return nil, fmt.Errorf("TOS list objects: %w", err)
	}

	resp := &stores.ListFilesResponse{
		IsTruncated: out.IsTruncated,
		Marker:      out.NextMarker,
	}

	for _, obj := range out.Contents {
		resp.Files = append(resp.Files, stores.FileInfo{
			Key:          obj.Key,
			Size:         obj.Size,
			LastModified: obj.LastModified,
			ETag:         obj.ETag,
			StorageClass: string(obj.StorageClass),
			IsLatest:     true,
			PublicURL:    s.PublicURL(obj.Key),
		})
	}

	for _, prefix := range out.CommonPrefixes {
		resp.CommonPrefixes = append(resp.CommonPrefixes, prefix.Prefix)
	}

	return resp, nil
}

// GetFileInfo returns metadata for a single TOS object.
func (s *Store) GetFileInfo(bucket, key string) (*stores.FileInfo, error) {
	ctx := context.Background()
	client, err := s.client(ctx)
	if err != nil {
		return nil, err
	}

	bucket = s.resolveBucket(bucket)
	out, err := client.HeadObjectV2(ctx, &tos.HeadObjectV2Input{
		Bucket: bucket,
		Key:    key,
	})
	if err != nil {
		if strings.Contains(err.Error(), "404") || strings.Contains(strings.ToLower(err.Error()), "not found") {
			return nil, stores.ErrAttachmentNotExist
		}
		return nil, fmt.Errorf("TOS head object: %w", err)
	}

	info := &stores.FileInfo{
		Key:          key,
		Size:         out.ContentLength,
		LastModified: out.LastModified,
		ETag:         out.ETag,
		ContentType:  out.ContentType,
		StorageClass: string(out.StorageClass),
		VersionID:    out.VersionID,
		IsLatest:     true,
		PublicURL:    s.PublicURL(key),
	}
	if out.Meta != nil {
		info.Metadata = make(map[string]string)
		out.Meta.Range(func(k, v string) bool {
			info.Metadata[k] = v
			return true
		})
	}

	return info, nil
}

// UploadFile uploads data to a TOS bucket.
func (s *Store) UploadFile(bucket, key string, reader io.Reader, size int64) error {
	ctx := context.Background()
	client, err := s.client(ctx)
	if err != nil {
		return err
	}

	bucket = s.resolveBucket(bucket)
	input := &tos.PutObjectV2Input{
		PutObjectBasicInput: tos.PutObjectBasicInput{
			Bucket:        bucket,
			Key:           key,
			ContentLength: size,
		},
		Content: reader,
	}

	if _, err = client.PutObjectV2(ctx, input); err != nil {
		return fmt.Errorf("TOS put object: %w", err)
	}
	return nil
}

// DeleteFile deletes an object from a TOS bucket.
func (s *Store) DeleteFile(bucket, key string) error {
	ctx := context.Background()
	client, err := s.client(ctx)
	if err != nil {
		return err
	}

	bucket = s.resolveBucket(bucket)
	if _, err = client.DeleteObjectV2(ctx, &tos.DeleteObjectV2Input{
		Bucket: bucket,
		Key:    key,
	}); err != nil {
		return fmt.Errorf("TOS delete object: %w", err)
	}
	return nil
}

// CopyFile copies an object within or across TOS buckets.
func (s *Store) CopyFile(req *stores.CopyObjectRequest) error {
	if req == nil {
		return fmt.Errorf("TOS: copy request is nil")
	}
	ctx := context.Background()
	client, err := s.client(ctx)
	if err != nil {
		return err
	}

	srcBucket := s.resolveBucket(req.SrcBucket)
	dstBucket := s.resolveBucket(req.DestBucket)

	input := &tos.CopyObjectInput{
		Bucket:    dstBucket,
		Key:       req.DestKey,
		SrcBucket: srcBucket,
		SrcKey:    req.SrcKey,
	}
	if req.ContentType != "" {
		input.ContentType = req.ContentType
		input.MetadataDirective = enum.MetadataDirectiveReplace
	}
	if len(req.Metadata) > 0 {
		input.Meta = req.Metadata
		input.MetadataDirective = enum.MetadataDirectiveReplace
	}

	if _, err = client.CopyObject(ctx, input); err != nil {
		return fmt.Errorf("TOS copy object: %w", err)
	}
	return nil
}

// MoveFile moves an object within or across TOS buckets.
func (s *Store) MoveFile(req *stores.CopyObjectRequest) error {
	if err := s.CopyFile(req); err != nil {
		return err
	}
	return s.DeleteFile(req.SrcBucket, req.SrcKey)
}

// GetFileURL returns an expiring URL for a TOS object.
func (s *Store) GetFileURL(bucket, key string, expires time.Duration) (string, error) {
	client, err := s.client(context.Background())
	if err != nil {
		return "", err
	}

	bucket = s.resolveBucket(bucket)
	out, err := client.PreSignedURL(&tos.PreSignedURLInput{
		HTTPMethod: enum.HttpMethodGet,
		Bucket:     bucket,
		Key:        key,
		Expires:    int64(expires / time.Second),
	})
	if err != nil {
		return "", fmt.Errorf("TOS presign get: %w", err)
	}
	return out.SignedUrl, nil
}

// ──────────────────────────────────────────────
// Multipart upload
// ──────────────────────────────────────────────

// InitiateMultipartUpload starts a multipart upload.
func (s *Store) InitiateMultipartUpload(bucket string, req *stores.InitiateMultipartUploadRequest) (*stores.InitiateMultipartUploadResponse, error) {
	if req == nil {
		return nil, fmt.Errorf("TOS: request is nil")
	}
	ctx := context.Background()
	client, err := s.client(ctx)
	if err != nil {
		return nil, err
	}

	bucket = s.resolveBucket(bucket)
	input := &tos.CreateMultipartUploadV2Input{
		Bucket: bucket,
		Key:    req.Key,
	}
	if req.ContentType != "" {
		input.ContentType = req.ContentType
	}
	if len(req.Metadata) > 0 {
		input.Meta = req.Metadata
	}

	out, err := client.CreateMultipartUploadV2(ctx, input)
	if err != nil {
		return nil, fmt.Errorf("TOS create multipart upload: %w", err)
	}

	return &stores.InitiateMultipartUploadResponse{
		UploadID: out.UploadID,
		Key:      req.Key,
	}, nil
}

// UploadPart uploads a single part of a multipart upload.
func (s *Store) UploadPart(bucket, key string, req *stores.UploadPartRequest) (*stores.UploadPartResponse, error) {
	if req == nil {
		return nil, fmt.Errorf("TOS: request is nil")
	}
	ctx := context.Background()
	client, err := s.client(ctx)
	if err != nil {
		return nil, err
	}

	bucket = s.resolveBucket(bucket)
	out, err := client.UploadPartV2(ctx, &tos.UploadPartV2Input{
		UploadPartBasicInput: tos.UploadPartBasicInput{
			Bucket:     bucket,
			Key:        key,
			UploadID:   req.UploadID,
			PartNumber: req.PartNumber,
		},
		Content: req.Body,
	})
	if err != nil {
		return nil, fmt.Errorf("TOS upload part: %w", err)
	}

	return &stores.UploadPartResponse{
		ETag: out.ETag,
	}, nil
}

// CompleteMultipartUpload finalizes a multipart upload.
func (s *Store) CompleteMultipartUpload(bucket, key string, req *stores.CompleteMultipartUploadRequest) (*stores.CompleteMultipartUploadResponse, error) {
	if req == nil {
		return nil, fmt.Errorf("TOS: request is nil")
	}
	ctx := context.Background()
	client, err := s.client(ctx)
	if err != nil {
		return nil, err
	}

	bucket = s.resolveBucket(bucket)
	var parts []tos.UploadedPartV2
	for _, p := range req.Parts {
		parts = append(parts, tos.UploadedPartV2{
			PartNumber: p.PartNumber,
			ETag:       p.ETag,
		})
	}

	out, err := client.CompleteMultipartUploadV2(ctx, &tos.CompleteMultipartUploadV2Input{
		Bucket:   bucket,
		Key:      key,
		UploadID: req.UploadID,
		Parts:    parts,
	})
	if err != nil {
		return nil, fmt.Errorf("TOS complete multipart upload: %w", err)
	}

	return &stores.CompleteMultipartUploadResponse{
		Location: out.Location,
		Bucket:   bucket,
		Key:      key,
		ETag:     out.ETag,
	}, nil
}

// AbortMultipartUpload cancels a multipart upload.
func (s *Store) AbortMultipartUpload(bucket, key, uploadID string) error {
	ctx := context.Background()
	client, err := s.client(ctx)
	if err != nil {
		return err
	}

	bucket = s.resolveBucket(bucket)
	if _, err = client.AbortMultipartUpload(ctx, &tos.AbortMultipartUploadInput{
		Bucket:   bucket,
		Key:      key,
		UploadID: uploadID,
	}); err != nil {
		return fmt.Errorf("TOS abort multipart upload: %w", err)
	}
	return nil
}

// ListParts lists the parts of a multipart upload.
func (s *Store) ListParts(bucket, key string, req *stores.ListPartsRequest) (*stores.ListPartsResponse, error) {
	if req == nil {
		return nil, fmt.Errorf("TOS: request is nil")
	}
	ctx := context.Background()
	client, err := s.client(ctx)
	if err != nil {
		return nil, err
	}

	bucket = s.resolveBucket(bucket)
	input := &tos.ListPartsInput{
		Bucket:   bucket,
		Key:      key,
		UploadID: req.UploadID,
	}
	if req.MaxParts > 0 {
		input.MaxParts = req.MaxParts
	}
	if req.PartNumberMarker > 0 {
		input.PartNumberMarker = req.PartNumberMarker
	}

	out, err := client.ListParts(ctx, input)
	if err != nil {
		return nil, fmt.Errorf("TOS list parts: %w", err)
	}

	resp := &stores.ListPartsResponse{
		Bucket:               bucket,
		Key:                  key,
		UploadID:             req.UploadID,
		MaxParts:             out.MaxParts,
		IsTruncated:          out.IsTruncated,
		PartNumberMarker:     out.PartNumberMarker,
		NextPartNumberMarker: out.NextPartNumberMarker,
	}

	for _, p := range out.Parts {
		resp.Parts = append(resp.Parts, stores.CompletedPart{
			PartNumber: p.PartNumber,
			ETag:       p.ETag,
		})
	}

	return resp, nil
}
