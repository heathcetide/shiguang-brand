// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package stores

import (
	"io"
	"time"
)

// ──────────────────────────────────────────────
// Bucket management types
// ──────────────────────────────────────────────

// BucketInfo holds metadata about a storage bucket.
type BucketInfo struct {
	Name         string            `json:"name"`         // bucket name
	Region       string            `json:"region"`       // bucket region
	CreatedAt    time.Time         `json:"createdAt"`    // creation time
	IsPrivate    bool              `json:"isPrivate"`    // whether the bucket is private
	Domains      []string          `json:"domains"`      // bound domain names
	Tags         map[string]string `json:"tags"`         // bucket tags
	StorageClass string            `json:"storageClass"` // storage class (e.g. STANDARD)
	Versioning   bool              `json:"versioning"`   // whether versioning is enabled
}

// ListBucketsRequest holds parameters for listing buckets.
type ListBucketsRequest struct {
	Region  string `json:"region,omitempty"`  // filter by region
	Prefix  string `json:"prefix,omitempty"`  // filter by name prefix
	MaxKeys int    `json:"maxKeys,omitempty"` // max buckets to return (0 = all)
}

// ListBucketsResponse holds the result of listing buckets.
type ListBucketsResponse struct {
	Buckets     []BucketInfo `json:"buckets"`
	IsTruncated bool         `json:"isTruncated"`
	NextMarker  string       `json:"nextMarker,omitempty"`
}

// CreateBucketRequest holds parameters for creating a bucket.
type CreateBucketRequest struct {
	Name         string            `json:"name"`
	Region       string            `json:"region,omitempty"`
	StorageClass string            `json:"storageClass,omitempty"`
	Tags         map[string]string `json:"tags,omitempty"`
	IsPrivate    bool              `json:"isPrivate"`
}

// ──────────────────────────────────────────────
// File/object management types
// ──────────────────────────────────────────────

// FileInfo holds metadata about a stored object.
type FileInfo struct {
	Key          string            `json:"key"`          // object key
	Size         int64             `json:"size"`         // object size in bytes
	LastModified time.Time         `json:"lastModified"` // last modification time
	ETag         string            `json:"etag"`         // ETag / hash
	ContentType  string            `json:"contentType"`  // MIME type
	Metadata     map[string]string `json:"metadata"`     // user-defined metadata
	StorageClass string            `json:"storageClass"` // storage class
	VersionID    string            `json:"versionId"`    // version ID (if versioning enabled)
	IsLatest     bool              `json:"isLatest"`     // whether this is the latest version
	PublicURL    string            `json:"publicURL"`    // public access URL
}

// ListFilesRequest holds parameters for listing objects in a bucket.
type ListFilesRequest struct {
	Prefix    string `json:"prefix,omitempty"`    // prefix filter
	Marker    string `json:"marker,omitempty"`    // pagination marker
	Limit     int    `json:"limit,omitempty"`     // max objects to return
	Delimiter string `json:"delimiter,omitempty"` // directory delimiter (e.g. "/")
}

// ListFilesResponse holds the result of listing objects.
type ListFilesResponse struct {
	Files          []FileInfo `json:"files"`
	Marker         string     `json:"marker,omitempty"`
	IsTruncated    bool       `json:"isTruncated"`
	CommonPrefixes []string   `json:"commonPrefixes,omitempty"` // virtual directories
}

// CopyObjectRequest holds parameters for copying an object.
type CopyObjectRequest struct {
	SrcBucket   string            `json:"srcBucket"`
	SrcKey      string            `json:"srcKey"`
	DestBucket  string            `json:"destBucket"`
	DestKey     string            `json:"destKey"`
	ContentType string            `json:"contentType,omitempty"`
	Metadata    map[string]string `json:"metadata,omitempty"`
}

// ──────────────────────────────────────────────
// Multipart upload types
// ──────────────────────────────────────────────

// InitiateMultipartUploadRequest holds parameters for initiating a
// multipart upload.
type InitiateMultipartUploadRequest struct {
	Key         string            `json:"key"`
	ContentType string            `json:"contentType,omitempty"`
	Metadata    map[string]string `json:"metadata,omitempty"`
}

// InitiateMultipartUploadResponse holds the result of initiating a
// multipart upload.
type InitiateMultipartUploadResponse struct {
	UploadID string `json:"uploadId"`
	Key      string `json:"key"`
}

// UploadPartRequest holds parameters for uploading a single part.
type UploadPartRequest struct {
	UploadID   string    `json:"uploadId"`
	PartNumber int       `json:"partNumber"`
	Body       io.Reader `json:"-"`
}

// UploadPartResponse holds the result of uploading a part.
type UploadPartResponse struct {
	ETag string `json:"etag"`
}

// CompletedPart represents a single completed part in a multipart upload.
type CompletedPart struct {
	PartNumber int    `json:"partNumber"`
	ETag       string `json:"etag"`
}

// CompleteMultipartUploadRequest holds parameters for completing a
// multipart upload.
type CompleteMultipartUploadRequest struct {
	UploadID string          `json:"uploadId"`
	Parts    []CompletedPart `json:"parts"`
}

// CompleteMultipartUploadResponse holds the result of completing a
// multipart upload.
type CompleteMultipartUploadResponse struct {
	Location string `json:"location"`
	Bucket   string `json:"bucket"`
	Key      string `json:"key"`
	ETag     string `json:"etag"`
}

