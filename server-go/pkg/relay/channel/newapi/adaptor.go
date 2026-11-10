package newapi

import (
	"context"
	"errors"
	"io"
	"net/http"

	"github.com/heathcetide/DietDigiDose/pkg/relay/channel"
	"github.com/heathcetide/DietDigiDose/pkg/relay/channel/claude"
	"github.com/heathcetide/DietDigiDose/pkg/relay/channel/gemini"
	"github.com/heathcetide/DietDigiDose/pkg/relay/channel/openai"
	"github.com/heathcetide/DietDigiDose/pkg/relay/common"
	relayconstant "github.com/heathcetide/DietDigiDose/pkg/relay/relaymode"
	"github.com/heathcetide/DietDigiDose/pkg/relay/relaykit/dto"
	"github.com/heathcetide/DietDigiDose/pkg/relay/relaykit/types"

)

type Adaptor struct {
	openaiAdaptor openai.Adaptor
	claudeAdaptor claude.Adaptor
	geminiAdaptor gemini.Adaptor
}

func (a *Adaptor) Init(info *common.RelayInfo) {
	a.openaiAdaptor.Init(info)
	a.claudeAdaptor.Init(info)
	a.geminiAdaptor.Init(info)
}

func (a *Adaptor) GetRequestURL(info *common.RelayInfo) (string, error) {
	if info.RelayMode == relayconstant.RelayModeAlphaSearch {
		return channel.GetFullRequestURL(info.ChannelBaseUrl, "/v1/alpha/search", info.ChannelType), nil
	}
	return channel.GetFullRequestURL(info.ChannelBaseUrl, info.RequestURLPath, info.ChannelType), nil
}

func (a *Adaptor) SetupRequestHeader(c context.Context, req *http.Header, info *common.RelayInfo) error {
	channel.SetupApiRequestHeader(info, req)
	req.Set("Authorization", "Bearer "+info.ApiKey)

	switch info.RelayFormat {
	case types.RelayFormatClaude:
		req.Set("x-api-key", info.ApiKey)
		if req.Get("anthropic-version") == "" {
			anthropicVersion := info.RequestHeaders["anthropic-version"]
			if anthropicVersion == "" {
				anthropicVersion = "2023-06-01"
			}
			req.Set("anthropic-version", anthropicVersion)
		}
	case types.RelayFormatGemini:
		req.Set("x-goog-api-key", info.ApiKey)
	}
	return nil
}

func (a *Adaptor) ConvertOpenAIRequest(c context.Context, info *common.RelayInfo, request *dto.GeneralOpenAIRequest) (any, error) {
	if request == nil {
		return nil, errors.New("request is nil")
	}
	return request, nil
}

func (a *Adaptor) ConvertOpenAIResponsesRequest(c context.Context, info *common.RelayInfo, request dto.OpenAIResponsesRequest) (any, error) {
	return request, nil
}

func (a *Adaptor) ConvertEmbeddingRequest(c context.Context, info *common.RelayInfo, request dto.EmbeddingRequest) (any, error) {
	return request, nil
}

func (a *Adaptor) ConvertClaudeRequest(c context.Context, info *common.RelayInfo, request *dto.ClaudeRequest) (any, error) {
	if request == nil {
		return nil, errors.New("request is nil")
	}
	return request, nil
}

func (a *Adaptor) ConvertGeminiRequest(c context.Context, info *common.RelayInfo, request *dto.GeminiChatRequest) (any, error) {
	if request == nil {
		return nil, errors.New("request is nil")
	}
	return request, nil
}

func (a *Adaptor) ConvertImageRequest(c context.Context, info *common.RelayInfo, request dto.ImageRequest) (any, error) {
	return a.openaiAdaptor.ConvertImageRequest(c, info, request)
}

func (a *Adaptor) ConvertRerankRequest(c context.Context, relayMode int, request dto.RerankRequest) (any, error) {
	return nil, errors.New("endpoint not supported")
}

func (a *Adaptor) ConvertAudioRequest(c context.Context, info *common.RelayInfo, request dto.AudioRequest) (io.Reader, error) {
	return nil, errors.New("endpoint not supported")
}

func (a *Adaptor) DoRequest(c context.Context, info *common.RelayInfo, requestBody io.Reader) (*http.Response, error) {
	return channel.DoApiRequest(c, a, info, requestBody)
}

func (a *Adaptor) DoResponse(c context.Context, resp *http.Response, info *common.RelayInfo, w http.ResponseWriter) (usage any, err *types.NewAPIError) {
	switch info.RelayFormat {
	case types.RelayFormatClaude:
		return a.claudeAdaptor.DoResponse(c, resp, info, w)
	case types.RelayFormatGemini:
		return a.geminiAdaptor.DoResponse(c, resp, info, w)
	default:
		return a.openaiAdaptor.DoResponse(c, resp, info, w)
	}
}

func (a *Adaptor) GetModelList() []string {
	return ModelList
}

func (a *Adaptor) GetChannelName() string {
	return ChannelName
}
