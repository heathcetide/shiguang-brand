// Copyright (c) 2026 heathcetide. All rights reserved.

// Package stores defines the object-storage interface used by pkg/storage.
// The full ling-base stores tree was not vendored into this scaffold; local is enough for the gateway phase.
package stores

import "io"

// Store is a minimal object storage contract.
type Store interface {
	Write(key string, r io.Reader) error
	Read(key string) (io.ReadCloser, int64, error)
	Delete(key string) error
	Exists(key string) (bool, error)
	PublicURL(key string) string
}
