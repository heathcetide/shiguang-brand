package advancedcustom

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"

	"github.com/heathcetide/DietDigiDose/pkg/relay/constant"
	"github.com/heathcetide/DietDigiDose/pkg/relay/channel"
	claude2 "github.com/heathcetide/DietDigiDose/pkg/relay/channel/claude"
	gemini2 "github.com/heathcetide/DietDigiDose/pkg/relay/channel/gemini"
	openai2 "github.com/heathcetide/DietDigiDose/pkg/relay/channel/openai"
	common "github.com/heathcetide/DietDigiDose/pkg/relay/common"
	relayconstant "github.com/heathcetide/DietDigiDose/pkg/relay/relaymode"
	"github.com/heathcetide/DietDigiDose/pkg/relay/relaykit/dto"
	"github.com/heathcetide/DietDigiDose/pkg/relay/relaykit/relayconvert"
	"github.com/heathcetide/DietDigiDose/pkg/relay/relaykit/types"
	"github.com/heathcetide/DietDigiDose/pkg/relay/service"
	"github.com/samber/lo"
)

const ChannelName = "advanced_custom"

const advancedCustomModelPlaceholder = "{model}"

type Adaptor struct {
	openaiAdaptor openai2.Adaptor
	claudeAdaptor claude2.Adaptor
	geminiAdaptor gemini2.Adaptor

	resolved  bool
	converted bool
	route     dto.AdvancedCustomRoute
	converter string
}

func (a *Adaptor) Init(info *common.RelayInfo) {
	a.openaiAdaptor.Init(info)
	a.claudeAdaptor.Init(info)
	a.geminiAdaptor.Init(info)
}

func (a *Adaptor) ConvertOpenAIRequest(c context.Context, info *common.RelayInfo, request *dto.GeneralOpenAIRequest) (any, error) {
	converter, err := a.resolveForConversion(c, info)
	if err != nil {
		return nil, err
	}
	if converter == relayconvert.ConverterNone {
		return a.convertOpenAICompatibleRequest(c, info, request)
	}

	switch converter {
	case relayconvert.ConverterOpenAIChatToClaudeMessages,
		relayconvert.ConverterOpenAIChatToOpenAIResponses,
		relayconvert.ConverterOpenAIChatToGeminiContent:
		result, err := service.ConvertRequestByID(c, info, converter, request)
		if err != nil {
			return nil, err
		}
		return result.Value, nil
	default:
		return nil, fmt.Errorf("converter %q does not support OpenAI chat completions requests", converter)
	}
}

func (a *Adaptor) ConvertClaudeRequest(c context.Context, info *common.RelayInfo, request *dto.ClaudeRequest) (any, error) {
	converter, err := a.resolveForConversion(c, info)
	if err != nil {
		return nil, err
	}

	switch converter {
	case relayconvert.ConverterNone:
		return a.claudeAdaptor.ConvertClaudeRequest(c, info, request)
	case relayconvert.ConverterClaudeMessagesToOpenAIChat:
		result, err := service.ConvertRequestByID(c, info, converter, request)
		if err != nil {
			return nil, err
		}
		chatRequest, ok := result.Value.(*dto.GeneralOpenAIRequest)
		if !ok {
			return nil, fmt.Errorf("expected OpenAI chat completions request, got %T", result.Value)
		}
		return a.convertOpenAICompatibleRequest(c, info, chatRequest)
	default:
		return nil, fmt.Errorf("converter %q does not support Anthropic Messages requests", converter)
	}
}

