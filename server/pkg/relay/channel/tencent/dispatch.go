package tencent

import (
	"strings"

	"github.com/heathcetide/DietDigiDose/pkg/relay/constant"
	"github.com/heathcetide/DietDigiDose/pkg/relay/channel/openai"
	common "github.com/heathcetide/DietDigiDose/pkg/relay/common"
)

const tokenHubBaseURL = "https://tokenhub.tencentmaas.com"

// DispatchAdaptor 按密钥格式分流:三段式 ak/sk 走原生 TC3,单段 TokenHub key 走 OpenAI 兼容。
type DispatchAdaptor struct {
	common.Adaptor
}

func (a *DispatchAdaptor) Init(info *common.RelayInfo) {
	if strings.Contains(info.ApiKey, "|") {
		a.Adaptor = &Adaptor{}
	} else {
		a.Adaptor = &openai.Adaptor{}
		if info.ChannelBaseUrl == "" || info.ChannelBaseUrl == constant.ChannelBaseURLs[constant.ChannelTypeTencent] {
			info.ChannelBaseUrl = tokenHubBaseURL
		}
	}
	a.Adaptor.Init(info)
}

func (a *DispatchAdaptor) GetModelList() []string {
	return ModelList
}

func (a *DispatchAdaptor) GetChannelName() string {
	return ChannelName
}
