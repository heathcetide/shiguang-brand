package xai

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/heathcetide/DietDigiDose/pkg/relay/channel"
	openai2 "github.com/heathcetide/DietDigiDose/pkg/relay/channel/openai"
	"github.com/heathcetide/DietDigiDose/pkg/relay/common"
	constant "github.com/heathcetide/DietDigiDose/pkg/relay/relaymode"
	"github.com/heathcetide/DietDigiDose/pkg/relay/relaykit/dto"
	"github.com/heathcetide/DietDigiDose/pkg/relay/relaykit/types"

	"github.com/samber/lo"
)

type Adaptor struct {
}

func (a *Adaptor) ConvertGeminiRequest(context.Context, *common.RelayInfo, *dto.GeminiChatRequest) (any, error) {
	return nil, errors.New("unsupported capability for this provider")
}

func (a *Adaptor) ConvertClaudeRequest(context.Context, *common.RelayInfo, *dto.ClaudeRequest) (any, error) {
	//panic("implement me")
	return nil, errors.New("not available")
}

func (a *Adaptor) ConvertAudioRequest(c context.Context, info *common.RelayInfo, request dto.AudioRequest) (io.Reader, error) {
	//not available
	return nil, errors.New("not available")
}

func (a *Adaptor) ConvertImageRequest(c context.Context, info *common.RelayInfo, request dto.ImageRequest) (any, error) {
	xaiRequest := ImageRequest{
		Model:          request.Model,
		Prompt:         request.Prompt,
		N:              int(lo.FromPtrOr(request.N, uint(1))),
		ResponseFormat: request.ResponseFormat,
	}
	return xaiRequest, nil
}

func (a *Adaptor) Init(info *common.RelayInfo) {
}

func (a *Adaptor) GetRequestURL(info *common.RelayInfo) (string, error) {
	return channel.GetFullRequestURL(info.ChannelBaseUrl, info.RequestURLPath, info.ChannelType), nil
}

func (a *Adaptor) SetupRequestHeader(c context.Context, req *http.Header, info *common.RelayInfo) error {
	channel.SetupApiRequestHeader(info, req)
	req.Set("Authorization", "Bearer "+info.ApiKey)
	return nil
}

func (a *Adaptor) ConvertOpenAIRequest(c context.Context, info *common.RelayInfo, request *dto.GeneralOpenAIRequest) (any, error) {
	if request == nil {
		return nil, errors.New("request is nil")
	}
	if strings.HasSuffix(info.UpstreamModelName, "-search") {
		info.UpstreamModelName = strings.TrimSuffix(info.UpstreamModelName, "-search")
		request.Model = info.UpstreamModelName
		toMap := request.ToMap()
		toMap["search_parameters"] = map[string]any{
			"mode": "on",
		}
		return toMap, nil
	}
	if strings.HasPrefix(request.Model, "grok-3-mini") {
		if lo.FromPtrOr(request.MaxCompletionTokens, uint(0)) == 0 && lo.FromPtrOr(request.MaxTokens, uint(0)) != 0 {
			request.MaxCompletionTokens = request.MaxTokens
			request.MaxTokens = nil
		}
		if strings.HasSuffix(request.Model, "-high") {
			request.ReasoningEffort = "high"
			request.Model = strings.TrimSuffix(request.Model, "-high")
		} else if strings.HasSuffix(request.Model, "-low") {
			request.ReasoningEffort = "low"
			request.Model = strings.TrimSuffix(request.Model, "-low")
		}
		info.ReasoningEffort = request.ReasoningEffort
		info.UpstreamModelName = request.Model
	}
	return request, nil
}

func (a *Adaptor) ConvertRerankRequest(c context.Context, relayMode int, request dto.RerankRequest) (any, error) {
	return nil, nil
}

func (a *Adaptor) ConvertEmbeddingRequest(c context.Context, info *common.RelayInfo, request dto.EmbeddingRequest) (any, error) {
	return request, nil
}

func (a *Adaptor) ConvertOpenAIResponsesRequest(c context.Context, info *common.RelayInfo, request dto.OpenAIResponsesRequest) (any, error) {
	if request.Model == "" && info != nil {
		request.Model = info.UpstreamModelName
	}
	return request, nil
}

func (a *Adaptor) DoRequest(c context.Context, info *common.RelayInfo, requestBody io.Reader) (*http.Response, error) {
	return channel.DoApiRequest(c, a, info, requestBody)
}

func (a *Adaptor) DoResponse(c context.Context, resp *http.Response, info *common.RelayInfo, w http.ResponseWriter) (usage any, err *types.NewAPIError) {
	switch info.RelayMode {
	case constant.RelayModeImagesGenerations, constant.RelayModeImagesEdits:
		adaptor := openai2.Adaptor{}
		return adaptor.DoResponse(c, resp, info, w)
	case constant.RelayModeResponses:
		adaptor := openai2.Adaptor{}
		return adaptor.DoResponse(c, resp, info, w)
	case constant.RelayModeEmbeddings:
		adaptor := openai2.Adaptor{}
		return adaptor.DoResponse(c, resp, info, w)
	default:
		if info.IsStream {
			usage, err = xAIStreamHandler(c, info, resp, w)
		} else {
			usage, err = xAIHandler(c, info, resp, w)
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