func (a *Adaptor) ConvertGeminiRequest(c context.Context, info *common.RelayInfo, request *dto.GeminiChatRequest) (any, error) {
	converter, err := a.resolveForConversion(c, info)
	if err != nil {
		return nil, err
	}

	switch converter {
	case relayconvert.ConverterNone:
		return a.geminiAdaptor.ConvertGeminiRequest(c, info, request)
	case relayconvert.ConverterGeminiContentToOpenAIChat:
		result, err := service.ConvertRequestByID(c, info, converter, request)
		if err != nil {
			return nil, err
		}
		chatRequest, ok := result.Value.(*dto.GeneralOpenAIRequest)
		if !ok {
			return nil, fmt.Errorf("expected OpenAI chat completions request, got %T", result.Value)
		}
		return a.convertOpenAICompatibleRequest(c, info, chatRequest)
	default:
		return nil, fmt.Errorf("converter %q does not support Gemini generateContent requests", converter)
	}
}

func (a *Adaptor) ConvertOpenAIResponsesRequest(c context.Context, info *common.RelayInfo, request dto.OpenAIResponsesRequest) (any, error) {
	converter, err := a.resolveForConversion(c, info)
	if err != nil {
		return nil, err
	}
	switch converter {
	case relayconvert.ConverterNone:
		return a.convertOpenAICompatibleResponsesRequest(c, info, request)
	case relayconvert.ConverterOpenAIResponsesToOpenAIChat:
		result, err := service.ConvertRequestByID(c, info, converter, request)
		if err != nil {
			return nil, err
		}
		chatRequest, ok := result.Value.(*dto.GeneralOpenAIRequest)
		if !ok {
			return nil, fmt.Errorf("expected OpenAI chat completions request, got %T", result.Value)
		}
		return a.convertOpenAICompatibleRequest(c, info, chatRequest)
	case relayconvert.ConverterOpenAIResponsesToGemini:
		result, err := service.ConvertRequestByID(c, info, converter, request)
		if err != nil {
			return nil, err
		}
		geminiRequest, ok := result.Value.(*dto.GeminiChatRequest)
		if !ok {
			return nil, fmt.Errorf("expected Gemini generateContent request, got %T", result.Value)
		}
		return geminiRequest, nil
	default:
		return nil, fmt.Errorf("converter %q does not support OpenAI Responses requests", converter)
	}
}

func (a *Adaptor) ConvertEmbeddingRequest(c context.Context, info *common.RelayInfo, request dto.EmbeddingRequest) (any, error) {
	converter, err := a.resolveForConversion(c, info)
	if err != nil {
		return nil, err
	}
	if converter != relayconvert.ConverterNone {
		return nil, fmt.Errorf("converter %q does not support embedding requests", converter)
	}
	return a.convertOpenAICompatibleEmbeddingRequest(c, info, request)
}

func (a *Adaptor) ConvertAudioRequest(c context.Context, info *common.RelayInfo, request dto.AudioRequest) (io.Reader, error) {
	converter, err := a.resolveForConversion(c, info)
	if err != nil {
		return nil, err
	}
	if converter != relayconvert.ConverterNone {
		return nil, fmt.Errorf("converter %q does not support audio requests", converter)
	}
	return a.convertOpenAICompatibleAudioRequest(c, info, request)
}

func (a *Adaptor) ConvertImageRequest(c context.Context, info *common.RelayInfo, request dto.ImageRequest) (any, error) {
	converter, err := a.resolveForConversion(c, info)
	if err != nil {
		return nil, err
	}
	if converter != relayconvert.ConverterNone {
		return nil, fmt.Errorf("converter %q does not support image requests", converter)
	}
	return a.convertOpenAICompatibleImageRequest(c, info, request)
}

func (a *Adaptor) ConvertRerankRequest(c context.Context, relayMode int, request dto.RerankRequest) (any, error) {
	a.converted = true
	return a.openaiAdaptor.ConvertRerankRequest(c, relayMode, request)
}

func (a *Adaptor) GetRequestURL(info *common.RelayInfo) (string, error) {
	if err := a.resolve(nil, info); err != nil {
		return "", err
	}
	return a.routeURL(info)
}

