// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package upload provides file upload utilities for HTTP servers.
//
// It supports single and multiple file uploads from multipart requests,
// MIME-type validation, safe filename generation, and chunked (resumable)
// uploads with merge and cleanup.
//
// # Quick start
//
//	h := upload.NewHandler("/var/uploads",
//	    upload.WithMaxSize(10<<20),
//	    upload.WithAllowedTypes([]string{"image/png", "image/jpeg"}),
//	)
//	info, err := h.SaveFromRequest(r, "file")
//	if err != nil { ... }
//	log.Println(info.Path)
package upload

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// ──────────────────────────────────────────────
// Errors
// ──────────────────────────────────────────────

var (
	// ErrFileTooLarge is returned when the uploaded file exceeds MaxSize.
	ErrFileTooLarge = errors.New("upload: file too large")
	// ErrFileTypeNotAllowed is returned when the file MIME type is not allowed.
	ErrFileTypeNotAllowed = errors.New("upload: file type not allowed")
	// ErrEmptyFile is returned when the uploaded file is empty.
	ErrEmptyFile = errors.New("upload: empty file")
	// ErrUploadNotFound is returned when the upload ID is not found.
	ErrUploadNotFound = errors.New("upload: upload not found")
	// ErrNoFile is returned when no file is found in the request.
	ErrNoFile = errors.New("upload: no file in request")
)

// ──────────────────────────────────────────────
// FileInfo
// ──────────────────────────────────────────────

// FileInfo describes a saved file.
type FileInfo struct {
	// OriginalName is the filename provided by the client.
	OriginalName string
	// SavedName is the filename used on disk.
	SavedName string
	// Path is the full path to the saved file.
	Path string
	// Size is the file size in bytes.
	Size int64
	// MIMEType is the detected MIME type.
	MIMEType string
	// Extension is the file extension (including the dot).
	Extension string
}

// ──────────────────────────────────────────────
// Handler
// ──────────────────────────────────────────────

// Handler processes file uploads.
type Handler struct {
	// MaxSize is the maximum allowed file size in bytes (0 = unlimited).
	MaxSize int64
	// AllowedTypes is the list of allowed MIME types (empty = all allowed).
	AllowedTypes []string
	// DestDir is the destination directory for saved files.
	DestDir string
	// filenameGen is an optional custom filename generator.
	filenameGen func(original string) string
}

// HandlerOption configures a Handler.
type HandlerOption func(*Handler)

// WithMaxSize sets the maximum file size.
func WithMaxSize(n int64) HandlerOption {
	return func(h *Handler) { h.MaxSize = n }
}

// WithAllowedTypes sets the allowed MIME types.
func WithAllowedTypes(types []string) HandlerOption {
	return func(h *Handler) { h.AllowedTypes = types }
}

// WithFilenameGenerator sets a custom filename generator.
func WithFilenameGenerator(fn func(original string) string) HandlerOption {
	return func(h *Handler) { h.filenameGen = fn }
}

// NewHandler creates a new Handler for the given destination directory.
func NewHandler(destDir string, opts ...HandlerOption) *Handler {
	h := &Handler{
		DestDir: destDir,
	}
	for _, opt := range opts {
		opt(h)
	}
	return h
}

