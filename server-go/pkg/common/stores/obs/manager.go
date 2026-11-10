// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// OBS ObjectStorageManager + MultipartUploader implementation.

package obs

import (
	"context"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common/stores"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	s3types "github.com/aws/aws-sdk-go-v2/service/s3/types"
)

// ──────────────────────────────────────────────
// Bucket management
// ──────────────────────────────────────────────

func (s *Store) resolveBucket(bucket string) string {
	if bucket == "" {
		return s.cfg.BucketName
	}
	return bucket
}

// ListBuckets lists all OBS buckets.
func (s *Store) ListBuckets(req *stores.ListBucketsRequest) (*stores.ListBucketsResponse, error) {
	ctx := context.Background()
	client, err := s.client(ctx)
	if err != nil {
		return nil, err
	}

	out, err := client.ListBuckets(ctx, &s3.ListBucketsInput{})
	if err != nil {
		return nil, fmt.Errorf("list buckets: %w", err)
	}

	var buckets []stores.BucketInfo
	for _, b := range out.Buckets {
		name := aws.ToString(b.Name)
		if req != nil && req.Prefix != "" && !strings.HasPrefix(name, req.Prefix) {
			continue
		}
		created := time.Now()
		if b.CreationDate != nil {
			created = *b.CreationDate
		}
		buckets = append(buckets, stores.BucketInfo{
			Name:      name,
			CreatedAt: created,
		})
	}

	if req != nil && req.MaxKeys > 0 && len(buckets) > req.MaxKeys {
		buckets = buckets[:req.MaxKeys]
	}

	return &stores.ListBucketsResponse{Buckets: buckets}, nil
}

// CreateBucket creates a new OBS bucket. Unlike S3, OBS does not use
// LocationConstraint via CreateBucketConfiguration — the bucket is
// created on the configured endpoint.
func (s *Store) CreateBucket(req *stores.CreateBucketRequest) error {
	if req == nil || req.Name == "" {
		return fmt.Errorf("bucket name is required")
	}
	ctx := context.Background()
	client, err := s.client(ctx)
	if err != nil {
		return err
	}

	input := &s3.CreateBucketInput{
		Bucket: aws.String(req.Name),
	}

	_, err = client.CreateBucket(ctx, input)
	if err != nil {
		return fmt.Errorf("create bucket: %w", err)
	}
	return nil
}

// DeleteBucket deletes an empty OBS bucket.
func (s *Store) DeleteBucket(bucket string) error {
	ctx := context.Background()
	client, err := s.client(ctx)
	if err != nil {
		return err
	}
	_, err = client.DeleteBucket(ctx, &s3.DeleteBucketInput{
		Bucket: aws.String(bucket),
	})
	if err != nil {
		return fmt.Errorf("delete bucket: %w", err)
	}
	return nil
}

// GetBucketInfo returns metadata about an OBS bucket.
func (s *Store) GetBucketInfo(bucket string) (*stores.BucketInfo, error) {
	ctx := context.Background()
	client, err := s.client(ctx)
	if err != nil {
		return nil, err
	}

	// Get bucket location.
	locOut, err := client.GetBucketLocation(ctx, &s3.GetBucketLocationInput{
		Bucket: aws.String(bucket),
	})
	if err != nil {
		return nil, fmt.Errorf("get bucket location: %w", err)
	}

	region := string(locOut.LocationConstraint)
	if region == "" {
		region = s.cfg.Region
	}

	info := &stores.BucketInfo{
		Name:   bucket,
		Region: region,
	}

	// Try to get bucket tagging (may fail if no tags).
	tagOut, err := client.GetBucketTagging(ctx, &s3.GetBucketTaggingInput{
		Bucket: aws.String(bucket),
	})
	if err == nil && tagOut != nil {
		tags := make(map[string]string, len(tagOut.TagSet))
		for _, t := range tagOut.TagSet {
			tags[aws.ToString(t.Key)] = aws.ToString(t.Value)
		}
		info.Tags = tags
	}

	return info, nil
}

