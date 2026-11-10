package volcengine

import (
	"context"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"strings"

	channelconstant "github.com/heathcetide/DietDigiDose/pkg/relay/constant"
	"github.com/heathcetide/DietDigiDose/pkg/relay/channel"
	"github.com/heathcetide/DietDigiDose/pkg/relay/channel/claude"
	"github.com/heathcetide/DietDigiDose/pkg/relay/channel/openai"
	common "github.com/heathcetide/DietDigiDose/pkg/relay/common"
	constant "github.com/heathcetide/DietDigiDose/pkg/relay/relaymode"
	"github.com/heathcetide/DietDigiDose/pkg/relay/relaykit/dto"
	"github.com/heathcetide/DietDigiDose/pkg/relay/relaykit/types"
	"github.com/heathcetide/DietDigiDose/pkg/relay/setting"
	"github.com/samber/lo"
)

const (
	contextKeyTTSRequest     = "volcengine_tts_request"
	contextKeyResponseFormat = "response_format"
)

type Adaptor struct {
}

func (a *Adaptor) ConvertGeminiRequest(context.Context, *common.RelayInfo, *dto.GeminiChatRequest) (any, error) {
	return nil, errors.New("unsupported capability for this provider")
}

func (a *Adaptor) ConvertClaudeRequest(c context.Context, info *common.RelayInfo, req *dto.ClaudeRequest) (any, error) {
	if _, ok := channelconstant.ChannelSpecialBases[info.ChannelBaseUrl]; ok {
		adaptor := claude.Adaptor{}
		return adaptor.ConvertClaudeRequest(c, info, req)
	}
	adaptor := openai.Adaptor{}
	return adaptor.ConvertClaudeRequest(c, info, req)
}

func (a *Adaptor) ConvertAudioRequest(c context.Context, info *common.RelayInfo, request dto.AudioRequest) (io.Reader, error) {
	if info.RelayMode != constant.RelayModeAudioSpeech {
		return nil, errors.New("unsupported audio relay mode")
	}

	appID, token, err := parseVolcengineAuth(info.ApiKey)
	if err != nil {
		return nil, err
	}

	voiceType := request.Voice
	// Not supported in library mode — VoiceMapped and UpstreamVoiceId fields removed
	// if info.VoiceMapped && info.UpstreamVoiceId != "" {
	// 	voiceType = info.UpstreamVoiceId
	// } else {
	voiceType = mapVoiceType(request.Voice)
	// }
	speedRatio := lo.FromPtrOr(request.Speed, 0.0)
	encoding := mapEncoding(request.ResponseFormat)

	// c.Set(contextKeyResponseFormat, encoding)

	volcRequest := VolcengineTTSRequest{
		App: VolcengineTTSApp{
			AppID:   appID,
			Token:   token,
			Cluster: "volcano_tts",
		},
		User: VolcengineTTSUser{
			UID: "openai_relay_user",
		},
		Audio: VolcengineTTSAudio{
			VoiceType:  voiceType,
			Encoding:   encoding,
			SpeedRatio: speedRatio,
			Rate:       24000,
		},
		Request: VolcengineTTSReqInfo{
			ReqID:     generateRequestID(),
			Text:      request.Input,
			Operation: "submit",
			Model:     info.OriginModelName,
		},
	}

	if len(request.Metadata) > 0 {
		if err = json.Unmarshal(request.Metadata, &volcRequest); err != nil {
			return nil, fmt.Errorf("error unmarshalling metadata to volcengine request: %w", err)
		}
	}

	// c.Set(contextKeyTTSRequest, volcRequest)

	if volcRequest.Request.Operation == "submit" {
		info.IsStream = true
	}

	jsonData, err := json.Marshal(volcRequest)
	if err != nil {
		return nil, fmt.Errorf("error marshalling volcengine request: %w", err)
	}

	return bytes.NewReader(jsonData), nil
}

