package cohere

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"

	"github.com/heathcetide/DietDigiDose/pkg/relay/channel"
	common "github.com/heathcetide/DietDigiDose/pkg/relay/common"
	relaymode "github.com/heathcetide/DietDigiDose/pkg/relay/relaymode"
	"github.com/heathcetide/DietDigiDose/pkg/relay/relaykit/dto"
	"github.com/heathcetide/DietDigiDose/pkg/relay/relaykit/types"

)

type Adaptor struct {
}

func (a *Adaptor) ConvertGeminiRequest(context.Context, *common.RelayInfo, *dto.GeminiChatRequest) (any, error) {
	return nil, errors.New("unsupported capability for this provider")
}

func (a *Adaptor) ConvertClaudeRequest(context.Context, *common.RelayInfo, *dto.ClaudeRequest) (any, error) {
	return nil, errors.New("unsupported capability for this provider")
}

func (a *Adaptor) ConvertAudioRequest(c context.Context, info *common.RelayInfo, request dto.AudioRequest) (io.Reader, error) {
	return nil, errors.New("unsupported capability for this provider")
}

func (a *Adaptor) ConvertImageRequest(c context.Context, info *common.RelayInfo, request dto.ImageRequest) (any, error) {
	return nil, errors.New("unsupported capability for this provider")
}

func (a *Adaptor) Init(info *common.RelayInfo) {
}

func (a *Adaptor) GetRequestURL(info *common.RelayInfo) (string, error) {
	if info.RelayMode == relaymode.RelayModeRerank {
		return fmt.Sprintf("%s/v1/rerank", info.ChannelBaseUrl), nil
	} else if info.RelayMode == relaymode.RelayModeEmbeddings {
		return fmt.Sprintf("%s/v1/embed", info.ChannelBaseUrl), nil
	} else {
		return fmt.Sprintf("%s/v1/chat", info.ChannelBaseUrl), nil
	}
}

func (a *Adaptor) SetupRequestHeader(c context.Context, req *http.Header, info *common.RelayInfo) error {
	channel.SetupApiRequestHeader(info, req)
	req.Set("Authorization", fmt.Sprintf("Bearer %s", info.ApiKey))
	return nil
}

func (a *Adaptor) ConvertOpenAIRequest(c context.Context, info *common.RelayInfo, request *dto.GeneralOpenAIRequest) (any, error) {
	return requestOpenAI2Cohere(*request), nil
}

func (a *Adaptor) ConvertOpenAIResponsesRequest(c context.Context, info *common.RelayInfo, request dto.OpenAIResponsesRequest) (any, error) {
	// Responses API is not supported by this provider
	return nil, errors.New("unsupported capability for this provider")
}

func (a *Adaptor) DoRequest(c context.Context, info *common.RelayInfo, requestBody io.Reader) (*http.Response, error) {
	return channel.DoApiRequest(c, a, info, requestBody)
}

func (a *Adaptor) ConvertRerankRequest(c context.Context, relayMode int, request dto.RerankRequest) (any, error) {
	// Cohere rerank uses passthrough; the request body is converted
	// to Cohere format by requestConvertRerank2Cohere at the handler level.
	return request, nil
}

func (a *Adaptor) ConvertEmbeddingRequest(c context.Context, info *common.RelayInfo, request dto.EmbeddingRequest) (any, error) {
	return requestOpenAI2CohereEmbedding(request), nil
}

func (a *Adaptor) DoResponse(c context.Context, resp *http.Response, info *common.RelayInfo, w http.ResponseWriter) (usage any, err *types.NewAPIError) {
	if info.RelayMode == relaymode.RelayModeRerank {
		usage, err = cohereRerankHandler(c, resp, info, w)
	} else if info.RelayMode == relaymode.RelayModeEmbeddings {
		usage, err = cohereEmbeddingHandler(c, resp, info, w)
	} else {
		if info.IsStream {
			usage, err = cohereStreamHandler(c, info, resp, w)
		} else {
			usage, err = cohereHandler(c, info, resp, w)
		}
	}
	return
}

func (a *Adaptor) GetModelList() []string {
	return ModelList
}

func (a *Adaptor) GetChannelName() string {
	return ChannelName
}
