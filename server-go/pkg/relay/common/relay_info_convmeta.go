// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package common

import (
	"github.com/heathcetide/DietDigiDose/pkg/relay/relaykit/relayconvert/convmeta"
	"github.com/heathcetide/DietDigiDose/pkg/relay/relaykit/types"
)

// Ensure RelayInfo implements convmeta.Meta for relayconvert.
var _ convmeta.Meta = (*RelayInfo)(nil)

func (info *RelayInfo) GetOriginModelName() string    { return info.OriginModelName }
func (info *RelayInfo) GetUpstreamModelName() string  { return info.UpstreamModelName }
func (info *RelayInfo) HasChannelMeta() bool           { return info.ChannelMeta != nil }
func (info *RelayInfo) GetChannelID() int              { return 0 } // no channel ID in library mode
func (info *RelayInfo) GetChannelType() int            { return info.ChannelType }
func (info *RelayInfo) GetIsStream() bool              { return info.IsStream }
func (info *RelayInfo) GetReasoningEffort() string     { return info.ReasoningEffort }
func (info *RelayInfo) SetReasoningEffort(effort string) { info.ReasoningEffort = effort }
func (info *RelayInfo) GetEstimatePromptTokens() int   { return 0 }

func (info *RelayInfo) EnsureClaudeConvertInfo() *convmeta.ClaudeConvertInfo {
	// In library mode, return a fresh state each time.
	// For streaming, the caller should cache this.
	return &convmeta.ClaudeConvertInfo{}
}

func (info *RelayInfo) GetSendResponseCount() int      { return info.SendResponseCount }
func (info *RelayInfo) IncrSendResponseCount()         { info.SendResponseCount++ }

func (info *RelayInfo) AppendRequestConversion(format types.RelayFormat) {
	info.RequestConversionChain = append(info.RequestConversionChain, format)
	info.FinalRequestRelayFormat = format
}

// convOptions is a cached conversion options snapshot.
// Zero value = every adaptation disabled, no defaults applied.
func (info *RelayInfo) ConvOptions() *convmeta.Options {
	return &info.convOptions
}
