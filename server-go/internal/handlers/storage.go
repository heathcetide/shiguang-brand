// Copyright (c) 2026 heathcetide. All rights reserved.

package handlers

import (
	"fmt"
	"path/filepath"
	"strings"
	"time"

	"github.com/heathcetide/DietDigiDose/internal/types"
	pkgstorage "github.com/heathcetide/DietDigiDose/pkg/storage"

	"github.com/heathcetide/DietDigiDose/pkg/common/response"
	respgin "github.com/heathcetide/DietDigiDose/pkg/common/response/gin"
	"github.com/gin-gonic/gin"
)

// File upload / download / delete
// Uses pkg/storage package-level singleton (no dependency injection needed).

// UploadFile handles file upload.
// Form field: file (multipart/form-data)
// Optional field: dir (subdirectory, e.g. "avatars")
//
// Upload flow:
//  1. Validate file size (must not exceed storage.MaxFileSize)
//  2. Generate unique key (dir + timestamp + original filename)
//  3. Call pkgstorage.Write to store
//  4. Return key + publicURL
func (h *Handlers) UploadFile(c *gin.Context) {
	file, err := c.FormFile("file")
	if err != nil {
		respgin.WriteError(c, response.New(response.CodeBadRequest, "no file provided: "+err.Error()))
		return
	}

	// Validate file size
	if err = pkgstorage.CheckFileSize(file.Size); err != nil {
		respgin.WriteError(c, response.New(response.CodeBadRequest, err.Error()))
		return
	}

	// Optional subdirectory
	dir := sanitizePath(strings.TrimSpace(c.PostForm("dir")))

	// Generate unique key: dir/20060102_150405_filename
	filename := sanitizePath(filepath.Base(file.Filename))
	key := fmt.Sprintf("%s/%s_%s", dir, time.Now().Format("20060102_150405"), filename)
	if dir == "" {
		key = fmt.Sprintf("%s_%s", time.Now().Format("20060102_150405"), filename)
	}

	// Open uploaded file
	src, err := file.Open()
	if err != nil {
		respgin.WriteError(c, response.New(response.CodeInternal, "failed to open file: "+err.Error()))
		return
	}
	defer src.Close()

	// Write to storage
	if err = pkgstorage.Write(key, src); err != nil {
		respgin.WriteError(c, response.New(response.CodeInternal, "storage write failed: "+err.Error()))
		return
	}

	respgin.Created(c, types.FileUploadResponse{
		Key:       key,
		Name:      filename,
		Size:      file.Size,
		PublicURL: pkgstorage.PublicURL(key),
	})
}

// DownloadFile handles file download.
// Path parameter: key (storage key)
func (h *Handlers) DownloadFile(c *gin.Context) {
	key := c.Param("key")
	if key == "" {
		respgin.WriteError(c, response.Err(response.CodeBadRequest))
		return
	}

	reader, size, err := pkgstorage.Read(key)
	if err != nil {
		respgin.WriteError(c, response.New(response.CodeNotFound, "file not found"))
		return
	}
	defer reader.Close()

	c.Header("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, filepath.Base(key)))
	c.DataFromReader(200, size, "application/octet-stream", reader, nil)
}

// DeleteFile handles file deletion.
// Path parameter: key (storage key)
func (h *Handlers) DeleteFile(c *gin.Context) {
	key := c.Param("key")
	if key == "" {
		respgin.WriteError(c, response.Err(response.CodeBadRequest))
		return
	}

	exists, err := pkgstorage.Exists(key)
	if err != nil {
		respgin.WriteError(c, response.Err(response.CodeInternal))
		return
	}
	if !exists {
		respgin.WriteError(c, response.Err(response.CodeNotFound))
		return
	}

	if err = pkgstorage.Delete(key); err != nil {
		respgin.WriteError(c, response.New(response.CodeInternal, "delete failed: "+err.Error()))
		return
	}

	respgin.NoContent(c)
}

// sanitizePath cleans a path to prevent directory traversal.
// Removes "..", leading "/", and collapses duplicate slashes.
func sanitizePath(p string) string {
	p = strings.TrimSpace(p)
	p = strings.TrimPrefix(p, "/")
	p = strings.ReplaceAll(p, "..", "")
	for strings.Contains(p, "//") {
		p = strings.ReplaceAll(p, "//", "/")
	}
	return p
}
