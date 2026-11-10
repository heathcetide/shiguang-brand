package codex

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/heathcetide/DietDigiDose/pkg/relay/channel"
	common "github.com/heathcetide/DietDigiDose/pkg/relay/common"
	relayconstant "github.com/heathcetide/DietDigiDose/pkg/relay/relaymode"
	"github.com/heathcetide/DietDigiDose/pkg/relay/relaykit/dto"
	"github.com/heathcetide/DietDigiDose/pkg/relay/relaykit/types"

)

type Adaptor struct {
}

func (a *Adaptor) ConvertGeminiRequest(c context.Context, info *common.RelayInfo, request *dto.GeminiChatRequest) (any, error) {
	return nil, errors.New("codex channel: endpoint not supported")
}

func (a *Adaptor) ConvertClaudeRequest(context.Context, *common.RelayInfo, *dto.ClaudeRequest) (any, error) {
	return nil, errors.New("codex channel: /v1/messages endpoint not supported")
}

func (a *Adaptor) ConvertAudioRequest(c context.Context, info *common.RelayInfo, request dto.AudioRequest) (io.Reader, error) {
	return nil, errors.New("codex channel: endpoint not supported")
}

func (a *Adaptor) ConvertImageRequest(c context.Context, info *common.RelayInfo, request dto.ImageRequest) (any, error) {
	return nil, errors.New("codex channel: endpoint not supported")
}

func (a *Adaptor) Init(info *common.RelayInfo) {
}

func (a *Adaptor) ConvertOpenAIRequest(c context.Context, info *common.RelayInfo, request *dto.GeneralOpenAIRequest) (any, error) {
	return nil, errors.New("codex channel: /v1/chat/completions endpoint not supported")
}

func (a *Adaptor) ConvertRerankRequest(c context.Context, relayMode int, request dto.RerankRequest) (any, error) {
	return nil, errors.New("codex channel: /v1/rerank endpoint not supported")
}

func (a *Adaptor) ConvertEmbeddingRequest(c context.Context, info *common.RelayInfo, request dto.EmbeddingRequest) (any, error) {
	return nil, errors.New("codex channel: /v1/embeddings endpoint not supported")
}

func (a *Adaptor) ConvertOpenAIResponsesRequest(c context.Context, info *common.RelayInfo, request dto.OpenAIResponsesRequest) (any, error) {
	isCompact := info != nil && info.RelayMode == relayconstant.RelayModeResponsesCompact

	// Not supported in library mode — ChannelSetting was DB-coupled and has been removed.
	// if info != nil && info.ChannelSetting.SystemPrompt != "" {
	// 	systemPrompt := info.ChannelSetting.SystemPrompt
	//
	// 	if len(request.Instructions) == 0 {
	// 		if b, err := json.Marshal(systemPrompt); err == nil {
	// 			request.Instructions = b
	// 		} else {
	// 			return nil, err
	// 		}
	// 	} else if info.ChannelSetting.SystemPromptOverride {
	// 		var existing string
	// 		if err := json.Unmarshal(request.Instructions, &existing); err == nil {
	// 			existing = strings.TrimSpace(existing)
	// 			if existing == "" {
	// 				if b, err := json.Marshal(systemPrompt); err == nil {
	// 					request.Instructions = b
	// 				} else {
	// 					return nil, err
	// 				}
	// 			} else {
	// 				if b, err := json.Marshal(systemPrompt + "\n" + existing); err == nil {
	// 					request.Instructions = b
	// 				} else {
	// 					return nil, err
	// 				}
	// 			}
	// 		} else {
	// 			if b, err := json.Marshal(systemPrompt); err == nil {
	// 				request.Instructions = b
	// 			} else {
	// 				return nil, err
	// 			}
	// 		}
	// 	}
	// }
	// Codex backend requires the `instructions` field to be present.
	// Keep it consistent with Codex CLI behavior by defaulting to an empty string.
	if len(request.Instructions) == 0 {
		request.Instructions = json.RawMessage(`""`)
	}

	if isCompact {
		return request, nil
	}
	// codex: store must be false
	request.Store = json.RawMessage("false")
	// rm max_output_tokens
	request.MaxOutputTokens = nil
	request.Temperature = nil
	return request, nil
}

