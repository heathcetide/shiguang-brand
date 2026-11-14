package ai360

import (
	"context"

	common "github.com/heathcetide/DietDigiDose/pkg/relay/common"
	"github.com/heathcetide/DietDigiDose/pkg/relay/channel/openai"
	"github.com/heathcetide/DietDigiDose/pkg/relay/constant"
)

// Adaptor wraps openai.Adaptor for ai360 (360智脑).
// ai360 is OpenAI-compatible, so all methods delegate to the OpenAI adaptor.
type Adaptor struct {
	openai.Adaptor
}

// New creates an ai360 adaptor with the given API key and base URL.
func New(apiKey, baseURL string) *Adaptor {
	a := &Adaptor{}
	a.ChannelType = constant.ChannelType360
	a.APIKey = apiKey
	a.BaseURL = baseURL
	if a.BaseURL == "" {
		a.BaseURL = "https://api.360.cn"
	}
	return a
}

func (a *Adaptor) Init(info *common.RelayInfo) {
	if info.ChannelType != 0 {
		a.ChannelType = info.ChannelType
	}
	a.Adaptor.Init(info)
}

func (a *Adaptor) GetChannelName() string { return ChannelName }

func (a *Adaptor) GetModelList() []string { return ModelList }

// Ensure unused imports are referenced.
var _ context.Context
