package jimeng

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"

	"github.com/heathcetide/DietDigiDose/pkg/relay/channel/openai"
	common "github.com/heathcetide/DietDigiDose/pkg/relay/common"
	relayconstant "github.com/heathcetide/DietDigiDose/pkg/relay/relaymode"
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

func (a *Adaptor) Init(info *common.RelayInfo) {
}

func (a *Adaptor) GetRequestURL(info *common.RelayInfo) (string, error) {
	return fmt.Sprintf("%s/?Action=CVProcess&Version=2022-08-31", info.ChannelBaseUrl), nil
}

func (a *Adaptor) SetupRequestHeader(c context.Context, header *http.Header, info *common.RelayInfo) error {
	header.Set("Content-Type", "application/json")
	if info.ApiKey != "" {
		header.Set("Authorization", "Bearer "+info.ApiKey)
	}
	return nil
}

func (a *Adaptor) ConvertOpenAIRequest(c context.Context, info *common.RelayInfo, request *dto.GeneralOpenAIRequest) (any, error) {
	if request == nil {
		return nil, errors.New("request is nil")
	}
	return request, nil
}

type LogoInfo struct {
	AddLogo         bool    `json:"add_logo,omitempty"`
	Position        int     `json:"position,omitempty"`
	Language        int     `json:"language,omitempty"`
	Opacity         float64 `json:"opacity,omitempty"`
	LogoTextContent string  `json:"logo_text_content,omitempty"`
}

type imageRequestPayload struct {
	ReqKey     string   `json:"req_key"`                      // Service identifier, fixed value: jimeng_high_aes_general_v21_L
	Prompt     string   `json:"prompt"`                       // Prompt for image generation, supports both Chinese and English
	Seed       int64    `json:"seed,omitempty"`               // Random seed, default -1 (random)
	Width      int      `json:"width,omitempty"`              // Image width, default 512, range [256, 768]
	Height     int      `json:"height,omitempty"`             // Image height, default 512, range [256, 768]
	UsePreLLM  bool     `json:"use_pre_llm,omitempty"`        // Enable text expansion, default true
	UseSR      bool     `json:"use_sr,omitempty"`             // Enable super resolution, default true
	ReturnURL  bool     `json:"return_url,omitempty"`         // Whether to return image URL (valid for 24 hours)
	LogoInfo   LogoInfo `json:"logo_info,omitempty"`          // Watermark information
	ImageUrls  []string `json:"image_urls,omitempty"`         // Image URLs for input
	BinaryData []string `json:"binary_data_base64,omitempty"` // Base64 encoded binary data
}

func (a *Adaptor) ConvertImageRequest(c context.Context, info *common.RelayInfo, request dto.ImageRequest) (any, error) {
	payload := imageRequestPayload{
		ReqKey: request.Model,
		Prompt: request.Prompt,
	}
	if request.ResponseFormat == "" || request.ResponseFormat == "url" {
		payload.ReturnURL = true // Default to returning image URLs
	}

	if len(request.ExtraFields) > 0 {
		if err := json.Unmarshal(request.ExtraFields, &payload); err != nil {
			return nil, fmt.Errorf("failed to unmarshal extra fields: %w", err)
		}
	}

	return payload, nil
}

func (a *Adaptor) ConvertRerankRequest(c context.Context, relayMode int, request dto.RerankRequest) (any, error) {
	return nil, errors.New("unsupported capability for this provider")
}

func (a *Adaptor) ConvertEmbeddingRequest(c context.Context, info *common.RelayInfo, request dto.EmbeddingRequest) (any, error) {
	return nil, errors.New("unsupported capability for this provider")
}

func (a *Adaptor) ConvertAudioRequest(c context.Context, info *common.RelayInfo, request dto.AudioRequest) (io.Reader, error) {
	return nil, errors.New("unsupported capability for this provider")
}

func (a *Adaptor) ConvertOpenAIResponsesRequest(c context.Context, info *common.RelayInfo, request dto.OpenAIResponsesRequest) (any, error) {
	return nil, errors.New("unsupported capability for this provider")
}

func (a *Adaptor) DoRequest(c context.Context, info *common.RelayInfo, requestBody io.Reader) (*http.Response, error) {
	fullRequestURL, err := a.GetRequestURL(info)
	if err != nil {
		return nil, fmt.Errorf("get request url failed: %w", err)
	}
	req, err := http.NewRequest("POST", fullRequestURL, requestBody)
	if err != nil {
		return nil, fmt.Errorf("new request failed: %w", err)
	}
	err = Sign(c, req, info.ApiKey)
	if err != nil {
		return nil, fmt.Errorf("setup request header failed: %w", err)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("do request failed: %w", err)
	}
	return resp, nil
}

func (a *Adaptor) DoResponse(c context.Context, resp *http.Response, info *common.RelayInfo, w http.ResponseWriter) (usage any, err *types.NewAPIError) {
	if info.RelayMode == relayconstant.RelayModeImagesGenerations {
		usage, err = jimengImageHandler(c, resp, info, w)
	} else {
		// Not supported in library mode — openai.OaiStreamHandler/openai.OpenaiHandler do not exist.
		// Fall back to openai.Adaptor.DoResponse for non-image modes.
		openaiAdaptor := openai.Adaptor{}
		usage, err = openaiAdaptor.DoResponse(c, resp, info, w)
	}
	return
}

func (a *Adaptor) GetModelList() []string {
	return ModelList
}

func (a *Adaptor) GetChannelName() string {
	return ChannelName
}
