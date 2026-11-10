// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package kodo provides a Qiniu Kodo Store implementation.
package kodo

import (
	"bytes"
	"context"
	"io"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common/stores"

	"github.com/qiniu/go-sdk/v7/auth/qbox"
	"github.com/qiniu/go-sdk/v7/client"
	"github.com/qiniu/go-sdk/v7/storage"
)

// Config holds Qiniu Kodo storage configuration.
type Config struct {
	AccessKey  string
	SecretKey  string
	BucketName string
	Domain     string // e.g. https://cdn.example.com
	Private    bool   // private bucket (signed URLs)
	Region     string // optional region hint (z0/z1/z2/huanan/...)
}

// Store implements stores.Store backed by Qiniu Kodo.
type Store struct {
	cfg Config
}

// New creates a Kodo-backed store from the given config.
func New(cfg Config) *Store {
	return &Store{cfg: cfg}
}

func (s *Store) mac() *qbox.Mac {
	return qbox.NewMac(s.cfg.AccessKey, s.cfg.SecretKey)
}

func (s *Store) makeConfig() storage.Config {
	useHTTPS := strings.HasPrefix(strings.ToLower(s.cfg.Domain), "https://")
	cfg := storage.Config{UseHTTPS: useHTTPS}
	if zone := regionFromHint(s.cfg.Region); zone != nil {
		cfg.Region = zone
		return cfg
	}
	if zone, err := storage.GetRegion(s.cfg.AccessKey, s.cfg.BucketName); err == nil && zone != nil {
		cfg.Region = zone
	}
	return cfg
}

func regionFromHint(hint string) *storage.Region {
	switch strings.ToLower(strings.TrimSpace(hint)) {
	case "z0", "huadong", "east", "cn-east-1":
		z := storage.ZoneHuadong
		return &z
	case "z1", "huabei", "north", "cn-north-1":
		z := storage.ZoneHuabei
		return &z
	case "z2", "huanan", "south", "cn-south-1":
		z := storage.ZoneHuanan
		return &z
	case "na0", "beimei", "north_america":
		z := storage.ZoneBeimei
		return &z
	case "as0", "xinjiapo", "singapore":
		z := storage.ZoneXinjiapo
		return &z
	case "cn-east-2", "huadongzhejiang2", "zhejiang2":
		z := storage.ZoneHuadongZheJiang2
		return &z
	default:
		return nil
	}
}

// preferIPv4Client returns a Qiniu SDK client whose dialer tries tcp4 first.
// Many egress networks advertise AAAA for upload-*.qiniup.com but have no
// working IPv6 route ("network is unreachable").
func preferIPv4Client() *client.Client {
	ipv4ClientOnce.Do(func() {
		transport := &http.Transport{
			Proxy: http.ProxyFromEnvironment,
			DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
				d := &net.Dialer{Timeout: 30 * time.Second, KeepAlive: 30 * time.Second}
				if c, err := d.DialContext(ctx, "tcp4", addr); err == nil {
					return c, nil
				}
				return d.DialContext(ctx, network, addr)
			},
			ForceAttemptHTTP2:     true,
			MaxIdleConns:          100,
			IdleConnTimeout:       90 * time.Second,
			TLSHandshakeTimeout:   10 * time.Second,
			ExpectContinueTimeout: 1 * time.Second,
		}
		ipv4Client = &client.Client{Client: &http.Client{Transport: transport}}
	})
	return ipv4Client
}

var (
	ipv4ClientOnce sync.Once
	ipv4Client     *client.Client
)

func (s *Store) uploadToken() string {
	p := storage.PutPolicy{Scope: s.cfg.BucketName, Expires: 3600}
	return p.UploadToken(s.mac())
}

func (s *Store) normalizedDomain() string {
	d := s.cfg.Domain
	if !strings.HasPrefix(d, "http://") && !strings.HasPrefix(d, "https://") {
		d = "http://" + d
	}
	return d
}

// Write uploads a file to Kodo via form upload.
func (s *Store) Write(key string, r io.Reader) error {
	data, err := io.ReadAll(r)
	if err != nil {
		return err
	}
	cfg := s.makeConfig()
	uploader := storage.NewFormUploaderEx(&cfg, preferIPv4Client())
	ret := storage.PutRet{}
	extra := storage.PutExtra{}
	return uploader.Put(context.Background(), &ret, s.uploadToken(), key, bytes.NewReader(data), int64(len(data)), &extra)
}