// ListPartsRequest holds parameters for listing parts of a multipart upload.
type ListPartsRequest struct {
	UploadID         string `json:"uploadId"`
	MaxParts         int    `json:"maxParts,omitempty"`
	PartNumberMarker int    `json:"partNumberMarker,omitempty"`
}

// ListPartsResponse holds the result of listing parts.
type ListPartsResponse struct {
	Bucket               string          `json:"bucket"`
	Key                  string          `json:"key"`
	UploadID             string          `json:"uploadId"`
	MaxParts             int             `json:"maxParts"`
	IsTruncated          bool            `json:"isTruncated"`
	PartNumberMarker     int             `json:"partNumberMarker"`
	NextPartNumberMarker int             `json:"nextPartNumberMarker"`
	Parts                []CompletedPart `json:"parts"`
}

// ──────────────────────────────────────────────
// ObjectStorageManager — bucket & object management
// ──────────────────────────────────────────────

// ObjectStorageManager extends Store with administrative operations for
// managing buckets, listing objects with metadata, copying/moving
// objects, and generating expiring URLs. Not all backends implement
// every operation — callers should check with a type assertion or use
// the helper functions.
//
// The bucket parameter may be empty for backends that operate on a
// single pre-configured bucket (e.g. the local store or a single-bucket
// cloud config); in that case the backend uses its default bucket.
type ObjectStorageManager interface {
	Store

	// ── Bucket management ──

	// ListBuckets returns all buckets the configured credentials can
	// access, optionally filtered by the request parameters.
	ListBuckets(req *ListBucketsRequest) (*ListBucketsResponse, error)

	// CreateBucket creates a new bucket.
	CreateBucket(req *CreateBucketRequest) error

	// DeleteBucket deletes an empty bucket. Returns an error if the
	// bucket is not empty or does not exist.
	DeleteBucket(bucket string) error

	// GetBucketInfo returns metadata about a bucket.
	GetBucketInfo(bucket string) (*BucketInfo, error)

	// SetBucketPrivate sets the access control of a bucket.
	SetBucketPrivate(bucket string, isPrivate bool) error

	// GetBucketDomains returns the domain names bound to a bucket.
	GetBucketDomains(bucket string) ([]string, error)

	// ── Object management ──

	// ListFiles lists objects in a bucket with optional prefix,
	// delimiter, and pagination.
	ListFiles(bucket string, req *ListFilesRequest) (*ListFilesResponse, error)

	// GetFileInfo returns metadata for a single object.
	GetFileInfo(bucket, key string) (*FileInfo, error)

	// UploadFile uploads data to a bucket. Unlike Write, this method
	// accepts an explicit size hint and bucket parameter.
	UploadFile(bucket, key string, reader io.Reader, size int64) error

	// DeleteFile deletes an object from a bucket.
	DeleteFile(bucket, key string) error

	// CopyFile copies an object within or across buckets.
	CopyFile(req *CopyObjectRequest) error

	// MoveFile moves (renames) an object within or across buckets.
	MoveFile(req *CopyObjectRequest) error

	// GetFileURL returns an expiring URL for accessing a (possibly
	// private) object.
	GetFileURL(bucket, key string, expires time.Duration) (string, error)
}

// ──────────────────────────────────────────────
// MultipartUploader — large file multipart upload
// ──────────────────────────────────────────────

// MultipartUploader is implemented by backends that support multipart
// upload for large files. This allows uploading files in parts,
// resuming interrupted uploads, and parallel part uploads.
type MultipartUploader interface {
	// InitiateMultipartUpload starts a multipart upload and returns
	// an upload ID.
	InitiateMultipartUpload(bucket string, req *InitiateMultipartUploadRequest) (*InitiateMultipartUploadResponse, error)

	// UploadPart uploads a single part of a multipart upload.
	UploadPart(bucket, key string, req *UploadPartRequest) (*UploadPartResponse, error)

	// CompleteMultipartUpload finalizes a multipart upload by combining
	// all uploaded parts.
	CompleteMultipartUpload(bucket, key string, req *CompleteMultipartUploadRequest) (*CompleteMultipartUploadResponse, error)

	// AbortMultipartUpload cancels a multipart upload and discards
	// uploaded parts.
	AbortMultipartUpload(bucket, key, uploadID string) error

	// ListParts lists the parts that have been uploaded for a multipart
	// upload.
	ListParts(bucket, key string, req *ListPartsRequest) (*ListPartsResponse, error)
}

// ──────────────────────────────────────────────
// Helper functions
// ──────────────────────────────────────────────

// AsManager returns the given store as an ObjectStorageManager, or nil
// if the store does not implement the management interface.
func AsManager(s Store) ObjectStorageManager {
	if m, ok := s.(ObjectStorageManager); ok {
		return m
	}
	return nil
}

// AsMultipartUploader returns the given store as a MultipartUploader,
// or nil if the store does not support multipart upload.
func AsMultipartUploader(s Store) MultipartUploader {
	if m, ok := s.(MultipartUploader); ok {
		return m
	}
	return nil
}

// SupportsManagement reports whether the store implements
// ObjectStorageManager.
func SupportsManagement(s Store) bool {
	_, ok := s.(ObjectStorageManager)
	return ok
}

// SupportsMultipart reports whether the store implements
// MultipartUploader.
func SupportsMultipart(s Store) bool {
	_, ok := s.(MultipartUploader)
	return ok
}
