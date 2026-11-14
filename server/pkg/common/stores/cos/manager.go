// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// COS ObjectStorageManager + MultipartUploader implementation.

package cos

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common/stores"

	"github.com/tencentyun/cos-go-sdk-v5"
)

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

// resolveBucket returns the configured default bucket when bucket is empty.
func (s *Store) resolveBucket(bucket string) string {
	if bucket == "" {
		return s.cfg.BucketName
	}
	return bucket
}

// clientForBucket creates a COS client pointing at the given bucket. The
// region is taken from the request context when available, otherwise the
// configured default region is used.
func (s *Store) clientForBucket(bucketName, region string) (*cos.Client, error) {
	if err := s.validate(); err != nil {
		return nil, err
	}
	if region == "" {
		region = s.cfg.Region
	}
	bucketURL := fmt.Sprintf("https://%s.cos.%s.myqcloud.com", bucketName, region)
	u, _ := url.Parse(bucketURL)
	b := &cos.BaseURL{BucketURL: u}
	return cos.NewClient(b, &http.Client{
		Transport: &cos.AuthorizationTransport{
			SecretID:  s.cfg.SecretID,
			SecretKey: s.cfg.SecretKey,
		},
	}), nil
}

// ──────────────────────────────────────────────
// Bucket management
// ──────────────────────────────────────────────

// ListBuckets lists all COS buckets accessible by the configured credentials.
func (s *Store) ListBuckets(req *stores.ListBucketsRequest) (*stores.ListBucketsResponse, error) {
	ctx := context.Background()
	c, err := s.client()
	if err != nil {
		return nil, err
	}

	opt := &cos.ServiceGetOptions{}
	if req != nil {
		if req.Region != "" {
			opt.Region = req.Region
		}
		if req.MaxKeys > 0 {
			opt.MaxKeys = int64(req.MaxKeys)
		}
	}

	out, _, err := c.Service.Get(ctx, opt)
	if err != nil {
		return nil, fmt.Errorf("COS list buckets: %w", err)
	}

	var buckets []stores.BucketInfo
	for _, b := range out.Buckets {
		name := b.Name
		if req != nil && req.Prefix != "" && !strings.HasPrefix(name, req.Prefix) {
			continue
		}
		created := time.Now()
		if b.CreationDate != "" {
			if t, err := time.Parse(time.RFC3339, b.CreationDate); err == nil {
				created = t
			}
		}
		buckets = append(buckets, stores.BucketInfo{
			Name:      name,
			Region:    b.Region,
			CreatedAt: created,
		})
	}

	if req != nil && req.MaxKeys > 0 && len(buckets) > req.MaxKeys {
		buckets = buckets[:req.MaxKeys]
	}

	resp := &stores.ListBucketsResponse{Buckets: buckets}
	if out.IsTruncated {
		resp.IsTruncated = true
		resp.NextMarker = out.NextMarker
	}
	return resp, nil
}

// CreateBucket creates a new COS bucket.
func (s *Store) CreateBucket(req *stores.CreateBucketRequest) error {
	if req == nil || req.Name == "" {
		return fmt.Errorf("COS bucket name is required")
	}
	ctx := context.Background()
	c, err := s.clientForBucket(req.Name, req.Region)
	if err != nil {
		return err
	}

	opt := &cos.BucketPutOptions{
		XCosACL: "private",
	}
	if req.IsPrivate {
		opt.XCosACL = "private"
	} else {
		opt.XCosACL = "public-read"
	}

	if _, err := c.Bucket.Put(ctx, opt); err != nil {
		return fmt.Errorf("COS create bucket: %w", err)
	}
	return nil
}

// DeleteBucket deletes an empty COS bucket.
func (s *Store) DeleteBucket(bucket string) error {
	ctx := context.Background()
	c, err := s.clientForBucket(bucket, "")
	if err != nil {
		return err
	}
	if _, err := c.Bucket.Delete(ctx); err != nil {
		return fmt.Errorf("COS delete bucket: %w", err)
	}
	return nil
}

// GetBucketInfo returns metadata about a COS bucket.
func (s *Store) GetBucketInfo(bucket string) (*stores.BucketInfo, error) {
	ctx := context.Background()
	c, err := s.clientForBucket(bucket, "")
	if err != nil {
		return nil, err
	}

	info := &stores.BucketInfo{
		Name:   bucket,
		Region: s.cfg.Region,
	}

	// Try to get the bucket location.
	if locOut, _, err := c.Bucket.GetLocation(ctx); err == nil && locOut != nil {
		if locOut.Location != "" {
			info.Region = locOut.Location
		}
	}

	// Try to get bucket tagging (may fail if no tags).
	if tagOut, _, err := c.Bucket.GetTagging(ctx); err == nil && tagOut != nil {
		tags := make(map[string]string, len(tagOut.TagSet))
		for _, t := range tagOut.TagSet {
			tags[t.Key] = t.Value
		}
		info.Tags = tags
	}

	return info, nil
}

