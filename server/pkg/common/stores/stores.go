// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package stores provides a unified storage abstraction layer supporting
// multiple cloud object storage backends and local file system storage.
//
// All backends implement the Store interface with five operations:
// Read, Write, Delete, Exists, and PublicURL. Configuration is injected
// explicitly via provider-specific Config structs — no environment variables
// are read inside the library.
//
// Each provider lives in its own Go module so applications only import the
// cloud SDK they actually use:
//
//	common/stores/local   - Local filesystem (no cloud SDK)
//	common/stores/s3      - AWS S3 / S3 compatible
//	common/stores/oss     - Alibaba Cloud OSS
//	common/stores/cos     - Tencent Cloud COS
//	common/stores/minio   - MinIO / S3 compatible
//	common/stores/kodo    - Qiniu Kodo
//	common/stores/tos     - Volcengine TOS
//	common/stores/obs     - Huawei Cloud OBS
//	common/stores/ks3     - Kingsoft Cloud KS3
package stores

import (
	"errors"
	"io"
)

// Store is the unified object storage interface. All backends implement it.
type Store interface {
	// Read returns an io.ReadCloser for the object at key, plus its size.
	Read(key string) (io.ReadCloser, int64, error)
	// Write stores the contents of r under key.
	Write(key string, r io.Reader) error
	// Delete removes the object at key. No error is returned if the key
	// does not exist.
	Delete(key string) error
	// Exists reports whether an object exists at key.
	Exists(key string) (bool, error)
	// PublicURL returns a publicly accessible URL for key, or "" if the
	// backend cannot construct one.
	PublicURL(key string) string
}

// StoreError is a structured error returned by store backends.
type StoreError struct {
	Code    int    // HTTP status code or 0
	Message string // human-readable message
}

func (e *StoreError) Error() string {
	if e.Message == "" {
		return "store error"
	}
	return e.Message
}

// Sentinel errors.
var (
	// ErrInvalidPath is returned when a key resolves outside the allowed
	// root directory (path traversal) or is otherwise malformed.
	ErrInvalidPath = errors.New("invalid storage path")

	// ErrAttachmentNotExist is returned when an object is not found.
	ErrAttachmentNotExist = errors.New("attachment does not exist")
)

// DefaultUploadDir is the default local upload directory.
const DefaultUploadDir = "uploads"
