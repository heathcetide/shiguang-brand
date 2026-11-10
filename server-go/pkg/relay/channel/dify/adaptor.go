package dify

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"

	"github.com/heathcetide/DietDigiDose/pkg/relay/channel"
	common "github.com/heathcetide/DietDigiDose/pkg/relay/common"
	"github.com/heathcetide/DietDigiDose/pkg/relay/relaykit/dto"
	"github.com/heathcetide/DietDigiDose/pkg/relay/relaykit/types"

)

const (
	BotTypeChatFlow   = 1 // chatflow default
	BotTypeAgent      = 2
	BotTypeWorkFlow   = 3
	BotTypeCompletion = 4
)

type Adaptor struct {
	BotType int
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
	//if strings.HasPrefix(info.UpstreamModelName, "agent") {
	//	a.BotType = BotTypeAgent
	//} else if strings.HasPrefix(info.UpstreamModelName, "workflow") {
	//	a.BotType = BotTypeWorkFlow
	//} else if strings.HasPrefix(info.UpstreamModelName, "chat") {
	//	a.BotType = BotTypeCompletion
	//} else {
	//}
	a.BotType = BotTypeChatFlow

}

func (a *Adaptor) GetRequestURL(info *common.RelayInfo) (string, error) {
	switch a.BotType {
	case BotTypeWorkFlow:
		return fmt.Sprintf("%s/v1/workflows/run", info.ChannelBaseUrl), nil
	case BotTypeCompletion:
		return fmt.Sprintf("%s/v1/completion-messages", info.ChannelBaseUrl), nil
	case BotTypeAgent:
		fallthrough
	default:
		return fmt.Sprintf("%s/v1/chat-messages", info.ChannelBaseUrl), nil
	}
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
	return requestOpenAI2Dify(c, info, *request), nil
}

func (a *Adaptor) ConvertRerankRequest(c context.Context, relayMode int, request dto.RerankRequest) (any, error) {
	return nil, nil
}

func (a *Adaptor) ConvertEmbeddingRequest(c context.Context, info *common.RelayInfo, request dto.EmbeddingRequest) (any, error) {
	return nil, errors.New("unsupported capability for this provider")
}

func (a *Adaptor) ConvertOpenAIResponsesRequest(c context.Context, info *common.RelayInfo, request dto.OpenAIResponsesRequest) (any, error) {
	// Responses API is not supported by this provider
	return nil, errors.New("unsupported capability for this provider")
}

func (a *Adaptor) DoRequest(c context.Context, info *common.RelayInfo, requestBody io.Reader) (*http.Response, error) {
	return channel.DoApiRequest(c, a, info, requestBody)
}

func (a *Adaptor) DoResponse(c context.Context, resp *http.Response, info *common.RelayInfo, w http.ResponseWriter) (usage any, err *types.NewAPIError) {
	if info.IsStream {
		return difyStreamHandler(c, info, resp, w)
	} else {
		return difyHandler(c, info, resp, w)
	}
}

func (a *Adaptor) GetModelList() []string {
	return ModelList
}

func (a *Adaptor) GetChannelName() string {
	return ChannelName
}