func (a *Adaptor) BuildModelListRequest(info *common.RelayInfo) (string, http.Header, error) {
	if info == nil {
		return "", nil, errors.New("missing relay info")
	}
	// Not supported in library mode — ChannelOtherSettings not available
	// config := info.ChannelOtherSettings.AdvancedCustom
	// if config == nil {
	// 	return "", nil, errors.New("advanced_custom is required")
	// }
	// if err := config.Validate(); err != nil {
	// 	return "", nil, err
	// }
	// route, ok := config.ModelListRoute()
	// if !ok {
	// 	return "", nil, errors.New("advanced custom channel does not configure a /v1/models route")
	// }
	// converter := strings.TrimSpace(route.Converter)
	// if converter == "" {
	// 	converter = relayconvert.ConverterNone
	// }
	// if converter != relayconvert.ConverterNone {
	// 	return "", nil, fmt.Errorf("converter %q does not support model list requests", converter)
	// }
	//
	// requestURL, err := buildRouteURL(route, converter, info)
	// if err != nil {
	// 	return "", nil, err
	// }
	//
	// header := http.Header{}
	// auth := route.Auth
	// if auth == nil {
	// 	header.Set("Authorization", "Bearer "+info.ApiKey)
	// 	return requestURL, header, nil
	// }
	//
	// switch strings.TrimSpace(auth.Type) {
	// case dto.AdvancedCustomAuthTypeNone, dto.AdvancedCustomAuthTypeQuery:
	// case dto.AdvancedCustomAuthTypeHeader:
	// 	header.Set(strings.TrimSpace(auth.Name), applyAuthTemplate(auth.Value, info.ApiKey))
	// default:
	// 	return "", nil, fmt.Errorf("invalid advanced custom auth type: %s", auth.Type)
	// }
	// return requestURL, header, nil
	return "", nil, errors.New("BuildModelListRequest not supported in library mode")
}

func (a *Adaptor) SetupRequestHeader(c context.Context, header *http.Header, info *common.RelayInfo) error {
	if err := a.resolve(c, info); err != nil {
		return err
	}

	channel.SetupApiRequestHeader(info, header)
	auth := a.route.Auth
	if auth == nil {
		header.Set("Authorization", "Bearer "+info.ApiKey)
	} else {
		switch strings.TrimSpace(auth.Type) {
		case dto.AdvancedCustomAuthTypeNone:
		case dto.AdvancedCustomAuthTypeHeader:
			header.Set(strings.TrimSpace(auth.Name), applyAuthTemplate(auth.Value, info.ApiKey))
		case dto.AdvancedCustomAuthTypeQuery:
		default:
			return fmt.Errorf("invalid advanced custom auth type: %s", auth.Type)
		}
	}

	if shouldApplyClaudeHeaders(a.converter, info) {
		applyClaudeHeaders(c, header, info)
	}

	return nil
}

func (a *Adaptor) DoRequest(c context.Context, info *common.RelayInfo, requestBody io.Reader) (*http.Response, error) {
	if err := a.resolve(c, info); err != nil {
		return nil, err
	}
	if !a.converted && a.converter != relayconvert.ConverterNone {
		return nil, errors.New("advanced custom converter routes cannot be used with pass-through request body")
	}

	if info.RelayMode == relayconstant.RelayModeAudioTranscription ||
		info.RelayMode == relayconstant.RelayModeAudioTranslation ||
		(info.RelayMode == relayconstant.RelayModeImagesEdits && !isJSONRequest(c)) {
		return channel.DoFormRequest(c, a, info, requestBody)
	}
	if info.RelayMode == relayconstant.RelayModeRealtime {
		// Not supported in library mode
		// return channel.DoWssRequest(a, c, info, requestBody)
		return nil, errors.New("realtime mode not supported in library mode")
	}
	return channel.DoApiRequest(c, a, info, requestBody)
}

