// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package cos provides a Tencent Cloud COS Store implementation.
package cos

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common/stores"

	"github.com/tencentyun/cos-go-sdk-v5"
)

// Config holds Tencent Cloud COS storage configuration.
type Config struct {
	SecretID   string
	SecretKey  string
	Region     string
	BucketName string
}

// Store implements stores.Store backed by Tencent Cloud COS.
type Store struct {
	cfg Config
}

// New creates a COS-backed store from the given config.
func New(cfg Config) *Store {
	return &Store{cfg: cfg}
}

func (s *Store) validate() error {
	if s.cfg.SecretID == "" || s.cfg.SecretKey == "" || s.cfg.Region == "" {
		return fmt.Errorf("COS credentials not configured")
	}
	return nil
}

func (s *Store) client() (*cos.Client, error) {
	if err := s.validate(); err != nil {
		return nil, err
	}
	bucketURL := fmt.Sprintf("https://%s.cos.%s.myqcloud.com", s.cfg.BucketName, s.cfg.Region)
	u, _ := url.Parse(bucketURL)
	b := &cos.BaseURL{BucketURL: u}
	return cos.NewClient(b, &http.Client{
		Transport: &cos.AuthorizationTransport{
			SecretID:  s.cfg.SecretID,
			SecretKey: s.cfg.SecretKey,
		},
	}), nil
}

// Delete implements Store.
func (s *Store) Delete(key string) error {
	c, err := s.client()
	if err != nil {
		return err
	}
	_, err = c.Object.Delete(context.Background(), key)
	return err
}

// Exists implements Store.
func (s *Store) Exists(key string) (bool, error) {
	c, err := s.client()
	if err != nil {
		return false, err
	}
	return c.Object.IsExist(context.Background(), key)
}

// Read implements Store.
func (s *Store) Read(key string) (io.ReadCloser, int64, error) {
	c, err := s.client()
	if err != nil {
		return nil, 0, err
	}
	resp, err := c.Object.Get(context.Background(), key, nil)
	if err != nil {
		return nil, 0, err
	}
	var size int64 = -1
	if cl := resp.Header.Get("Content-Length"); cl != "" {
		if v, err := fmt.Sscanf(cl, "%d", &size); err != nil || v != 1 {
			size = -1
		}
	}
	return resp.Body, size, nil
}

// Write implements Store.
func (s *Store) Write(key string, r io.Reader) error {
	c, err := s.client()
	if err != nil {
		return err
	}
	_, err = c.Object.Put(context.Background(), key, r, nil)
	return err
}

// SignedURL implements stores.PrivateURLSigner via a COS presigned GET.
func (s *Store) SignedURL(key string, expires time.Duration) (string, error) {
	c, err := s.client()
	if err != nil {
		return "", err
	}
	u, err := c.Object.GetPresignedURL(context.Background(), http.MethodGet, key, s.cfg.SecretID, s.cfg.SecretKey, expires, nil)
	if err != nil {
		return "", err
	}
	return u.String(), nil
}

// PresignUpload implements stores.DirectUploadPresigner via a COS presigned PUT.
func (s *Store) PresignUpload(key, contentType string, expires time.Duration) (*stores.DirectUpload, error) {
	c, err := s.client()
	if err != nil {
		return nil, err
	}
	u, err := c.Object.GetPresignedURL(context.Background(), http.MethodPut, key, s.cfg.SecretID, s.cfg.SecretKey, expires, nil)
	if err != nil {
		return nil, err
	}
	headers := map[string]string{}
	if contentType != "" {
		headers["Content-Type"] = contentType
	}
	return &stores.DirectUpload{
		Provider:  "cos",
		Method:    http.MethodPut,
		URL:       u.String(),
		Headers:   headers,
		Key:       key,
		ExpiresAt: time.Now().Add(expires),
	}, nil
}

// PublicURL returns the public URL for a file.
func (s *Store) PublicURL(key string) string {
	return fmt.Sprintf("https://%s.cos.%s.myqcloud.com/%s", s.cfg.BucketName, s.cfg.Region, key)
}
