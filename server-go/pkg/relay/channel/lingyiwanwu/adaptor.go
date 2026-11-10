package lingyiwanwu

import (
	common "github.com/heathcetide/DietDigiDose/pkg/relay/common"
	"github.com/heathcetide/DietDigiDose/pkg/relay/channel/openai"
	"github.com/heathcetide/DietDigiDose/pkg/relay/constant"
)

// Adaptor wraps openai.Adaptor for lingyiwanwu (零一万物).
// lingyiwanwu is OpenAI-compatible, so all methods delegate to the OpenAI adaptor.
type Adaptor struct {
	openai.Adaptor
}

// New creates a lingyiwanwu adaptor with the given API key and base URL.
func New(apiKey, baseURL string) *Adaptor {
	a := &Adaptor{}
	a.ChannelType = constant.ChannelTypeLingYiWanWu
	a.APIKey = apiKey
	a.BaseURL = baseURL
	if a.BaseURL == "" {
		a.BaseURL = "https://api.lingyiwanwu.com"
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
