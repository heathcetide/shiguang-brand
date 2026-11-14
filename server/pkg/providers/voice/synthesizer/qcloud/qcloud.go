// Package synthesizer implements the Tencent QCloud TTS adapter for ling-base.
package synthesizer

// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: AGPL-3.0

import (
	"context"
	"fmt"
	"reflect"
	"strconv"
	"sync"

	"github.com/heathcetide/DietDigiDose/pkg/common/logger"
	base "github.com/heathcetide/DietDigiDose/pkg/providers/voice/synthesizer"
	"github.com/tencentcloud/tencentcloud-speech-sdk-go/common"
	"github.com/tencentcloud/tencentcloud-speech-sdk-go/tts"
)

// QCloudTTSConfig tencent qcloud tts config
type QCloudTTSConfig struct {
	AppID         int64  `json:"appId" yaml:"app_id" env:"QCLOUD_APP_ID"`
	SecretID      string `json:"secretId" yaml:"secret_id" env:"QCLOUD_SECRET_ID"`
	SecretKey     string `json:"secret" yaml:"secret" env:"QCLOUD_SECRET"`
	VoiceType     int64  `json:"voiceType" yaml:"voice_type" default:"1005"`
	ModelType     int64  `json:"modelType" yaml:"model_type" default:"1"`
	Language      string `json:"language" yaml:"language"` // 语言代码，如 zh-CN, en-US（腾讯云通过音色类型区分语言，此字段用于配置和缓存）
	Codec         string `json:"codec" yaml:"codec" default:"pcm"`
	FrameDuration string `json:"frameDuration" yaml:"frame_duration" default:"20ms"`
	SampleRate    int64  `json:"sampleRate" yaml:"sample_rate" default:"8000"`
	Channels      int64  `json:"channels" yaml:"channels" default:"1"`
	BitDepth      int64  `json:"bitDepth" yaml:"bit_depth" default:"16"`
	// Speed is Tencent TTS speed level (typically -2~6, 0 means default).
	Speed int64 `json:"speed" yaml:"speed" default:"0"`
}

// GetProvider returns the TTS provider type
func (c *QCloudTTSConfig) GetProvider() base.Provider {
	return base.ProviderTencent
}

// ToString returns a debug string representation of the config.
func (opt *QCloudTTSConfig) ToString() string {
	return fmt.Sprintf("QCloudTTSOption{AppID: %d, SecretID: %s, VoiceType: %d, ModelType: %d, SampleRate: %d, Channel: %d, BitDepth: %d, Codec: %s, Speed: %d}",
		opt.AppID, opt.SecretID, opt.VoiceType, opt.ModelType, opt.SampleRate, opt.Channels, opt.BitDepth, opt.Codec, opt.Speed)
}

// NewQcloudTTSConfig creates a QCloud TTS config from the given parameters.
func NewQcloudTTSConfig(appId string, secretId string, secretKey string, voiceType int64, codec string, sample int) QCloudTTSConfig {
	appIdVal, _ := strconv.ParseInt(appId, 10, 64)
	if voiceType == 0 {
		voiceType = 1005
	}
	if codec == "" {
		codec = "pcm"
	}
	return QCloudTTSConfig{
		AppID:      appIdVal,
		SecretID:   secretId,
		SecretKey:  secretKey,
		VoiceType:  voiceType,
		ModelType:  1,
		Codec:      codec,
		SampleRate: int64(sample),
		Channels:   1,
		BitDepth:   16,
	}
}

// QCloudService tencent qcloud tts service
type QCloudService struct {
	opt QCloudTTSConfig
	mu  sync.Mutex // 保护 opt 的并发访问
}

// NewQCloudService creates a QCloud TTS service.
func NewQCloudService(opt QCloudTTSConfig) *QCloudService {
	svc := &QCloudService{
		opt: opt,
	}
	return svc
}

// Provider returns the TTS provider identifier.
func (qs *QCloudService) Provider() base.Provider {
	return base.ProviderTencent
}

// Format returns the audio output stream format.
func (qs *QCloudService) Format() base.StreamFormat {
	qs.mu.Lock()
	defer qs.mu.Unlock()
	return base.StreamFormat{
		SampleRate:    int(qs.opt.SampleRate),
		BitDepth:      int(qs.opt.BitDepth),
		Channels:      int(qs.opt.Channels),
		Codec:         qs.opt.Codec,
		FrameDuration: base.NormalizeFramePeriod(qs.opt.FrameDuration),
	}
}