// SetBucketPrivate sets the ACL of a COS bucket.
func (s *Store) SetBucketPrivate(bucket string, isPrivate bool) error {
	ctx := context.Background()
	c, err := s.clientForBucket(bucket, "")
	if err != nil {
		return err
	}

	acl := "private"
	if !isPrivate {
		acl = "public-read"
	}
	opt := &cos.BucketPutACLOptions{
		Header: &cos.ACLHeaderOptions{
			XCosACL: acl,
		},
	}
	if _, err := c.Bucket.PutACL(ctx, opt); err != nil {
		return fmt.Errorf("COS set bucket acl: %w", err)
	}
	return nil
}

// GetBucketDomains returns the domain names bound to a COS bucket.
func (s *Store) GetBucketDomains(bucket string) ([]string, error) {
	ctx := context.Background()
	c, err := s.clientForBucket(bucket, "")
	if err != nil {
		return nil, err
	}

	var domains []string
	if domOut, _, err := c.Bucket.GetDomain(ctx); err == nil && domOut != nil {
		for _, rule := range domOut.Rules {
			if rule.Name != "" {
				domains = append(domains, rule.Name)
			}
		}
	}
	return domains, nil
}

// ──────────────────────────────────────────────
// Object management
// ──────────────────────────────────────────────

// ListFiles lists objects in a COS bucket.
func (s *Store) ListFiles(bucket string, req *stores.ListFilesRequest) (*stores.ListFilesResponse, error) {
	ctx := context.Background()
	bucket = s.resolveBucket(bucket)
	c, err := s.clientForBucket(bucket, "")
	if err != nil {
		return nil, err
	}

	opt := &cos.BucketGetOptions{}
	if req != nil {
		if req.Prefix != "" {
			opt.Prefix = req.Prefix
		}
		if req.Delimiter != "" {
			opt.Delimiter = req.Delimiter
		}
		if req.Marker != "" {
			opt.Marker = req.Marker
		}
		if req.Limit > 0 {
			opt.MaxKeys = req.Limit
		}
	}

	out, _, err := c.Bucket.Get(ctx, opt)
	if err != nil {
		return nil, fmt.Errorf("COS list objects: %w", err)
	}

	resp := &stores.ListFilesResponse{
		IsTruncated: out.IsTruncated,
		Marker:      out.NextMarker,
	}
	for _, obj := range out.Contents {
		fi := stores.FileInfo{
			Key:          obj.Key,
			Size:         obj.Size,
			ETag:         obj.ETag,
			StorageClass: obj.StorageClass,
			IsLatest:     true,
			PublicURL:    s.PublicURL(obj.Key),
		}
		if obj.LastModified != "" {
			if t, err := time.Parse(time.RFC3339, obj.LastModified); err == nil {
				fi.LastModified = t
			}
		}
		resp.Files = append(resp.Files, fi)
	}
	resp.CommonPrefixes = append(resp.CommonPrefixes, out.CommonPrefixes...)

	return resp, nil
}

// GetFileInfo returns metadata for a single COS object.
func (s *Store) GetFileInfo(bucket, key string) (*stores.FileInfo, error) {
	ctx := context.Background()
	bucket = s.resolveBucket(bucket)
	c, err := s.clientForBucket(bucket, "")
	if err != nil {
		return nil, err
	}

	resp, err := c.Object.Head(ctx, key, nil)
	if err != nil {
		if cos.IsNotFoundError(err) {
			return nil, stores.ErrAttachmentNotExist
		}
		return nil, fmt.Errorf("COS head object: %w", err)
	}

	info := &stores.FileInfo{
		Key:       key,
		PublicURL: s.PublicURL(key),
		IsLatest:  true,
	}
	if cl := resp.Header.Get("Content-Length"); cl != "" {
		if v, err := strconv.ParseInt(cl, 10, 64); err == nil {
			info.Size = v
		}
	}
	if lm := resp.Header.Get("Last-Modified"); lm != "" {
		if t, err := http.ParseTime(lm); err == nil {
			info.LastModified = t
		}
	}
	if et := resp.Header.Get("ETag"); et != "" {
		info.ETag = strings.Trim(et, `"`)
	}
	if ct := resp.Header.Get("Content-Type"); ct != "" {
		info.ContentType = ct
	}
	if sc := resp.Header.Get("X-Cos-Storage-Class"); sc != "" {
		info.StorageClass = sc
	}

	// Collect user-defined metadata (x-cos-meta-*).
	meta := map[string]string{}
	for k, v := range resp.Header {
		if strings.HasPrefix(strings.ToLower(k), "x-cos-meta-") {
			if len(v) > 0 {
				meta[k] = v[0]
			}
		}
	}
	if len(meta) > 0 {
		info.Metadata = meta
	}

	return info, nil
}

