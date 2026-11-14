// Package synthesizer implements the Volcengine LLM ASR adapter for ling-base.
package synthesizer

// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: AGPL-3.0

import (
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common/logger"
	base "github.com/heathcetide/DietDigiDose/pkg/providers/voice/recognizer"
	gonanoid "github.com/matoous/go-nanoid"
)

// VolcengineLLMASR is the Volcengine big-model (SAUC) ASR engine.
type VolcengineLLMASR struct {
	handler      base.MessageType
	opt          VolcengineLLMOption
	sendReqTime  time.Time
	endReqTime   *time.Time
	dialogID     string
	ttfbDone     bool
	audioDataLen int
	recognizer   *base.Recognizer
	tr           base.ResultFunc
	er           base.ErrorFunc
}

// VolcengineLLMOption configures the Volcengine big-model ASR.
type VolcengineLLMOption struct {
	Url           string         `json:"url" yaml:"url" default:"wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async"`
	ResourceId    string         `json:"resourceId" yaml:"resource_id" default:"volc.bigasr.sauc.duration"`
	AppID         string         `json:"appId" yaml:"app_id" env:"ASR_VOLC_LLM_APPID"`
	AccessToken   string         `json:"accessToken" yaml:"access_token" env:"ASR_VOLC_LLM_ACCESS_TOKEN"`
	Format        string         `json:"format" yaml:"format" default:"pcm"`
	SampleRate    int            `json:"sampleRate" yaml:"sample_rate" default:"16000"`
	BitDepth      int            `json:"bitDepth" yaml:"bit_depth" default:"16"`
	Channel       int            `json:"channel" yaml:"channel" default:"1"`
	Codec         string         `json:"codec" yaml:"codec" default:"raw"`
	ReqChanSize   int            `json:"reqChanSize" yaml:"req_chan_size" default:"128"`
	HotWords      []base.HotWord `json:"hotWords" yaml:"hot_words"`
	EndWindowSize int            `json:"endWindowSize" yaml:"end_window_size"`
}

// GetVendor returns the vendor identifier.
func (opt *VolcengineLLMOption) GetVendor() base.Vendor {
	return base.VendorVolcengineLLM
}

// NewVolcengineLLMOption creates a default VolcengineLLMOption.
func NewVolcengineLLMOption(token, appID string) VolcengineLLMOption {
	return VolcengineLLMOption{
		Url:           "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async",
		ResourceId:    "volc.bigasr.sauc.duration",
		AccessToken:   token,
		AppID:         appID,
		Format:        "pcm",
		SampleRate:    16000,
		BitDepth:      16,
		Channel:       1,
		Codec:         "raw",
		ReqChanSize:   128,
		EndWindowSize: base.DefaultVolcEndWindowMs(),
	}
}

// NewVolcengineLLM builds a Volcengine big-model ASR engine.
func NewVolcengineLLM(opt VolcengineLLMOption) VolcengineLLMASR {
	return VolcengineLLMASR{opt: opt}
}

// Init registers the result and error callbacks.
func (v *VolcengineLLMASR) Init(tr base.ResultFunc, er base.ErrorFunc) {
	v.tr = tr
	v.er = er
}

// Vendor returns the vendor identifier string.
func (v *VolcengineLLMASR) Vendor() string {
	return "volcllmasr"
}

// ConnAndReceive establishes the connection and starts receiving results.
func (v *VolcengineLLMASR) ConnAndReceive(dialogID string) error {
	v.dialogID = dialogID

	config := base.DefaultConfig().
		WithURL(v.opt.Url).
		WithAuth(base.AuthConfig{
			ResourceId: v.opt.ResourceId,
			AccessKey:  v.opt.AccessToken,
			AppKey:     v.opt.AppID,
		}).
		WithAudio(base.AudioConfig{
			Format:  v.opt.Format,
			Codec:   v.opt.Codec,
			Rate:    v.opt.SampleRate,
			Bits:    v.opt.BitDepth,
			Channel: v.opt.Channel,
		}).
		WithBuffer(base.BufferConfig{
			SegmentDurationMs: 100,
		})

	// 设置热词上下文
	if len(v.opt.HotWords) > 0 {
		config.Request.Corpus.Context = GenerateCorpusContext(v.opt.HotWords)
	}
	endWin := v.opt.EndWindowSize
	if endWin <= 0 {
		endWin = base.DefaultVolcEndWindowMs()
	}
	if endWin < 200 {
		endWin = 200
	}
	config.Request.EndWindowSize = endWin

	v.recognizer = base.NewRecognizer(config)
	v.sendReqTime = time.Now()

	err := v.recognizer.Start()
	if err != nil {
		v.er(errors.New("failed to start recognizer"), true)
		return err
	}

	v.recognizer.OnResult(func(result *base.Result) {
		v.handleRecognitionResult(result)
	})

	v.recognizer.OnError(func(err error) {
		v.er(fmt.Errorf("recognizer error: %s", err), true)
	})

	logger.Info(fmt.Sprintf("volcenginellm asr: start recognize"), logger.WithFields(map[string]interface{}{
		"dialogId": v.dialogID,
		"traceId":  v.recognizer.GetTraceID(),
	})...)

	return nil
}

