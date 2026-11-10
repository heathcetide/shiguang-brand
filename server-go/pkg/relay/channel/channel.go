// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package channel provides shared utilities for provider adaptors.
// It is adapted from LingRein's pkg/relay/channel top-level package,
// with gin.Context dependencies removed.
package channel

import (
	"context"
	"fmt"
	"io"
	"net/http"

	common "github.com/heathcetide/DietDigiDose/pkg/relay/common"
)

// SetupApiRequestHeader sets common headers for upstream API requests.
func SetupApiRequestHeader(info *common.RelayInfo, header *http.Header) {
	if info.RelayMode == 5 || info.RelayMode == 6 {
		// multipart/form-data for audio transcription/translation
		return
	}
	header.Set("Content-Type", "application/json")
	if info.IsStream {
		header.Set("Accept", "text/event-stream")
	}
}

// DoApiRequest sends an HTTP request to the upstream provider.
// This is the library-mode replacement for LingRein's channel.DoApiRequest.
func DoApiRequest(ctx context.Context, a common.Adaptor, info *common.RelayInfo, requestBody io.Reader) (*http.Response, error) {
	fullRequestURL, err := a.GetRequestURL(info)
	if err != nil {
		return nil, fmt.Errorf("get request url failed: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", fullRequestURL, requestBody)
	if err != nil {
		return nil, fmt.Errorf("new request failed: %w", err)
	}

	headers := req.Header
	if err := a.SetupRequestHeader(ctx, &headers, info); err != nil {
		return nil, fmt.Errorf("setup request header failed: %w", err)
	}

	return http.DefaultClient.Do(req)
}

// DoFormRequest sends a multipart form request to the upstream provider.
func DoFormRequest(ctx context.Context, a common.Adaptor, info *common.RelayInfo, requestBody io.Reader) (*http.Response, error) {
	fullRequestURL, err := a.GetRequestURL(info)
	if err != nil {
		return nil, fmt.Errorf("get request url failed: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", fullRequestURL, requestBody)
	if err != nil {
		return nil, fmt.Errorf("new request failed: %w", err)
	}

	headers := req.Header
	if err := a.SetupRequestHeader(ctx, &headers, info); err != nil {
		return nil, fmt.Errorf("setup request header failed: %w", err)
	}

	return http.DefaultClient.Do(req)
}

// GetFullRequestURL builds a full request URL from a base URL and path.
func GetFullRequestURL(baseURL, requestURL string, channelType int) string {
	if baseURL == "" {
		return requestURL
	}
	return baseURL + requestURL
}

// DoTaskApiRequest sends an HTTP request to the upstream provider for an
// async task adaptor. It is the library-mode replacement for LingRein's
// channel.DoTaskApiRequest.
func DoTaskApiRequest(a common.TaskAdaptor, ctx context.Context, info *common.RelayInfo, requestBody io.Reader) (*http.Response, error) {
	fullRequestURL, err := a.BuildRequestURL(info)
	if err != nil {
		return nil, fmt.Errorf("get request url failed: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", fullRequestURL, requestBody)
	if err != nil {
		return nil, fmt.Errorf("new request failed: %w", err)
	}

	if err := a.BuildRequestHeader(ctx, req, info); err != nil {
		return nil, fmt.Errorf("setup request header failed: %w", err)
	}

	return http.DefaultClient.Do(req)
}
