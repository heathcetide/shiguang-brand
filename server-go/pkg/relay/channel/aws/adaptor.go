package aws

import (
	"context"
	"fmt"
	"io"
	"net/http"

	"github.com/heathcetide/DietDigiDose/pkg/relay/channel"
	"github.com/heathcetide/DietDigiDose/pkg/relay/channel/claude"
	"github.com/heathcetide/DietDigiDose/pkg/relay/channel/openai"
	common "github.com/heathcetide/DietDigiDose/pkg/relay/common"
	relaymode "github.com/heathcetide/DietDigiDose/pkg/relay/relaymode"
	"github.com/heathcetide/DietDigiDose/pkg/relay/relaykit/dto"
	"github.com/heathcetide/DietDigiDose/pkg/relay/relaykit/types"
	"github.com/heathcetide/DietDigiDose/pkg/relay/service"
	"github.com/aws/aws-sdk-go-v2/service/bedrockruntime"
	"github.com/pkg/errors"

)

type ClientMode int

const (
	ClientModeApiKey ClientMode = iota + 1
	ClientModeAKSK
)

type Adaptor struct {
	ClientMode ClientMode
	AwsClient  *bedrockruntime.Client
	AwsModelId string
	AwsReq     any
	IsNova     bool
}

func (a *Adaptor) ConvertGeminiRequest(context.Context, *common.RelayInfo, *dto.GeminiChatRequest) (any, error) {
	return nil, errors.New("unsupported capability for this provider")
}

func (a *Adaptor) ConvertClaudeRequest(c context.Context, info *common.RelayInfo, request *dto.ClaudeRequest) (any, error) {
	for i, message := range request.Messages {
		updated := false
		if !message.IsStringContent() {
			content, err := message.ParseContent()
			if err != nil {
				return nil, errors.Wrap(err, "failed to parse message content")
			}
			for i2, mediaMessage := range content {
				if mediaMessage.Source != nil {
					if mediaMessage.Source.Type == "url" {
						// 使用统一的文件服务获取图片数据
						source := types.NewURLFileSource(mediaMessage.Source.Url)
						base64Data, mimeType, err := service.GetBase64Data(source.URL, "formatting image for Claude")
						if err != nil {
							return nil, fmt.Errorf("get file base64 from url failed: %s", err.Error())
						}
						mediaMessage.Source.MediaType = mimeType
						mediaMessage.Source.Data = base64Data
						mediaMessage.Source.Url = ""
						mediaMessage.Source.Type = "base64"
						content[i2] = mediaMessage
						updated = true
					}
				}
			}
			if updated {
				message.SetContent(content)
			}
		}
		if updated {
			request.Messages[i] = message
		}
	}
	return request, nil
}

func (a *Adaptor) ConvertAudioRequest(c context.Context, info *common.RelayInfo, request dto.AudioRequest) (io.Reader, error) {
	return nil, errors.New("unsupported capability for this provider")
}

func (a *Adaptor) ConvertImageRequest(c context.Context, info *common.RelayInfo, request dto.ImageRequest) (any, error) {
	return nil, errors.New("unsupported capability for this provider")
}

func (a *Adaptor) Init(info *common.RelayInfo) {
}

func (a *Adaptor) GetRequestURL(info *common.RelayInfo) (string, error) {
	// Not supported in library mode — ChannelOtherSettings not available
	// Default to AKSK mode (no HTTP URL needed; AWS SDK handles routing)
	a.ClientMode = ClientModeAKSK
	return "", nil
}

func (a *Adaptor) SetupRequestHeader(c context.Context, req *http.Header, info *common.RelayInfo) error {
	// Not supported in library mode
	// claude.CommonClaudeHeadersOperation(c, req, info)
	if a.ClientMode == ClientModeApiKey {
		req.Set("Authorization", "Bearer "+info.ApiKey)
	}
	return nil
}

func (a *Adaptor) ConvertOpenAIRequest(c context.Context, info *common.RelayInfo, request *dto.GeneralOpenAIRequest) (any, error) {
	if request == nil {
		return nil, errors.New("request is nil")
	}
	// 检查是否为Nova模型
	if isNovaModel(request.Model) {
		novaReq := convertToNovaRequest(request)
		a.IsNova = true
		return novaReq, nil
	}

	// 原有的Claude模型处理逻辑
	result, err := service.ConvertRequest(c, info, types.RelayFormatClaude, request)
	if err != nil {
		return nil, errors.Wrap(err, "failed to convert openai request to claude request")
	}
	claudeReq, ok := result.Value.(*dto.ClaudeRequest)
	if !ok {
		return nil, fmt.Errorf("expected Anthropic Messages request, got %T", result.Value)
	}
	info.UpstreamModelName = claudeReq.Model
	return claudeReq, err
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
	if a.ClientMode == ClientModeApiKey {
		return channel.DoApiRequest(c, a, info, requestBody)
	} else {
		_, err := doAwsClientRequest(c, info, a, requestBody)
		if err != nil {
			return nil, err
		}
		return nil, nil
	}
}

func (a *Adaptor) DoResponse(c context.Context, resp *http.Response, info *common.RelayInfo, w http.ResponseWriter) (usage any, err *types.NewAPIError) {
	if info.RelayMode == relaymode.RelayModeEmbeddings {
		adaptor := openai.Adaptor{}
		return adaptor.DoResponse(c, resp, info, w)
	}
	if info.RelayMode == relaymode.RelayModeRerank {
		adaptor := openai.Adaptor{}
		return adaptor.DoResponse(c, resp, info, w)
	}
	if a.ClientMode == ClientModeApiKey {
		claudeAdaptor := claude.Adaptor{}
		usage, err = claudeAdaptor.DoResponse(c, resp, info, w)
	} else {
		if a.IsNova {
			err, usage = handleNovaRequest(c, info, a, w)
		} else {
			if info.IsStream {
				err, usage = awsStreamHandler(c, info, a, w)
			} else {
				err, usage = awsHandler(c, info, a, w)
			}
		}
	}
	return
}

func (a *Adaptor) GetModelList() (models []string) {
	for n := range awsModelIDMap {
		models = append(models, n)
	}

	return
}

func (a *Adaptor) GetChannelName() string {
	return ChannelName
}
