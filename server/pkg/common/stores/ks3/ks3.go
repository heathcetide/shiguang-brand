// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package ks3 provides a Kingsoft Cloud KS3 Store implementation.
package ks3

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common/stores"

	ks3aws "github.com/ks3sdklib/aws-sdk-go/aws"
	"github.com/ks3sdklib/aws-sdk-go/aws/credentials"
	ks3s3 "github.com/ks3sdklib/aws-sdk-go/service/s3"
)

// Config holds Kingsoft Cloud KS3 storage configuration.
type Config struct {
	Endpoint        string
	Region          string
	AccessKeyID     string
	AccessKeySecret string
	BucketName      string
	Domain          string // optional custom domain for public access
}

// Store implements stores.Store backed by Kingsoft Cloud KS3.
type Store struct {
	cfg Config
}

// New creates a KS3-backed store from the given config.
func New(cfg Config) *Store {
	return &Store{cfg: cfg}
}

func (s *Store) client() *ks3s3.S3 {
	creds := credentials.NewStaticCredentials(s.cfg.AccessKeyID, s.cfg.AccessKeySecret, "")
	return ks3s3.New(&ks3aws.Config{
		Credentials:      creds,
		Region:           s.cfg.Region,
		Endpoint:         s.cfg.Endpoint,
		DisableSSL:       false,
		S3ForcePathStyle: false,
		SignerVersion:    "V2",
		MaxRetries:       3,
	})
}

// Read reads a file from KS3.
func (s *Store) Read(key string) (io.ReadCloser, int64, error) {
	client := s.client()
	result, err := client.GetObject(&ks3s3.GetObjectInput{
		Bucket: ks3aws.String(s.cfg.BucketName),
		Key:    ks3aws.String(key),
	})
	if err != nil {
		return nil, 0, fmt.Errorf("failed to get object from KS3: %w", err)
	}
	var size int64
	if result.ContentLength != nil {
		size = *result.ContentLength
	}
	return result.Body, size, nil
}

// Write writes a file to KS3.
func (s *Store) Write(key string, r io.Reader) error {
	data, err := io.ReadAll(r)
	if err != nil {
		return fmt.Errorf("failed to read upload body: %w", err)
	}
	client := s.client()
	_, err = client.PutObject(&ks3s3.PutObjectInput{
		Bucket: ks3aws.String(s.cfg.BucketName),
		Key:    ks3aws.String(key),
		Body:   bytes.NewReader(data),
	})
	if err != nil {
		return fmt.Errorf("failed to upload object to KS3: %w", err)
	}
	return nil
}

// Delete deletes a file from KS3.
func (s *Store) Delete(key string) error {
	client := s.client()
	_, err := client.DeleteObject(&ks3s3.DeleteObjectInput{
		Bucket: ks3aws.String(s.cfg.BucketName),
		Key:    ks3aws.String(key),
	})
	if err != nil {
		return fmt.Errorf("failed to delete object from KS3: %w", err)
	}
	return nil
}

// Exists checks if a file exists in KS3.
func (s *Store) Exists(key string) (bool, error) {
	client := s.client()
	_, err := client.HeadObject(&ks3s3.HeadObjectInput{
		Bucket: ks3aws.String(s.cfg.BucketName),
		Key:    ks3aws.String(key),
	})
	if err != nil {
		if strings.Contains(err.Error(), "NotFound") || strings.Contains(err.Error(), "404") || strings.Contains(err.Error(), "NoSuchKey") {
			return false, nil
		}
		return false, fmt.Errorf("failed to check object existence in KS3: %w", err)
	}
	return true, nil
}

// SignedURL implements stores.PrivateURLSigner via a KS3 presigned GET.
func (s *Store) SignedURL(key string, expires time.Duration) (string, error) {
	client := s.client()
	u, err := client.GeneratePresignedUrl(&ks3s3.GeneratePresignedUrlInput{
		Bucket:     ks3aws.String(s.cfg.BucketName),
		Key:        ks3aws.String(key),
		HTTPMethod: ks3s3.GET,
		Expires:    int64(expires / time.Second),
	})
	if err != nil {
		return "", fmt.Errorf("failed to presign KS3 get: %w", err)
	}
	return u, nil
}

// PresignUpload implements stores.DirectUploadPresigner via a KS3 presigned PUT.
func (s *Store) PresignUpload(key, contentType string, expires time.Duration) (*stores.DirectUpload, error) {
	client := s.client()
	in := &ks3s3.GeneratePresignedUrlInput{
		Bucket:     ks3aws.String(s.cfg.BucketName),
		Key:        ks3aws.String(key),
		HTTPMethod: ks3s3.PUT,
		Expires:    int64(expires / time.Second),
	}
	headers := map[string]string{}
	if contentType != "" {
		in.ContentType = ks3aws.String(contentType)
		headers["Content-Type"] = contentType
	}
	u, err := client.GeneratePresignedUrl(in)
	if err != nil {
		return nil, fmt.Errorf("failed to presign KS3 put: %w", err)
	}
	return &stores.DirectUpload{
		Provider:  "ks3",
		Method:    "PUT",
		URL:       u,
		Headers:   headers,
		Key:       key,
		ExpiresAt: time.Now().Add(expires),
	}, nil
}

// PublicURL returns the public URL for a file in KS3.
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

// CheckConnectivity tests KS3 connectivity using the provided credentials.
func CheckConnectivity(ctx context.Context, endpoint, region, accessKey, secretKey, bucketName string) error {
	creds := credentials.NewStaticCredentials(accessKey, secretKey, "")
	client := ks3s3.New(&ks3aws.Config{
		Credentials:      creds,
		Region:           region,
		Endpoint:         endpoint,
		DisableSSL:       false,
		S3ForcePathStyle: false,
		SignerVersion:    "V2",
	})
	done := make(chan error, 1)
	go func() {
		_, err := client.HeadBucket(&ks3s3.HeadBucketInput{
			Bucket: ks3aws.String(bucketName),
		})
		done <- err
	}()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case err := <-done:
		if err != nil {
			return fmt.Errorf("KS3 connectivity check failed: %w", err)
		}
		return nil
	}
}