// UploadFile uploads data to a COS bucket.
func (s *Store) UploadFile(bucket, key string, reader io.Reader, size int64) error {
	ctx := context.Background()
	bucket = s.resolveBucket(bucket)
	c, err := s.clientForBucket(bucket, "")
	if err != nil {
		return err
	}

	opt := &cos.ObjectPutOptions{}
	if size > 0 {
		opt.ObjectPutHeaderOptions = &cos.ObjectPutHeaderOptions{
			ContentLength: size,
		}
	}
	if _, err := c.Object.Put(ctx, key, reader, opt); err != nil {
		return fmt.Errorf("COS put object: %w", err)
	}
	return nil
}

// DeleteFile deletes an object from a COS bucket.
func (s *Store) DeleteFile(bucket, key string) error {
	ctx := context.Background()
	bucket = s.resolveBucket(bucket)
	c, err := s.clientForBucket(bucket, "")
	if err != nil {
		return err
	}
	if _, err := c.Object.Delete(ctx, key); err != nil {
		return fmt.Errorf("COS delete object: %w", err)
	}
	return nil
}

// CopyFile copies an object within or across COS buckets.
func (s *Store) CopyFile(req *stores.CopyObjectRequest) error {
	if req == nil {
		return fmt.Errorf("COS copy request is nil")
	}
	ctx := context.Background()

	srcBucket := s.resolveBucket(req.SrcBucket)
	dstBucket := s.resolveBucket(req.DestBucket)

	c, err := s.clientForBucket(dstBucket, "")
	if err != nil {
		return err
	}

	// COS Copy expects the source as "<bucket>/<key>".
	sourceURL := fmt.Sprintf("%s/%s", srcBucket, req.SrcKey)

	opt := &cos.ObjectCopyOptions{
		ObjectCopyHeaderOptions: &cos.ObjectCopyHeaderOptions{},
	}
	if req.ContentType != "" {
		opt.ObjectCopyHeaderOptions.ContentType = req.ContentType
		opt.ObjectCopyHeaderOptions.XCosMetadataDirective = "Replaced"
	}

	if _, _, err := c.Object.Copy(ctx, req.DestKey, sourceURL, opt); err != nil {
		return fmt.Errorf("COS copy object: %w", err)
	}
	return nil
}

// MoveFile moves an object within or across COS buckets.
func (s *Store) MoveFile(req *stores.CopyObjectRequest) error {
	if err := s.CopyFile(req); err != nil {
		return err
	}
	return s.DeleteFile(req.SrcBucket, req.SrcKey)
}

// GetFileURL returns an expiring URL for accessing a COS object.
func (s *Store) GetFileURL(bucket, key string, expires time.Duration) (string, error) {
	ctx := context.Background()
	bucket = s.resolveBucket(bucket)
	c, err := s.clientForBucket(bucket, "")
	if err != nil {
		return "", err
	}
	u, err := c.Object.GetPresignedURL(ctx, http.MethodGet, key, s.cfg.SecretID, s.cfg.SecretKey, expires, nil)
	if err != nil {
		return "", fmt.Errorf("COS presign get: %w", err)
	}
	return u.String(), nil
}

// ──────────────────────────────────────────────
// Multipart upload
// ──────────────────────────────────────────────

// InitiateMultipartUpload starts a multipart upload.
func (s *Store) InitiateMultipartUpload(bucket string, req *stores.InitiateMultipartUploadRequest) (*stores.InitiateMultipartUploadResponse, error) {
	if req == nil {
		return nil, fmt.Errorf("COS request is nil")
	}
	ctx := context.Background()
	bucket = s.resolveBucket(bucket)
	c, err := s.clientForBucket(bucket, "")
	if err != nil {
		return nil, err
	}

	opt := &cos.InitiateMultipartUploadOptions{
		ObjectPutHeaderOptions: &cos.ObjectPutHeaderOptions{},
	}
	if req.ContentType != "" {
		opt.ObjectPutHeaderOptions.ContentType = req.ContentType
	}
	if req.Metadata != nil {
		meta := http.Header{}
		for k, v := range req.Metadata {
			meta.Set(k, v)
		}
		opt.ObjectPutHeaderOptions.XCosMetaXXX = &meta
	}

	out, _, err := c.Object.InitiateMultipartUpload(ctx, req.Key, opt)
	if err != nil {
		return nil, fmt.Errorf("COS initiate multipart upload: %w", err)
	}
	return &stores.InitiateMultipartUploadResponse{
		UploadID: out.UploadID,
		Key:      out.Key,
	}, nil
}

