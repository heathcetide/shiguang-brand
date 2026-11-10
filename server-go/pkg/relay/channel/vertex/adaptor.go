package vertex

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
	claude2 "github.com/heathcetide/DietDigiDose/pkg/relay/channel/claude"
	gemini2 "github.com/heathcetide/DietDigiDose/pkg/relay/channel/gemini"
	"github.com/heathcetide/DietDigiDose/pkg/relay/channel/openai"
	common "github.com/heathcetide/DietDigiDose/pkg/relay/common"
	"github.com/heathcetide/DietDigiDose/pkg/relay/relaymode"
	"github.com/heathcetide/DietDigiDose/pkg/relay/relaykit/dto"
	"github.com/heathcetide/DietDigiDose/pkg/relay/setting"
	"github.com/heathcetide/DietDigiDose/pkg/relay/relaykit/relayconvert/reasoning"
	"github.com/heathcetide/DietDigiDose/pkg/relay/relaykit/types"
	"github.com/heathcetide/DietDigiDose/pkg/relay/service"
	"github.com/samber/lo"
)

const (
	RequestModeClaude     = 1
	RequestModeGemini     = 2
	RequestModeOpenSource = 3
)

var claudeModelMap = map[string]string{
	"claude-3-sonnet-20240229":   "claude-3-sonnet@20240229",
	"claude-3-opus-20240229":     "claude-3-opus@20240229",
	"claude-3-haiku-20240307":    "claude-3-haiku@20240307",
	"claude-3-5-sonnet-20240620": "claude-3-5-sonnet@20240620",
	"claude-3-5-sonnet-20241022": "claude-3-5-sonnet-v2@20241022",
	"claude-3-7-sonnet-20250219": "claude-3-7-sonnet@20250219",
	"claude-sonnet-4-20250514":   "claude-sonnet-4@20250514",
	"claude-opus-4-20250514":     "claude-opus-4@20250514",
	"claude-opus-4-1-20250805":   "claude-opus-4-1@20250805",
	"claude-sonnet-4-5-20250929": "claude-sonnet-4-5@20250929",
	"claude-haiku-4-5-20251001":  "claude-haiku-4-5@20251001",
	"claude-opus-4-5-20251101":   "claude-opus-4-5@20251101",
	"claude-opus-4-6":            "claude-opus-4-6",
	"claude-opus-4-7":            "claude-opus-4-7",
	"claude-opus-4-8":            "claude-opus-4-8",
}

const anthropicVersion = "vertex-2023-10-16"

type Adaptor struct {
	RequestMode        int
	AccountCredentials Credentials
}

func (a *Adaptor) ConvertGeminiRequest(c context.Context, info *common.RelayInfo, request *dto.GeminiChatRequest) (any, error) {
	// Vertex AI does not support functionResponse.id; keep it stripped here for consistency.
	if setting.GetGeminiSettings().RemoveFunctionResponseIdEnabled {
		removeFunctionResponseID(request)
	}
	geminiAdaptor := gemini2.Adaptor{}
	return geminiAdaptor.ConvertGeminiRequest(c, info, request)
}

func removeFunctionResponseID(request *dto.GeminiChatRequest) {
	if request == nil {
		return
	}

	if len(request.Contents) > 0 {
		for i := range request.Contents {
			if len(request.Contents[i].Parts) == 0 {
				continue
			}
			for j := range request.Contents[i].Parts {
				part := &request.Contents[i].Parts[j]
				if part.FunctionResponse == nil {
					continue
				}
				if len(part.FunctionResponse.ID) > 0 {
					part.FunctionResponse.ID = nil
				}
			}
		}
	}

	if len(request.Requests) > 0 {
		for i := range request.Requests {
			removeFunctionResponseID(&request.Requests[i])
		}
	}
}

