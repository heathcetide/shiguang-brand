// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Local filesystem ObjectStorageManager implementation.
//
// The local store emulates bucket-based object storage using directories:
//   <root>/buckets/<bucket-name>/<object-key>
//
// Bucket metadata is persisted in <root>/.metadata/buckets.json.

package local

import (
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common/stores"
)

// ──────────────────────────────────────────────
// Bucket metadata persistence
// ──────────────────────────────────────────────

// bucketMeta is the on-disk metadata for a local bucket.
type bucketMeta struct {
	stores.BucketInfo
}

// bucketStore manages bucket metadata in memory + on disk.
type bucketStore struct {
	mu       sync.RWMutex
	cache    map[string]*stores.BucketInfo
	metaPath string // path to buckets.json
	root     string
}

func newBucketStore(root string) *bucketStore {
	bs := &bucketStore{
		cache:    make(map[string]*stores.BucketInfo),
		metaPath: filepath.Join(root, ".metadata"),
		root:     root,
	}
	_ = os.MkdirAll(bs.metaPath, 0755)
	bs.load()
	return bs
}

func (bs *bucketStore) load() {
	data, err := os.ReadFile(filepath.Join(bs.metaPath, "buckets.json"))
	if err != nil {
		return
	}
	var buckets map[string]*stores.BucketInfo
	if json.Unmarshal(data, &buckets) == nil {
		bs.cache = buckets
	}
}

func (bs *bucketStore) save() error {
	data, err := json.MarshalIndent(bs.cache, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(bs.metaPath, "buckets.json"), data, 0644)
}

func (bs *bucketStore) get(name string) (*stores.BucketInfo, bool) {
	bs.mu.RLock()
	defer bs.mu.RUnlock()
	info, ok := bs.cache[name]
	return info, ok
}

func (bs *bucketStore) put(info *stores.BucketInfo) {
	bs.mu.Lock()
	defer bs.mu.Unlock()
	bs.cache[info.Name] = info
}

func (bs *bucketStore) delete(name string) {
	bs.mu.Lock()
	defer bs.mu.Unlock()
	delete(bs.cache, name)
}

func (bs *bucketStore) list() []*stores.BucketInfo {
	bs.mu.RLock()
	defer bs.mu.RUnlock()
	result := make([]*stores.BucketInfo, 0, len(bs.cache))
	for _, info := range bs.cache {
		result = append(result, info)
	}
	sort.Slice(result, func(i, j int) bool {
		return result[i].Name < result[j].Name
	})
	return result
}

// ──────────────────────────────────────────────
// Bucket directory helpers
// ──────────────────────────────────────────────

func (s *Store) bucketPath(bucket string) string {
	return filepath.Join(s.root, "buckets", bucket)
}

func (s *Store) objectPath(bucket, key string) string {
	return filepath.Join(s.bucketPath(bucket), filepath.FromSlash(key))
}

// validateBucketName checks that a bucket name is valid.
func validateBucketName(name string) error {
	if len(name) < 3 || len(name) > 63 {
		return fmt.Errorf("bucket name must be between 3 and 63 characters")
	}
	if strings.Contains(name, "..") || strings.Contains(name, "//") {
		return fmt.Errorf("bucket name cannot contain consecutive dots or slashes")
	}
	return nil
}

// ──────────────────────────────────────────────
// Bucket management
// ──────────────────────────────────────────────

// ensureBuckets initializes the bucket metadata store (lazy).
func (s *Store) ensureBuckets() *bucketStore {
	s.bsOnce.Do(func() {
		s.bs = newBucketStore(s.root)
	})
	return s.bs
}

