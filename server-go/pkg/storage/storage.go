// Copyright (c) 2026 heathcetide. All rights reserved.

// Package storage wraps ling-base/stores object storage as a package-level singleton.
//
// Usage:
//
//	// Initialize at startup in main.go
//	pkgstorage.Init(cfg.Storage)
//
//	// Call directly from handler / service
//	pkgstorage.Write("avatars/photo.jpg", reader)
//	url := pkgstorage.PublicURL("avatars/photo.jpg")
//
// To switch to cloud storage (S3/OSS/COS/MinIO etc.):
//  1. go get the corresponding driver module, e.g. go get github.com/heathcetide/DietDigiDose/pkg/stores/s3
//  2. Add a case in Init() for the driver
//  3. Set storage.driver in configs/config.yaml
package storage

import (
	"fmt"
	"io"
	"os"

	"github.com/heathcetide/DietDigiDose/pkg/stores"
	"github.com/heathcetide/DietDigiDose/pkg/stores/local"
)

// Package-level singleton.
var (
	// Store is the active object storage instance. nil until Init() is called.
	Store stores.Store

	// MaxFileSize is the maximum file size in bytes (0 = unlimited).
	MaxFileSize int64

	// PublicURLBase is the public access base URL (empty = use Store.PublicURL() default).
	PublicURLBase string
)

// Init initializes the object storage singleton from configuration.
// Default backend is local (local filesystem, zero cloud SDK dependency).
// Switching drivers requires go get of the corresponding module and adding a case.
func Init(driver, root, region, endpoint, accessKey, secretKey, publicURLBase string, maxFileSize int64) error {
	switch driver {
	case "local", "":
		Store = local.New(local.Config{
			Root:       root,
			NewDirPerm: 0755,
		})
	// ── Additional backends require go get of the corresponding module ──
	// case "s3":
	//     Store = s3.New(s3.Config{Bucket: root, Region: region, AccessKey: accessKey, SecretKey: secretKey, Endpoint: endpoint})
	// case "oss":
	//     Store = oss.New(oss.Config{Bucket: root, Region: region, AccessKey: accessKey, SecretKey: secretKey})
	// case "cos":
	//     Store = cos.New(cos.Config{Bucket: root, Region: region, SecretID: accessKey, SecretKey: secretKey})
	// case "minio":
	//     Store = minio.New(minio.Config{Bucket: root, Endpoint: endpoint, AccessKey: accessKey, SecretKey: secretKey})
	default:
		return fmt.Errorf("unsupported storage driver: %s (go get the corresponding module first)", driver)
	}

	MaxFileSize = maxFileSize
	PublicURLBase = publicURLBase
	return nil
}

// Convenience methods — operate on the global Store

// Write stores the content from reader to the given key.
func Write(key string, r io.Reader) error {
	if Store == nil {
		return fmt.Errorf("storage not initialized, call Init() first")
	}
	return Store.Write(key, r)
}

// Read returns a reader and size for the object at the given key.
func Read(key string) (io.ReadCloser, int64, error) {
	if Store == nil {
		return nil, 0, fmt.Errorf("storage not initialized, call Init() first")
	}
	return Store.Read(key)
}

// Delete removes the object at the given key (no error if it does not exist).
func Delete(key string) error {
	if Store == nil {
		return fmt.Errorf("storage not initialized, call Init() first")
	}
	return Store.Delete(key)
}

// Exists checks whether the object at the given key exists.
func Exists(key string) (bool, error) {
	if Store == nil {
		return false, fmt.Errorf("storage not initialized, call Init() first")
	}
	return Store.Exists(key)
}

// PublicURL returns the public access URL for the given key.
// If PublicURLBase is set, it returns PublicURLBase/key; otherwise Store.PublicURL().
func PublicURL(key string) string {
	if Store == nil {
		return ""
	}
	if PublicURLBase != "" {
		return PublicURLBase + "/" + key
	}
	return Store.PublicURL(key)
}

// CheckFileSize validates that the file size is within the allowed limit.
// maxSize of 0 means unlimited.
func CheckFileSize(size int64) error {
	if MaxFileSize > 0 && size > MaxFileSize {
		return fmt.Errorf("file size %d exceeds limit %d", size, MaxFileSize)
	}
	return nil
}

// Close releases resources (local backend needs no cleanup; kept for cloud backend compatibility).
func Close() error {
	// local backend needs no close; cloud backends with Close methods can be called here
	_ = os.Stdout // avoid unused import warning (when no cloud backend is integrated)
	return nil
}
