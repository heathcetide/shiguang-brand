// Copyright (c) 2026 heathcetide. All rights reserved.

package local

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/heathcetide/DietDigiDose/pkg/stores"
)

// Config configures the local filesystem store.
type Config struct {
	Root       string
	NewDirPerm os.FileMode
}

type store struct {
	root string
	perm os.FileMode
}

// New creates a local filesystem Store rooted at cfg.Root.
func New(cfg Config) stores.Store {
	perm := cfg.NewDirPerm
	if perm == 0 {
		perm = 0o755
	}
	root := cfg.Root
	if root == "" {
		root = "uploads"
	}
	return &store{root: root, perm: perm}
}

func (s *store) resolve(key string) (string, error) {
	clean := filepath.Clean("/" + strings.TrimPrefix(key, "/"))
	full := filepath.Join(s.root, clean)
	rel, err := filepath.Rel(s.root, full)
	if err != nil || strings.HasPrefix(rel, "..") {
		return "", fmt.Errorf("invalid storage key")
	}
	return full, nil
}

func (s *store) Write(key string, r io.Reader) error {
	path, err := s.resolve(key)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), s.perm); err != nil {
		return err
	}
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = io.Copy(f, r)
	return err
}

func (s *store) Read(key string) (io.ReadCloser, int64, error) {
	path, err := s.resolve(key)
	if err != nil {
		return nil, 0, err
	}
	info, err := os.Stat(path)
	if err != nil {
		return nil, 0, err
	}
	f, err := os.Open(path)
	if err != nil {
		return nil, 0, err
	}
	return f, info.Size(), nil
}

func (s *store) Delete(key string) error {
	path, err := s.resolve(key)
	if err != nil {
		return err
	}
	err = os.Remove(path)
	if os.IsNotExist(err) {
		return nil
	}
	return err
}

func (s *store) Exists(key string) (bool, error) {
	path, err := s.resolve(key)
	if err != nil {
		return false, err
	}
	_, err = os.Stat(path)
	if os.IsNotExist(err) {
		return false, nil
	}
	return err == nil, err
}

func (s *store) PublicURL(key string) string {
	return "/" + strings.TrimPrefix(filepath.ToSlash(key), "/")
}
