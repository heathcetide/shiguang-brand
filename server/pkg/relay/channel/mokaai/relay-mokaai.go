package mokaai

import (
	"context"
	"encoding/json"
	"io"
	"net/http"

	common "github.com/heathcetide/DietDigiDose/pkg/relay/common"
	"github.com/heathcetide/DietDigiDose/pkg/relay/relaykit/dto"
	"github.com/heathcetide/DietDigiDose/pkg/relay/relaykit/types"
	"github.com/heathcetide/DietDigiDose/pkg/relay/service"

)

func embeddingRequestOpenAI2Moka(request dto.GeneralOpenAIRequest) *dto.EmbeddingRequest {
	var input []string // Change input to []string

	switch v := request.Input.(type) {
	case string:
		input = []string{v} // Convert string to []string
	case []string:
		input = v // Already a []string, no conversion needed
	case []interface{}:
		for _, part := range v {
			if str, ok := part.(string); ok {
				input = append(input, str) // Append each string to the slice
			}
		}
	}
	return &dto.EmbeddingRequest{
		Input: input,
		Model: request.Model,
	}
}

func embeddingResponseMoka2OpenAI(response *dto.EmbeddingResponse) *dto.OpenAIEmbeddingResponse {
	openAIEmbeddingResponse := dto.OpenAIEmbeddingResponse{
		Object: "list",
		Data:   make([]dto.OpenAIEmbeddingResponseItem, 0, len(response.Data)),
		Model:  "baidu-embedding",
		Usage:  response.Usage,
	}
	for _, item := range response.Data {
		openAIEmbeddingResponse.Data = append(openAIEmbeddingResponse.Data, dto.OpenAIEmbeddingResponseItem{
			Object:    item.Object,
			Index:     item.Index,
			Embedding: item.Embedding,
		})
	}
	return &openAIEmbeddingResponse
}

func mokaEmbeddingHandler(c context.Context, info *common.RelayInfo, resp *http.Response, w http.ResponseWriter) (*dto.Usage, *types.NewAPIError) {
	defer resp.Body.Close()
	var baiduResponse dto.EmbeddingResponse
	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, types.NewError(err, types.ErrorCodeBadResponseBody)
	}
	err = json.Unmarshal(responseBody, &baiduResponse)
	if err != nil {
		return nil, types.NewError(err, types.ErrorCodeBadResponseBody)
	}
	// if baiduResponse.ErrorMsg != "" {
	// 	return &dto.OpenAIErrorWithStatusCode{
	// 		Error: dto.OpenAIError{
	// 			Type:    "baidu_error",
	// 			Param:   "",
	// 		},
	// 		StatusCode: resp.StatusCode,
	// 	}, nil
	// }
	fullTextResponse := embeddingResponseMoka2OpenAI(&baiduResponse)
	jsonResponse, err := json.Marshal(fullTextResponse)
	if err != nil {
		return nil, types.NewError(err, types.ErrorCodeBadResponseBody)
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	service.IOCopyBytesGracefully(w, resp, jsonResponse)
	return &fullTextResponse.Usage, nil
}
