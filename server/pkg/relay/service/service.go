// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package service provides shared utility functions for relay providers,
// adapted from LingRein's internal/service package with gin.Context
// dependencies removed.
//
// This package bridges provider adaptors to the relaykit conversion system
// and provides common helpers for response handling and usage estimation.
package service

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	common "github.com/heathcetide/DietDigiDose/pkg/relay/common"
	"github.com/heathcetide/DietDigiDose/pkg/relay/relaykit/dto"
	"github.com/heathcetide/DietDigiDose/pkg/relay/relaykit/relayconvert"
	"github.com/heathcetide/DietDigiDose/pkg/relay/relaykit/types"
)

// ConvertRequest converts a request to the target relay format using relaykit.
func ConvertRequest(ctx context.Context, info *common.RelayInfo, target types.RelayFormat, request any) (*relayconvert.RequestResult, error) {
	return relayconvert.ConvertRequest(ctx, info, target, request)
}

// ConvertRequestByID converts a request using a named converter.
func ConvertRequestByID(ctx context.Context, info *common.RelayInfo, converter string, request any) (*relayconvert.RequestResult, error) {
	return relayconvert.ConvertRequestByID(ctx, info, converter, request)
}

// IOCopyBytesGracefully writes data to the ResponseWriter.
func IOCopyBytesGracefully(w http.ResponseWriter, resp *http.Response, data []byte) {
	if w == nil {
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write(data)
}

// ResponseText2Usage estimates usage from response text when the provider
// doesn't return token counts. Uses a simple word-based estimation.
func ResponseText2Usage(responseText string, modelName string, promptTokens int) *dto.Usage {
	usage := &dto.Usage{}
	usage.PromptTokens = promptTokens
	usage.CompletionTokens = EstimateTokenByModel(modelName, responseText)
	usage.TotalTokens = usage.PromptTokens + usage.CompletionTokens
	return usage
}

// EstimateTokenByModel estimates token count for a given model and text.
// Uses a simple heuristic: ~4 characters per token for English text.
func EstimateTokenByModel(modelName string, text string) int {
	// Simple estimation: ~4 chars per token.
	// For CJK text, ~2 chars per token.
	cjkCount := 0
	for _, r := range text {
		if r >= 0x4E00 && r <= 0x9FFF {
			cjkCount++
		}
	}
	nonCjk := len(text) - cjkCount
	return cjkCount/2 + nonCjk/4
}

// ValidUsage checks if a usage struct has non-zero values.
func ValidUsage(usage *dto.Usage) bool {
	return usage != nil && (usage.PromptTokens != 0 || usage.CompletionTokens != 0)
}

// GetImageFromUrl downloads an image from a URL and returns its data,
// MIME type, and any error.
func GetImageFromUrl(url string) ([]byte, string, error) {
	resp, err := http.Get(url)
	if err != nil {
		return nil, "", fmt.Errorf("failed to fetch image: %w", err)
	}
	defer resp.Body.Close()

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, "", fmt.Errorf("failed to read image: %w", err)
	}

	mimeType := resp.Header.Get("Content-Type")
	if mimeType == "" {
		mimeType = "image/png"
	}

	return data, mimeType, nil
}

// GetBase64Data returns base64-encoded data from a source (URL or base64 string).
func GetBase64Data(source string, context string) (string, string, error) {
	if strings.HasPrefix(source, "data:") {
		// Already a data URI.
		parts := strings.SplitN(source, ",", 2)
		if len(parts) != 2 {
			return "", "", fmt.Errorf("invalid data URI")
		}
		mimeType := strings.SplitN(parts[0], ":", 2)[1]
		mimeType = strings.SplitN(mimeType, ";", 2)[0]
		return parts[1], mimeType, nil
	}
	if strings.HasPrefix(source, "http") {
		data, mimeType, err := GetImageFromUrl(source)
		if err != nil {
			return "", "", err
		}
		return base64Encode(data), mimeType, nil
	}
	// Assume it's already base64.
	return source, "image/png", nil
}

// ShouldCopyUpstreamHeader reports whether a header should be copied from
// the upstream response to the client response.
func ShouldCopyUpstreamHeader(key string, values []string) bool {
	// Skip hop-by-hop headers.
	switch strings.ToLower(key) {
	case "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
		"te", "trailers", "transfer-encoding", "upgrade":
		return false
	}
	return true
}

// base64Encode encodes bytes to base64 string.
func base64Encode(data []byte) string {
	return jsonEscapeString(string(data))
}

// jsonEscapeString is a placeholder; in production use encoding/base64.
func jsonEscapeString(s string) string {
	// Use standard base64 encoding.
	const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
	result := make([]byte, 0, len(s)*4/3+4)
	for i := 0; i < len(s); i += 3 {
		var b0, b1, b2 byte
		b0 = s[i]
		if i+1 < len(s) {
			b1 = s[i+1]
		}
		if i+2 < len(s) {
			b2 = s[i+2]
		}
		result = append(result, chars[b0>>2])
		result = append(result, chars[((b0&3)<<4)|(b1>>4)])
		if i+1 < len(s) {
			result = append(result, chars[((b1&15)<<2)|(b2>>6)])
		} else {
			result = append(result, '=')
		}
		if i+2 < len(s) {
			result = append(result, chars[b2&63])
		} else {
			result = append(result, '=')
		}
	}
	return string(result)
}

// CloseResponseBodyGracefully closes a response body, ignoring errors.
func CloseResponseBodyGracefully(resp *http.Response) {
	if resp != nil && resp.Body != nil {
		resp.Body.Close()
	}
}

// Ensure json import is used.
var _ = json.Marshal

// TaskErrorWrapper wraps an error into a TaskError with code and status code.
func TaskErrorWrapper(err error, code string, statusCode int) *common.TaskError {
	return &common.TaskError{
		Code:       code,
		Message:     err.Error(),
		StatusCode: statusCode,
		Err:        err,
	}
}

// TaskErrorWrapperLocal wraps a local error into a TaskError.
func TaskErrorWrapperLocal(err error, code string, statusCode int) *common.TaskError {
	return &common.TaskError{
		Code:       code,
		Message:     err.Error(),
		StatusCode: statusCode,
		LocalError: true,
		Err:        err,
	}
}