func (a *Adaptor) DoRequest(c context.Context, info *common.RelayInfo, requestBody io.Reader) (*http.Response, error) {
	return channel.DoApiRequest(c, a, info, requestBody)
}

func (a *Adaptor) DoResponse(c context.Context, resp *http.Response, info *common.RelayInfo, w http.ResponseWriter) (usage any, err *types.NewAPIError) {
	switch info.RelayMode {
	case relayconstant.RelayModeAlphaSearch:
		// Alpha search responses are handled by relay.AlphaSearchHelper.
		return nil, types.NewError(errors.New("codex channel: alpha search response should be handled by AlphaSearchHelper"), types.ErrorCodeInvalidRequest)
	case relayconstant.RelayModeResponsesCompact:
		// Not supported in library mode — openai2.OaiResponsesCompactionHandler does not exist.
		return nil, types.NewError(errors.New("codex channel: responses compact handler not supported in library mode"), types.ErrorCodeInvalidRequest)
	case relayconstant.RelayModeResponses:
		// Not supported in library mode — openai2.OaiResponsesStreamHandler/OaiResponsesHandler do not exist.
		return nil, types.NewError(errors.New("codex channel: responses handler not supported in library mode"), types.ErrorCodeInvalidRequest)
	default:
		return nil, types.NewError(errors.New("codex channel: endpoint not supported"), types.ErrorCodeInvalidRequest)
	}
}

func (a *Adaptor) GetModelList() []string {
	return ModelList
}

func (a *Adaptor) GetChannelName() string {
	return ChannelName
}

func (a *Adaptor) GetRequestURL(info *common.RelayInfo) (string, error) {
	var path string
	switch info.RelayMode {
	case relayconstant.RelayModeResponses:
		path = "/backend-api/codex/responses"
	case relayconstant.RelayModeResponsesCompact:
		path = "/backend-api/codex/responses/compact"
	case relayconstant.RelayModeAlphaSearch:
		path = "/backend-api/codex/alpha/search"
	default:
		return "", errors.New("codex channel: only /v1/responses, /v1/responses/compact and /v1/alpha/search are supported")
	}
	return channel.GetFullRequestURL(info.ChannelBaseUrl, path, info.ChannelType), nil
}

func (a *Adaptor) SetupRequestHeader(c context.Context, req *http.Header, info *common.RelayInfo) error {
	channel.SetupApiRequestHeader(info, req)

	key := strings.TrimSpace(info.ApiKey)
	if !strings.HasPrefix(key, "{") {
		return errors.New("codex channel: key must be a JSON object")
	}

	oauthKey, err := ParseOAuthKey(key)
	if err != nil {
		return err
	}

	accessToken := strings.TrimSpace(oauthKey.AccessToken)
	accountID := strings.TrimSpace(oauthKey.AccountID)

	if accessToken == "" {
		return errors.New("codex channel: access_token is required")
	}
	if accountID == "" {
		return errors.New("codex channel: account_id is required")
	}

	req.Set("Authorization", "Bearer "+accessToken)
	req.Set("chatgpt-account-id", accountID)

	if req.Get("OpenAI-Beta") == "" {
		req.Set("OpenAI-Beta", "responses=experimental")
	}
	if req.Get("originator") == "" {
		req.Set("originator", "codex_cli_rs")
	}

	// chatgpt.com/backend-api/codex/responses is strict about Content-Type.
	// Clients may omit it or include parameters like `application/json; charset=utf-8`,
	// which can be rejected by the upstream. Force the exact media type.
	req.Set("Content-Type", "application/json")
	if info.IsStream {
		req.Set("Accept", "text/event-stream")
	} else if req.Get("Accept") == "" {
		req.Set("Accept", "application/json")
	}

	return nil
}
