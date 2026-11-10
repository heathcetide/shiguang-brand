// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package common_handler provides shared response handlers for relay providers.
package common_handler

import (
	"encoding/json"
	"context"
	"io"
	"net/http"

	common "github.com/heathcetide/DietDigiDose/pkg/relay/common"
	"github.com/heathcetide/DietDigiDose/pkg/relay/relaykit/dto"
	"github.com/heathcetide/DietDigiDose/pkg/relay/relaykit/types"
)

// RerankHandler parses a rerank response and writes it to w.
func RerankHandler(c context.Context, info *common.RelayInfo, resp *http.Response, w http.ResponseWriter) (*dto.Usage, *types.NewAPIError) {
	defer resp.Body.Close()
	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, types.NewError(err, types.ErrorCodeReadResponseBodyFailed)
	}

	var rerankResp dto.RerankResponse
	if err := json.Unmarshal(responseBody, &rerankResp); err != nil {
		return nil, types.NewError(err, types.ErrorCodeBadResponseBody)
	}
	rerankResp.Usage.PromptTokens = rerankResp.Usage.TotalTokens

	w.Header().Set("Content-Type", "application/json")
	jsonData, _ := json.Marshal(rerankResp)
	w.Write(jsonData)

	usage := rerankResp.Usage
	return &usage, nil
}
