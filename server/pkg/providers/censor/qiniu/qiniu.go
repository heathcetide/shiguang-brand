// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package qiniu provides Qiniu content moderation implementations for text,
// image, audio, and video. It depends only on the Qiniu Go SDK.
package qiniu

import (
	"fmt"
	"net/http"
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common/netutil"
	"github.com/qiniu/go-sdk/v7/auth"
)

// Config holds Qiniu content moderation credentials.
type Config struct {
	AccessKey string
	SecretKey string
	Host      string       // defaults to "ai.qiniuapi.com" if empty
	Client    *http.Client // defaults to a standard HTTP client with 30s timeout if nil
}

// newMAC builds the Qiniu auth credentials from the config.
func newMAC(cfg Config) (*auth.Credentials, error) {
	if cfg.AccessKey == "" || cfg.SecretKey == "" {
		return nil, fmt.Errorf("qiniu requires AccessKey and SecretKey")
	}
	return auth.New(cfg.AccessKey, cfg.SecretKey), nil
}

// defaultHost returns cfg.Host or the Qiniu AI default.
func defaultHost(host string) string {
	if host == "" {
		return "ai.qiniuapi.com"
	}
	return host
}

// defaultClient returns cfg.Client or a standard HTTP client with a 30s timeout.
func defaultClient(c *http.Client) *http.Client {
	if c == nil {
		return netutil.NewStandardHTTPClient(netutil.HTTPClientConfig{Timeout: 30 * time.Second})
	}
	return c
}