func (a *Adaptor) ConvertClaudeRequest(c context.Context, info *common.RelayInfo, request *dto.ClaudeRequest) (any, error) {
	if _, ok := claudeModelMap[info.UpstreamModelName]; ok {
		// c.Set("request_model", v)
	} else {
		// c.Set("request_model", request.Model)
	}
	vertexClaudeReq := copyRequest(request, anthropicVersion)
	return vertexClaudeReq, nil
}

func (a *Adaptor) ConvertAudioRequest(c context.Context, info *common.RelayInfo, request dto.AudioRequest) (io.Reader, error) {
	data, err := json.Marshal(request)
	if err != nil {
		return nil, err
	}
	return bytes.NewReader(data), nil
}

func (a *Adaptor) ConvertImageRequest(c context.Context, info *common.RelayInfo, request dto.ImageRequest) (any, error) {
	geminiAdaptor := gemini2.Adaptor{}
	return geminiAdaptor.ConvertImageRequest(c, info, request)
}

func (a *Adaptor) Init(info *common.RelayInfo) {
	if strings.HasPrefix(info.UpstreamModelName, "claude") {
		a.RequestMode = RequestModeClaude
	} else if strings.Contains(info.UpstreamModelName, "llama") ||
		// open source models
		strings.Contains(info.UpstreamModelName, "-maas") {
		a.RequestMode = RequestModeOpenSource
	} else {
		a.RequestMode = RequestModeGemini
	}
}

func (a *Adaptor) getRequestUrl(info *common.RelayInfo, modelName, suffix string) (string, error) {
	region := GetModelRegion(info.ApiVersion, info.OriginModelName)
	// Not supported in library mode — ChannelOtherSettings removed.
	// Always use JSON credentials path; API-key mode is not available.
	adc := &Credentials{}
	if err := json.Unmarshal([]byte(info.ApiKey), adc); err != nil {
		return "", fmt.Errorf("failed to decode credentials file: %w", err)
	}
	a.AccountCredentials = *adc

	if a.RequestMode == RequestModeGemini {
		return BuildGoogleModelURL(info.ChannelBaseUrl, DefaultAPIVersion, adc.ProjectID, region, modelName, suffix), nil
	} else if a.RequestMode == RequestModeClaude {
		return BuildAnthropicModelURL(info.ChannelBaseUrl, DefaultAPIVersion, adc.ProjectID, region, modelName, suffix), nil
	} else if a.RequestMode == RequestModeOpenSource {
		return BuildOpenSourceChatCompletionsURL(info.ChannelBaseUrl, adc.ProjectID, region), nil
	}
	return "", errors.New("unsupported request mode")
}