func (a *Adaptor) ConvertImageRequest(c context.Context, info *common.RelayInfo, request dto.ImageRequest) (any, error) {
	switch info.RelayMode {
	case constant.RelayModeImagesGenerations:
		return request, nil
	// 根据官方文档,并没有发现豆包生图支持表单请求:https://www.volcengine.com/docs/82379/1824121
	//case constant.RelayModeImagesEdits:
	//
	//	var requestBody bytes.Buffer
	//	writer := multipart.NewWriter(&requestBody)
	//
	//	writer.WriteField("model", request.Model)
	//
	//	formData := c.Request.PostForm
	//	for key, values := range formData {
	//		if key == "model" {
	//			continue
	//		}
	//		for _, value := range values {
	//			writer.WriteField(key, value)
	//		}
	//	}
	//
	//	if err := c.Request.ParseMultipartForm(32 << 20); err != nil {
	//		return nil, errors.New("failed to parse multipart form")
	//	}
	//
	//	if nil != nil && nil.File != nil {
	//		var imageFiles []*multipart.FileHeader
	//		var exists bool
	//
	//		if imageFiles, exists = nil.File["image"]; !exists || len(imageFiles) == 0 {
	//			if imageFiles, exists = nil.File["image[]"]; !exists || len(imageFiles) == 0 {
	//				foundArrayImages := false
	//				for fieldName, files := range nil.File {
	//					if strings.HasPrefix(fieldName, "image[") && len(files) > 0 {
	//						foundArrayImages = true
	//						for _, file := range files {
	//							imageFiles = append(imageFiles, file)
	//						}
	//					}
	//				}
	//
	//				if !foundArrayImages && (len(imageFiles) == 0) {
	//					return nil, errors.New("image is required")
	//				}
	//			}
	//		}
	//
	//		for i, fileHeader := range imageFiles {
	//			file, err := fileHeader.Open()
	//			if err != nil {
	//				return nil, fmt.Errorf("failed to open image file %d: %w", i, err)
	//			}
	//			defer file.Close()
	//
	//			fieldName := "image"
	//			if len(imageFiles) > 1 {
	//				fieldName = "image[]"
	//			}
	//
	//			mimeType := detectImageMimeType(fileHeader.Filename)
	//
	//			h := make(textproto.MIMEHeader)
	//			h.Set("Content-Disposition", fmt.Sprintf(`form-data; name="%s"; filename="%s"`, fieldName, fileHeader.Filename))
	//			h.Set("Content-Type", mimeType)
	//
	//			part, err := writer.CreatePart(h)
	//			if err != nil {
	//				return nil, fmt.Errorf("create form part failed for image %d: %w", i, err)
	//			}
	//
	//			if _, err := io.Copy(part, file); err != nil {
	//				return nil, fmt.Errorf("copy file failed for image %d: %w", i, err)
	//			}
	//		}
	//
	//		if maskFiles, exists := nil.File["mask"]; exists && len(maskFiles) > 0 {
	//			maskFile, err := maskFiles[0].Open()
	//			if err != nil {
	//				return nil, errors.New("failed to open mask file")
	//			}
	//			defer maskFile.Close()
	//
	//			mimeType := detectImageMimeType(maskFiles[0].Filename)
	//
	//			h := make(textproto.MIMEHeader)
	//			h.Set("Content-Disposition", fmt.Sprintf(`form-data; name="mask"; filename="%s"`, maskFiles[0].Filename))
	//			h.Set("Content-Type", mimeType)
	//
	//			maskPart, err := writer.CreatePart(h)
	//			if err != nil {
	//				return nil, errors.New("create form file failed for mask")
	//			}
	//
	//			if _, err := io.Copy(maskPart, maskFile); err != nil {
	//				return nil, errors.New("copy mask file failed")
	//			}
	//		}
	//	} else {
	//		return nil, errors.New("no multipart form data found")
	//	}
	//
	//	writer.Close()
	//	c.Request.Header.Set("Content-Type", writer.FormDataContentType())
	//	return bytes.NewReader(requestBody.Bytes()), nil

	default:
		return request, nil
	}
}

func detectImageMimeType(filename string) string {
	ext := strings.ToLower(filepath.Ext(filename))
	switch ext {
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".png":
		return "image/png"
	case ".webp":
		return "image/webp"
	default:
		if strings.HasPrefix(ext, ".jp") {
			return "image/jpeg"
		}
		return "image/png"
	}
}

func (a *Adaptor) Init(info *common.RelayInfo) {
}

func (a *Adaptor) GetRequestURL(info *common.RelayInfo) (string, error) {
	baseUrl := info.ChannelBaseUrl
	if baseUrl == "" {
		baseUrl = channelconstant.ChannelBaseURLs[channelconstant.ChannelTypeVolcEngine]
	}
	specialPlan, hasSpecialPlan := channelconstant.ChannelSpecialBases[baseUrl]

	switch info.RelayFormat {
	case types.RelayFormatClaude:
		if hasSpecialPlan && specialPlan.ClaudeBaseURL != "" {
			return fmt.Sprintf("%s/v1/messages", specialPlan.ClaudeBaseURL), nil
		}
		if strings.HasPrefix(info.UpstreamModelName, "bot") {
			return fmt.Sprintf("%s/api/v3/bots/chat/completions", baseUrl), nil
		}
		return fmt.Sprintf("%s/api/v3/chat/completions", baseUrl), nil
	default:
		switch info.RelayMode {
		case constant.RelayModeChatCompletions:
			if hasSpecialPlan && specialPlan.OpenAIBaseURL != "" {
				return fmt.Sprintf("%s/chat/completions", specialPlan.OpenAIBaseURL), nil
			}
			if strings.HasPrefix(info.UpstreamModelName, "bot") {
				return fmt.Sprintf("%s/api/v3/bots/chat/completions", baseUrl), nil
			}
			return fmt.Sprintf("%s/api/v3/chat/completions", baseUrl), nil
		case constant.RelayModeEmbeddings:
			return fmt.Sprintf("%s/api/v3/embeddings", baseUrl), nil
		//豆包的图生图也走generations接口: https://www.volcengine.com/docs/82379/1824121
		case constant.RelayModeImagesGenerations, constant.RelayModeImagesEdits:
			return fmt.Sprintf("%s/api/v3/images/generations", baseUrl), nil
		//case constant.RelayModeImagesEdits:
		//	return fmt.Sprintf("%s/api/v3/images/edits", baseUrl), nil
		case constant.RelayModeRerank:
			return fmt.Sprintf("%s/api/v3/rerank", baseUrl), nil
		case constant.RelayModeResponses:
			return fmt.Sprintf("%s/api/v3/responses", baseUrl), nil
		case constant.RelayModeAudioSpeech:
			if baseUrl == channelconstant.ChannelBaseURLs[channelconstant.ChannelTypeVolcEngine] {
				return "wss://openspeech.bytedance.com/api/v1/tts/ws_binary", nil
			}
			return fmt.Sprintf("%s/v1/audio/speech", baseUrl), nil
		default:
		}
	}
	return "", fmt.Errorf("unsupported relay mode: %d", info.RelayMode)
}

