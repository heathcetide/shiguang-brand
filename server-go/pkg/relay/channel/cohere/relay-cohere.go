package cohere

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common/logger"
	common "github.com/heathcetide/DietDigiDose/pkg/relay/common"
	"github.com/heathcetide/DietDigiDose/pkg/relay/helper"
	helper2 "github.com/heathcetide/DietDigiDose/pkg/relay/helper"
	"github.com/heathcetide/DietDigiDose/pkg/relay/relaykit/dto"
	"github.com/heathcetide/DietDigiDose/pkg/relay/relaykit/types"
	"github.com/heathcetide/DietDigiDose/pkg/relay/service"

	"github.com/samber/lo"
	"go.uber.org/zap"
)

func requestOpenAI2Cohere(textRequest dto.GeneralOpenAIRequest) *CohereRequest {
	cohereReq := CohereRequest{
		Model:       textRequest.Model,
		ChatHistory: []ChatHistory{},
		Message:     "",
		Stream:      lo.FromPtrOr(textRequest.Stream, false),
		MaxTokens:   textRequest.GetMaxTokens(),
	}
	// Not supported in library mode — common.CohereSafetySetting does not exist.
	// if common.CohereSafetySetting != "NONE" {
	// 	cohereReq.SafetyMode = common.CohereSafetySetting
	// }
	if cohereReq.MaxTokens == 0 {
		cohereReq.MaxTokens = 4000
	}
	for _, msg := range textRequest.Messages {
		if msg.Role == "user" {
			cohereReq.Message = msg.StringContent()
		} else {
			var role string
			if msg.Role == "assistant" {
				role = "CHATBOT"
			} else if msg.Role == "system" {
				role = "SYSTEM"
			} else {
				role = "USER"
			}
			cohereReq.ChatHistory = append(cohereReq.ChatHistory, ChatHistory{
				Role:    role,
				Message: msg.StringContent(),
			})
		}
	}

	return &cohereReq
}

func requestConvertRerank2Cohere(rerankRequest dto.RerankRequest) *CohereRerankRequest {
	topN := lo.FromPtrOr(rerankRequest.TopN, 1)
	if topN <= 0 {
		topN = 1
	}
	cohereReq := CohereRerankRequest{
		Query:           rerankRequest.Query,
		Documents:       rerankRequest.Documents,
		Model:           rerankRequest.Model,
		TopN:            topN,
		ReturnDocuments: true,
	}
	return &cohereReq
}

func stopReasonCohere2OpenAI(reason string) string {
	switch reason {
	case "COMPLETE":
		return "stop"
	case "MAX_TOKENS":
		return "max_tokens"
	default:
		return reason
	}
}

func cohereStreamHandler(c context.Context, info *common.RelayInfo, resp *http.Response, w http.ResponseWriter) (*dto.Usage, *types.NewAPIError) {
	responseId := helper.GetResponseID("")
	createdTime := time.Now().Unix()
	usage := &dto.Usage{}
	responseText := ""
	helper.SetEventStreamHeaders(w)
	err := helper2.StreamScannerHandler(resp, func(data string) error {
		data = strings.TrimSuffix(data, "\r")
		var cohereResp CohereResponse
		err := json.Unmarshal([]byte(data), &cohereResp)
		if err != nil {
			logger.Warn("error unmarshalling stream response", zap.String("error", err.Error()))
			return nil
		}
		var openaiResp dto.ChatCompletionsStreamResponse
		openaiResp.Id = responseId
		openaiResp.Created = createdTime
		openaiResp.Object = "chat.completion.chunk"
		openaiResp.Model = info.UpstreamModelName
		if cohereResp.IsFinished {
			finishReason := stopReasonCohere2OpenAI(cohereResp.FinishReason)
			openaiResp.Choices = []dto.ChatCompletionsStreamResponseChoice{
				{
					Delta:        dto.ChatCompletionsStreamResponseChoiceDelta{},
					Index:        0,
					FinishReason: &finishReason,
				},
			}
			if cohereResp.Response != nil {
				usage.PromptTokens = cohereResp.Response.Meta.BilledUnits.InputTokens
				usage.CompletionTokens = cohereResp.Response.Meta.BilledUnits.OutputTokens
			}
		} else {
			openaiResp.Choices = []dto.ChatCompletionsStreamResponseChoice{
				{
					Delta: dto.ChatCompletionsStreamResponseChoiceDelta{
						Role:    "assistant",
						Content: &cohereResp.Text,
					},
					Index: 0,
				},
			}
			responseText += cohereResp.Text
		}
		jsonStr, err := json.Marshal(openaiResp)
		if err != nil {
			logger.Warn("error marshalling stream response", zap.String("error", err.Error()))
			return nil
		}
		fmt.Fprintf(w, "data: %s\n\n", string(jsonStr))
		return nil
	})
	if err != nil {
		logger.Warn("error reading stream", zap.String("error", err.Error()))
	}
	fmt.Fprintf(w, "data: [DONE]\n\n")
	if usage.PromptTokens == 0 {
		usage = service.ResponseText2Usage(responseText, info.UpstreamModelName, info.GetEstimatePromptTokens())
	}
	return usage, nil
}

