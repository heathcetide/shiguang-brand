package xai

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"

	"github.com/heathcetide/DietDigiDose/pkg/common/logger"
	common "github.com/heathcetide/DietDigiDose/pkg/relay/common"
	helper2 "github.com/heathcetide/DietDigiDose/pkg/relay/helper"
	"github.com/heathcetide/DietDigiDose/pkg/relay/relaykit/dto"
	"github.com/heathcetide/DietDigiDose/pkg/relay/relaykit/types"
	"github.com/heathcetide/DietDigiDose/pkg/relay/service"
	"go.uber.org/zap"

)

func streamResponseXAI2OpenAI(xAIResp *dto.ChatCompletionsStreamResponse, usage *dto.Usage) *dto.ChatCompletionsStreamResponse {
	if xAIResp == nil {
		return nil
	}
	if xAIResp.Usage != nil {
		xAIResp.Usage.CompletionTokens = usage.CompletionTokens
	}
	openAIResp := &dto.ChatCompletionsStreamResponse{
		Id:      xAIResp.Id,
		Object:  xAIResp.Object,
		Created: xAIResp.Created,
		Model:   xAIResp.Model,
		Choices: xAIResp.Choices,
		Usage:   xAIResp.Usage,
	}

	return openAIResp
}

func xAIStreamHandler(c context.Context, info *common.RelayInfo, resp *http.Response, w http.ResponseWriter) (*dto.Usage, *types.NewAPIError) {
	defer resp.Body.Close()
	usage := &dto.Usage{}
	var responseTextBuilder strings.Builder
	var toolCount int
	var containStreamUsage bool

	helper2.SetEventStreamHeaders(w)

	helper2.StreamScannerHandler(resp, func(data string) error {
		var xAIResp *dto.ChatCompletionsStreamResponse
		if err := json.Unmarshal([]byte(data), &xAIResp); err != nil {
			logger.Warn("error unmarshalling stream response", zap.String("error", err.Error()))
			return err
		}

		// 把 xAI 的usage转换为 OpenAI 的usage
		if xAIResp.Usage != nil {
			containStreamUsage = true
			usage.PromptTokens = xAIResp.Usage.PromptTokens
			usage.TotalTokens = xAIResp.Usage.TotalTokens
			usage.CompletionTokens = usage.TotalTokens - usage.PromptTokens
		}

		openaiResponse := streamResponseXAI2OpenAI(xAIResp, usage)
		// Not supported in library mode — openai.ProcessStreamResponse does not exist
		// _ = openai.ProcessStreamResponse(*openaiResponse, &responseTextBuilder, &toolCount)
		if openaiResponse != nil && len(openaiResponse.Choices) > 0 {
			responseTextBuilder.WriteString(openaiResponse.Choices[0].Delta.GetContentString())
		}
		if err := helper2.ObjectData(w, openaiResponse); err != nil {
			logger.Warn("error", zap.String("error", err.Error()))
			return err
		}
		return nil
	})

	if !containStreamUsage {
		usage = service.ResponseText2Usage(responseTextBuilder.String(), info.UpstreamModelName, info.GetEstimatePromptTokens())
		usage.CompletionTokens += toolCount * 7
	}

	helper2.Done(w)
	return usage, nil
}

func xAIHandler(c context.Context, info *common.RelayInfo, resp *http.Response, w http.ResponseWriter) (*dto.Usage, *types.NewAPIError) {
	defer resp.Body.Close()

	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, types.NewError(err, types.ErrorCodeBadResponseBody)
	}
	var xaiResponse ChatCompletionResponse
	err = json.Unmarshal(responseBody, &xaiResponse)
	if err != nil {
		return nil, types.NewError(err, types.ErrorCodeBadResponseBody)
	}
	if xaiResponse.Usage != nil {
		xaiResponse.Usage.CompletionTokens = xaiResponse.Usage.TotalTokens - xaiResponse.Usage.PromptTokens
		xaiResponse.Usage.CompletionTokenDetails.TextTokens = xaiResponse.Usage.CompletionTokens - xaiResponse.Usage.CompletionTokenDetails.ReasoningTokens
	}

	// new body
	encodeJson, err := json.Marshal(xaiResponse)
	if err != nil {
		return nil, types.NewError(err, types.ErrorCodeBadResponseBody)
	}

	service.IOCopyBytesGracefully(w, resp, encodeJson)

	return xaiResponse.Usage, nil
}
