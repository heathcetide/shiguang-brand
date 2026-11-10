// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package obs provides a Huawei Cloud OBS (S3-compatible) Store implementation.
package obs

import (
	"context"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common/stores"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/feature/s3/manager"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

// Config holds Huawei Cloud OBS storage configuration.
type Config struct {
	Endpoint        string
	Region          string
	AccessKeyID     string
	AccessKeySecret string
	BucketName      string
	ProxyDomain     string // optional proxy domain for public access
}

// Store implements stores.Store backed by Huawei Cloud OBS.
type Store struct {
	cfg Config
}

// New creates an OBS-backed store from the given config.
func New(cfg Config) *Store {
	return &Store{cfg: cfg}
}

func (s *Store) client(ctx context.Context) (*s3.Client, error) {
	cfg, err := awsconfig.LoadDefaultConfig(ctx,
		awsconfig.WithRegion(s.cfg.Region),
		awsconfig.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(s.cfg.AccessKeyID, s.cfg.AccessKeySecret, "")),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to load AWS config: %w", err)
	}
	return s3.NewFromConfig(cfg, func(opts *s3.Options) {
		opts.BaseEndpoint = aws.String(s.cfg.Endpoint)
		opts.UsePathStyle = true
	}), nil
}

// Read reads a file from OBS.
func (s *Store) Read(key string) (io.ReadCloser, int64, error) {
	ctx := context.Background()
	client, err := s.client(ctx)
	if err != nil {
		return nil, 0, err
	}
	result, err := client.GetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(s.cfg.BucketName),
		Key:    aws.String(key),
	})
	if err != nil {
		return nil, 0, fmt.Errorf("failed to get object from OBS: %w", err)
	}
	var size int64
	if result.ContentLength != nil {
		size = *result.ContentLength
	}
	return result.Body, size, nil
}

// Write writes a file to OBS.
func (s *Store) Write(key string, r io.Reader) error {
	ctx := context.Background()
	client, err := s.client(ctx)
	if err != nil {
		return err
	}
	uploader := manager.NewUploader(client)
	_, err = uploader.Upload(ctx, &s3.PutObjectInput{
		Bucket: aws.String(s.cfg.BucketName),
		Key:    aws.String(key),
		Body:   r,
	})
	if err != nil {
		return fmt.Errorf("failed to upload object to OBS: %w", err)
	}
	return nil
}

// Delete deletes a file from OBS.
func (s *Store) Delete(key string) error {
	ctx := context.Background()
	client, err := s.client(ctx)
	if err != nil {
		return err
	}
	_, err = client.DeleteObject(ctx, &s3.DeleteObjectInput{
		Bucket: aws.String(s.cfg.BucketName),
		Key:    aws.String(key),
	})
	if err != nil {
		return fmt.Errorf("failed to delete object from OBS: %w", err)
	}
	return nil
}

// Exists checks if a file exists in OBS.
func (s *Store) Exists(key string) (bool, error) {
	ctx := context.Background()
	client, err := s.client(ctx)
	if err != nil {
		return false, err
	}
	_, err = client.HeadObject(ctx, &s3.HeadObjectInput{
		Bucket: aws.String(s.cfg.BucketName),
		Key:    aws.String(key),
	})
	if err != nil {
		if strings.Contains(err.Error(), "NoSuchKey") || strings.Contains(err.Error(), "NotFound") || strings.Contains(err.Error(), "404") {
			return false, nil
		}
		return false, fmt.Errorf("failed to check object existence in OBS: %w", err)
	}
	return true, nil
}

// SignedURL implements stores.PrivateURLSigner via a presigned GET.
func (s *Store) SignedURL(key string, expires time.Duration) (string, error) {
	ctx := context.Background()
	client, err := s.client(ctx)
	if err != nil {
		return "", err
	}
	out, err := s3.NewPresignClient(client).PresignGetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(s.cfg.BucketName),
		Key:    aws.String(key),
	}, s3.WithPresignExpires(expires))
	if err != nil {
		return "", fmt.Errorf("failed to presign OBS get object: %w", err)
	}
	return out.URL, nil
}

// PresignUpload implements stores.DirectUploadPresigner via a presigned PUT.
func (s *Store) PresignUpload(key, contentType string, expires time.Duration) (*stores.DirectUpload, error) {
	ctx := context.Background()
	client, err := s.client(ctx)
	if err != nil {
		return nil, err
	}
	in := &s3.PutObjectInput{
		Bucket: aws.String(s.cfg.BucketName),
		Key:    aws.String(key),
	}
	if contentType != "" {
		in.ContentType = aws.String(contentType)
	}
	out, err := s3.NewPresignClient(client).PresignPutObject(ctx, in, s3.WithPresignExpires(expires))
	if err != nil {
		return nil, fmt.Errorf("failed to presign OBS put object: %w", err)
	}
	headers := map[string]string{}
	if contentType != "" {
		headers["Content-Type"] = contentType
	}
	return &stores.DirectUpload{
		Provider:  "obs",
		Method:    out.Method,
		URL:       out.URL,
		Headers:   headers,
		Key:       key,
		ExpiresAt: time.Now().Add(expires),
	}, nil
}

// PublicURL returns the public URL for a file in OBS.
func (s *Store) PublicURL(key string) string {
	key = strings.TrimPrefix(key, "/")
	if s.cfg.ProxyDomain != "" {
		return fmt.Sprintf("%s/%s", s.cfg.ProxyDomain, key)
	}
	endpoint := strings.TrimSuffix(s.cfg.Endpoint, "/")
	return fmt.Sprintf("%s/%s/%s", endpoint, s.cfg.BucketName, key)
}
