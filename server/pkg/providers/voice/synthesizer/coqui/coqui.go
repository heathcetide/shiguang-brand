// Package synthesizer implements the Coqui TTS adapter for ling-base.
package synthesizer

// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: AGPL-3.0

import (
	"context"
	"encoding/base64"
	"fmt"
	"net/url"

	"github.com/heathcetide/DietDigiDose/pkg/common/logger"
	base "github.com/heathcetide/DietDigiDose/pkg/providers/voice/synthesizer"
	"github.com/carlmjohnson/requests"
)

// CoquiTTSOption configures a Coqui TTS service.
type CoquiTTSOption struct {
	Url           string `json:"url" yaml:"url" env:"COQUI_URL"`
	Language      string `json:"language" yaml:"language" default:"en_US"`
	Speaker       string `json:"speaker" yaml:"speaker" default:"p226"`
	SampleRate    int    `json:"sampleRate" yaml:"sample_rate" default:"16000"`
	Channels      int    `json:"channels" yaml:"channels" default:"1"`
	BitDepth      int    `json:"bitDepth" yaml:"bit_depth" default:"16"`
	FrameDuration string `json:"frameDuration" yaml:"frame_duration" default:"20ms"`
}

// GetProvider returns the TTS provider type.
func (c *CoquiTTSOption) GetProvider() base.Provider {
	return base.ProviderCoqui
}

// CoquiResponse is the JSON response returned by the Coqui TTS HTTP endpoint.
type CoquiResponse struct {
	Audio string `json:"audio"`
}

// String returns a debug string representation of the config.
func (opt *CoquiTTSOption) String() string {
	return fmt.Sprintf("CoquiTTSOption{Url: %s, Language: %s, Channels: %d, SampleRate: %d, Speaker: %s, BitDepth: %d}",
		opt.Url, opt.Language, opt.Channels, opt.SampleRate, opt.Speaker, opt.BitDepth)
}

// NewCoquiTTSOption creates a CoquiTTSOption with sensible defaults.
func NewCoquiTTSOption(url string) CoquiTTSOption {
	return CoquiTTSOption{
		Url:        url,
		Language:   "en-US",
		Speaker:    "p226",
		SampleRate: 16000,
		Channels:   1,
		BitDepth:   16,
	}
}

// CoquiService wraps a CoquiTTSOption and implements base.Engine.
type CoquiService struct {
	opt CoquiTTSOption
}

// Close releases resources held by the service.
func (c *CoquiService) Close() error {
	return nil
}

// NewCoquiService creates a Coqui TTS service.
func NewCoquiService(opt CoquiTTSOption) *CoquiService {
	return &CoquiService{
		opt: opt,
	}
}

// Provider returns the TTS provider identifier.
func (c *CoquiService) Provider() base.Provider {
	return base.ProviderCoqui
}

// Format returns the audio output stream format.
func (c *CoquiService) Format() base.StreamFormat {
	return base.StreamFormat{
		SampleRate:    c.opt.SampleRate,
		BitDepth:      c.opt.BitDepth,
		Channels:      c.opt.Channels,
		FrameDuration: base.NormalizeFramePeriod(c.opt.FrameDuration),
	}
}

// CacheKey returns a unique cache key for the given text.
func (c *CoquiService) CacheKey(text string) string {
	digest := base.HashText(text)
	return fmt.Sprintf("coqui.tts-%s-%s-%s.pcm", c.opt.Language, c.opt.Speaker, digest)
}

type coquiSpeechSynthesisListener struct {
	handler base.Handler
}

// Synthesize converts text to speech and delivers audio via the handler.
func (c *CoquiService) Synthesize(ctx context.Context, handler base.Handler, text string) error {
	ttsReq := coquiSpeechSynthesisListener{
		handler: handler,
	}
	dataBytes, err := ttsReq.sendRequest(ctx, text, c.opt)
	if err != nil {
		return err
	}
	ttsReq.OnMessage(dataBytes)
	return nil
}

func (c *coquiSpeechSynthesisListener) sendRequest(ctx context.Context, text string, opt CoquiTTSOption) ([]byte, error) {
	var resp CoquiResponse
	if err := requests.URL(opt.Url).BodyForm(url.Values{
		"text":        []string{text},
		"language_id": []string{opt.Language},
		"speaker_id":  []string{opt.Speaker},
	}).ToJSON(&resp).Fetch(ctx); err != nil {
		logger.Info("coqui tts: send request failed", append(logger.WithFields(map[string]interface{}{
			"handler": c.handler,
			"text":    text,
		}), logger.WithError(err))...)
		return nil, err
	}
	dataBytes, err := base64.StdEncoding.DecodeString(resp.Audio)
	if err != nil {
		logger.Info("coqui tts: decode string failed", append(logger.WithFields(map[string]interface{}{
			"handler": c.handler,
		}), logger.WithError(err))...)
		return nil, err
	}
	return dataBytes, nil
}

func (c *coquiSpeechSynthesisListener) OnComplete() {
	logger.Info("coqui tts: complete", logger.WithFields(map[string]interface{}{})...)
}

func (c *coquiSpeechSynthesisListener) OnMessage(data []byte) {
	c.handler.OnMessage(data)
	c.OnComplete()
}

// Compile-time guard ensuring CoquiService implements base.Engine.
var _ base.Engine = (*CoquiService)(nil)
