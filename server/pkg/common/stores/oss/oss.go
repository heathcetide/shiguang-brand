// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package oss provides an Alibaba Cloud OSS Store implementation.
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

// Config holds Alibaba Cloud OSS storage configuration.
type Config struct {
	AccessKeyID     string
	AccessKeySecret string
	Endpoint        string
	BucketName      string
	BaseURL         string // optional custom base URL for PublicURL
}

// Store implements stores.Store backed by Alibaba Cloud OSS.
type Store struct {
	cfg     Config
	baseURL string
}

// New creates an OSS-backed store from the given config.
func New(cfg Config) *Store {
	return &Store{cfg: cfg, baseURL: cfg.BaseURL}
}

// SetBaseURL overrides the base URL used by PublicURL.
func (s *Store) SetBaseURL(baseURL string) {
	s.baseURL = baseURL
}

func (s *Store) bucket() (*oss.Bucket, error) {
	if s.cfg.AccessKeyID == "" || s.cfg.AccessKeySecret == "" || s.cfg.Endpoint == "" {
		return nil, fmt.Errorf("OSS credentials not configured")
	}
	client, err := oss.New(s.cfg.Endpoint, s.cfg.AccessKeyID, s.cfg.AccessKeySecret)
	if err != nil {
		return nil, fmt.Errorf("failed to create OSS client: %v", err)
	}
	return client.Bucket(s.cfg.BucketName)
}

// Delete implements Store.
func (s *Store) Delete(key string) error {
	bucket, err := s.bucket()
	if err != nil {
		return err
	}
	return bucket.DeleteObject(key)
}

// Exists implements Store.
func (s *Store) Exists(key string) (bool, error) {
	bucket, err := s.bucket()
	if err != nil {
		return false, err
	}
	return bucket.IsObjectExist(key)
}

// Read implements Store.
func (s *Store) Read(key string) (io.ReadCloser, int64, error) {
	bucket, err := s.bucket()
	if err != nil {
		return nil, 0, err
	}
	props, err := bucket.GetObjectDetailedMeta(key)
	if err != nil {
		return nil, 0, fmt.Errorf("failed to get object meta: %v", err)
	}
	var size int64 = -1
	if cl := props.Get("Content-Length"); cl != "" {
		if v, err := strconv.ParseInt(cl, 10, 64); err == nil {
			size = v
		}
	}
	body, err := bucket.GetObject(key)
	if err != nil {
		return nil, 0, fmt.Errorf("failed to get object: %v", err)
	}
	return body, size, nil
}

// Write implements Store.
func (s *Store) Write(key string, r io.Reader) error {
	bucket, err := s.bucket()
	if err != nil {
		return err
	}
	return bucket.PutObject(key, r)
}

// SignedURL implements stores.PrivateURLSigner via an OSS signed GET URL.
func (s *Store) SignedURL(key string, expires time.Duration) (string, error) {
	bucket, err := s.bucket()
	if err != nil {
		return "", err
	}
	return bucket.SignURL(key, oss.HTTPGet, int64(expires/time.Second))
}

// PresignUpload implements stores.DirectUploadPresigner via an OSS signed PUT URL.
func (s *Store) PresignUpload(key, contentType string, expires time.Duration) (*stores.DirectUpload, error) {
	bucket, err := s.bucket()
	if err != nil {
		return nil, err
	}
	var opts []oss.Option
	headers := map[string]string{}
	if contentType != "" {
		opts = append(opts, oss.ContentType(contentType))
		headers["Content-Type"] = contentType
	}
	u, err := bucket.SignURL(key, oss.HTTPPut, int64(expires/time.Second), opts...)
	if err != nil {
		return nil, err
	}
	return &stores.DirectUpload{
		Provider:  "oss",
		Method:    "PUT",
		URL:       u,
		Headers:   headers,
		Key:       key,
		ExpiresAt: time.Now().Add(expires),
	}, nil
}

// PublicURL returns the public URL for a file.
func (s *Store) PublicURL(key string) string {
	if s.baseURL != "" {
		return fmt.Sprintf("%s/%s", strings.TrimRight(s.baseURL, "/"), key)
	}
	endpoint := strings.TrimPrefix(s.cfg.Endpoint, "http://")
	endpoint = strings.TrimPrefix(endpoint, "https://")
	return fmt.Sprintf("https://%s.%s/%s", s.cfg.BucketName, endpoint, key)
}
