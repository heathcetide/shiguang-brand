package baidu

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/heathcetide/DietDigiDose/pkg/relay/channel"
	"github.com/heathcetide/DietDigiDose/pkg/relay/channel/openai"
	common "github.com/heathcetide/DietDigiDose/pkg/relay/common"
	"github.com/heathcetide/DietDigiDose/pkg/relay/relaymode"
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

}

func (a *Adaptor) GetRequestURL(info *common.RelayInfo) (string, error) {
	// https://cloud.baidu.com/doc/WENXINWORKSHOP/s/clntwmv7t
	if info.RelayMode == constant.RelayModeAudioSpeech {
		fullRequestURL := fmt.Sprintf("%s/rpc/2.0/ai_custom/v1/wenxinworkshop/audio/speech", info.ChannelBaseUrl)
		var accessToken string
		var err error
		if accessToken, err = getBaiduAccessToken(info.ApiKey); err != nil {
			return "", err
		}
		fullRequestURL += "?access_token=" + accessToken
		return fullRequestURL, nil
	}
	suffix := "chat/"
	if strings.HasPrefix(info.UpstreamModelName, "Embedding") {
		suffix = "embeddings/"
	}
	if strings.HasPrefix(info.UpstreamModelName, "bge-large") {
		suffix = "embeddings/"
	}
	if strings.HasPrefix(info.UpstreamModelName, "tao-8k") {
		suffix = "embeddings/"
	}
	switch info.UpstreamModelName {
	case "ERNIE-4.0":
		suffix += "completions_pro"
	case "ERNIE-Bot-4":
		suffix += "completions_pro"
	case "ERNIE-Bot":
		suffix += "completions"
	case "ERNIE-Bot-turbo":
		suffix += "eb-instant"
	case "ERNIE-Speed":
		suffix += "ernie_speed"
	case "ERNIE-4.0-8K":
		suffix += "completions_pro"
	case "ERNIE-3.5-8K":
		suffix += "completions"
	case "ERNIE-3.5-8K-0205":
		suffix += "ernie-3.5-8k-0205"
	case "ERNIE-3.5-8K-1222":
		suffix += "ernie-3.5-8k-1222"
	case "ERNIE-Bot-8K":
		suffix += "ernie_bot_8k"
	case "ERNIE-3.5-4K-0205":
		suffix += "ernie-3.5-4k-0205"
	case "ERNIE-Speed-8K":
		suffix += "ernie_speed"
	case "ERNIE-Speed-128K":
		suffix += "ernie-speed-128k"
	case "ERNIE-Lite-8K-0922":
		suffix += "eb-instant"
	case "ERNIE-Lite-8K-0308":
		suffix += "ernie-lite-8k"
	case "ERNIE-Tiny-8K":
		suffix += "ernie-tiny-8k"
	case "BLOOMZ-7B":
		suffix += "bloomz_7b1"
	case "Embedding-V1":
		suffix += "embedding-v1"
	case "bge-large-zh":
		suffix += "bge_large_zh"
	case "bge-large-en":
		suffix += "bge_large_en"
	case "tao-8k":
		suffix += "tao_8k"
	default:
		suffix += strings.ToLower(info.UpstreamModelName)
	}
	fullRequestURL := fmt.Sprintf("%s/rpc/2.0/ai_custom/v1/wenxinworkshop/%s", info.ChannelBaseUrl, suffix)
	var accessToken string
	var err error
	if accessToken, err = getBaiduAccessToken(info.ApiKey); err != nil {
		return "", err
	}
	fullRequestURL += "?access_token=" + accessToken
	return fullRequestURL, nil
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
	switch info.RelayMode {
	default:
		baiduRequest := requestOpenAI2Baidu(*request)
		return baiduRequest, nil
	}
}

func (a *Adaptor) ConvertRerankRequest(c context.Context, relayMode int, request dto.RerankRequest) (any, error) {
	return request, nil
}

func (a *Adaptor) ConvertEmbeddingRequest(c context.Context, info *common.RelayInfo, request dto.EmbeddingRequest) (any, error) {
	// Baidu embedding uses passthrough; the request body is converted
	// to Baidu format by embeddingRequestOpenAI2Baidu at the handler level.
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
	if info.RelayMode == constant.RelayModeRerank || info.RelayMode == constant.RelayModeAudioSpeech {
		adaptor := openai.Adaptor{}
		return adaptor.DoResponse(c, resp, info, w)
	}
	if info.IsStream {
		err, usage = baiduStreamHandler(c, info, resp, w)
	} else {
		switch info.RelayMode {
		case constant.RelayModeEmbeddings:
			err, usage = baiduEmbeddingHandler(c, info, resp, w)
		default:
			err, usage = baiduHandler(c, info, resp, w)
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