// Save saves a single file from a multipart.File and its header.
// The file is streamed to a temporary file on disk using io.Copy with an
// io.LimitReader to enforce MaxSize, avoiding loading the entire file
// into memory. MIME detection is performed on the first 512 bytes read
// from the file.
func (h *Handler) Save(file multipart.File, header *multipart.FileHeader) (*FileInfo, error) {
	// Pre-write validation based on the client-provided header (actualSize
	// unknown at this point).
	if err := ValidateFile(header, h.AllowedTypes, h.MaxSize, -1); err != nil {
		return nil, err
	}

	if err := os.MkdirAll(h.DestDir, 0o755); err != nil {
		return nil, fmt.Errorf("upload: create dir: %w", err)
	}

	// Read the first 512 bytes for MIME detection. The rest of the file
	// is streamed to disk without holding it all in memory.
	head := make([]byte, 512)
	hn, err := io.ReadFull(file, head)
	if err != nil && err != io.ErrUnexpectedEOF && err != io.EOF {
		return nil, fmt.Errorf("upload: read file: %w", err)
	}
	head = head[:hn]

	savedName := h.generateFilename(header.Filename)
	ext := filepath.Ext(savedName)
	destPath := filepath.Join(h.DestDir, savedName)

	// Stream the combined head + rest of the file to a temp file in the
	// same directory (so the final rename is atomic on the same
	// filesystem), limiting total bytes to MaxSize+1 when MaxSize is set
	// so we can detect oversize uploads.
	tmp, err := os.CreateTemp(h.DestDir, ".upload-tmp-*")
	if err != nil {
		return nil, fmt.Errorf("upload: create temp file: %w", err)
	}
	tmpPath := tmp.Name()
	defer func() {
		_ = tmp.Close()
		_ = os.Remove(tmpPath) // no-op if successfully renamed
	}()

	combined := io.MultiReader(bytes.NewReader(head), file)
	var src io.Reader = combined
	if h.MaxSize > 0 {
		src = io.LimitReader(combined, h.MaxSize+1)
	}

	n, err := io.Copy(tmp, src)
	if err != nil {
		return nil, fmt.Errorf("upload: write file: %w", err)
	}

	// Post-write validation: check the actual byte count, which is more
	// reliable than the client-provided header.Size.
	if err := ValidateFile(header, h.AllowedTypes, h.MaxSize, n); err != nil {
		return nil, err
	}

	mimeType := DetectMIME(head)
	if !IsAllowedType(mimeType, h.AllowedTypes) {
		return nil, ErrFileTypeNotAllowed
	}

	// Close the temp file and rename it to the final destination.
	if err := tmp.Close(); err != nil {
		return nil, fmt.Errorf("upload: close temp file: %w", err)
	}
	if err := os.Rename(tmpPath, destPath); err != nil {
		return nil, fmt.Errorf("upload: write file: %w", err)
	}

	return &FileInfo{
		OriginalName: header.Filename,
		SavedName:    savedName,
		Path:         destPath,
		Size:         n,
		MIMEType:     mimeType,
		Extension:    ext,
	}, nil
}

// SaveFromRequest saves a single file from an HTTP multipart request.
func (h *Handler) SaveFromRequest(r *http.Request, fieldName string) (*FileInfo, error) {
	if err := r.ParseMultipartForm(h.MaxSize); err != nil {
		return nil, fmt.Errorf("upload: parse multipart: %w", err)
	}
	file, header, err := r.FormFile(fieldName)
	if err != nil {
		return nil, ErrNoFile
	}
	defer file.Close()
	return h.Save(file, header)
}

// SaveMultipleFromRequest saves all files for the given field name from an
// HTTP multipart request.
func (h *Handler) SaveMultipleFromRequest(r *http.Request, fieldName string) ([]*FileInfo, error) {
	if err := r.ParseMultipartForm(h.MaxSize); err != nil {
		return nil, fmt.Errorf("upload: parse multipart: %w", err)
	}
	files := r.MultipartForm.File[fieldName]
	if len(files) == 0 {
		return nil, ErrNoFile
	}
	var infos []*FileInfo
	for _, header := range files {
		file, err := header.Open()
		if err != nil {
			return infos, fmt.Errorf("upload: open file: %w", err)
		}
		info, err := h.Save(file, header)
		_ = file.Close()
		if err != nil {
			return infos, err
		}
		infos = append(infos, info)
	}
	return infos, nil
}

// generateFilename produces a safe filename, using a custom generator if set.
func (h *Handler) generateFilename(original string) string {
	if h.filenameGen != nil {
		return h.filenameGen(original)
	}
	return GenerateSafeFilename(original)
}

