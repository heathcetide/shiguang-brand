// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package backup provides a pluggable backup/restore manager. It copies
// data from a [Source] to a [Destination], computing a SHA-256 checksum
// and optionally applying gzip compression along the way.
//
// The source and destination are abstracted as interfaces so that file
// systems, object stores, databases, or any other backend can be plugged
// in. File-based implementations ([FileSource] and [FileDestination])
// are provided out of the box.
//
// # Quick start
//
//	mgr := backup.NewManager(
//	    &backup.FileSource{Path: "/var/data/app.db"},
//	    &backup.FileDestination{Dir: "/var/backups"},
//	    backup.WithCompression(),
//	)
//
//	bp, err := mgr.Backup(ctx, "app-2026-01-01")
//	if err != nil { ... }
//
//	err = mgr.Restore(ctx, bp)
package backup

import (
	"bufio"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

// Backup describes a completed backup artifact.
type Backup struct {
	// Name is the logical name of the backup.
	Name string
	// Timestamp is when the backup was created.
	Timestamp time.Time
	// Size is the size of the stored (possibly compressed) artifact in bytes.
	Size int64
	// Checksum is the SHA-256 hex digest of the stored artifact.
	Checksum string
	// Path is the location/identifier returned by the destination.
	Path string
	// Compressed indicates whether gzip compression was applied.
	Compressed bool
}

// Source is a readable backup source (e.g. a file, a database dump).
type Source interface {
	// Read returns a reader over the data to back up. The caller must
	// close the reader when done.
	Read() (io.ReadCloser, error)
}

// Destination is a writable backup target.
type Destination interface {
	// Write stores the data read from r under the given name and returns
	// the final storage path/identifier.
	Write(name string, r io.Reader) (string, error)
}

// ManagerOption configures a [Manager].
type ManagerOption func(*Manager)

// WithCompression enables gzip compression for backups.
func WithCompression() ManagerOption {
	return func(m *Manager) { m.compressed = true }
}

// Manager coordinates backup and restore operations between a [Source]
// and a [Destination].
type Manager struct {
	src        Source
	dst        Destination
	compressed bool

	mu      sync.RWMutex
	backups map[string]*Backup
}

// NewManager returns a new [Manager] that backs up from src to dst.
func NewManager(src Source, dst Destination, opts ...ManagerOption) *Manager {
	m := &Manager{
		src:     src,
		dst:     dst,
		backups: make(map[string]*Backup),
	}
	for _, opt := range opts {
		opt(m)
	}
	return m
}

// Backup performs a backup: it reads from the source, optionally
// compresses the stream, computes the SHA-256 checksum of the stored
// bytes, writes them to the destination, and records the result.
//
// The name is used as the base file name; a compression suffix and/or
// timestamp may be appended by the destination.
func (m *Manager) Backup(ctx context.Context, name string) (*Backup, error) {
	if m == nil || m.src == nil || m.dst == nil {
		return nil, errors.New("backup: manager not fully initialized")
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if name == "" {
		return nil, errors.New("backup: empty backup name")
	}

	srcReader, err := m.src.Read()
	if err != nil {
		return nil, fmt.Errorf("backup: open source: %w", err)
	}
	defer func() { _ = srcReader.Close() }()

	// We need to compute the checksum and size of the bytes that are
	// actually written to the destination (i.e. after compression). To
	// do that in a single pass we tee the (possibly compressed) stream
	// through a hasher and counter while writing to the destination.
	var pipeReader *io.PipeReader
	var pipeWriter *io.PipeWriter
	pipeReader, pipeWriter = io.Pipe()

	// Start a goroutine that reads from the source, optionally
	// compresses, and writes to the pipe. The destination reads from
	// the other end of the pipe.
	copyErr := make(chan error, 1)
	go func() {
		var w io.WriteCloser = pipeWriter
		if m.compressed {
			gz := gzip.NewWriter(pipeWriter)
			defer func() {
				_ = gz.Close()
				_ = pipeWriter.Close()
			}()
			w = gz
		} else {
			defer func() { _ = pipeWriter.Close() }()
		}
		_, err := io.Copy(w, srcReader)
		copyErr <- err
	}()

	// Tee through hasher + counter on the reading side.
	hasher := sha256.New()
	var size int64
	tee := io.TeeReader(pipeReader, io.MultiWriter(hasher, &countWriter{n: &size}))

	path, err := m.dst.Write(name, tee)
	if err != nil {
		// Close the pipe reader to unblock the goroutine whose Write
		// to the pipe would otherwise block forever (deadlock).
		_ = pipeReader.Close()
		<-copyErr
		return nil, fmt.Errorf("backup: write destination: %w", err)
	}
	if cerr := <-copyErr; cerr != nil {
		return nil, fmt.Errorf("backup: read source: %w", cerr)
	}

	bp := &Backup{
		Name:       name,
		Timestamp:  time.Now(),
		Size:       size,
		Checksum:   hex.EncodeToString(hasher.Sum(nil)),
		Path:       path,
		Compressed: m.compressed,
	}

	m.mu.Lock()
	m.backups[name] = bp
	m.mu.Unlock()

	return bp, nil
}

// countWriter is an io.Writer that only counts bytes written.
type countWriter struct{ n *int64 }

func (c *countWriter) Write(p []byte) (int, error) {
	*c.n += int64(len(p))
	return len(p), nil
}

// Restore reads the backup artifact from the destination and writes it
// back to the source's underlying storage. For [FileSource]/[FileDestination]
// the restore decompresses gzip if the backup was compressed.
//
// The current implementation restores the backup to the file identified
// by the source's path (when the source is a [*FileSource]).
func (m *Manager) Restore(ctx context.Context, backup *Backup) error {
	if m == nil || m.dst == nil {
		return errors.New("backup: manager not fully initialized")
	}
	if backup == nil {
		return errors.New("backup: nil backup")
	}
	if err := ctx.Err(); err != nil {
		return err
	}

	// We need a way to read the artifact back. Destination is write-only
	// by interface, so we rely on the concrete FileDestination which
	// also exposes a Read method via the file system. To keep the
	// interface clean, we type-assert for the common case.
	fd, ok := m.dst.(*FileDestination)
	if !ok {
		return errors.New("backup: restore only supported for FileDestination")
	}

	// Check early that the source supports restore. Silently discarding
	// the data would mislead the caller into thinking restore succeeded.
	fs, ok := m.src.(*FileSource)
	if !ok {
		return errors.New("backup: restore only supported for FileSource")
	}

	srcPath := backup.Path
	if srcPath == "" {
		srcPath = filepath.Join(fd.Dir, backup.Name)
	}
	f, err := os.Open(srcPath)
	if err != nil {
		return fmt.Errorf("backup: open artifact: %w", err)
	}
	defer func() { _ = f.Close() }()

	var r io.Reader = f
	if backup.Compressed {
		gz, err := gzip.NewReader(f)
		if err != nil {
			return fmt.Errorf("backup: open gzip: %w", err)
		}
		defer func() { _ = gz.Close() }()
		r = gz
	}

	out, err := os.Create(fs.Path)
	if err != nil {
		return fmt.Errorf("backup: create restore target: %w", err)
	}
	defer func() { _ = out.Close() }()

	if _, err := io.Copy(out, r); err != nil {
		return fmt.Errorf("backup: write restore target: %w", err)
	}
	return nil
}

// List returns all recorded backups sorted by name.
func (m *Manager) List() ([]*Backup, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := make([]*Backup, 0, len(m.backups))
	for _, bp := range m.backups {
		out = append(out, bp)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, nil
}

// Delete removes the backup record and, for [FileDestination], deletes
// the underlying artifact file.
func (m *Manager) Delete(name string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	bp, ok := m.backups[name]
	if !ok {
		return fmt.Errorf("backup: %q not found", name)
	}
	delete(m.backups, name)

	if fd, ok := m.dst.(*FileDestination); ok {
		path := bp.Path
		if path == "" {
			path = filepath.Join(fd.Dir, name)
		}
		if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
			return fmt.Errorf("backup: delete artifact: %w", err)
		}
	}
	return nil
}

// FileSource is a [Source] backed by a local file.
type FileSource struct {
	// Path is the file to read from.
	Path string
}

// Read opens the file for reading.
func (s *FileSource) Read() (io.ReadCloser, error) {
	if s.Path == "" {
		return nil, errors.New("backup: empty source path")
	}
	f, err := os.Open(s.Path)
	if err != nil {
		return nil, err
	}
	return f, nil
}

// FileDestination is a [Destination] backed by a local directory.
type FileDestination struct {
	// Dir is the directory where backup artifacts are stored.
	Dir string
}

// Write stores the data from r into a file named name (with a .gz suffix
// appended when the stream is gzip-compressed, detected by sniffing the
// first two bytes). It returns the full path of the written file.
func (d *FileDestination) Write(name string, r io.Reader) (string, error) {
	if d.Dir == "" {
		return "", errors.New("backup: empty destination dir")
	}
	if err := os.MkdirAll(d.Dir, 0o755); err != nil {
		return "", fmt.Errorf("backup: mkdir: %w", err)
	}

	// Sniff for gzip magic to decide the file extension. We peek the
	// first 2 bytes using bufio.Reader; if it's gzip magic (0x1f 0x8b)
	// we append .gz.
	br := bufio.NewReader(r)
	peek, _ := br.Peek(2)
	fname := name
	if len(peek) == 2 && peek[0] == 0x1f && peek[1] == 0x8b {
		if !strings.HasSuffix(fname, ".gz") {
			fname += ".gz"
		}
	}
	path := filepath.Join(d.Dir, fname)

	f, err := os.Create(path)
	if err != nil {
		return "", fmt.Errorf("backup: create file: %w", err)
	}
	defer func() { _ = f.Close() }()

	if _, err := io.Copy(f, br); err != nil {
		return "", fmt.Errorf("backup: write file: %w", err)
	}
	return path, nil
}

// newPeekReader wraps r in a bufio.Reader with enough buffer for peeking.
// It is retained for backward compatibility with tests.
func newPeekReader(r io.Reader, n int) *bufio.Reader {
	return bufio.NewReaderSize(r, n)
}