func (a *Adaptor) SetupRequestHeader(c context.Context, req *http.Header, info *common.RelayInfo) error {
	channel.SetupApiRequestHeader(info, req)

	if info.RelayMode == constant.RelayModeAudioSpeech {
		parts := strings.Split(info.ApiKey, "|")
		if len(parts) == 2 {
			req.Set("Authorization", "Bearer;"+parts[1])
		}
		req.Set("Content-Type", "application/json")
		return nil
	} else if info.RelayMode == constant.RelayModeImagesEdits {
		req.Set("Content-Type", "application/json")
	}

	req.Set("Authorization", "Bearer "+info.ApiKey)
	return nil
}

func (a *Adaptor) ConvertOpenAIRequest(c context.Context, info *common.RelayInfo, request *dto.GeneralOpenAIRequest) (any, error) {
	if request == nil {
		return nil, errors.New("request is nil")
	}

	if !setting.ShouldPreserveThinkingSuffix(info.OriginModelName) &&
		strings.HasSuffix(info.UpstreamModelName, "-thinking") &&
		strings.HasPrefix(info.UpstreamModelName, "deepseek") {
		info.UpstreamModelName = strings.TrimSuffix(info.UpstreamModelName, "-thinking")
		request.Model = info.UpstreamModelName
		request.THINKING = json.RawMessage(`{"type": "enabled"}`)
	}
	return request, nil
}

func (a *Adaptor) ConvertRerankRequest(c context.Context, relayMode int, request dto.RerankRequest) (any, error) {
	return request, nil
}

func (a *Adaptor) ConvertEmbeddingRequest(c context.Context, info *common.RelayInfo, request dto.EmbeddingRequest) (any, error) {
	return request, nil
}

func (a *Adaptor) ConvertOpenAIResponsesRequest(c context.Context, info *common.RelayInfo, request dto.OpenAIResponsesRequest) (any, error) {
	return request, nil
}

func (a *Adaptor) DoRequest(c context.Context, info *common.RelayInfo, requestBody io.Reader) (*http.Response, error) {
	if info.RelayMode == constant.RelayModeAudioSpeech {
		baseUrl := info.ChannelBaseUrl
		if baseUrl == "" {
			baseUrl = channelconstant.ChannelBaseURLs[channelconstant.ChannelTypeVolcEngine]
		}

		if baseUrl == channelconstant.ChannelBaseURLs[channelconstant.ChannelTypeVolcEngine] {
			if info.IsStream {
				return nil, nil
			}
		}
	}
	return channel.DoApiRequest(c, a, info, requestBody)
}

func (a *Adaptor) DoResponse(c context.Context, resp *http.Response, info *common.RelayInfo, w http.ResponseWriter) (usage any, err *types.NewAPIError) {
	if info.RelayFormat == types.RelayFormatClaude {
		if _, ok := channelconstant.ChannelSpecialBases[info.ChannelBaseUrl]; ok {
			adaptor := claude.Adaptor{}
			return adaptor.DoResponse(c, resp, info, w)
		}
	}

	if info.RelayMode == constant.RelayModeRerank {
		adaptor := openai.Adaptor{}
		return adaptor.DoResponse(c, resp, info, w)
	}

	if info.RelayMode == constant.RelayModeAudioSpeech {
		encoding := mapEncoding("")
		if info.IsStream {
			// Not supported in library mode — WebSocket TTS streaming requires context-stored request
			return nil, types.NewErrorWithStatusCode(
				errors.New("volcengine TTS WebSocket streaming is not supported in library mode"),
				types.ErrorCodeBadRequestBody,
				http.StatusInternalServerError,
			)
		}
		return handleTTSResponse(c, resp, info, encoding, w)
	}

	adaptor := openai.Adaptor{}
	usage, err = adaptor.DoResponse(c, resp, info, w)
	return
}

func (a *Adaptor) GetModelList() []string {
	return ModelList
}

func (a *Adaptor) GetChannelName() string {
	return ChannelName
}
