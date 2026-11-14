// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package tos provides a Volcengine TOS Store implementation.
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

// Config holds Volcengine TOS storage configuration.
type Config struct {
	Endpoint        string
	Region          string
	AccessKeyID     string
	AccessKeySecret string
	BucketName      string
	Domain          string // optional custom domain for public access
}

// Store implements stores.Store backed by Volcengine TOS.
type Store struct {
	cfg Config
}

// New creates a TOS-backed store from the given config.
func New(cfg Config) *Store {
	return &Store{cfg: cfg}
}

func (s *Store) client(ctx context.Context) (*tos.ClientV2, error) {
	return tos.NewClientV2(
		s.cfg.Endpoint,
		tos.WithRegion(s.cfg.Region),
		tos.WithCredentials(tos.NewStaticCredentials(s.cfg.AccessKeyID, s.cfg.AccessKeySecret)),
	)
}

// Read reads a file from TOS.
func (s *Store) Read(key string) (io.ReadCloser, int64, error) {
	ctx := context.Background()
	client, err := s.client(ctx)
	if err != nil {
		return nil, 0, fmt.Errorf("failed to create TOS client: %w", err)
	}
	result, err := client.GetObjectV2(ctx, &tos.GetObjectV2Input{
		Bucket: s.cfg.BucketName,
		Key:    key,
	})
	if err != nil {
		return nil, 0, fmt.Errorf("failed to get object from TOS: %w", err)
	}
	var size int64
	if result.ContentLength > 0 {
		size = result.ContentLength
	}
	return result.Content, size, nil
}

// Write writes a file to TOS.
func (s *Store) Write(key string, r io.Reader) error {
	ctx := context.Background()
	client, err := s.client(ctx)
	if err != nil {
		return fmt.Errorf("failed to create TOS client: %w", err)
	}
	_, err = client.PutObjectV2(ctx, &tos.PutObjectV2Input{
		PutObjectBasicInput: tos.PutObjectBasicInput{
			Bucket: s.cfg.BucketName,
			Key:    key,
		},
		Content: r,
	})
	if err != nil {
		return fmt.Errorf("failed to upload object to TOS: %w", err)
	}
	return nil
}

// Delete deletes a file from TOS.
func (s *Store) Delete(key string) error {
	ctx := context.Background()
	client, err := s.client(ctx)
	if err != nil {
		return fmt.Errorf("failed to create TOS client: %w", err)
	}
	_, err = client.DeleteObjectV2(ctx, &tos.DeleteObjectV2Input{
		Bucket: s.cfg.BucketName,
		Key:    key,
	})
	if err != nil {
		return fmt.Errorf("failed to delete object from TOS: %w", err)
	}
	return nil
}

// Exists checks if a file exists in TOS.
func (s *Store) Exists(key string) (bool, error) {
	ctx := context.Background()
	client, err := s.client(ctx)
	if err != nil {
		return false, fmt.Errorf("failed to create TOS client: %w", err)
	}
	_, err = client.HeadObjectV2(ctx, &tos.HeadObjectV2Input{
		Bucket: s.cfg.BucketName,
		Key:    key,
	})
	if err != nil {
		if strings.Contains(err.Error(), "404") || strings.Contains(strings.ToLower(err.Error()), "not found") {
			return false, nil
		}
		return false, fmt.Errorf("failed to check object existence in TOS: %w", err)
	}
	return true, nil
}

// SignedURL implements stores.PrivateURLSigner via a TOS presigned GET.
func (s *Store) SignedURL(key string, expires time.Duration) (string, error) {
	client, err := s.client(context.Background())
	if err != nil {
		return "", fmt.Errorf("failed to create TOS client: %w", err)
	}
	out, err := client.PreSignedURL(&tos.PreSignedURLInput{
		HTTPMethod: enum.HttpMethodGet,
		Bucket:     s.cfg.BucketName,
		Key:        key,
		Expires:    int64(expires / time.Second),
	})
	if err != nil {
		return "", fmt.Errorf("failed to presign TOS get: %w", err)
	}
	return out.SignedUrl, nil
}

// PresignUpload implements stores.DirectUploadPresigner via a TOS presigned PUT.
func (s *Store) PresignUpload(key, contentType string, expires time.Duration) (*stores.DirectUpload, error) {
	client, err := s.client(context.Background())
	if err != nil {
		return nil, fmt.Errorf("failed to create TOS client: %w", err)
	}
	in := &tos.PreSignedURLInput{
		HTTPMethod: enum.HttpMethodPut,
		Bucket:     s.cfg.BucketName,
		Key:        key,
		Expires:    int64(expires / time.Second),
	}
	headers := map[string]string{}
	if contentType != "" {
		in.Header = map[string]string{"Content-Type": contentType}
		headers["Content-Type"] = contentType
	}
	out, err := client.PreSignedURL(in)
	if err != nil {
		return nil, fmt.Errorf("failed to presign TOS put: %w", err)
	}
	return &stores.DirectUpload{
		Provider:  "tos",
		Method:    "PUT",
		URL:       out.SignedUrl,
		Headers:   headers,
		Key:       key,
		ExpiresAt: time.Now().Add(expires),
	}, nil
}

// PublicURL returns the public URL for a file in TOS.
func (s *Store) PublicURL(key string) string {
	key = strings.TrimPrefix(key, "/")
	if s.cfg.Domain != "" {
		domain := strings.TrimSuffix(s.cfg.Domain, "/")
		if !strings.HasPrefix(domain, "http://") && !strings.HasPrefix(domain, "https://") {
			domain = "https://" + domain
		}
		return fmt.Sprintf("%s/%s", domain, key)
	}
	endpoint := strings.TrimPrefix(strings.TrimPrefix(s.cfg.Endpoint, "https://"), "http://")
	return fmt.Sprintf("https://%s.%s/%s", s.cfg.BucketName, endpoint, key)
}