// ListBuckets lists all local buckets.
func (s *Store) ListBuckets(req *stores.ListBucketsRequest) (*stores.ListBucketsResponse, error) {
	all := s.ensureBuckets().list()

	var filtered []*stores.BucketInfo
	for _, b := range all {
		if req != nil {
			if req.Region != "" && b.Region != req.Region {
				continue
			}
			if req.Prefix != "" && !strings.HasPrefix(b.Name, req.Prefix) {
				continue
			}
		}
		filtered = append(filtered, b)
	}

	if req != nil && req.MaxKeys > 0 && len(filtered) > req.MaxKeys {
		filtered = filtered[:req.MaxKeys]
	}

	result := &stores.ListBucketsResponse{
		Buckets:     make([]stores.BucketInfo, len(filtered)),
		IsTruncated: false,
	}
	for i, b := range filtered {
		result.Buckets[i] = *b
	}
	return result, nil
}

// CreateBucket creates a new local bucket (directory + metadata).
func (s *Store) CreateBucket(req *stores.CreateBucketRequest) error {
	if req == nil || req.Name == "" {
		return fmt.Errorf("bucket name is required")
	}
	if err := validateBucketName(req.Name); err != nil {
		return err
	}

	bs := s.ensureBuckets()
	bs.mu.Lock()
	defer bs.mu.Unlock()

	if _, exists := bs.cache[req.Name]; exists {
		return fmt.Errorf("bucket %s already exists", req.Name)
	}

	bucketDir := s.bucketPath(req.Name)
	if err := os.MkdirAll(bucketDir, s.newDirPerm); err != nil {
		return err
	}

	storageClass := req.StorageClass
	if storageClass == "" {
		storageClass = "STANDARD"
	}

	info := &stores.BucketInfo{
		Name:         req.Name,
		Region:       req.Region,
		CreatedAt:    time.Now(),
		IsPrivate:    req.IsPrivate,
		Domains:      []string{},
		Tags:         req.Tags,
		StorageClass: storageClass,
		Versioning:   false,
	}
	if info.Tags == nil {
		info.Tags = make(map[string]string)
	}
	bs.cache[req.Name] = info
	return bs.save()
}

// DeleteBucket deletes an empty local bucket.
func (s *Store) DeleteBucket(bucket string) error {
	bs := s.ensureBuckets()
	bs.mu.Lock()
	defer bs.mu.Unlock()

	if _, exists := bs.cache[bucket]; !exists {
		return fmt.Errorf("bucket %s does not exist", bucket)
	}

	// Check if bucket is empty.
	bucketDir := s.bucketPath(bucket)
	entries, err := os.ReadDir(bucketDir)
	if err != nil {
		if os.IsNotExist(err) {
			// Directory gone but metadata remains — clean up.
			delete(bs.cache, bucket)
			return bs.save()
		}
		return err
	}
	if len(entries) > 0 {
		return fmt.Errorf("bucket %s is not empty", bucket)
	}

	if err := os.RemoveAll(bucketDir); err != nil {
		return err
	}
	delete(bs.cache, bucket)
	return bs.save()
}

// GetBucketInfo returns metadata about a local bucket.
func (s *Store) GetBucketInfo(bucket string) (*stores.BucketInfo, error) {
	info, ok := s.ensureBuckets().get(bucket)
	if !ok {
		return nil, fmt.Errorf("bucket %s does not exist", bucket)
	}
	// Return a copy.
	copied := *info
	if info.Domains != nil {
		copied.Domains = append([]string{}, info.Domains...)
	}
	if info.Tags != nil {
		copied.Tags = make(map[string]string, len(info.Tags))
		for k, v := range info.Tags {
			copied.Tags[k] = v
		}
	}
	return &copied, nil
}

// SetBucketPrivate sets the access control of a local bucket.
func (s *Store) SetBucketPrivate(bucket string, isPrivate bool) error {
	bs := s.ensureBuckets()
	bs.mu.Lock()
	defer bs.mu.Unlock()

	info, exists := bs.cache[bucket]
	if !exists {
		return fmt.Errorf("bucket %s does not exist", bucket)
	}
	info.IsPrivate = isPrivate
	return bs.save()
}