func (a *Adaptor) GetRequestURL(info *common.RelayInfo) (string, error) {
	if info.RelayMode == constant.RelayModeEmbeddings {
		// Vertex AI exposes an OpenAI-compatible embeddings endpoint via the
		// openapi surface. Reuse the same credential/project/region resolution
		// as the chat completions endpoint.
		region := GetModelRegion(info.ApiVersion, info.OriginModelName)
		adc := &Credentials{}
		if err := json.Unmarshal([]byte(info.ApiKey), adc); err != nil {
			return "", fmt.Errorf("failed to decode credentials file: %w", err)
		}
		a.AccountCredentials = *adc
		return BuildOpenSourceEmbeddingsURL(info.ChannelBaseUrl, adc.ProjectID, region), nil
	}
	if info.RelayMode == constant.RelayModeAudioSpeech {
		region := GetModelRegion(info.ApiVersion, info.OriginModelName)
		adc := &Credentials{}
		if err := json.Unmarshal([]byte(info.ApiKey), adc); err != nil {
			return "", fmt.Errorf("failed to decode credentials file: %w", err)
		}
		a.AccountCredentials = *adc
		return BuildOpenSourceAudioSpeechURL(info.ChannelBaseUrl, adc.ProjectID, region), nil
	}
	if info.RelayMode == constant.RelayModeRerank {
		region := GetModelRegion(info.ApiVersion, info.OriginModelName)
		adc := &Credentials{}
		if err := json.Unmarshal([]byte(info.ApiKey), adc); err != nil {
			return "", fmt.Errorf("failed to decode credentials file: %w", err)
		}
		a.AccountCredentials = *adc
		return BuildOpenSourceRerankURL(info.ChannelBaseUrl, adc.ProjectID, region), nil
	}
	suffix := ""
	if a.RequestMode == RequestModeGemini {
		if setting.GetGeminiSettings().ThinkingAdapterEnabled &&
			!setting.ShouldPreserveThinkingSuffix(info.OriginModelName) {
			// 新增逻辑：处理 -thinking-<budget> 格式
			if strings.Contains(info.UpstreamModelName, "-thinking-") {
				parts := strings.Split(info.UpstreamModelName, "-thinking-")
				info.UpstreamModelName = parts[0]
			} else if strings.HasSuffix(info.UpstreamModelName, "-thinking") { // 旧的适配
				info.UpstreamModelName = strings.TrimSuffix(info.UpstreamModelName, "-thinking")
			} else if strings.HasSuffix(info.UpstreamModelName, "-nothinking") {
				info.UpstreamModelName = strings.TrimSuffix(info.UpstreamModelName, "-nothinking")
			} else if baseModel, level, ok := reasoning.TrimEffortSuffix(info.UpstreamModelName); ok && level != "" {
				info.UpstreamModelName = baseModel
			}
		}

		if info.IsStream {
			suffix = "streamGenerateContent?alt=sse"
		} else {
			suffix = "generateContent"
		}

		if strings.HasPrefix(info.UpstreamModelName, "imagen") {
			suffix = "predict"
		}
		return a.getRequestUrl(info, info.UpstreamModelName, suffix)
	} else if a.RequestMode == RequestModeClaude {
		if info.IsStream {
			suffix = "streamRawPredict?alt=sse"
		} else {
			suffix = "rawPredict"
		}
		model := info.UpstreamModelName
		if v, ok := claudeModelMap[info.UpstreamModelName]; ok {
			model = v
		}
		return a.getRequestUrl(info, model, suffix)
	} else if a.RequestMode == RequestModeOpenSource {
		return a.getRequestUrl(info, "", "")
	}
	return "", errors.New("unsupported request mode")
}

func (a *Adaptor) SetupRequestHeader(c context.Context, req *http.Header, info *common.RelayInfo) error {
	channel.SetupApiRequestHeader(info, req)
	// Not supported in library mode — ChannelOtherSettings removed.
	// Always use JSON credentials path; API-key mode is not available.
	accessToken, err := getAccessToken(a, info)
	if err != nil {
		return err
	}
	req.Set("Authorization", "Bearer "+accessToken)
	if a.AccountCredentials.ProjectID != "" {
		req.Set("x-goog-user-project", a.AccountCredentials.ProjectID)
	}
	if strings.Contains(info.UpstreamModelName, "claude") {
		// Not supported in library mode — claude2.CommonClaudeHeadersOperation does not exist
		_ = c
	}
	return nil
}

