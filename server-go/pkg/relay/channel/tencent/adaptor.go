package tencent

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/relay/channel"
	"github.com/heathcetide/DietDigiDose/pkg/relay/channel/openai"
	common "github.com/heathcetide/DietDigiDose/pkg/relay/common"
	"github.com/heathcetide/DietDigiDose/pkg/relay/relaymode"
	"github.com/heathcetide/DietDigiDose/pkg/relay/relaykit/dto"
	"github.com/heathcetide/DietDigiDose/pkg/relay/relaykit/types"

)

type Adaptor struct {
	Sign      string
	AppID     int64
	Action    string
	Version   string
	Timestamp int64
}

func (a *Adaptor) ConvertGeminiRequest(context.Context, *common.RelayInfo, *dto.GeminiChatRequest) (any, error) {
	return nil, errors.New("unsupported capability for this provider")
}

func (a *Adaptor) ConvertClaudeRequest(context.Context, *common.RelayInfo, *dto.ClaudeRequest) (any, error) {
	return nil, errors.New("unsupported capability for this provider")
}

func (a *Adaptor) ConvertAudioRequest(c context.Context, info *common.RelayInfo, request dto.AudioRequest) (io.Reader, error) {
	data, err := json.Marshal(request)
	if err != nil {
		return nil, err
	}
	return bytes.NewReader(data), nil
}

func (a *Adaptor) ConvertImageRequest(c context.Context, info *common.RelayInfo, request dto.ImageRequest) (any, error) {
	return nil, errors.New("unsupported capability for this provider")
}

func (a *Adaptor) Init(info *common.RelayInfo) {
	a.Action = "ChatCompletions"
	a.Version = "2023-09-01"
	a.Timestamp = time.Now().Unix()
}

func (a *Adaptor) GetRequestURL(info *common.RelayInfo) (string, error) {
	if info.RelayMode == constant.RelayModeAudioSpeech {
		return fmt.Sprintf("%s/v1/audio/speech", info.ChannelBaseUrl), nil
	}
	if info.RelayMode == constant.RelayModeEmbeddings {
		return fmt.Sprintf("%s/", info.ChannelBaseUrl), nil
	}
	return fmt.Sprintf("%s/", info.ChannelBaseUrl), nil
}

func (a *Adaptor) SetupRequestHeader(c context.Context, req *http.Header, info *common.RelayInfo) error {
	channel.SetupApiRequestHeader(info, req)
	req.Set("Authorization", a.Sign)
	req.Set("X-TC-Action", a.Action)
	req.Set("X-TC-Version", a.Version)
	req.Set("X-TC-Timestamp", strconv.FormatInt(a.Timestamp, 10))
	return nil
}

func (a *Adaptor) ConvertOpenAIRequest(c context.Context, info *common.RelayInfo, request *dto.GeneralOpenAIRequest) (any, error) {
	if request == nil {
		return nil, errors.New("request is nil")
	}
	apiKey := info.ApiKey
	apiKey = strings.TrimPrefix(apiKey, "Bearer ")
	appId, secretId, secretKey, err := parseTencentConfig(apiKey)
	a.AppID = appId
	if err != nil {
		return nil, err
	}
	tencentRequest := requestOpenAI2Tencent(a, *request)
	// we have to calculate the sign here
	a.Sign = getTencentSign(*tencentRequest, a, secretId, secretKey)
	return tencentRequest, nil
}

func (a *Adaptor) ConvertRerankRequest(c context.Context, relayMode int, request dto.RerankRequest) (any, error) {
	return request, nil
}

func (a *Adaptor) ConvertEmbeddingRequest(c context.Context, info *common.RelayInfo, request dto.EmbeddingRequest) (any, error) {
	return request, nil
}

func (a *Adaptor) ConvertOpenAIResponsesRequest(c context.Context, info *common.RelayInfo, request dto.OpenAIResponsesRequest) (any, error) {
	// Responses API is not supported by this provider
	return nil, errors.New("unsupported capability for this provider")
}

func (a *Adaptor) DoRequest(c context.Context, info *common.RelayInfo, requestBody io.Reader) (*http.Response, error) {
	return channel.DoApiRequest(c, a, info, requestBody)
}

func (a *Adaptor) DoResponse(c context.Context, resp *http.Response, info *common.RelayInfo, w http.ResponseWriter) (usage any, err *types.NewAPIError) {
	if info.RelayMode == constant.RelayModeEmbeddings ||
		info.RelayMode == constant.RelayModeRerank ||
		info.RelayMode == constant.RelayModeAudioSpeech {
		adaptor := openai.Adaptor{}
		return adaptor.DoResponse(c, resp, info, w)
	}
	if info.IsStream {
		usage, err = tencentStreamHandler(c, info, resp, w)
	} else {
		usage, err = tencentHandler(c, info, resp, w)
	}
	return
}

func (a *Adaptor) GetModelList() []string {
	return ModelList
}

func (a *Adaptor) GetChannelName() string {
	return ChannelName
}