// UploadPart uploads a single part of a multipart upload.
func (s *Store) UploadPart(bucket, key string, req *stores.UploadPartRequest) (*stores.UploadPartResponse, error) {
	if req == nil {
		return nil, fmt.Errorf("COS request is nil")
	}
	ctx := context.Background()
	bucket = s.resolveBucket(bucket)
	c, err := s.clientForBucket(bucket, "")
	if err != nil {
		return nil, err
	}

	resp, err := c.Object.UploadPart(ctx, key, req.UploadID, req.PartNumber, req.Body, &cos.ObjectUploadPartOptions{})
	if err != nil {
		return nil, fmt.Errorf("COS upload part: %w", err)
	}
	etag := resp.Header.Get("ETag")
	return &stores.UploadPartResponse{
		ETag: strings.Trim(etag, `"`),
	}, nil
}

// CompleteMultipartUpload finalizes a multipart upload.
func (s *Store) CompleteMultipartUpload(bucket, key string, req *stores.CompleteMultipartUploadRequest) (*stores.CompleteMultipartUploadResponse, error) {
	if req == nil {
		return nil, fmt.Errorf("COS request is nil")
	}
	ctx := context.Background()
	bucket = s.resolveBucket(bucket)
	c, err := s.clientForBucket(bucket, "")
	if err != nil {
		return nil, err
	}

	var parts []cos.Object
	for _, p := range req.Parts {
		parts = append(parts, cos.Object{
			PartNumber: p.PartNumber,
			ETag:       p.ETag,
		})
	}

	out, _, err := c.Object.CompleteMultipartUpload(ctx, key, req.UploadID, &cos.CompleteMultipartUploadOptions{
		Parts: parts,
	})
	if err != nil {
		return nil, fmt.Errorf("COS complete multipart upload: %w", err)
	}

	resp := &stores.CompleteMultipartUploadResponse{
		Bucket: bucket,
		Key:    key,
	}
	if out != nil {
		resp.Location = out.Location
		resp.Bucket = out.Bucket
		resp.Key = out.Key
		resp.ETag = out.ETag
	}
	return resp, nil
}

// AbortMultipartUpload cancels a multipart upload.
func (s *Store) AbortMultipartUpload(bucket, key, uploadID string) error {
	ctx := context.Background()
	bucket = s.resolveBucket(bucket)
	c, err := s.clientForBucket(bucket, "")
	if err != nil {
		return err
	}
	if _, err := c.Object.AbortMultipartUpload(ctx, key, uploadID); err != nil {
		return fmt.Errorf("COS abort multipart upload: %w", err)
	}
	return nil
}

// ListParts lists the parts of a multipart upload.
func (s *Store) ListParts(bucket, key string, req *stores.ListPartsRequest) (*stores.ListPartsResponse, error) {
	if req == nil {
		return nil, fmt.Errorf("COS request is nil")
	}
	ctx := context.Background()
	bucket = s.resolveBucket(bucket)
	c, err := s.clientForBucket(bucket, "")
	if err != nil {
		return nil, err
	}

	opt := &cos.ObjectListPartsOptions{}
	if req.MaxParts > 0 {
		opt.MaxParts = strconv.Itoa(req.MaxParts)
	}
	if req.PartNumberMarker > 0 {
		opt.PartNumberMarker = strconv.Itoa(req.PartNumberMarker)
	}

	out, _, err := c.Object.ListParts(ctx, key, req.UploadID, opt)
	if err != nil {
		return nil, fmt.Errorf("COS list parts: %w", err)
	}

	resp := &stores.ListPartsResponse{
		Bucket:      bucket,
		Key:         key,
		UploadID:    req.UploadID,
		IsTruncated: out.IsTruncated,
	}
	if out.MaxParts != "" {
		if v, err := strconv.Atoi(out.MaxParts); err == nil {
			resp.MaxParts = v
		}
	}
	if out.PartNumberMarker != "" {
		if v, err := strconv.Atoi(out.PartNumberMarker); err == nil {
			resp.PartNumberMarker = v
		}
	}
	if out.NextPartNumberMarker != "" {
		if v, err := strconv.Atoi(out.NextPartNumberMarker); err == nil {
			resp.NextPartNumberMarker = v
		}
	}
	for _, p := range out.Parts {
		resp.Parts = append(resp.Parts, stores.CompletedPart{
			PartNumber: p.PartNumber,
			ETag:       strings.Trim(p.ETag, `"`),
		})
	}
	return resp, nil
}
