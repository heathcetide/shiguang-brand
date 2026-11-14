// Copyright (c) 2026 heathcetide. All rights reserved.

// Package storage wraps object storage as a package-level singleton.
package storage

import (
	"fmt"
	"io"
	"strings"

	"github.com/heathcetide/DietDigiDose/pkg/common/stores/kodo"
	"github.com/heathcetide/DietDigiDose/pkg/stores"
	"github.com/heathcetide/DietDigiDose/pkg/stores/local"
)

var (
	Store         stores.Store
	MaxFileSize   int64
	PublicURLBase string
	Driver        string
)

// Init initializes the object storage singleton from configuration.
func Init(driver, root, region, endpoint, accessKey, secretKey, publicURLBase string, maxFileSize int64) error {
	driver = strings.ToLower(strings.TrimSpace(driver))
	switch driver {
	case "local", "":
		Store = local.New(local.Config{
			Root:       root,
			NewDirPerm: 0755,
		})
		driver = "local"
	case "kodo", "qiniu":
		if strings.TrimSpace(accessKey) == "" || strings.TrimSpace(secretKey) == "" || strings.TrimSpace(root) == "" {
			return fmt.Errorf("kodo storage requires accessKey, secretKey and bucket (root)")
		}
		domain := strings.TrimSpace(publicURLBase)
		if domain == "" {
			domain = strings.TrimSpace(endpoint)
		}
		Store = kodo.New(kodo.Config{
			AccessKey:  accessKey,
			SecretKey:  secretKey,
			BucketName: root,
			Domain:     domain,
			Private:    false,
			Region:     region,
		})
		driver = "kodo"
	default:
		return fmt.Errorf("unsupported storage driver: %s", driver)
	}

	MaxFileSize = maxFileSize
	PublicURLBase = strings.TrimRight(strings.TrimSpace(publicURLBase), "/")
	Driver = driver
	return nil
}

func Write(key string, r io.Reader) error {
	if Store == nil {
		return fmt.Errorf("storage not initialized, call Init() first")
	}
	return Store.Write(key, r)
}

func Read(key string) (io.ReadCloser, int64, error) {
	if Store == nil {
		return nil, 0, fmt.Errorf("storage not initialized, call Init() first")
	}
	return Store.Read(key)
}

func Delete(key string) error {
	if Store == nil {
		return fmt.Errorf("storage not initialized, call Init() first")
	}
	return Store.Delete(key)
}

func Exists(key string) (bool, error) {
	if Store == nil {
		return false, fmt.Errorf("storage not initialized, call Init() first")
	}
	return Store.Exists(key)
}

func PublicURL(key string) string {
	if Store == nil {
		return ""
	}
	key = strings.TrimPrefix(key, "/")
	if PublicURLBase != "" {
		return PublicURLBase + "/" + key
	}
	return Store.PublicURL(key)
}

func CheckFileSize(size int64) error {
	if MaxFileSize > 0 && size > MaxFileSize {
		return fmt.Errorf("file size %d exceeds limit %d", size, MaxFileSize)
	}
	return nil
}

func Close() error { return nil }

func UsingCloud() bool {
	return Driver != "" && Driver != "local"
}