// handleRecognitionResult forwards a recognition result to the tr callback
// and stops the recognizer once the final result is received.
func (v *VolcengineLLMASR) handleRecognitionResult(result *base.Result) {
	duration := time.Since(v.sendReqTime)
	v.tr(result.Text, result.IsFinal, duration, v.dialogID)
	if result.IsFinal {
		logger.Info(fmt.Sprintf("volcenginellm asr: recv last result: %s", result.Text), logger.WithFields(map[string]interface{}{
			"dialogId": v.dialogID,
			"traceId":  v.recognizer.GetTraceID(),
		})...)

		if v.recognizer != nil {
			logger.Info(fmt.Sprintf("volcenginellm asr: stop recognize"), logger.WithFields(map[string]interface{}{
				"dialogId": v.dialogID,
				"traceId":  v.recognizer.GetTraceID(),
			})...)
			v.recognizer.Stop()
			v.recognizer = nil
		}
	}
}

// Activity returns true if the engine is actively connected.
func (v *VolcengineLLMASR) Activity() bool {
	return v.recognizer != nil
}

// RestartClient stops the current connection and starts a new one.
func (v *VolcengineLLMASR) RestartClient() {
	_ = v.StopConn()
	dialogID, _ := gonanoid.Nanoid()
	if err := v.ConnAndReceive(dialogID); err != nil {
		v.er(err, true)
	}
}

// SendAudioBytes sends audio data for recognition.
func (v *VolcengineLLMASR) SendAudioBytes(data []byte) error {
	if v.recognizer != nil {
		err := v.recognizer.SendAudioFrame(&base.AudioFrame{Data: data})
		if errors.Is(err, base.ErrClientClosed) {
			return nil
		}
		return err
	}
	return nil
}

// SendEnd signals the end of the audio stream.
func (v *VolcengineLLMASR) SendEnd() error {
	if v.recognizer != nil {
		logger.Info(fmt.Sprintf("volcenginellm asr: end recognize"), logger.WithFields(map[string]interface{}{
			"dialogId": v.dialogID,
			"traceId":  v.recognizer.GetTraceID(),
		})...)
		return v.recognizer.SendAudioFrame(&base.AudioFrame{IsEnd: true})
	}
	return nil
}

// StopConn stops the connection and cleans up resources.
func (v *VolcengineLLMASR) StopConn() error {
	if v.recognizer != nil {
		logger.Info(fmt.Sprintf("volcenginellm asr: stop recognize"), logger.WithFields(map[string]interface{}{
			"dialogId": v.dialogID,
			"traceId":  v.recognizer.GetTraceID(),
		})...)
		v.recognizer.Stop()
		v.recognizer = nil
	}

	return nil
}

// GenerateCorpusContext builds the JSON hotword context string used by the
// Volcengine big-model ASR request.
func GenerateCorpusContext(hotwords []base.HotWord) string {
	type Hotword struct {
		Word string `json:"word"`
	}
	type Context struct {
		Hotwords []Hotword `json:"hotwords"`
	}

	var ctx Context
	for _, w := range hotwords {
		ctx.Hotwords = append(ctx.Hotwords, Hotword{Word: w.Word})
	}

	data, err := json.Marshal(ctx)
	if err != nil {
		return ""
	}
	return string(data)
}

// Compile-time guard ensuring VolcengineLLMASR implements base.Engine.
var _ base.Engine = (*VolcengineLLMASR)(nil)
