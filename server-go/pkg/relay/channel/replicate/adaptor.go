package replicate

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common/logger"
	"github.com/heathcetide/DietDigiDose/pkg/relay/constant"
	"github.com/heathcetide/DietDigiDose/pkg/relay/channel"
	common "github.com/heathcetide/DietDigiDose/pkg/relay/common"
	relayconstant "github.com/heathcetide/DietDigiDose/pkg/relay/relaymode"
	"github.com/heathcetide/DietDigiDose/pkg/relay/relaykit/dto"
	"github.com/heathcetide/DietDigiDose/pkg/relay/relaykit/types"
	"github.com/heathcetide/DietDigiDose/pkg/relay/service"

	"github.com/samber/lo"
	"go.uber.org/zap"
)

type Adaptor struct {
}

func (a *Adaptor) Init(info *common.RelayInfo) {
}

func (a *Adaptor) GetRequestURL(info *common.RelayInfo) (string, error) {
	if info == nil {
		return "", errors.New("replicate adaptor: relay info is nil")
	}
	if info.ChannelBaseUrl == "" {
		info.ChannelBaseUrl = constant.ChannelBaseURLs[constant.ChannelTypeReplicate]
	}
	requestPath := info.RequestURLPath
	if requestPath == "" {
		return info.ChannelBaseUrl, nil
	}
	return channel.GetFullRequestURL(info.ChannelBaseUrl, requestPath, info.ChannelType), nil
}

func (a *Adaptor) SetupRequestHeader(c context.Context, req *http.Header, info *common.RelayInfo) error {
	if info == nil {
		return errors.New("replicate adaptor: relay info is nil")
	}
	if info.ApiKey == "" {
		return errors.New("replicate adaptor: api key is required")
	}
	channel.SetupApiRequestHeader(info, req)
	req.Set("Authorization", "Bearer "+info.ApiKey)
	req.Set("Prefer", "wait")
	if req.Get("Content-Type") == "" {
		req.Set("Content-Type", "application/json")
	}
	if req.Get("Accept") == "" {
		req.Set("Accept", "application/json")
	}
	return nil
}

func (a *Adaptor) ConvertImageRequest(c context.Context, info *common.RelayInfo, request dto.ImageRequest) (any, error) {
	if info == nil {
		return nil, errors.New("replicate adaptor: relay info is nil")
	}
	if strings.TrimSpace(request.Prompt) == "" {
		if v := ""; strings.TrimSpace(v) != "" {
			request.Prompt = v
		}
	}
	if strings.TrimSpace(request.Prompt) == "" {
		return nil, errors.New("replicate adaptor: prompt is required")
	}

	modelName := strings.TrimSpace(info.UpstreamModelName)
	if modelName == "" {
		modelName = strings.TrimSpace(request.Model)
	}
	if modelName == "" {
		modelName = ModelFlux11Pro
	}
	info.UpstreamModelName = modelName

	info.RequestURLPath = fmt.Sprintf("/v1/models/%s/predictions", modelName)

	inputPayload := make(map[string]any)
	inputPayload["prompt"] = request.Prompt

	if size := strings.TrimSpace(request.Size); size != "" {
		if aspect, width, height, ok := mapOpenAISizeToFlux(size); ok {
			if aspect != "" {
				if aspect == "custom" {
					inputPayload["aspect_ratio"] = "custom"
					if width > 0 {
						inputPayload["width"] = width
					}
					if height > 0 {
						inputPayload["height"] = height
					}
				} else {
					inputPayload["aspect_ratio"] = aspect
				}
			}
		}
	}

	if len(request.OutputFormat) > 0 {
		var outputFormat string
		if err := json.Unmarshal(request.OutputFormat, &outputFormat); err == nil && strings.TrimSpace(outputFormat) != "" {
			inputPayload["output_format"] = outputFormat
		}
	}

	if imageN := lo.FromPtrOr(request.N, uint(0)); imageN > 0 {
		inputPayload["num_outputs"] = int(imageN)
	}

	if strings.EqualFold(request.Quality, "hd") || strings.EqualFold(request.Quality, "high") {
		inputPayload["prompt_upsampling"] = true
	}

	if info.RelayMode == relayconstant.RelayModeImagesEdits {
		imageURL, err := uploadFileFromForm(c, info, "image", "image[]", "image_prompt")
		if err != nil {
			return nil, err
		}
		if imageURL == "" {
			return nil, errors.New("replicate adaptor: image file is required for edits")
		}
		inputPayload["image_prompt"] = imageURL
	}

	if len(request.ExtraFields) > 0 {
		var extra map[string]any
		if err := json.Unmarshal(request.ExtraFields, &extra); err != nil {
			return nil, fmt.Errorf("replicate adaptor: failed to decode extra_fields: %w", err)
		}
		for key, val := range extra {
			inputPayload[key] = val
		}
	}

	for key, raw := range request.Extra {
		if strings.EqualFold(key, "input") {
			var extraInput map[string]any
			if err := json.Unmarshal(raw, &extraInput); err != nil {
				return nil, fmt.Errorf("replicate adaptor: failed to decode extra input: %w", err)
			}
			for k, v := range extraInput {
				inputPayload[k] = v
			}
			continue
		}
		if raw == nil {
			continue
		}
		var val any
		if err := json.Unmarshal(raw, &val); err != nil {
			return nil, fmt.Errorf("replicate adaptor: failed to decode extra field %s: %w", key, err)
		}
		inputPayload[key] = val
	}

	return map[string]any{
		"input": inputPayload,
	}, nil
}

