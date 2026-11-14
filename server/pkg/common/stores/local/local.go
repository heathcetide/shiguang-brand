// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package local provides a filesystem-backed Store implementation with no
// cloud SDK dependencies.
package local

import (
	"io"
	"os"
	"path"
	"path/filepath"
	"strings"
	"sync"

	"github.com/heathcetide/DietDigiDose/pkg/common/stores"
)

// Config holds local filesystem storage configuration.
type Config struct {
	Root       string // root directory for stored files
	NewDirPerm os.FileMode
}

// Store implements stores.Store using the local filesystem.
// It also implements stores.ObjectStorageManager for bucket & object
// management (see manager.go).
type Store struct {
	root       string
	newDirPerm os.FileMode

	bsOnce sync.Once
	bs     *bucketStore
}

// New creates a local filesystem store.
func New(cfg Config) *Store {
	root := cfg.Root
	if root == "" {
		root = stores.DefaultUploadDir
	}
	perm := cfg.NewDirPerm
	if perm == 0 {
		perm = 0755
	}
	return &Store{root: root, newDirPerm: perm}
}

// Delete removes the object at key.
func (s *Store) Delete(key string) error {
	fname, err := s.resolveKey(key)
	if err != nil {
		return err
	}
	return os.RemoveAll(fname)
}

// Exists reports whether an object exists at key.
func (s *Store) Exists(key string) (bool, error) {
	fname, err := s.resolveKey(key)
	if err != nil {
		return false, err
	}
	_, err = os.Stat(fname)
	if err != nil {
		if os.IsNotExist(err) {
			return false, nil
		}
		return false, err
	}
	return true, nil
}

// Read returns an io.ReadCloser for the object at key, plus its size.
func (s *Store) Read(key string) (io.ReadCloser, int64, error) {
	fname, err := s.resolveKey(key)
	if err != nil {
		return nil, 0, err
	}
	st, err := os.Stat(fname)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, 0, stores.ErrAttachmentNotExist
		}
		return nil, 0, err
	}
	f, err := os.Open(fname)
	if err != nil {
		return nil, 0, err
	}
	return f, st.Size(), nil
}

func (s *Store) resolveKey(key string) (string, error) {
	root, err := filepath.Abs(s.root)
	if err != nil {
		return "", err
	}
	fname := filepath.Clean(filepath.Join(root, key))
	if !strings.HasPrefix(fname, root+string(filepath.Separator)) && fname != root {
		return "", stores.ErrInvalidPath
	}
	return fname, nil
}

// Write stores the contents of r under key.
func (s *Store) Write(key string, r io.Reader) error {
	fname, err := s.resolveKey(key)
	if err != nil {
		return err
	}
	dir := filepath.Dir(fname)
	if err := os.MkdirAll(dir, s.newDirPerm); err != nil {
		return err
	}
	body, err := io.ReadAll(r)
	if err != nil {
		return err
	}
	_ = os.RemoveAll(fname)
	return os.WriteFile(fname, body, 0644)
}

// PublicURL returns a relative URL path for key.
func (s *Store) PublicURL(key string) string {
	mediaPrefix := strings.TrimSuffix(s.root, "/")
	key = strings.TrimPrefix(key, "/")
	return path.Join("/", mediaPrefix, key)
}