func (a *Adaptor) ConvertOpenAIRequest(c context.Context, info *common.RelayInfo, request *dto.GeneralOpenAIRequest) (any, error) {
	if request == nil {
		return nil, errors.New("request is nil")
	}
	if a.RequestMode == RequestModeGemini && strings.HasPrefix(info.UpstreamModelName, "imagen") {
		prompt := ""
		for _, m := range request.Messages {
			if m.Role == "user" {
				prompt = m.StringContent()
				if prompt != "" {
					break
				}
			}
		}
		if prompt == "" {
			if p, ok := request.Prompt.(string); ok {
				prompt = p
			}
		}
		if prompt == "" {
			return nil, errors.New("prompt is required for image generation")
		}

		imgReq := dto.ImageRequest{
			Model:  request.Model,
			Prompt: prompt,
			N:      lo.ToPtr(uint(1)),
			Size:   "1024x1024",
		}
		if request.N != nil && *request.N > 0 {
			imgReq.N = lo.ToPtr(uint(*request.N))
		}
		if request.Size != "" {
			imgReq.Size = request.Size
		}
		if len(request.ExtraBody) > 0 {
			var extra map[string]any
			if err := json.Unmarshal(request.ExtraBody, &extra); err == nil {
				if n, ok := extra["n"].(float64); ok && n > 0 {
					imgReq.N = lo.ToPtr(uint(n))
				}
				if size, ok := extra["size"].(string); ok {
					imgReq.Size = size
				}
				// accept aspectRatio in extra body (top-level or under parameters)
				if ar, ok := extra["aspectRatio"].(string); ok && ar != "" {
					imgReq.Size = ar
				}
				if params, ok := extra["parameters"].(map[string]any); ok {
					if ar, ok := params["aspectRatio"].(string); ok && ar != "" {
						imgReq.Size = ar
					}
				}
			}
		}
		// c.Set("request_model", request.Model)
		return a.ConvertImageRequest(c, info, imgReq)
	}
	if a.RequestMode == RequestModeClaude {
		result, err := service.ConvertRequest(c, info, types.RelayFormatClaude, request)
		if err != nil {
			return nil, err
		}
		claudeReq, ok := result.Value.(*dto.ClaudeRequest)
		if !ok {
			return nil, fmt.Errorf("expected Anthropic Messages request, got %T", result.Value)
		}
		vertexClaudeReq := copyRequest(claudeReq, anthropicVersion)
		// c.Set("request_model", claudeReq.Model)
		info.UpstreamModelName = claudeReq.Model
		return vertexClaudeReq, nil
	} else if a.RequestMode == RequestModeGemini {
		result, err := service.ConvertRequest(c, info, types.RelayFormatGemini, request)
		if err != nil {
			return nil, err
		}
		geminiRequest, ok := result.Value.(*dto.GeminiChatRequest)
		if !ok {
			return nil, fmt.Errorf("expected Gemini generateContent request, got %T", result.Value)
		}
		// c.Set("request_model", request.Model)
		return geminiRequest, nil
	} else if a.RequestMode == RequestModeOpenSource {
		return request, nil
	}
	return nil, errors.New("unsupported request mode")
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
		openaiAdaptor := openai.Adaptor{}
		return openaiAdaptor.DoResponse(c, resp, info, w)
	}
	if info.IsStream {
		switch a.RequestMode {
		case RequestModeClaude:
			claudeAdaptor := claude2.Adaptor{}
			return claudeAdaptor.DoResponse(c, resp, info, w)
		case RequestModeGemini:
			geminiAdaptor := gemini2.Adaptor{}
			return geminiAdaptor.DoResponse(c, resp, info, w)
		case RequestModeOpenSource:
			openaiAdaptor := openai.Adaptor{}
			return openaiAdaptor.DoResponse(c, resp, info, w)
		}
	} else {
		switch a.RequestMode {
		case RequestModeClaude:
			claudeAdaptor := claude2.Adaptor{}
			return claudeAdaptor.DoResponse(c, resp, info, w)
		case RequestModeGemini:
			geminiAdaptor := gemini2.Adaptor{}
			return geminiAdaptor.DoResponse(c, resp, info, w)
		case RequestModeOpenSource:
			openaiAdaptor := openai.Adaptor{}
			return openaiAdaptor.DoResponse(c, resp, info, w)
		}
	}
	return
}

func (a *Adaptor) GetModelList() []string {
	var modelList []string
	for i, s := range ModelList {
		modelList = append(modelList, s)
		ModelList[i] = s
	}
	for i, s := range claude2.ModelList {
		modelList = append(modelList, s)
		claude2.ModelList[i] = s
	}
	for i, s := range gemini2.ModelList {
		modelList = append(modelList, s)
		gemini2.ModelList[i] = s
	}
	return modelList
}

func (a *Adaptor) GetChannelName() string {
	return ChannelName
}