func (a *Adaptor) DoRequest(c context.Context, info *common.RelayInfo, requestBody io.Reader) (*http.Response, error) {
	return channel.DoApiRequest(c, a, info, requestBody)
}

func (a *Adaptor) DoResponse(c context.Context, resp *http.Response, info *common.RelayInfo, w http.ResponseWriter) (any, *types.NewAPIError) {
	if resp == nil {
		return nil, types.NewError(errors.New("replicate adaptor: empty response"), types.ErrorCodeBadResponse)
	}
	defer resp.Body.Close()

	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, types.NewError(err, types.ErrorCodeReadResponseBodyFailed)
	}

	var prediction PredictionResponse
	if err := json.Unmarshal(responseBody, &prediction); err != nil {
		return nil, types.NewError(fmt.Errorf("replicate adaptor: failed to decode response: %w", err), types.ErrorCodeBadResponseBody)
	}

	if prediction.Error != nil {
		errMsg := prediction.Error.Message
		if errMsg == "" {
			errMsg = prediction.Error.Detail
		}
		if errMsg == "" {
			errMsg = prediction.Error.Code
		}
		if errMsg == "" {
			errMsg = "replicate adaptor: prediction error"
		}
		return nil, types.NewError(errors.New(errMsg), types.ErrorCodeBadResponse)
	}

	if prediction.Status != "" && !strings.EqualFold(prediction.Status, "succeeded") {
		return nil, types.NewError(fmt.Errorf("replicate adaptor: prediction status %q", prediction.Status), types.ErrorCodeBadResponse)
	}

	var urls []string

	appendOutput := func(value string) {
		value = strings.TrimSpace(value)
		if value == "" {
			return
		}
		urls = append(urls, value)
	}

	switch output := prediction.Output.(type) {
	case string:
		appendOutput(output)
	case []any:
		for _, item := range output {
			if str, ok := item.(string); ok {
				appendOutput(str)
			}
		}
	case nil:
		// no output
	default:
		if str, ok := output.(fmt.Stringer); ok {
			appendOutput(str.String())
		}
	}

	if len(urls) == 0 {
		return nil, types.NewError(errors.New("replicate adaptor: empty prediction output"), types.ErrorCodeBadResponseBody)
	}

	var imageReq *dto.ImageRequest
	if info != nil {
		if req, ok := info.Request.(*dto.ImageRequest); ok {
			imageReq = req
		}
	}

	wantsBase64 := imageReq != nil && strings.EqualFold(imageReq.ResponseFormat, "b64_json")

	imageResponse := dto.ImageResponse{
		Created: time.Now().Unix(),
		Data:    make([]dto.ImageData, 0),
	}

	if wantsBase64 {
		converted, convErr := downloadImagesToBase64(urls)
		if convErr != nil {
			return nil, types.NewError(convErr, types.ErrorCodeBadResponse)
		}
		for _, content := range converted {
			if content == "" {
				continue
			}
			imageResponse.Data = append(imageResponse.Data, dto.ImageData{B64Json: content})
		}
	} else {
		for _, url := range urls {
			if url == "" {
				continue
			}
			imageResponse.Data = append(imageResponse.Data, dto.ImageData{Url: url})
		}
	}

	if len(imageResponse.Data) == 0 {
		return nil, types.NewError(errors.New("replicate adaptor: no usable image data"), types.ErrorCodeBadResponse)
	}

	responseBytes, err := json.Marshal(imageResponse)
	if err != nil {
		return nil, types.NewError(fmt.Errorf("replicate adaptor: encode response failed: %w", err), types.ErrorCodeBadResponseBody)
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if _, err := w.Write(responseBytes); err != nil {
		logger.Warn("error writing replicate response", zap.String("error", err.Error()))
	}

	usage := &dto.Usage{}
	return usage, nil
}