// CacheKey returns a unique cache key for the given text.
func (qs *QCloudService) CacheKey(text string) string {
	qs.mu.Lock()
	defer qs.mu.Unlock()
	digest := base.HashText(text)
	// 如果配置了语言，将其包含在缓存键中
	if qs.opt.Language != "" {
		return fmt.Sprintf("qcloud.tts-%d-%d-%d-%d-%s-%s.pcm", qs.opt.VoiceType, qs.opt.ModelType, qs.opt.SampleRate, qs.opt.Speed, qs.opt.Language, digest)
	}
	return fmt.Sprintf("qcloud.tts-%d-%d-%d-%d-%s.pcm", qs.opt.VoiceType, qs.opt.ModelType, qs.opt.SampleRate, qs.opt.Speed, digest)
}

// Synthesize converts text to speech and delivers audio via the handler.
func (qs *QCloudService) Synthesize(ctx context.Context, handler base.Handler, text string) error {
	if text == "" {
		logger.Debug("qcloud tts: skip empty or invalid segment", logger.WithFields(map[string]interface{}{"text": text})...)
		return nil
	}

	qs.mu.Lock()
	opt := qs.opt
	qs.mu.Unlock()

	ttsReq := &qcloudSpeechSynthesisListener{
		handler: handler,
	}
	credential := common.NewCredential(opt.SecretID, opt.SecretKey)
	synthesizer := tts.NewSpeechSynthesizer(opt.AppID, credential, ttsReq)
	synthesizer.VoiceType = opt.VoiceType
	synthesizer.SampleRate = opt.SampleRate
	synthesizer.Codec = opt.Codec
	applyQCloudTTSSpeed(synthesizer, opt.Speed)

	err := synthesizer.Synthesis(text)
	if err != nil {
		return err
	}
	err = synthesizer.Wait()
	if err != nil {
		return err
	}

	// 检查是否有 OnFail 错误
	ttsReq.mu.Lock()
	failErr := ttsReq.err
	ttsReq.mu.Unlock()

	if failErr != nil {
		return failErr
	}

	return nil
}

// Close releases resources.
func (qs *QCloudService) Close() error {
	return nil
}

// applyQCloudTTSSpeed sets the Speed field on the SDK synthesizer via reflection,
// tolerating SDK versions that do not expose a public Speed field.
func applyQCloudTTSSpeed(synth *tts.SpeechSynthesizer, speed int64) {
	if synth == nil || speed == 0 {
		return
	}
	// SDK versions differ: some expose a public Speed field, some don't.
	rv := reflect.ValueOf(synth)
	if rv.Kind() != reflect.Ptr || rv.IsNil() {
		return
	}
	ev := rv.Elem()
	if !ev.IsValid() {
		return
	}
	f := ev.FieldByName("Speed")
	if !f.IsValid() || !f.CanSet() {
		return
	}
	switch f.Kind() {
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		f.SetInt(speed)
	}
}

// qcloudSpeechSynthesisListener implements tts.SpeechSynthesisListener.
type qcloudSpeechSynthesisListener struct {
	handler base.Handler
	err     error
	mu      sync.Mutex
}

// OnCancel is called when synthesis is cancelled.
func (q *qcloudSpeechSynthesisListener) OnCancel(*tts.SpeechSynthesisResponse) {
	logger.Info("qcloud tts: cancel", logger.WithFields(map[string]interface{}{})...)
}

// OnComplete is called when synthesis completes successfully.
func (q *qcloudSpeechSynthesisListener) OnComplete(*tts.SpeechSynthesisResponse) {
	logger.Info("qcloud tts: complete", logger.WithFields(map[string]interface{}{})...)
}

// OnFail is called when synthesis fails.
func (q *qcloudSpeechSynthesisListener) OnFail(_ *tts.SpeechSynthesisResponse, err error) {
	logger.Error("qcloud tts: fail", append(logger.WithFields(map[string]interface{}{}), logger.WithError(err))...)
	q.mu.Lock()
	q.err = err
	q.mu.Unlock()
}

// OnMessage is called for each audio chunk.
func (q *qcloudSpeechSynthesisListener) OnMessage(resp *tts.SpeechSynthesisResponse) {
	q.handler.OnMessage(resp.Data)
}

// Compile-time guard ensuring QCloudService implements base.Engine.
var _ base.Engine = (*QCloudService)(nil)