// ──────────────────────────────────────────────
// Validation & helpers
// ──────────────────────────────────────────────

// ValidateFile checks a file header against size and type constraints.
// actualSize is the number of bytes actually written to disk (-1 if
// unknown, e.g. during a pre-write check). When actualSize >= 0 it takes
// precedence over the client-provided header.Size, which can be spoofed.
func ValidateFile(header *multipart.FileHeader, allowedTypes []string, maxSize int64, actualSize int64) error {
	size := header.Size
	if actualSize >= 0 {
		size = actualSize
	}
	if maxSize > 0 && size > maxSize {
		return ErrFileTooLarge
	}
	if size == 0 {
		return ErrEmptyFile
	}
	if len(allowedTypes) > 0 {
		ext := strings.ToLower(filepath.Ext(header.Filename))
		guess := extensionToMIME(ext)
		if !IsAllowedType(guess, allowedTypes) {
			return ErrFileTypeNotAllowed
		}
	}
	return nil
}

// GenerateSafeFilename creates a safe filename, stripping path components and
// generating a unique prefix to prevent path traversal and collisions.
func GenerateSafeFilename(original string) string {
	// Strip any path components — keep only the base name.
	base := filepath.Base(original)
	if base == "." || base == "/" || base == "" {
		base = "file"
	}
	// Remove potentially dangerous characters.
	base = strings.ReplaceAll(base, "..", "")
	ext := filepath.Ext(base)
	name := strings.TrimSuffix(base, ext)
	// Add a timestamp prefix for uniqueness.
	return fmt.Sprintf("%d_%s%s", time.Now().UnixNano(), name, ext)
}

// IsAllowedType reports whether mimeType is in the allowed list. An empty
// allowed list means all types are permitted.
func IsAllowedType(mimeType string, allowed []string) bool {
	if len(allowed) == 0 {
		return true
	}
	for _, a := range allowed {
		if strings.EqualFold(a, mimeType) {
			return true
		}
	}
	return false
}

// DetectMIME detects the MIME type of the given data using
// http.DetectContentType.
func DetectMIME(data []byte) string {
	if len(data) == 0 {
		return ""
	}
	ct := http.DetectContentType(data)
	// Strip parameters like "; charset=utf-8".
	if idx := strings.Index(ct, ";"); idx >= 0 {
		ct = strings.TrimSpace(ct[:idx])
	}
	return ct
}

// extensionToMIME maps a few common extensions to MIME types for quick
// validation before reading the file.
func extensionToMIME(ext string) string {
	switch ext {
	case ".png":
		return "image/png"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".gif":
		return "image/gif"
	case ".pdf":
		return "application/pdf"
	case ".txt":
		return "text/plain"
	case ".csv":
		return "text/csv"
	case ".zip":
		return "application/zip"
	case ".webp":
		return "image/webp"
	default:
		return "application/octet-stream"
	}
}

// ──────────────────────────────────────────────
// ChunkUploader
// ──────────────────────────────────────────────

// ChunkUploader supports chunked (resumable) file uploads.
type ChunkUploader struct {
	DestDir    string
	ChunkSize  int64
	mu         sync.Mutex
	uploads    map[string]map[int]bool // uploadID -> chunkIndex -> received
	tempDir    string
}

// NewChunkUploader creates a new ChunkUploader.
func NewChunkUploader(destDir string, chunkSize int64) *ChunkUploader {
	return &ChunkUploader{
		DestDir:   destDir,
		ChunkSize: chunkSize,
		uploads:   make(map[string]map[int]bool),
		tempDir:   filepath.Join(destDir, ".chunks"),
	}
}

// chunkPath returns the path for a specific chunk.
func (cu *ChunkUploader) chunkPath(uploadID string, chunkIndex int) string {
	return filepath.Join(cu.tempDir, uploadID, fmt.Sprintf("chunk_%d", chunkIndex))
}

