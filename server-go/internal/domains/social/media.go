// Copyright (c) 2026 heathcetide. All rights reserved.

package social

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/heathcetide/DietDigiDose/internal/expressauth"
	"github.com/heathcetide/DietDigiDose/internal/httpx"
)

func mediaUploadRoot() string {
	if v := strings.TrimSpace(os.Getenv("MEDIA_LOCAL_ROOT")); v != "" {
		return v
	}
	candidates := []string{
		"uploads/media",
		filepath.Join("server-go", "uploads", "media"),
	}
	for _, c := range candidates {
		if st, err := os.Stat(c); err == nil && st.IsDir() {
			return c
		}
	}
	return filepath.Join("server-go", "uploads", "media")
}

func (h *Handlers) UploadImage(c *gin.Context) {
	_, ok := expressauth.UserID(c)
	if !ok {
		httpx.AbortAuth(c)
		return
	}

	var data []byte
	var mime string

	if strings.Contains(c.GetHeader("Content-Type"), "multipart/form-data") {
		file, header, err := c.Request.FormFile("file")
		if err != nil {
			httpx.SendError(c, http.StatusBadRequest, "请上传图片文件", "INVALID_MEDIA")
			return
		}
		defer file.Close()
		data, err = io.ReadAll(io.LimitReader(file, 4*1024*1024+1))
		if err != nil || len(data) > 4*1024*1024 {
			httpx.SendError(c, http.StatusBadRequest, "图片大小无效", "INVALID_MEDIA")
			return
		}
		mime = header.Header.Get("Content-Type")
		if mime == "" {
			mime = http.DetectContentType(data)
		}
	} else {
		var body struct {
			ImageBase64 string `json:"imageBase64"`
			DataURL     string `json:"data_url"`
			MimeType    string `json:"mimeType"`
			Scope       string `json:"scope"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			httpx.SendError(c, http.StatusBadRequest, "请求参数无效", "INVALID_BODY")
			return
		}
		raw := strings.TrimSpace(body.ImageBase64)
		if raw == "" {
			raw = strings.TrimSpace(body.DataURL)
		}
		if raw == "" {
			httpx.SendError(c, http.StatusBadRequest, "请提供图片数据", "INVALID_MEDIA")
			return
		}
		if i := strings.Index(raw, ","); strings.HasPrefix(raw, "data:") && i >= 0 {
			prefix := raw[:i]
			if body.MimeType == "" {
				if semi := strings.Index(prefix, ";"); semi > 5 {
					body.MimeType = prefix[5:semi]
				}
			}
			raw = raw[i+1:]
		}
		var err error
		data, err = base64.StdEncoding.DecodeString(raw)
		if err != nil {
			data, err = base64.RawStdEncoding.DecodeString(raw)
		}
		if err != nil || len(data) == 0 || len(data) > 4*1024*1024 {
			httpx.SendError(c, http.StatusBadRequest, "图片数据无效", "INVALID_MEDIA")
			return
		}
		mime = body.MimeType
		if mime == "" {
			mime = http.DetectContentType(data)
		}
	}

	ext := extForMIME(mime)
	if ext == "" {
		httpx.SendError(c, http.StatusBadRequest, "不支持的图片格式", "INVALID_MEDIA")
		return
	}

	root := mediaUploadRoot()
	if err := os.MkdirAll(root, 0o755); err != nil {
		httpx.SendError(c, http.StatusServiceUnavailable, "图片暂时无法上传", "MEDIA_STORAGE_UNAVAILABLE")
		return
	}
	name := fmt.Sprintf("%s.%s", newMediaID(), ext)
	dest := filepath.Join(root, name)
	if err := os.WriteFile(dest, data, 0o644); err != nil {
		httpx.SendError(c, http.StatusBadGateway, "图片暂时无法上传", "MEDIA_UPLOAD_FAILED")
		return
	}
	c.JSON(http.StatusCreated, gin.H{"url": "/media/uploads/" + name})
}

func extForMIME(mime string) string {
	switch strings.ToLower(strings.TrimSpace(mime)) {
	case "image/jpeg", "image/jpg":
		return "jpg"
	case "image/png":
		return "png"
	case "image/webp":
		return "webp"
	case "image/gif":
		return "gif"
	default:
		return ""
	}
}

func newMediaID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}