func (a *Adaptor) GetModelList() []string {
	return ModelList
}

func (a *Adaptor) GetChannelName() string {
	return ChannelName
}

func downloadImagesToBase64(urls []string) ([]string, error) {
	results := make([]string, 0, len(urls))
	for _, url := range urls {
		if strings.TrimSpace(url) == "" {
			continue
		}
		_, data, err := service.GetImageFromUrl(url)
		if err != nil {
			return nil, fmt.Errorf("replicate adaptor: failed to download image from %s: %w", url, err)
		}
		results = append(results, data)
	}
	return results, nil
}

func mapOpenAISizeToFlux(size string) (aspect string, width int, height int, ok bool) {
	parts := strings.Split(size, "x")
	if len(parts) != 2 {
		return "", 0, 0, false
	}
	w, err1 := strconv.Atoi(strings.TrimSpace(parts[0]))
	h, err2 := strconv.Atoi(strings.TrimSpace(parts[1]))
	if err1 != nil || err2 != nil || w <= 0 || h <= 0 {
		return "", 0, 0, false
	}

	switch {
	case w == h:
		return "1:1", 0, 0, true
	case w == 1792 && h == 1024:
		return "16:9", 0, 0, true
	case w == 1024 && h == 1792:
		return "9:16", 0, 0, true
	case w == 1536 && h == 1024:
		return "3:2", 0, 0, true
	case w == 1024 && h == 1536:
		return "2:3", 0, 0, true
	}

	rw, rh := reduceRatio(w, h)
	ratioStr := fmt.Sprintf("%d:%d", rw, rh)
	switch ratioStr {
	case "1:1", "16:9", "9:16", "3:2", "2:3", "4:5", "5:4", "3:4", "4:3":
		return ratioStr, 0, 0, true
	}

	width = normalizeFluxDimension(w)
	height = normalizeFluxDimension(h)
	return "custom", width, height, true
}

func reduceRatio(w, h int) (int, int) {
	g := gcd(w, h)
	if g == 0 {
		return w, h
	}
	return w / g, h / g
}

func gcd(a, b int) int {
	for b != 0 {
		a, b = b, a%b
	}
	if a < 0 {
		return -a
	}
	return a
}

func normalizeFluxDimension(value int) int {
	const (
		minDim = 256
		maxDim = 1440
		step   = 32
	)
	if value < minDim {
		value = minDim
	}
	if value > maxDim {
		value = maxDim
	}
	remainder := value % step
	if remainder != 0 {
		if remainder >= step/2 {
			value += step - remainder
		} else {
			value -= remainder
		}
	}
	if value < minDim {
		value = minDim
	}
	if value > maxDim {
		value = maxDim
	}
	return value
}

func uploadFileFromForm(c context.Context, info *common.RelayInfo, fieldCandidates ...string) (string, error) {
	if info == nil {
		return "", errors.New("replicate adaptor: relay info is nil")
	}

	// Not supported in library mode — multipart form parsing requires gin.Context
	// In library mode, file uploads are handled differently.
	return "", nil
}

func (a *Adaptor) ConvertOpenAIRequest(context.Context, *common.RelayInfo, *dto.GeneralOpenAIRequest) (any, error) {
	return nil, errors.New("replicate adaptor: ConvertOpenAIRequest is not implemented")
}

func (a *Adaptor) ConvertRerankRequest(context.Context, int, dto.RerankRequest) (any, error) {
	return nil, errors.New("replicate adaptor: ConvertRerankRequest is not implemented")
}

func (a *Adaptor) ConvertEmbeddingRequest(context.Context, *common.RelayInfo, dto.EmbeddingRequest) (any, error) {
	return nil, errors.New("replicate adaptor: ConvertEmbeddingRequest is not implemented")
}

func (a *Adaptor) ConvertAudioRequest(context.Context, *common.RelayInfo, dto.AudioRequest) (io.Reader, error) {
	return nil, errors.New("replicate adaptor: ConvertAudioRequest is not implemented")
}

func (a *Adaptor) ConvertOpenAIResponsesRequest(context.Context, *common.RelayInfo, dto.OpenAIResponsesRequest) (any, error) {
	return nil, errors.New("replicate adaptor: ConvertOpenAIResponsesRequest is not implemented")
}

func (a *Adaptor) ConvertClaudeRequest(context.Context, *common.RelayInfo, *dto.ClaudeRequest) (any, error) {
	return nil, errors.New("replicate adaptor: ConvertClaudeRequest is not implemented")
}

func (a *Adaptor) ConvertGeminiRequest(context.Context, *common.RelayInfo, *dto.GeminiChatRequest) (any, error) {
	return nil, errors.New("replicate adaptor: ConvertGeminiRequest is not implemented")
}
