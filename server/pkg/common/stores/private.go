// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package stores

import (
	"net/http"
	"time"
)

// TTL bounds for signed URLs / direct-upload credentials. Callers passing a
// non-positive TTL get the default; anything above the max is clamped so a
// bad caller can never mint week-long private links by accident.
const (
	DefaultSignedURLTTL    = 1 * time.Hour
	DefaultDirectUploadTTL = 1 * time.Hour
	MaxPresignTTL          = 24 * time.Hour
)

// ErrDirectUploadUnsupported is returned by PresignUpload when the configured
// backend cannot issue client direct-upload credentials (e.g. local disk).
var ErrDirectUploadUnsupported = &StoreError{Code: http.StatusNotImplemented, Message: "direct upload not supported by this storage backend"}

// PrivateURLSigner is implemented by stores that can mint expiring signed GET
// URLs for objects in a private bucket.
type PrivateURLSigner interface {
	SignedURL(key string, expires time.Duration) (string, error)
}

// DirectUploadPresigner is implemented by stores that support client direct
// upload (browser/device → storage) without proxying the object bytes through
// this server.
type DirectUploadPresigner interface {
	// PresignUpload issues one-shot upload credentials for key. contentType
	// may be empty; when set, backends that sign it require the client to
	// send the same Content-Type header.
	PresignUpload(key, contentType string, expires time.Duration) (*DirectUpload, error)
}

// DirectUpload describes how a client must perform a direct upload.
// Method "PUT" → send the raw body to URL with Headers.
// Method "POST" → send multipart/form-data to URL with Form fields plus the
// file under FileField (Qiniu-style form upload).
type DirectUpload struct {
	Provider  string            `json:"provider"`
	Method    string            `json:"method"`
	URL       string            `json:"url"`
	Headers   map[string]string `json:"headers,omitempty"`
	Form      map[string]string `json:"form,omitempty"`
	FileField string            `json:"fileField,omitempty"`
	Key       string            `json:"key"`
	ExpiresAt time.Time         `json:"expiresAt"`
}

// SignedURL returns an expiring access URL for key. Stores without private
// signing (e.g. local disk, public buckets) fall back to PublicURL.
func SignedURL(s Store, key string, expires time.Duration) (string, error) {
	expires = clampPresignTTL(expires, DefaultSignedURLTTL)
	if signer, ok := s.(PrivateURLSigner); ok {
		return signer.SignedURL(key, expires)
	}
	u := s.PublicURL(key)
	if u == "" {
		return "", ErrInvalidPath
	}
	return u, nil
}

// PresignUpload issues client direct-upload credentials for key, or
// ErrDirectUploadUnsupported when the backend cannot (callers then use the
// regular server-side upload path).
func PresignUpload(s Store, key, contentType string, expires time.Duration) (*DirectUpload, error) {
	expires = clampPresignTTL(expires, DefaultDirectUploadTTL)
	if p, ok := s.(DirectUploadPresigner); ok {
		return p.PresignUpload(key, contentType, expires)
	}
	return nil, ErrDirectUploadUnsupported
}

func clampPresignTTL(d, def time.Duration) time.Duration {
	if d <= 0 {
		return def
	}
	if d > MaxPresignTTL {
		return MaxPresignTTL
	}
	return d
}
