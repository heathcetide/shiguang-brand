package coze

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/relay/channel"
	"github.com/heathcetide/DietDigiDose/pkg/relay/common"
	"github.com/heathcetide/DietDigiDose/pkg/relay/relaykit/dto"
	"github.com/heathcetide/DietDigiDose/pkg/relay/relaykit/types"

)

type Adaptor struct {
}

func (a *Adaptor) ConvertGeminiRequest(context.Context, *common.RelayInfo, *dto.GeminiChatRequest) (any, error) {
	return nil, errors.New("unsupported capability for this provider")
}

// ConvertAudioRequest implements channel.Adaptor.
func (a *Adaptor) ConvertAudioRequest(c context.Context, info *common.RelayInfo, request dto.AudioRequest) (io.Reader, error) {
	return nil, errors.New("unsupported capability for this provider")
}

// ConvertClaudeRequest implements channel.Adaptor.
func (a *Adaptor) ConvertClaudeRequest(c context.Context, info *common.RelayInfo, request *dto.ClaudeRequest) (any, error) {
	return nil, errors.New("unsupported capability for this provider")
}

// ConvertEmbeddingRequest implements channel.Adaptor.
func (a *Adaptor) ConvertEmbeddingRequest(c context.Context, info *common.RelayInfo, request dto.EmbeddingRequest) (any, error) {
	return nil, errors.New("unsupported capability for this provider")
}

// ConvertImageRequest implements channel.Adaptor.
func (a *Adaptor) ConvertImageRequest(c context.Context, info *common.RelayInfo, request dto.ImageRequest) (any, error) {
	return nil, errors.New("unsupported capability for this provider")
}

// ConvertOpenAIRequest implements channel.Adaptor.
func (a *Adaptor) ConvertOpenAIRequest(c context.Context, info *common.RelayInfo, request *dto.GeneralOpenAIRequest) (any, error) {
	if request == nil {
		return nil, errors.New("request is nil")
	}
	return convertCozeChatRequest(c, *request), nil
}

// ConvertOpenAIResponsesRequest implements channel.Adaptor.
func (a *Adaptor) ConvertOpenAIResponsesRequest(c context.Context, info *common.RelayInfo, request dto.OpenAIResponsesRequest) (any, error) {
	return nil, errors.New("unsupported capability for this provider")
}

// ConvertRerankRequest implements channel.Adaptor.
func (a *Adaptor) ConvertRerankRequest(c context.Context, relayMode int, request dto.RerankRequest) (any, error) {
	return nil, errors.New("unsupported capability for this provider")
}

// DoRequest implements channel.Adaptor.
func (a *Adaptor) DoRequest(c context.Context, info *common.RelayInfo, requestBody io.Reader) (*http.Response, error) {
	if info.IsStream {
		return channel.DoApiRequest(c, a, info, requestBody)
	}
	// 首先发送创建消息请求，成功后再发送获取消息请求
	// 发送创建消息请求
	resp, err := channel.DoApiRequest(c, a, info, requestBody)
	if err != nil {
		return nil, err
	}
	// 解析 resp
	var cozeResponse CozeChatResponse
	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	err = json.Unmarshal(respBody, &cozeResponse)
	if cozeResponse.Code != 0 {
		return nil, errors.New(cozeResponse.Msg)
	}
	// c.Set("coze_conversation_id", cozeResponse.Data.ConversationId)
	// c.Set("coze_chat_id", cozeResponse.Data.Id)
	// 轮询检查消息是否完成
	for {
		err, isComplete := checkIfChatComplete(a, c, info)
		if err != nil {
			return nil, err
		} else {
			if isComplete {
				break
			}
		}
		time.Sleep(time.Second * 1)
	}
	// 发送获取消息请求
	return getChatDetail(a, c, info)
}

// DoResponse implements channel.Adaptor.
func (a *Adaptor) DoResponse(c context.Context, resp *http.Response, info *common.RelayInfo, w http.ResponseWriter) (usage any, err *types.NewAPIError) {
	if info.IsStream {
		usage, err = cozeChatStreamHandler(c, info, resp, w)
	} else {
		usage, err = cozeChatHandler(c, info, resp, w)
	}
	return
}

// GetChannelName implements channel.Adaptor.
func (a *Adaptor) GetChannelName() string {
	return ChannelName
}

// GetModelList implements channel.Adaptor.
func (a *Adaptor) GetModelList() []string {
	return ModelList
}

// GetRequestURL implements channel.Adaptor.
func (a *Adaptor) GetRequestURL(info *common.RelayInfo) (string, error) {
	return fmt.Sprintf("%s/v3/chat", info.ChannelBaseUrl), nil
}

// Init implements channel.Adaptor.
func (a *Adaptor) Init(info *common.RelayInfo) {

}

// SetupRequestHeader implements channel.Adaptor.
func (a *Adaptor) SetupRequestHeader(c context.Context, req *http.Header, info *common.RelayInfo) error {
	channel.SetupApiRequestHeader(info, req)
	req.Set("Authorization", "Bearer "+info.ApiKey)
	return nil
}