func (a *Adaptor) DoResponse(c context.Context, resp *http.Response, info *common.RelayInfo, w http.ResponseWriter) (usage any, err *types.NewAPIError) {
	if err := a.resolve(c, info); err != nil {
		return nil, types.NewOpenAIError(err, types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
	}

	switch a.converter {
	case relayconvert.ConverterNone:
		return a.doNativeResponse(c, resp, info, w)
	case relayconvert.ConverterClaudeMessagesToOpenAIChat,
		relayconvert.ConverterGeminiContentToOpenAIChat:
		return a.openaiAdaptor.DoResponse(c, resp, info, w)
	case relayconvert.ConverterOpenAIChatToClaudeMessages:
		return a.claudeAdaptor.DoResponse(c, resp, info, w)
	case relayconvert.ConverterOpenAIChatToGeminiContent:
		return a.geminiAdaptor.DoResponse(c, resp, info, w)
	case relayconvert.ConverterOpenAIResponsesToGemini:
		return a.geminiAdaptor.DoResponse(c, resp, info, w)
	case relayconvert.ConverterOpenAIChatToOpenAIResponses:
		// Not supported in library mode
		// if info.IsStream {
		// 	return openai2.OaiResponsesToChatStreamHandler(c, info, resp)
		// }
		// return openai2.OaiResponsesToChatHandler(c, info, resp)
		return nil, types.NewOpenAIError(fmt.Errorf("OpenAIChatToOpenAIResponses converter not supported in library mode"), types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
	case relayconvert.ConverterOpenAIResponsesToOpenAIChat:
		// Not supported in library mode
		// if info.IsStream {
		// 	return openai2.OaiChatToResponsesStreamHandler(c, info, resp)
		// }
		// return openai2.OaiChatToResponsesHandler(c, info, resp)
		return nil, types.NewOpenAIError(fmt.Errorf("OpenAIResponsesToOpenAIChat converter not supported in library mode"), types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
	default:
		return nil, types.NewOpenAIError(fmt.Errorf("unsupported advanced custom converter: %s", a.converter), types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
	}
}

func (a *Adaptor) GetModelList() []string {
	models := make([]string, 0, len(openai2.ModelList)+len(claude2.ModelList)+len(gemini2.ModelList))
	models = append(models, openai2.ModelList...)
	models = append(models, claude2.ModelList...)
	models = append(models, gemini2.ModelList...)
	return lo.Uniq(models)
}

func (a *Adaptor) GetChannelName() string {
	return ChannelName
}

func (a *Adaptor) doNativeResponse(c context.Context, resp *http.Response, info *common.RelayInfo, w http.ResponseWriter) (any, *types.NewAPIError) {
	switch info.RelayFormat {
	case types.RelayFormatClaude:
		return a.claudeAdaptor.DoResponse(c, resp, info, w)
	case types.RelayFormatGemini:
		return a.geminiAdaptor.DoResponse(c, resp, info, w)
	default:
		return a.openaiAdaptor.DoResponse(c, resp, info, w)
	}
}

func (a *Adaptor) resolveForConversion(c context.Context, info *common.RelayInfo) (string, error) {
	if err := a.resolve(c, info); err != nil {
		return "", err
	}
	a.converted = true
	return a.converter, nil
}

func (a *Adaptor) resolve(c context.Context, info *common.RelayInfo) error {
	if a.resolved {
		return nil
	}
	if info == nil {
		return errors.New("missing relay info")
	}
	// Not supported in library mode — ChannelOtherSettings not available
	// config := info.ChannelOtherSettings.AdvancedCustom
	// if config == nil {
	// 	return errors.New("advanced_custom is required")
	// }
	// if err := config.Validate(); err != nil {
	// 	return err
	// }
	//
	// incomingPath := incomingRequestPath(c, info)
	// route, ok := config.MatchPathForModel(incomingPath, info.OriginModelName)
	// if ok {
	// 	route.Converter = strings.TrimSpace(route.Converter)
	// 	if route.Converter == "" {
	// 		route.Converter = relayconvert.ConverterNone
	// 	}
	// 	a.route = route
	// 	a.converter = route.Converter
	// 	a.resolved = true
	// 	return nil
	// }
	// return fmt.Errorf("advanced custom channel does not support request path %s for model %s", incomingPath, info.OriginModelName)
	a.resolved = true
	a.converter = relayconvert.ConverterNone
	return nil
}

func incomingRequestPath(c context.Context, info *common.RelayInfo) string {
	if info == nil {
		return ""
	}
	return strings.Split(info.RequestURLPath, "?")[0]
}

func (a *Adaptor) routeURL(info *common.RelayInfo) (string, error) {
	return buildRouteURL(a.route, a.converter, info)
}

func buildRouteURL(route dto.AdvancedCustomRoute, converter string, info *common.RelayInfo) (string, error) {
	parsedURL, err := resolveUpstreamTargetURL(applyUpstreamPathTemplate(strings.TrimSpace(route.UpstreamPath), info), info)
	if err != nil {
		return "", err
	}
	if shouldUseGeminiStreamURL(converter, info) {
		useGeminiStreamGenerateContentURL(parsedURL)
	}
	if info != nil && info.RelayMode == relayconstant.RelayModeRealtime {
		switch parsedURL.Scheme {
		case "https":
			parsedURL.Scheme = "wss"
		case "http":
			parsedURL.Scheme = "ws"
		}
	}
	if route.Auth != nil && strings.TrimSpace(route.Auth.Type) == dto.AdvancedCustomAuthTypeQuery {
		query := parsedURL.Query()
		query.Set(strings.TrimSpace(route.Auth.Name), applyAuthTemplate(route.Auth.Value, info.ApiKey))
		parsedURL.RawQuery = query.Encode()
	}
	return parsedURL.String(), nil
}

func resolveUpstreamTargetURL(upstreamPath string, info *common.RelayInfo) (*url.URL, error) {
	if strings.HasPrefix(upstreamPath, "/") {
		if strings.HasPrefix(upstreamPath, "//") {
			return nil, errors.New("advanced custom upstream path must be a full URL or a path starting with /")
		}
		if info == nil || strings.TrimSpace(info.ChannelBaseUrl) == "" {
			return nil, errors.New("channel base URL is required when advanced custom upstream path is relative")
		}
		return joinBaseURLAndUpstreamPath(info.ChannelBaseUrl, upstreamPath)
	}

	parsedURL, err := url.Parse(upstreamPath)
	if err != nil {
		return nil, err
	}
	if parsedURL.Scheme == "" || parsedURL.Host == "" {
		return nil, errors.New("advanced custom upstream path must be a full URL or a path starting with /")
	}
	if !strings.EqualFold(parsedURL.Scheme, "http") && !strings.EqualFold(parsedURL.Scheme, "https") {
		return nil, errors.New("advanced custom upstream path must use http or https")
	}
	return parsedURL, nil
}

func joinBaseURLAndUpstreamPath(baseURL string, upstreamPath string) (*url.URL, error) {
	parsedBaseURL, err := url.Parse(strings.TrimSpace(baseURL))
	if err != nil {
		return nil, err
	}
	if parsedBaseURL.Scheme == "" || parsedBaseURL.Host == "" {
		return nil, errors.New("channel base URL must be a full URL when advanced custom upstream path is relative")
	}
	if !strings.EqualFold(parsedBaseURL.Scheme, "http") && !strings.EqualFold(parsedBaseURL.Scheme, "https") {
		return nil, errors.New("channel base URL must use http or https when advanced custom upstream path is relative")
	}

	parsedPath, err := url.Parse(upstreamPath)
	if err != nil {
		return nil, err
	}
	parsedBaseURL.Path = strings.TrimRight(parsedBaseURL.Path, "/") + "/" + strings.TrimLeft(parsedPath.Path, "/")
	parsedBaseURL.RawPath = ""
	parsedBaseURL.RawQuery = parsedPath.RawQuery
	parsedBaseURL.Fragment = parsedPath.Fragment
	return parsedBaseURL, nil
}

func applyUpstreamPathTemplate(upstreamPath string, info *common.RelayInfo) string {
	if info == nil {
		return upstreamPath
	}
	return strings.ReplaceAll(upstreamPath, advancedCustomModelPlaceholder, info.UpstreamModelName)
}

func shouldUseGeminiStreamURL(converter string, info *common.RelayInfo) bool {
	return info != nil &&
		info.IsStream &&
		(converter == relayconvert.ConverterOpenAIChatToGeminiContent ||
			converter == relayconvert.ConverterOpenAIResponsesToGemini)
}

func useGeminiStreamGenerateContentURL(parsedURL *url.URL) {
	if strings.Contains(parsedURL.Path, ":generateContent") {
		parsedURL.Path = strings.Replace(parsedURL.Path, ":generateContent", ":streamGenerateContent", 1)
	}
	if strings.Contains(parsedURL.Path, ":streamGenerateContent") {
		query := parsedURL.Query()
		query.Set("alt", "sse")
		parsedURL.RawQuery = query.Encode()
	}
}

func shouldApplyClaudeHeaders(converter string, info *common.RelayInfo) bool {
	return converter == relayconvert.ConverterOpenAIChatToClaudeMessages ||
		(converter == relayconvert.ConverterNone && info != nil && info.RelayFormat == types.RelayFormatClaude)
}

func applyClaudeHeaders(c context.Context, header *http.Header, info *common.RelayInfo) {
	anthropicVersion := ""
	if info != nil {
		anthropicVersion = info.RequestHeaders["anthropic-version"]
	}
	if anthropicVersion == "" {
		anthropicVersion = "2023-06-01"
	}
	header.Set("anthropic-version", anthropicVersion)
	// Not supported in library mode
	// if c != nil {
	// 	claude2.CommonClaudeHeadersOperation(c, header, info)
	// }
}

func applyAuthTemplate(template string, apiKey string) string {
	return strings.ReplaceAll(template, "{api_key}", apiKey)
}

func isJSONRequest(c context.Context) bool {
	// Not supported in library mode
	return false
}

func (a *Adaptor) convertOpenAICompatibleRequest(c context.Context, info *common.RelayInfo, request *dto.GeneralOpenAIRequest) (any, error) {
	old := info.ChannelType
	info.ChannelType = constant.ChannelTypeOpenAI
	converted, err := a.openaiAdaptor.ConvertOpenAIRequest(c, info, request)
	info.ChannelType = old
	return converted, err
}

func (a *Adaptor) convertOpenAICompatibleResponsesRequest(c context.Context, info *common.RelayInfo, request dto.OpenAIResponsesRequest) (any, error) {
	old := info.ChannelType
	info.ChannelType = constant.ChannelTypeOpenAI
	converted, err := a.openaiAdaptor.ConvertOpenAIResponsesRequest(c, info, request)
	info.ChannelType = old
	return converted, err
}

func (a *Adaptor) convertOpenAICompatibleEmbeddingRequest(c context.Context, info *common.RelayInfo, request dto.EmbeddingRequest) (any, error) {
	old := info.ChannelType
	info.ChannelType = constant.ChannelTypeOpenAI
	converted, err := a.openaiAdaptor.ConvertEmbeddingRequest(c, info, request)
	info.ChannelType = old
	return converted, err
}

func (a *Adaptor) convertOpenAICompatibleAudioRequest(c context.Context, info *common.RelayInfo, request dto.AudioRequest) (io.Reader, error) {
	old := info.ChannelType
	info.ChannelType = constant.ChannelTypeOpenAI
	converted, err := a.openaiAdaptor.ConvertAudioRequest(c, info, request)
	info.ChannelType = old
	return converted, err
}

func (a *Adaptor) convertOpenAICompatibleImageRequest(c context.Context, info *common.RelayInfo, request dto.ImageRequest) (any, error) {
	old := info.ChannelType
	info.ChannelType = constant.ChannelTypeOpenAI
	converted, err := a.openaiAdaptor.ConvertImageRequest(c, info, request)
	info.ChannelType = old
	return converted, err
}
