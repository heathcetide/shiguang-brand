// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package minio provides a MinIO (S3-compatible) Store implementation.
package minio

import (
	"context"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common/stores"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

// Config holds MinIO storage configuration.
type Config struct {
	Endpoint  string
	AccessKey string
	SecretKey string
	Bucket    string
	UseSSL    bool
	BaseURL   string // optional custom base URL for PublicURL
}

// Store implements stores.Store backed by MinIO.
type Store struct {
	cfg     Config
	baseURL string
}

// New creates a MinIO-backed store from the given config.
func New(cfg Config) *Store {
	return &Store{cfg: cfg, baseURL: cfg.BaseURL}
}

// SetBaseURL overrides the base URL used by PublicURL.
func (s *Store) SetBaseURL(baseURL string) {
	s.baseURL = baseURL
}

func (s *Store) client() (*minio.Client, error) {
	return minio.New(s.cfg.Endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(s.cfg.AccessKey, s.cfg.SecretKey, ""),
		Secure: s.cfg.UseSSL,
	})
}

func (s *Store) ensureBucket(ctx context.Context, cli *minio.Client) error {
	exists, err := cli.BucketExists(ctx, s.cfg.Bucket)
	if err != nil {
		return err
	}
	if !exists {
		return cli.MakeBucket(ctx, s.cfg.Bucket, minio.MakeBucketOptions{})
	}
	return nil
}

// Read reads a file from MinIO.
func (s *Store) Read(key string) (io.ReadCloser, int64, error) {
	cli, err := s.client()
	if err != nil {
		return nil, 0, err
	}
	obj, err := cli.GetObject(context.Background(), s.cfg.Bucket, key, minio.GetObjectOptions{})
	if err != nil {
		return nil, 0, err
	}
	st, err := obj.Stat()
	if err != nil {
		return nil, 0, err
	}
	return obj, st.Size, nil
}

// Write writes a file to MinIO.
func (s *Store) Write(key string, r io.Reader) error {
	cli, err := s.client()
	if err != nil {
		return err
	}
	if err := s.ensureBucket(context.Background(), cli); err != nil {
		return err
	}
	_, err = cli.PutObject(context.Background(), s.cfg.Bucket, key, r, -1, minio.PutObjectOptions{ContentType: http.DetectContentType([]byte{})})
	return err
}

// Delete deletes a file from MinIO.
func (s *Store) Delete(key string) error {
	cli, err := s.client()
	if err != nil {
		return err
	}
	return cli.RemoveObject(context.Background(), s.cfg.Bucket, key, minio.RemoveObjectOptions{})
}

// Exists checks if a file exists in MinIO.
func (s *Store) Exists(key string) (bool, error) {
	cli, err := s.client()
	if err != nil {
		return false, err
	}
	_, err = cli.StatObject(context.Background(), s.cfg.Bucket, key, minio.StatObjectOptions{})
	if err != nil {
		if minio.ToErrorResponse(err).Code == "NoSuchKey" {
			return false, nil
		}
		return false, err
	}
	return true, nil
}

// SignedURL implements stores.PrivateURLSigner via a MinIO presigned GET.
func (s *Store) SignedURL(key string, expires time.Duration) (string, error) {
	cli, err := s.client()
	if err != nil {
		return "", err
	}
	u, err := cli.PresignedGetObject(context.Background(), s.cfg.Bucket, key, expires, url.Values{})
	if err != nil {
		return "", err
	}
	return u.String(), nil
}

// PresignUpload implements stores.DirectUploadPresigner via a MinIO presigned PUT.
func (s *Store) PresignUpload(key, contentType string, expires time.Duration) (*stores.DirectUpload, error) {
	cli, err := s.client()
	if err != nil {
		return nil, err
	}
	if err := s.ensureBucket(context.Background(), cli); err != nil {
		return nil, err
	}
	u, err := cli.PresignedPutObject(context.Background(), s.cfg.Bucket, key, expires)
	if err != nil {
		return nil, err
	}
	headers := map[string]string{}
	if contentType != "" {
		headers["Content-Type"] = contentType
	}
	return &stores.DirectUpload{
		Provider:  "minio",
		Method:    http.MethodPut,
		URL:       u.String(),
		Headers:   headers,
		Key:       key,
		ExpiresAt: time.Now().Add(expires),
	}, nil
}

// PublicURL returns the public URL for a file.
func (s *Store) PublicURL(key string) string {
	if s.baseURL != "" {
		return strings.TrimRight(s.baseURL, "/") + "/" + s.cfg.Bucket + "/" + key
	}
	scheme := "http://"
	if s.cfg.UseSSL {
		scheme = "https://"
	}
	return scheme + s.cfg.Endpoint + "/" + s.cfg.Bucket + "/" + key
}