// Exists checks if a file exists in Kodo (code 612 = not found).
func (s *Store) Exists(key string) (bool, error) {
	cfg := s.makeConfig()
	bm := storage.NewBucketManagerEx(s.mac(), &cfg, preferIPv4Client())
	_, err := bm.Stat(s.cfg.BucketName, key)
	if err == nil {
		return true, nil
	}
	if e, ok := err.(*storage.ErrorInfo); ok && e.Code == 612 {
		return false, nil
	}
	return false, err
}

// Delete removes a file from Kodo.
func (s *Store) Delete(key string) error {
	cfg := s.makeConfig()
	bm := storage.NewBucketManagerEx(s.mac(), &cfg, preferIPv4Client())
	return bm.Delete(s.cfg.BucketName, key)
}

// Read downloads a file from Kodo via HTTP GET to PublicURL.
func (s *Store) Read(key string) (io.ReadCloser, int64, error) {
	u := s.PublicURL(key)
	if u == "" {
		return nil, 0, stores.ErrInvalidPath
	}
	req, err := http.NewRequestWithContext(context.Background(), http.MethodGet, u, nil)
	if err != nil {
		return nil, 0, err
	}
	resp, err := preferIPv4Client().Do(context.Background(), req)
	if err != nil {
		return nil, 0, err
	}
	if resp.StatusCode != http.StatusOK {
		defer resp.Body.Close()
		return nil, 0, &stores.StoreError{Code: resp.StatusCode, Message: "qiniu read failed"}
	}
	var n int64 = -1
	if cl := resp.Header.Get("Content-Length"); cl != "" {
		if v, err := strconv.ParseInt(cl, 10, 64); err == nil {
			n = v
		}
	}
	return resp.Body, n, nil
}

// PublicURL returns the public URL (or signed private URL with 1h expiry).
func (s *Store) PublicURL(key string) string {
	if s.cfg.Domain == "" {
		return ""
	}
	d := s.normalizedDomain()
	pub := storage.MakePublicURLv2(d, key)
	if !s.cfg.Private {
		return pub
	}
	deadline := time.Now().Add(1 * time.Hour).Unix()
	return storage.MakePrivateURL(s.mac(), d, key, deadline)
}

// SignedURL implements stores.PrivateURLSigner with caller-specified expiry.
func (s *Store) SignedURL(key string, expires time.Duration) (string, error) {
	if s.cfg.Domain == "" {
		return "", stores.ErrInvalidPath
	}
	deadline := time.Now().Add(expires).Unix()
	return storage.MakePrivateURL(s.mac(), s.normalizedDomain(), key, deadline), nil
}

// PresignUpload implements stores.DirectUploadPresigner via a Kodo form upload token.
func (s *Store) PresignUpload(key, contentType string, expires time.Duration) (*stores.DirectUpload, error) {
	policy := storage.PutPolicy{
		Scope:   s.cfg.BucketName + ":" + key,
		Expires: uint64(expires / time.Second),
	}
	if contentType != "" {
		policy.MimeLimit = contentType
	}
	token := policy.UploadToken(s.mac())

	upHost := "https://upload.qiniup.com"
	if zone := regionFromHint(s.cfg.Region); zone != nil && len(zone.SrcUpHosts) > 0 {
		h := zone.SrcUpHosts[0]
		if !strings.HasPrefix(h, "http://") && !strings.HasPrefix(h, "https://") {
			h = "https://" + h
		}
		upHost = h
	} else if zone, err := storage.GetRegion(s.cfg.AccessKey, s.cfg.BucketName); err == nil && zone != nil && len(zone.SrcUpHosts) > 0 {
		h := zone.SrcUpHosts[0]
		if !strings.HasPrefix(h, "http://") && !strings.HasPrefix(h, "https://") {
			h = "https://" + h
		}
		upHost = h
	}
	return &stores.DirectUpload{
		Provider:  "kodo",
		Method:    http.MethodPost,
		URL:       upHost,
		Form:      map[string]string{"token": token, "key": key},
		FileField: "file",
		Key:       key,
		ExpiresAt: time.Now().Add(expires),
	}, nil
}
