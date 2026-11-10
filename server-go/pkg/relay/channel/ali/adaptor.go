package ali

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"

	"github.com/heathcetide/DietDigiDose/pkg/relay/channel"
	"github.com/heathcetide/DietDigiDose/pkg/relay/channel/claude"
	"github.com/heathcetide/DietDigiDose/pkg/relay/channel/openai"
	common "github.com/heathcetide/DietDigiDose/pkg/relay/common"
	"github.com/heathcetide/DietDigiDose/pkg/relay/relaymode"
	"github.com/heathcetide/DietDigiDose/pkg/relay/relaykit/dto"
	"github.com/heathcetide/DietDigiDose/pkg/relay/relaykit/types"
	"github.com/heathcetide/DietDigiDose/pkg/relay/setting"
	"github.com/heathcetide/DietDigiDose/pkg/relay/service"
	"github.com/samber/lo"
)

type Adaptor struct {
	IsSyncImageModel bool
}

const aliAnthropicMessagesModelsEnv = "ALI_ANTHROPIC_MESSAGES_MODELS"
const defaultAliAnthropicMessagesModels = "qwen,deepseek-v4,kimi,glm,minimax-m"

/*
	var syncModels = []string{
		"z-image",
		"qwen-image",
		"wan2.6",
	}
*/
func supportsAliAnthropicMessages(modelName string) bool {
	normalizedModelName := strings.ToLower(strings.TrimSpace(modelName))
	if normalizedModelName == "" {
		return false
	}

	return lo.SomeBy(aliAnthropicMessagesModelPatterns(), func(pattern string) bool {
		return strings.Contains(normalizedModelName, pattern)
	})
}

func aliAnthropicMessagesModelPatterns() []string {
	configuredModels := os.Getenv(aliAnthropicMessagesModelsEnv)
	if configuredModels == "" {
		configuredModels = defaultAliAnthropicMessagesModels
	}
	return lo.FilterMap(strings.Split(configuredModels, ","), func(item string, _ int) (string, bool) {
		pattern := strings.ToLower(strings.TrimSpace(item))
		return pattern, pattern != ""
	})
}

var syncModels = []string{
	"z-image",
	"qwen-image",
	"wan2.6",
}

func isSyncImageModel(modelName string) bool {
	return setting.IsSyncImageModel(modelName)
}

func (a *Adaptor) ConvertGeminiRequest(context.Context, *common.RelayInfo, *dto.GeminiChatRequest) (any, error) {
	return nil, errors.New("unsupported capability for this provider")
}

func (a *Adaptor) ConvertClaudeRequest(c context.Context, info *common.RelayInfo, req *dto.ClaudeRequest) (any, error) {
	if supportsAliAnthropicMessages(info.UpstreamModelName) {
		return req, nil
	}

	result, err := service.ConvertRequest(c, info, types.RelayFormatOpenAI, req)
	if err != nil {
		return nil, err
	}
	oaiReq, ok := result.Value.(*dto.GeneralOpenAIRequest)
	if !ok {
		return nil, fmt.Errorf("expected OpenAI chat completions request, got %T", result.Value)
	}
	if info.SupportStreamOptions && info.IsStream {
		oaiReq.StreamOptions = &dto.StreamOptions{IncludeUsage: true}
	}
	return a.ConvertOpenAIRequest(c, info, oaiReq)
}

func (a *Adaptor) Init(info *common.RelayInfo) {
}

func (a *Adaptor) GetRequestURL(info *common.RelayInfo) (string, error) {
	var fullRequestURL string
	switch info.RelayFormat {
	case types.RelayFormatClaude:
		if supportsAliAnthropicMessages(info.UpstreamModelName) {
			fullRequestURL = fmt.Sprintf("%s/apps/anthropic/v1/messages", info.ChannelBaseUrl)
		} else {
			fullRequestURL = fmt.Sprintf("%s/compatible-mode/v1/chat/completions", info.ChannelBaseUrl)
		}
	default:
		switch info.RelayMode {
		case constant.RelayModeRealtime:
			return buildAliRealtimeURL(info.ChannelBaseUrl, info.UpstreamModelName)
		case constant.RelayModeEmbeddings:
			fullRequestURL = fmt.Sprintf("%s/compatible-mode/v1/embeddings", info.ChannelBaseUrl)
		case constant.RelayModeAudioSpeech:
			fullRequestURL = fmt.Sprintf("%s/compatible-mode/v1/audio/speech", info.ChannelBaseUrl)
		case constant.RelayModeRerank:
			fullRequestURL = fmt.Sprintf("%s/api/v1/services/rerank/text-rerank/text-rerank", info.ChannelBaseUrl)
		case constant.RelayModeResponses:
			fullRequestURL = fmt.Sprintf("%s/api/v2/apps/protocols/compatible-mode/v1/responses", info.ChannelBaseUrl)
		case constant.RelayModeImagesGenerations:
			if isSyncImageModel(info.OriginModelName) {
				fullRequestURL = fmt.Sprintf("%s/api/v1/services/aigc/multimodal-generation/generation", info.ChannelBaseUrl)
			} else {
				fullRequestURL = fmt.Sprintf("%s/api/v1/services/aigc/text2image/image-synthesis", info.ChannelBaseUrl)
			}
		case constant.RelayModeImagesEdits:
			if isOldWanModel(info.OriginModelName) {
				fullRequestURL = fmt.Sprintf("%s/api/v1/services/aigc/image2image/image-synthesis", info.ChannelBaseUrl)
			} else if isWanModel(info.OriginModelName) {
				fullRequestURL = fmt.Sprintf("%s/api/v1/services/aigc/image-generation/generation", info.ChannelBaseUrl)
			} else {
				fullRequestURL = fmt.Sprintf("%s/api/v1/services/aigc/multimodal-generation/generation", info.ChannelBaseUrl)
			}
		case constant.RelayModeCompletions:
			fullRequestURL = fmt.Sprintf("%s/compatible-mode/v1/completions", info.ChannelBaseUrl)
		default:
			fullRequestURL = fmt.Sprintf("%s/compatible-mode/v1/chat/completions", info.ChannelBaseUrl)
		}
	}

	return fullRequestURL, nil
}