func cohereHandler(c context.Context, info *common.RelayInfo, resp *http.Response, w http.ResponseWriter) (*dto.Usage, *types.NewAPIError) {
	createdTime := time.Now().Unix()
	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, types.NewError(err, types.ErrorCodeBadResponseBody)
	}
	resp.Body.Close()
	var cohereResp CohereResponseResult
	err = json.Unmarshal(responseBody, &cohereResp)
	if err != nil {
		return nil, types.NewError(err, types.ErrorCodeBadResponseBody)
	}
	usage := dto.Usage{}
	usage.PromptTokens = cohereResp.Meta.BilledUnits.InputTokens
	usage.CompletionTokens = cohereResp.Meta.BilledUnits.OutputTokens
	usage.TotalTokens = cohereResp.Meta.BilledUnits.InputTokens + cohereResp.Meta.BilledUnits.OutputTokens

	var openaiResp dto.TextResponse
	openaiResp.Id = cohereResp.ResponseId
	openaiResp.Created = createdTime
	openaiResp.Object = "chat.completion"
	openaiResp.Model = info.UpstreamModelName
	openaiResp.Usage = usage

	openaiResp.Choices = []dto.OpenAITextResponseChoice{
		{
			Index:        0,
			Message:      dto.Message{Content: cohereResp.Text, Role: "assistant"},
			FinishReason: stopReasonCohere2OpenAI(cohereResp.FinishReason),
		},
	}

	jsonResponse, err := json.Marshal(openaiResp)
	if err != nil {
		return nil, types.NewError(err, types.ErrorCodeBadResponseBody)
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	if _, err := w.Write(jsonResponse); err != nil {
		logger.Warn("error writing cohere response", zap.String("error", err.Error()))
	}
	return &usage, nil
}

func requestOpenAI2CohereEmbedding(request dto.EmbeddingRequest) *CohereEmbeddingRequest {
	return &CohereEmbeddingRequest{
		Texts:     request.ParseInput(),
		Model:     request.Model,
		InputType: "search_document",
	}
}

func cohereEmbeddingHandler(c context.Context, resp *http.Response, info *common.RelayInfo, w http.ResponseWriter) (*dto.Usage, *types.NewAPIError) {
	defer resp.Body.Close()
	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, types.NewError(err, types.ErrorCodeBadResponseBody)
	}
	var cohereResp CohereEmbeddingResponse
	err = json.Unmarshal(responseBody, &cohereResp)
	if err != nil {
		return nil, types.NewError(err, types.ErrorCodeBadResponseBody)
	}

	usage := dto.Usage{}
	usage.PromptTokens = cohereResp.Meta.BilledUnits.InputTokens
	usage.TotalTokens = cohereResp.Meta.BilledUnits.InputTokens

	openaiResp := dto.OpenAIEmbeddingResponse{
		Object: "list",
		Model:  info.UpstreamModelName,
		Usage:  usage,
	}
	for i, embedding := range cohereResp.Embeddings {
		openaiResp.Data = append(openaiResp.Data, dto.OpenAIEmbeddingResponseItem{
			Object:    "embedding",
			Index:     i,
			Embedding: embedding,
		})
	}

	jsonResponse, err := json.Marshal(openaiResp)
	if err != nil {
		return nil, types.NewError(err, types.ErrorCodeBadResponseBody)
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	if _, err = w.Write(jsonResponse); err != nil {
		logger.Warn("error writing cohere embedding response", zap.String("error", err.Error()))
	}
	return &usage, nil
}

func cohereRerankHandler(c context.Context, resp *http.Response, info *common.RelayInfo, w http.ResponseWriter) (*dto.Usage, *types.NewAPIError) {
	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, types.NewError(err, types.ErrorCodeBadResponseBody)
	}
	resp.Body.Close()
	var cohereResp CohereRerankResponseResult
	err = json.Unmarshal(responseBody, &cohereResp)
	if err != nil {
		return nil, types.NewError(err, types.ErrorCodeBadResponseBody)
	}
	usage := dto.Usage{}
	if cohereResp.Meta.BilledUnits.InputTokens == 0 {
		usage.PromptTokens = info.GetEstimatePromptTokens()
		usage.CompletionTokens = 0
		usage.TotalTokens = info.GetEstimatePromptTokens()
	} else {
		usage.PromptTokens = cohereResp.Meta.BilledUnits.InputTokens
		usage.CompletionTokens = cohereResp.Meta.BilledUnits.OutputTokens
		usage.TotalTokens = cohereResp.Meta.BilledUnits.InputTokens + cohereResp.Meta.BilledUnits.OutputTokens
	}

	var rerankResp dto.RerankResponse
	rerankResp.Results = cohereResp.Results
	rerankResp.Usage = usage

	jsonResponse, err := json.Marshal(rerankResp)
	if err != nil {
		return nil, types.NewError(err, types.ErrorCodeBadResponseBody)
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	_, err = w.Write(jsonResponse)
	return &usage, nil
}