// SetBucketPrivate sets the ACL of an OBS bucket.
func (s *Store) SetBucketPrivate(bucket string, isPrivate bool) error {
	ctx := context.Background()
	client, err := s.client(ctx)
	if err != nil {
		return err
	}

	acl := s3types.BucketCannedACLPrivate
	if !isPrivate {
		acl = s3types.BucketCannedACLPublicRead
	}
	_, err = client.PutBucketAcl(ctx, &s3.PutBucketAclInput{
		Bucket: aws.String(bucket),
		ACL:    acl,
	})
	if err != nil {
		return fmt.Errorf("set bucket acl: %w", err)
	}
	return nil
}

// GetBucketDomains returns the domain names associated with an OBS bucket.
// For OBS, this returns the proxy domain if configured, otherwise the
// default endpoint-based domain.
func (s *Store) GetBucketDomains(bucket string) ([]string, error) {
	var domains []string
	if s.cfg.ProxyDomain != "" {
		domains = append(domains, s.cfg.ProxyDomain)
	}
	return domains, nil
}

// ──────────────────────────────────────────────
// Object management
// ──────────────────────────────────────────────

// ListFiles lists objects in an OBS bucket.
func (s *Store) ListFiles(bucket string, req *stores.ListFilesRequest) (*stores.ListFilesResponse, error) {
	ctx := context.Background()
	client, err := s.client(ctx)
	if err != nil {
		return nil, err
	}

	bucket = s.resolveBucket(bucket)
	input := &s3.ListObjectsV2Input{
		Bucket: aws.String(bucket),
	}

	if req != nil {
		if req.Prefix != "" {
			input.Prefix = aws.String(req.Prefix)
		}
		if req.Delimiter != "" {
			input.Delimiter = aws.String(req.Delimiter)
		}
		if req.Limit > 0 {
			input.MaxKeys = aws.Int32(int32(req.Limit))
		}
		if req.Marker != "" {
			input.ContinuationToken = aws.String(req.Marker)
		}
	}

	out, err := client.ListObjectsV2(ctx, input)
	if err != nil {
		return nil, fmt.Errorf("list objects: %w", err)
	}

	resp := &stores.ListFilesResponse{
		IsTruncated: aws.ToBool(out.IsTruncated),
	}
	if out.NextContinuationToken != nil {
		resp.Marker = aws.ToString(out.NextContinuationToken)
	}

	for _, obj := range out.Contents {
		resp.Files = append(resp.Files, stores.FileInfo{
			Key:          aws.ToString(obj.Key),
			Size:         aws.ToInt64(obj.Size),
			LastModified: aws.ToTime(obj.LastModified),
			ETag:         aws.ToString(obj.ETag),
			StorageClass: string(obj.StorageClass),
			IsLatest:     true,
			PublicURL:    s.PublicURL(aws.ToString(obj.Key)),
		})
	}

	for _, prefix := range out.CommonPrefixes {
		resp.CommonPrefixes = append(resp.CommonPrefixes, aws.ToString(prefix.Prefix))
	}

	return resp, nil
}

