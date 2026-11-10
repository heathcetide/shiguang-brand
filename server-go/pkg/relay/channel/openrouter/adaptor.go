package openrouter

import (
	"context"
	"net/http"

	common "github.com/heathcetide/DietDigiDose/pkg/relay/common"
	"github.com/heathcetide/DietDigiDose/pkg/relay/channel/openai"
	"github.com/heathcetide/DietDigiDose/pkg/relay/constant"
)

// Adaptor wraps openai.Adaptor for OpenRouter.
// OpenRouter is OpenAI-compatible but adds special headers.
type Adaptor struct {
	openai.Adaptor
}

// New creates an OpenRouter adaptor with the given API key and base URL.
func New(apiKey, baseURL string) *Adaptor {
	a := &Adaptor{}
	a.ChannelType = constant.ChannelTypeOpenRouter
	a.APIKey = apiKey
	a.BaseURL = baseURL
	if a.BaseURL == "" {
		a.BaseURL = "https://openrouter.ai/api"
	}
	return a
}

func (a *Adaptor) Init(info *common.RelayInfo) {
	if info.ChannelType != 0 {
		a.ChannelType = info.ChannelType
	}
	a.Adaptor.Init(info)
}

func (a *Adaptor) SetupRequestHeader(ctx context.Context, header *http.Header, info *common.RelayInfo) error {
	if err := a.Adaptor.SetupRequestHeader(ctx, header, info); err != nil {
		return err
	}
	// OpenRouter-specific headers.
	header.Set("HTTP-Referer", "https://lingbyte.dev")
	header.Set("X-OpenRouter-Title", "ling-base")
	return nil
}

func (a *Adaptor) GetChannelName() string { return ChannelName }

func (a *Adaptor) GetModelList() []string { return ModelList }