// GetBucketDomains returns the domain names bound to a local bucket.
func (s *Store) GetBucketDomains(bucket string) ([]string, error) {
	info, ok := s.ensureBuckets().get(bucket)
	if !ok {
		return nil, fmt.Errorf("bucket %s does not exist", bucket)
	}
	return append([]string{}, info.Domains...), nil
}

// ──────────────────────────────────────────────
// Object management
// ──────────────────────────────────────────────

// ListFiles lists objects in a local bucket.
func (s *Store) ListFiles(bucket string, req *stores.ListFilesRequest) (*stores.ListFilesResponse, error) {
	if _, ok := s.ensureBuckets().get(bucket); !ok {
		return nil, fmt.Errorf("bucket %s does not exist", bucket)
	}

	bucketDir := s.bucketPath(bucket)
	var files []stores.FileInfo
	var commonPrefixes []string
	prefixMap := make(map[string]bool)

	prefix := ""
	delimiter := ""
	limit := 0
	if req != nil {
		prefix = req.Prefix
		delimiter = req.Delimiter
		limit = req.Limit
	}

	err := filepath.WalkDir(bucketDir, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}

		relPath, err := filepath.Rel(bucketDir, p)
		if err != nil {
			return err
		}
		key := filepath.ToSlash(relPath)

		if prefix != "" && !strings.HasPrefix(key, prefix) {
			return nil
		}

		if delimiter != "" {
			remaining := strings.TrimPrefix(key, prefix)
			if idx := strings.Index(remaining, delimiter); idx >= 0 {
				commonPrefix := prefix + remaining[:idx+1]
				if !prefixMap[commonPrefix] {
					commonPrefixes = append(commonPrefixes, commonPrefix)
					prefixMap[commonPrefix] = true
				}
				return nil
			}
		}

		info, err := d.Info()
		if err != nil {
			return err
		}

		files = append(files, stores.FileInfo{
			Key:          key,
			Size:         info.Size(),
			LastModified: info.ModTime(),
			ContentType:  getMimeType(key),
			StorageClass: "STANDARD",
			IsLatest:     true,
			PublicURL:    s.bucketPublicURL(bucket, key),
		})
		return nil
	})
	if err != nil {
		return nil, err
	}

	sort.Slice(files, func(i, j int) bool {
		return files[i].Key < files[j].Key
	})
	sort.Strings(commonPrefixes)

	resp := &stores.ListFilesResponse{
		Files:          files,
		CommonPrefixes: commonPrefixes,
		IsTruncated:    false,
	}

	if limit > 0 && len(files) > limit {
		resp.Files = files[:limit]
		resp.IsTruncated = true
		resp.Marker = files[limit-1].Key
	}

	return resp, nil
}

// GetFileInfo returns metadata for a single object.
func (s *Store) GetFileInfo(bucket, key string) (*stores.FileInfo, error) {
	if _, ok := s.ensureBuckets().get(bucket); !ok {
		return nil, fmt.Errorf("bucket %s does not exist", bucket)
	}

	objPath := s.objectPath(bucket, key)
	info, err := os.Stat(objPath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, stores.ErrAttachmentNotExist
		}
		return nil, err
	}

	return &stores.FileInfo{
		Key:          key,
		Size:         info.Size(),
		LastModified: info.ModTime(),
		ContentType:  getMimeType(key),
		StorageClass: "STANDARD",
		IsLatest:     true,
		PublicURL:    s.bucketPublicURL(bucket, key),
	}, nil
}

// UploadFile uploads data to a local bucket.
func (s *Store) UploadFile(bucket, key string, reader io.Reader, size int64) error {
	if _, ok := s.ensureBuckets().get(bucket); !ok {
		return fmt.Errorf("bucket %s does not exist", bucket)
	}

	objPath := s.objectPath(bucket, key)
	if err := os.MkdirAll(filepath.Dir(objPath), s.newDirPerm); err != nil {
		return err
	}

	// Write to temp file then rename for atomicity.
	tmpPath := objPath + ".tmp"
	f, err := os.Create(tmpPath)
	if err != nil {
		return err
	}
	defer f.Close()

	n, err := io.Copy(f, reader)
	if err != nil {
		_ = os.Remove(tmpPath)
		return err
	}
	if size > 0 && n != size {
		_ = os.Remove(tmpPath)
		return fmt.Errorf("short write: wrote %d, expected %d", n, size)
	}
	if err := f.Sync(); err != nil {
		_ = os.Remove(tmpPath)
		return err
	}
	_ = os.RemoveAll(objPath)
	return os.Rename(tmpPath, objPath)
}

