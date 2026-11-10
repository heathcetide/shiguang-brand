package cloudflare

import (
	"context"
	"encoding/json"
	"io"
	"net/http"

	"github.com/heathcetide/DietDigiDose/pkg/common/logger"
	common "github.com/heathcetide/DietDigiDose/pkg/relay/common"
	helper2 "github.com/heathcetide/DietDigiDose/pkg/relay/helper"
	"github.com/heathcetide/DietDigiDose/pkg/relay/relaykit/dto"
	"github.com/heathcetide/DietDigiDose/pkg/relay/relaykit/types"
	"github.com/heathcetide/DietDigiDose/pkg/relay/service"
	"github.com/samber/lo"
	"go.uber.org/zap"

)

func convertCf2CompletionsRequest(textRequest dto.GeneralOpenAIRequest) *CfRequest {
	p, _ := textRequest.Prompt.(string)
	return &CfRequest{
		Prompt:      p,
		MaxTokens:   textRequest.GetMaxTokens(),
		Stream:      lo.FromPtrOr(textRequest.Stream, false),
		Temperature: textRequest.Temperature,
	}
}

func cfStreamHandler(c context.Context, info *common.RelayInfo, resp *http.Response, w http.ResponseWriter) (*types.NewAPIError, *dto.Usage) {
	helper2.SetEventStreamHeaders(w)
	id := helper2.GetResponseID("")
	var responseText string
	isFirst := true

	helper2.StreamScannerHandler(resp, func(data string) error {
		var response dto.ChatCompletionsStreamResponse
		err := json.Unmarshal([]byte(data), &response)
		if err != nil {
			// logger.LogError: "error_unmarshalling_stream_response: "+err.Error())
			return nil
		}
		for _, choice := range response.Choices {
			choice.Delta.Role = "assistant"
			responseText += choice.Delta.GetContentString()
		}
		response.Id = id
		response.Model = info.UpstreamModelName
		err = helper2.ObjectData(w, response)
		if isFirst {
			isFirst = false
			// Not supported in library mode
			// info.FirstResponseTime = time.Now()
		}
		if err != nil {
			// logger.LogError: "error_rendering_stream_response: "+err.Error())
		}
		return nil
	})

	usage := service.ResponseText2Usage(responseText, info.UpstreamModelName, info.GetEstimatePromptTokens())
	if info.ShouldIncludeUsage {
		response := helper2.GenerateFinalUsageResponse(id, info.StartTime.Unix(), info.UpstreamModelName, usage)
		err := helper2.ObjectData(w, response)
		if err != nil {
			// logger.LogError: "error_rendering_final_usage_response: "+err.Error())
		}
	}
	helper2.Done(w)

	resp.Body.Close()

	return nil, usage
}

func cfHandler(c context.Context, info *common.RelayInfo, resp *http.Response, w http.ResponseWriter) (*types.NewAPIError, *dto.Usage) {
	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return types.NewError(err, types.ErrorCodeBadResponseBody), nil
	}
	resp.Body.Close()
	var response dto.TextResponse
	err = json.Unmarshal(responseBody, &response)
	if err != nil {
		return types.NewError(err, types.ErrorCodeBadResponseBody), nil
	}
	response.Model = info.UpstreamModelName
	var responseText string
	for _, choice := range response.Choices {
		responseText += choice.Message.StringContent()
	}
	usage := service.ResponseText2Usage(responseText, info.UpstreamModelName, info.GetEstimatePromptTokens())
	response.Usage = *usage
	response.Id = helper2.GetResponseID("")
	jsonResponse, err := json.Marshal(response)
	if err != nil {
		return types.NewError(err, types.ErrorCodeBadResponseBody), nil
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	if _, err := w.Write(jsonResponse); err != nil {
		logger.Warn("error writing cloudflare response", zap.String("error", err.Error()))
	}
	return nil, usage
}

func cfSTTHandler(c context.Context, info *common.RelayInfo, resp *http.Response, w http.ResponseWriter) (*types.NewAPIError, *dto.Usage) {
	var cfResp CfAudioResponse
	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return types.NewError(err, types.ErrorCodeBadResponseBody), nil
	}
	resp.Body.Close()
	err = json.Unmarshal(responseBody, &cfResp)
	if err != nil {
		return types.NewError(err, types.ErrorCodeBadResponseBody), nil
	}

	audioResp := &dto.AudioResponse{
		Text: cfResp.Result.Text,
	}

	jsonResponse, err := json.Marshal(audioResp)
	if err != nil {
		return types.NewError(err, types.ErrorCodeBadResponseBody), nil
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	if _, err := w.Write(jsonResponse); err != nil {
		logger.Warn("error writing cloudflare stt response", zap.String("error", err.Error()))
	}

	usage := service.ResponseText2Usage(cfResp.Result.Text, info.UpstreamModelName, info.GetEstimatePromptTokens())
	return nil, usage
}