// GetFileInfo returns metadata for a single OBS object.
func (s *Store) GetFileInfo(bucket, key string) (*stores.FileInfo, error) {
	ctx := context.Background()
	client, err := s.client(ctx)
	if err != nil {
		return nil, err
	}

	bucket = s.resolveBucket(bucket)
	out, err := client.HeadObject(ctx, &s3.HeadObjectInput{
		Bucket: aws.String(bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		if strings.Contains(err.Error(), "NotFound") || strings.Contains(err.Error(), "NoSuchKey") {
			return nil, stores.ErrAttachmentNotExist
		}
		return nil, fmt.Errorf("head object: %w", err)
	}

	info := &stores.FileInfo{
		Key:       key,
		PublicURL: s.PublicURL(key),
		IsLatest:  true,
	}
	if out.ContentLength != nil {
		info.Size = aws.ToInt64(out.ContentLength)
	}
	if out.LastModified != nil {
		info.LastModified = aws.ToTime(out.LastModified)
	}
	if out.ETag != nil {
		info.ETag = aws.ToString(out.ETag)
	}
	if out.ContentType != nil {
		info.ContentType = aws.ToString(out.ContentType)
	}
	if out.StorageClass != "" {
		info.StorageClass = string(out.StorageClass)
	}
	if out.Metadata != nil {
		info.Metadata = make(map[string]string, len(out.Metadata))
		for k, v := range out.Metadata {
			info.Metadata[k] = v
		}
	}

	return info, nil
}

// UploadFile uploads data to an OBS bucket.
func (s *Store) UploadFile(bucket, key string, reader io.Reader, size int64) error {
	ctx := context.Background()
	client, err := s.client(ctx)
	if err != nil {
		return err
	}

	bucket = s.resolveBucket(bucket)
	input := &s3.PutObjectInput{
		Bucket: aws.String(bucket),
		Key:    aws.String(key),
		Body:   reader,
	}

	_, err = client.PutObject(ctx, input)
	if err != nil {
		return fmt.Errorf("put object: %w", err)
	}
	return nil
}

// DeleteFile deletes an object from an OBS bucket.
func (s *Store) DeleteFile(bucket, key string) error {
	ctx := context.Background()
	client, err := s.client(ctx)
	if err != nil {
		return err
	}

	bucket = s.resolveBucket(bucket)
	_, err = client.DeleteObject(ctx, &s3.DeleteObjectInput{
		Bucket: aws.String(bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		return fmt.Errorf("delete object: %w", err)
	}
	return nil
}

// CopyFile copies an object within or across OBS buckets.
func (s *Store) CopyFile(req *stores.CopyObjectRequest) error {
	if req == nil {
		return fmt.Errorf("copy request is nil")
	}
	ctx := context.Background()
	client, err := s.client(ctx)
	if err != nil {
		return err
	}

	srcBucket := s.resolveBucket(req.SrcBucket)
	dstBucket := s.resolveBucket(req.DestBucket)

	input := &s3.CopyObjectInput{
		Bucket:     aws.String(dstBucket),
		Key:        aws.String(req.DestKey),
		CopySource: aws.String(fmt.Sprintf("%s/%s", srcBucket, req.SrcKey)),
	}
	if req.ContentType != "" {
		input.ContentType = aws.String(req.ContentType)
		input.MetadataDirective = s3types.MetadataDirectiveReplace
	}

	_, err = client.CopyObject(ctx, input)
	if err != nil {
		return fmt.Errorf("copy object: %w", err)
	}
	return nil
}

// MoveFile moves an object within or across OBS buckets.
func (s *Store) MoveFile(req *stores.CopyObjectRequest) error {
	if err := s.CopyFile(req); err != nil {
		return err
	}
	return s.DeleteFile(req.SrcBucket, req.SrcKey)
}

// GetFileURL returns an expiring URL for an OBS object.
func (s *Store) GetFileURL(bucket, key string, expires time.Duration) (string, error) {
	ctx := context.Background()
	client, err := s.client(ctx)
	if err != nil {
		return "", err
	}

	bucket = s.resolveBucket(bucket)
	out, err := s3.NewPresignClient(client).PresignGetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(bucket),
		Key:    aws.String(key),
	}, s3.WithPresignExpires(expires))
	if err != nil {
		return "", fmt.Errorf("presign get: %w", err)
	}
	return out.URL, nil
}

// ──────────────────────────────────────────────
// Multipart upload
// ──────────────────────────────────────────────

// InitiateMultipartUpload starts a multipart upload.
func (s *Store) InitiateMultipartUpload(bucket string, req *stores.InitiateMultipartUploadRequest) (*stores.InitiateMultipartUploadResponse, error) {
	if req == nil {
		return nil, fmt.Errorf("request is nil")
	}
	ctx := context.Background()
	client, err := s.client(ctx)
	if err != nil {
		return nil, err
	}

	bucket = s.resolveBucket(bucket)
	input := &s3.CreateMultipartUploadInput{
		Bucket: aws.String(bucket),
		Key:    aws.String(req.Key),
	}
	if req.ContentType != "" {
		input.ContentType = aws.String(req.ContentType)
	}
	if req.Metadata != nil {
		input.Metadata = make(map[string]string, len(req.Metadata))
		for k, v := range req.Metadata {
			input.Metadata[k] = v
		}
	}

	out, err := client.CreateMultipartUpload(ctx, input)
	if err != nil {
		return nil, fmt.Errorf("create multipart upload: %w", err)
	}

	return &stores.InitiateMultipartUploadResponse{
		UploadID: aws.ToString(out.UploadId),
		Key:      req.Key,
	}, nil
}

// UploadPart uploads a single part of a multipart upload.
func (s *Store) UploadPart(bucket, key string, req *stores.UploadPartRequest) (*stores.UploadPartResponse, error) {
	if req == nil {
		return nil, fmt.Errorf("request is nil")
	}
	ctx := context.Background()
	client, err := s.client(ctx)
	if err != nil {
		return nil, err
	}

	bucket = s.resolveBucket(bucket)
	out, err := client.UploadPart(ctx, &s3.UploadPartInput{
		Bucket:     aws.String(bucket),
		Key:        aws.String(key),
		UploadId:   aws.String(req.UploadID),
		PartNumber: aws.Int32(int32(req.PartNumber)),
		Body:       req.Body,
	})
	if err != nil {
		return nil, fmt.Errorf("upload part: %w", err)
	}

	return &stores.UploadPartResponse{
		ETag: aws.ToString(out.ETag),
	}, nil
}

// CompleteMultipartUpload finalizes a multipart upload.
func (s *Store) CompleteMultipartUpload(bucket, key string, req *stores.CompleteMultipartUploadRequest) (*stores.CompleteMultipartUploadResponse, error) {
	if req == nil {
		return nil, fmt.Errorf("request is nil")
	}
	ctx := context.Background()
	client, err := s.client(ctx)
	if err != nil {
		return nil, err
	}

	bucket = s.resolveBucket(bucket)
	var parts []s3types.CompletedPart
	for _, p := range req.Parts {
		parts = append(parts, s3types.CompletedPart{
			ETag:       aws.String(p.ETag),
			PartNumber: aws.Int32(int32(p.PartNumber)),
		})
	}

	out, err := client.CompleteMultipartUpload(ctx, &s3.CompleteMultipartUploadInput{
		Bucket:          aws.String(bucket),
		Key:             aws.String(key),
		UploadId:        aws.String(req.UploadID),
		MultipartUpload: &s3types.CompletedMultipartUpload{Parts: parts},
	})
	if err != nil {
		return nil, fmt.Errorf("complete multipart upload: %w", err)
	}

	resp := &stores.CompleteMultipartUploadResponse{
		Bucket: bucket,
		Key:    key,
	}
	if out.Location != nil {
		resp.Location = aws.ToString(out.Location)
	}
	if out.ETag != nil {
		resp.ETag = aws.ToString(out.ETag)
	}
	return resp, nil
}

// AbortMultipartUpload cancels a multipart upload.
func (s *Store) AbortMultipartUpload(bucket, key, uploadID string) error {
	ctx := context.Background()
	client, err := s.client(ctx)
	if err != nil {
		return err
	}

	bucket = s.resolveBucket(bucket)
	_, err = client.AbortMultipartUpload(ctx, &s3.AbortMultipartUploadInput{
		Bucket:   aws.String(bucket),
		Key:      aws.String(key),
		UploadId: aws.String(uploadID),
	})
	if err != nil {
		return fmt.Errorf("abort multipart upload: %w", err)
	}
	return nil
}

// ListParts lists the parts of a multipart upload.
func (s *Store) ListParts(bucket, key string, req *stores.ListPartsRequest) (*stores.ListPartsResponse, error) {
	if req == nil {
		return nil, fmt.Errorf("request is nil")
	}
	ctx := context.Background()
	client, err := s.client(ctx)
	if err != nil {
		return nil, err
	}

	bucket = s.resolveBucket(bucket)
	input := &s3.ListPartsInput{
		Bucket:   aws.String(bucket),
		Key:      aws.String(key),
		UploadId: aws.String(req.UploadID),
	}
	if req.MaxParts > 0 {
		input.MaxParts = aws.Int32(int32(req.MaxParts))
	}
	if req.PartNumberMarker > 0 {
		input.PartNumberMarker = aws.String(fmt.Sprintf("%d", req.PartNumberMarker))
	}

	out, err := client.ListParts(ctx, input)
	if err != nil {
		return nil, fmt.Errorf("list parts: %w", err)
	}

	resp := &stores.ListPartsResponse{
		Bucket:      bucket,
		Key:         key,
		UploadID:    req.UploadID,
		IsTruncated: aws.ToBool(out.IsTruncated),
	}
	if out.MaxParts != nil {
		resp.MaxParts = int(aws.ToInt32(out.MaxParts))
	}

	for _, p := range out.Parts {
		resp.Parts = append(resp.Parts, stores.CompletedPart{
			PartNumber: int(aws.ToInt32(p.PartNumber)),
			ETag:       aws.ToString(p.ETag),
		})
	}

	return resp, nil
}