// DeleteFile deletes an object from a local bucket.
func (s *Store) DeleteFile(bucket, key string) error {
	if _, ok := s.ensureBuckets().get(bucket); !ok {
		return fmt.Errorf("bucket %s does not exist", bucket)
	}
	objPath := s.objectPath(bucket, key)
	if err := os.RemoveAll(objPath); err != nil {
		return err
	}
	return nil
}

// CopyFile copies an object within or across local buckets.
func (s *Store) CopyFile(req *stores.CopyObjectRequest) error {
	if req == nil {
		return fmt.Errorf("copy request is nil")
	}
	if _, ok := s.ensureBuckets().get(req.SrcBucket); !ok {
		return fmt.Errorf("source bucket %s does not exist", req.SrcBucket)
	}
	if _, ok := s.ensureBuckets().get(req.DestBucket); !ok {
		return fmt.Errorf("destination bucket %s does not exist", req.DestBucket)
	}

	srcPath := s.objectPath(req.SrcBucket, req.SrcKey)
	dstPath := s.objectPath(req.DestBucket, req.DestKey)

	src, err := os.Open(srcPath)
	if err != nil {
		if os.IsNotExist(err) {
			return stores.ErrAttachmentNotExist
		}
		return err
	}
	defer src.Close()

	if err := os.MkdirAll(filepath.Dir(dstPath), s.newDirPerm); err != nil {
		return err
	}

	tmpPath := dstPath + ".tmp"
	dst, err := os.Create(tmpPath)
	if err != nil {
		return err
	}
	defer dst.Close()

	if _, err := io.Copy(dst, src); err != nil {
		_ = os.Remove(tmpPath)
		return err
	}
	if err := dst.Sync(); err != nil {
		_ = os.Remove(tmpPath)
		return err
	}
	_ = os.RemoveAll(dstPath)
	return os.Rename(tmpPath, dstPath)
}

// MoveFile moves an object within or across local buckets.
func (s *Store) MoveFile(req *stores.CopyObjectRequest) error {
	if err := s.CopyFile(req); err != nil {
		return err
	}
	return s.DeleteFile(req.SrcBucket, req.SrcKey)
}

// GetFileURL returns a URL for accessing an object. For local stores
// this is a relative path; the expires parameter is ignored.
func (s *Store) GetFileURL(bucket, key string, expires time.Duration) (string, error) {
	if _, ok := s.ensureBuckets().get(bucket); !ok {
		return "", fmt.Errorf("bucket %s does not exist", bucket)
	}
	objPath := s.objectPath(bucket, key)
	if _, err := os.Stat(objPath); err != nil {
		if os.IsNotExist(err) {
			return "", stores.ErrAttachmentNotExist
		}
		return "", err
	}
	return s.bucketPublicURL(bucket, key), nil
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

// bucketPublicURL returns the public URL for an object in a bucket.
func (s *Store) bucketPublicURL(bucket, key string) string {
	mediaPrefix := strings.TrimSuffix(s.root, "/")
	key = strings.TrimPrefix(key, "/")
	return path.Join("/", mediaPrefix, "buckets", bucket, key)
}

// getMimeType returns the MIME type for a file key.
func getMimeType(key string) string {
	ext := filepath.Ext(key)
	if ext == "" {
		return "application/octet-stream"
	}
	ct := mime.TypeByExtension(ext)
	if ct == "" {
		return "application/octet-stream"
	}
	return ct
}