// buildAliRealtimeURL maps an Ali/DashScope HTTP base URL onto the Omni
// realtime WebSocket endpoint:
//
//	wss://dashscope.aliyuncs.com/api-ws/v1/realtime?model=<model>
func buildAliRealtimeURL(baseURL, model string) (string, error) {
	base := strings.TrimSpace(baseURL)
	if base == "" {
		base = "https://dashscope.aliyuncs.com"
	}
	u, err := url.Parse(base)
	if err != nil {
		return "", fmt.Errorf("parse ali realtime base url: %w", err)
	}
	switch strings.ToLower(u.Scheme) {
	case "https", "":
		u.Scheme = "wss"
	case "http":
		u.Scheme = "ws"
	case "wss", "ws":
		// keep
	default:
		return "", fmt.Errorf("unsupported ali realtime base scheme %q", u.Scheme)
	}
	if u.Host == "" {
		return "", errors.New("ali realtime base url missing host")
	}
	if !strings.Contains(u.Path, "/api-ws/") {
		u.Path = "/api-ws/v1/realtime"
		u.RawPath = ""
	}
	q := u.Query()
	if strings.TrimSpace(model) != "" {
		q.Set("model", model)
	}
	u.RawQuery = q.Encode()
	return u.String(), nil
}

func (a *Adaptor) SetupRequestHeader(c context.Context, req *http.Header, info *common.RelayInfo) error {
	channel.SetupApiRequestHeader(info, req)
	apiKey := strings.TrimSpace(info.ApiKey)
	apiKey = strings.TrimPrefix(apiKey, "Bearer ")
	apiKey = strings.TrimPrefix(apiKey, "bearer ")
	req.Set("Authorization", "Bearer "+apiKey)
	if info.RelayMode == constant.RelayModeRealtime {
		// Match DashScope Omni / Qwen-TTS realtime handshake (Authorization only).
		// Do not forward browser Sec-WebSocket-Protocol (lingrein.dashboard.*).
		req.Del("Content-Type")
		req.Del("Accept")
		req.Del("Sec-WebSocket-Protocol")
		return nil
	}
	if info.IsStream {
		req.Set("X-DashScope-SSE", "enable")
	}
	if "" != "" {
		req.Set("X-DashScope-Plugin", "")
	}
	if info.RelayMode == constant.RelayModeImagesGenerations {
		if isSyncImageModel(info.OriginModelName) {

		} else {
			req.Set("X-DashScope-Async", "enable")
		}
	}
	if info.RelayMode == constant.RelayModeImagesEdits {
		if isWanModel(info.OriginModelName) {
			req.Set("X-DashScope-Async", "enable")
		}
		req.Set("Content-Type", "application/json")
	}
	return nil
}

func (a *Adaptor) ConvertOpenAIRequest(c context.Context, info *common.RelayInfo, request *dto.GeneralOpenAIRequest) (any, error) {
	if request == nil {
		return nil, errors.New("request is nil")
	}
	// docs: https://bailian.console.aliyun.com/?tab=api#/api/?type=model&url=2712216
	// fix: InternalError.Algo.InvalidParameter: The value of the enable_thinking parameter is restricted to True.
	//if strings.Contains(request.Model, "thinking") {
	//	request.EnableThinking = true
	//	request.Stream = true
	//	info.IsStream = true
	//}
	//// fix: ali parameter.enable_thinking must be set to false for non-streaming calls
	//if !info.IsStream {
	//	request.EnableThinking = false
	//}

	switch info.RelayMode {
	default:
		aliReq := requestOpenAI2Ali(*request, info.UpstreamModelName)
		return aliReq, nil
	}
}