// SaveChunk saves a single chunk for the given upload ID.
func (cu *ChunkUploader) SaveChunk(uploadID string, chunkIndex int, r io.Reader) error {
	if uploadID == "" {
		return errors.New("upload: empty upload ID")
	}
	cu.mu.Lock()
	if cu.uploads[uploadID] == nil {
		cu.uploads[uploadID] = make(map[int]bool)
	}
	cu.mu.Unlock()

	dir := filepath.Join(cu.tempDir, uploadID)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("upload: create chunk dir: %w", err)
	}

	f, err := os.Create(cu.chunkPath(uploadID, chunkIndex))
	if err != nil {
		return fmt.Errorf("upload: create chunk: %w", err)
	}
	defer f.Close()

	if _, err := io.Copy(f, r); err != nil {
		return fmt.Errorf("upload: write chunk: %w", err)
	}

	cu.mu.Lock()
	cu.uploads[uploadID][chunkIndex] = true
	cu.mu.Unlock()
	return nil
}

// Merge combines all chunks for the given upload ID into a single file.
func (cu *ChunkUploader) Merge(uploadID string, totalChunks int, filename string) (*FileInfo, error) {
	cu.mu.Lock()
	chunks, ok := cu.uploads[uploadID]
	cu.mu.Unlock()
	if !ok {
		return nil, ErrUploadNotFound
	}
	if len(chunks) < totalChunks {
		return nil, fmt.Errorf("upload: missing chunks: have %d, need %d", len(chunks), totalChunks)
	}

	if err := os.MkdirAll(cu.DestDir, 0o755); err != nil {
		return nil, fmt.Errorf("upload: create dest dir: %w", err)
	}

	safeName := GenerateSafeFilename(filename)
	destPath := filepath.Join(cu.DestDir, safeName)
	out, err := os.Create(destPath)
	if err != nil {
		return nil, fmt.Errorf("upload: create merged file: %w", err)
	}
	defer out.Close()

	var totalSize int64
	var firstBytes []byte
	for i := 0; i < totalChunks; i++ {
		chunkFile, err := os.Open(cu.chunkPath(uploadID, i))
		if err != nil {
			return nil, fmt.Errorf("upload: open chunk %d: %w", i, err)
		}
		n, err := io.Copy(out, chunkFile)
		_ = chunkFile.Close()
		if err != nil {
			return nil, fmt.Errorf("upload: copy chunk %d: %w", i, err)
		}
		totalSize += n

		// Read first chunk for MIME detection.
		if i == 0 {
			data, _ := os.ReadFile(cu.chunkPath(uploadID, 0))
			if len(data) >= 512 {
				firstBytes = data[:512]
			} else {
				firstBytes = data
			}
		}
	}

	mimeType := DetectMIME(firstBytes)
	return &FileInfo{
		OriginalName: filename,
		SavedName:    safeName,
		Path:         destPath,
		Size:         totalSize,
		MIMEType:     mimeType,
		Extension:    filepath.Ext(safeName),
	}, nil
}

// Cleanup removes all chunks for the given upload ID.
func (cu *ChunkUploader) Cleanup(uploadID string) error {
	cu.mu.Lock()
	delete(cu.uploads, uploadID)
	cu.mu.Unlock()
	dir := filepath.Join(cu.tempDir, uploadID)
	if err := os.RemoveAll(dir); err != nil {
		return fmt.Errorf("upload: cleanup: %w", err)
	}
	return nil
}

// Status returns the number of received chunks and whether the upload exists.
func (cu *ChunkUploader) Status(uploadID string) (int, bool) {
	cu.mu.Lock()
	defer cu.mu.Unlock()
	chunks, ok := cu.uploads[uploadID]
	if !ok {
		return 0, false
	}
	return len(chunks), true
}

