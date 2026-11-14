// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package s3 provides an Amazon S3 (and S3-compatible) Store implementation.
package s3

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

// Config holds Amazon S3 storage configuration.
type Config struct {
	Region          string
	AccessKeyID     string
	AccessKeySecret string
	BucketName      string
	Endpoint        string // custom endpoint for S3-compatible services
	UsePathStyle    bool
	Domain          string // custom domain for public access
}

// Store implements stores.Store backed by Amazon S3.
type Store struct {
	cfg Config
}

// New creates an S3-backed store from the given config.
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

	options := []func(*s3.Options){}
	if s.cfg.Endpoint != "" {
		options = append(options, func(o *s3.Options) {
			o.BaseEndpoint = aws.String(s.cfg.Endpoint)
			o.UsePathStyle = s.cfg.UsePathStyle
		})
	}
	return s3.NewFromConfig(cfg, options...), nil
}

// Read reads a file from S3.
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
		return nil, 0, fmt.Errorf("failed to get object: %w", err)
	}
	var size int64
	if result.ContentLength != nil {
		size = *result.ContentLength
	}
	return result.Body, size, nil
}

// Write writes a file to S3.
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
		return fmt.Errorf("failed to upload object: %w", err)
	}
	return nil
}

// Delete deletes a file from S3.
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
		return fmt.Errorf("failed to delete object: %w", err)
	}
	return nil
}

// Exists checks if a file exists in S3.
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
		if strings.Contains(err.Error(), "NoSuchKey") || strings.Contains(err.Error(), "NotFound") {
			return false, nil
		}
		return false, fmt.Errorf("failed to check object existence: %w", err)
	}
	return true, nil
}

// SignedURL implements stores.PrivateURLSigner via an S3 presigned GET.
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
		return "", fmt.Errorf("failed to presign get object: %w", err)
	}
	return out.URL, nil
}

// PresignUpload implements stores.DirectUploadPresigner via an S3 presigned PUT.
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
		return nil, fmt.Errorf("failed to presign put object: %w", err)
	}
	headers := map[string]string{}
	if contentType != "" {
		headers["Content-Type"] = contentType
	}
	return &stores.DirectUpload{
		Provider:  "s3",
		Method:    out.Method,
		URL:       out.URL,
		Headers:   headers,
		Key:       key,
		ExpiresAt: time.Now().Add(expires),
	}, nil
}

// PublicURL returns the public URL for a file.
func (s *Store) PublicURL(key string) string {
	if s.cfg.Domain != "" {
		domain := strings.TrimSuffix(s.cfg.Domain, "/")
		if !strings.HasPrefix(domain, "http://") && !strings.HasPrefix(domain, "https://") {
			domain = "https://" + domain
		}
		return fmt.Sprintf("%s/%s", domain, strings.TrimPrefix(key, "/"))
	}
	if s.cfg.Endpoint != "" {
		endpoint := strings.TrimSuffix(s.cfg.Endpoint, "/")
		if s.cfg.UsePathStyle {
			return fmt.Sprintf("%s/%s/%s", endpoint, s.cfg.BucketName, strings.TrimPrefix(key, "/"))
		}
		return fmt.Sprintf("%s/%s", endpoint, strings.TrimPrefix(key, "/"))
	}
	return fmt.Sprintf("https://%s.s3.%s.amazonaws.com/%s", s.cfg.BucketName, s.cfg.Region, strings.TrimPrefix(key, "/"))
}