func (a *Adaptor) ConvertImageRequest(c context.Context, info *common.RelayInfo, request dto.ImageRequest) (any, error) {
	if info.RelayMode == constant.RelayModeImagesGenerations {
		if isSyncImageModel(info.OriginModelName) {
			a.IsSyncImageModel = true
		}
		aliRequest, err := oaiImage2AliImageRequest(info, request, a.IsSyncImageModel)
		if err != nil {
			return nil, fmt.Errorf("convert image request to async ali image request failed: %w", err)
		}
		return aliRequest, nil
	} else if info.RelayMode == constant.RelayModeImagesEdits {
		if isOldWanModel(info.OriginModelName) {
			return oaiFormEdit2WanxImageEdit(c, info, request)
		}
		if isSyncImageModel(info.OriginModelName) {
			if isWanModel(info.OriginModelName) {
				a.IsSyncImageModel = false
			} else {
				a.IsSyncImageModel = true
			}
		}
		// ali image edit https://bailian.console.aliyun.com/?tab=api#/api/?type=model&url=2976416
		// 如果用户使用表单，则需要解析表单数据
		if strings.Contains(info.RequestHeaders["Content-Type"], "multipart/form-data") {
			aliRequest, err := oaiFormEdit2AliImageEdit(c, info, request)
			if err != nil {
				return nil, fmt.Errorf("convert image edit form request failed: %w", err)
			}
			return aliRequest, nil
		} else {
			aliRequest, err := oaiImage2AliImageRequest(info, request, a.IsSyncImageModel)
			if err != nil {
				return nil, fmt.Errorf("convert image request to async ali image request failed: %w", err)
			}
			return aliRequest, nil
		}
	}
	return nil, fmt.Errorf("unsupported image relay mode: %d", info.RelayMode)
}

func (a *Adaptor) ConvertRerankRequest(c context.Context, relayMode int, request dto.RerankRequest) (any, error) {
	return ConvertRerankRequest(request), nil
}

func (a *Adaptor) ConvertEmbeddingRequest(c context.Context, info *common.RelayInfo, request dto.EmbeddingRequest) (any, error) {
	return request, nil
}

func (a *Adaptor) ConvertAudioRequest(c context.Context, info *common.RelayInfo, request dto.AudioRequest) (io.Reader, error) {
	data, err := json.Marshal(request)
	if err != nil {
		return nil, err
	}
	return bytes.NewReader(data), nil
}

func (a *Adaptor) ConvertOpenAIResponsesRequest(c context.Context, info *common.RelayInfo, request dto.OpenAIResponsesRequest) (any, error) {
	return request, nil
}

func (a *Adaptor) DoRequest(c context.Context, info *common.RelayInfo, requestBody io.Reader) (*http.Response, error) {
	if info.RelayMode == constant.RelayModeRealtime {
		// Not supported in library mode
		// return channel.DoWssRequest(a, c, info, requestBody)
		return nil, errors.New("realtime mode not supported in library mode")
	}
	return channel.DoApiRequest(c, a, info, requestBody)
}

func (a *Adaptor) DoResponse(c context.Context, resp *http.Response, info *common.RelayInfo, w http.ResponseWriter) (usage any, err *types.NewAPIError) {
	if info.RelayMode == constant.RelayModeRealtime {
		// Not supported in library mode
		// err, usage = openai.OpenaiRealtimeHandler(c, info)
		return nil, types.NewError(errors.New("realtime mode not supported in library mode"), types.ErrorCodeInvalidRequest)
	}
	switch info.RelayFormat {
	case types.RelayFormatClaude:
		if supportsAliAnthropicMessages(info.UpstreamModelName) {
			adaptor := claude.Adaptor{}
			return adaptor.DoResponse(c, resp, info, w)
		}

		adaptor := openai.Adaptor{}
		return adaptor.DoResponse(c, resp, info, w)
	default:
		switch info.RelayMode {
		case constant.RelayModeImagesGenerations:
			err, usage = aliImageHandler(a, c, resp, info, w)
		case constant.RelayModeImagesEdits:
			err, usage = aliImageHandler(a, c, resp, info, w)
		case constant.RelayModeRerank:
			err, usage = RerankHandler(c, resp, info, w)
		case constant.RelayModeAudioSpeech:
			adaptor := openai.Adaptor{}
			usage, err = adaptor.DoResponse(c, resp, info, w)
		default:
			adaptor := openai.Adaptor{}
			usage, err = adaptor.DoResponse(c, resp, info, w)
		}
		return usage, err
	}
}

func (a *Adaptor) GetModelList() []string {
	return ModelList
}

func (a *Adaptor) GetChannelName() string {
	return ChannelName
}
