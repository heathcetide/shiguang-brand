// Package synthesizer implements the QCloud (Tencent Cloud) ASR adapter for ling-base.
package synthesizer

// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: AGPL-3.0

import (
	"fmt"
	"strings"
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common/logger"
	base "github.com/heathcetide/DietDigiDose/pkg/providers/voice/recognizer"
	gonanoid "github.com/matoous/go-nanoid"
	"github.com/tencentcloud/tencentcloud-speech-sdk-go/asr"
	"github.com/tencentcloud/tencentcloud-speech-sdk-go/common"
)

// QCloudASR is the QCloud (Tencent Cloud) streaming ASR engine.
type QCloudASR struct {
	Handler     interface{}
	sentence    string
	sliceType   uint32
	startTime   uint32
	endTime     uint32
	sendReqTime *time.Time
	endReqTime  *time.Time

	opt              QCloudASROption
	recognizer       *asr.SpeechRecognizer
	transcribeResult base.ResultFunc
	processError     base.ErrorFunc
	dialogID         string
}

// QCloudASROption configures the QCloud streaming ASR.
type QCloudASROption struct {
	AppID       string         `json:"appId" yaml:"app_id" env:"QCLOUD_APP_ID"`
	SecretID    string         `json:"secretId" yaml:"secret_id" env:"QCLOUD_SECRET_ID"`
	SecretKey   string         `json:"secret" yaml:"secret" env:"QCLOUD_SECRET"`
	Format      int            `json:"format" yaml:"format" default:"1"`
	ModelType   string         `json:"modelType" yaml:"model_type" env:"QCLOUD_MODEL_TYPE" default:"16k_zh"`
	ReqChanSize int            `json:"reqChanSize" yaml:"req_chan_size" default:"128"`
	HotWords    []base.HotWord `json:"hotWords" yaml:"hot_words"`
	// VadSilenceTime is cloud endpointing silence (ms) before OnSentenceEnd.
	// Vendor default is 1000 when omitted from the WS query; we apply
	// defaultQCloudVadSilenceMs when unset so contact-center turns cut faster.
	// Range 240–2000; requires NeedVad=1 (SDK default).
	VadSilenceTime int `json:"vadSilenceTime" yaml:"vad_silence_time"`
	// NeedVad mirrors needvad. Zero = default on (1). Set to -1 to force off.
	NeedVad int `json:"needVad" yaml:"need_vad"`
}

// defaultQCloudVadSilenceMs is the contact-center default when the tenant
// does not set vadSilenceTime. Cloud default without the query param is 1000ms.
const defaultQCloudVadSilenceMs = 300

// GetVendor returns the vendor identifier.
func (opt QCloudASROption) GetVendor() base.Vendor {
	return base.VendorQCloud
}

// NewQcloudASROption creates a default QCloudASROption.
func NewQcloudASROption(appId string, secretId string, secretKey string) QCloudASROption {
	return QCloudASROption{
		AppID:          appId,
		SecretID:       secretId,
		SecretKey:      secretKey,
		Format:         asr.AudioFormatPCM,
		ModelType:      "16k_zh",
		ReqChanSize:    128,
		VadSilenceTime: defaultQCloudVadSilenceMs,
	}
}

// effectiveVadSilenceTime clamps the configured VAD silence time to the
// vendor-supported range (240–2000ms), falling back to the contact-center
// default when unset.
func (opt QCloudASROption) effectiveVadSilenceTime() int {
	v := opt.VadSilenceTime
	if v <= 0 {
		v = defaultQCloudVadSilenceMs
	}
	if v < 240 {
		return 240
	}
	if v > 2000 {
		return 2000
	}
	return v
}

// applyQCloudRecognizerParams configures VAD-related fields on the SDK
// recognizer according to the option.
func applyQCloudRecognizerParams(recognizer *asr.SpeechRecognizer, opt QCloudASROption) {
	if recognizer == nil {
		return
	}
	if opt.NeedVad < 0 {
		recognizer.NeedVad = 0
		return
	}
	// Default / explicit on: cloud VAD required for vad_silence_time.
	recognizer.NeedVad = 1
	recognizer.VadSilenceTime = opt.effectiveVadSilenceTime()
}

// String returns a human-readable summary of the option.
func (opt QCloudASROption) String() string {
	return fmt.Sprintf("QCloudASROption{AppID: %s, Format: %d, ModelType: %s, ReqChanSize: %d, VadSilenceTime: %d}",
		opt.AppID, opt.Format, opt.ModelType, opt.ReqChanSize, opt.effectiveVadSilenceTime())
}

// NewQcloudASR builds a QCloud ASR engine.
func NewQcloudASR(opt QCloudASROption) *QCloudASR {
	return &QCloudASR{opt: opt}
}

// Init registers the result and error callbacks.
func (asq *QCloudASR) Init(tr base.ResultFunc, er base.ErrorFunc) {
	asq.transcribeResult = tr
	asq.processError = er
}

// Vendor returns the vendor identifier string.
func (asq *QCloudASR) Vendor() string {
	return "qcloud"
}

// ConnAndReceive establishes the QCloud streaming recognizer connection and
// starts receiving results. dialogID is a unique identifier for the current
// dialog.
func (asq *QCloudASR) ConnAndReceive(dialogID string) error {
	asq.dialogID = dialogID
	credential := common.NewCredential(asq.opt.SecretID, asq.opt.SecretKey)
	recognizer := asr.NewSpeechRecognizer(asq.opt.AppID, credential, asq.opt.ModelType, asq)
	recognizer.VoiceFormat = asq.opt.Format
	applyQCloudRecognizerParams(recognizer, asq.opt)
	hotWords := asq.opt.HotWords

	var hotWordsStr string
	for _, hotWord := range hotWords {
		var weight string
		if hotWord.Weight > 0 {
			weight = fmt.Sprintf("%d", hotWord.Weight)
		} else {
			weight = "10"
		}
		wordStr := hotWord.Word + "|" + weight
		hotWordsStr += wordStr + ","
	}
	recognizer.HotwordList = strings.TrimSuffix(hotWordsStr, ",")
	if len(hotWordsStr) > 0 {
		logger.Info("qcloud: hotwords", logger.WithFields(map[string]interface{}{
			"hotwords": recognizer.HotwordList,
		})...)
	}
	err := recognizer.Start()
	if err != nil {
		logger.Error("qcloud: recognizer.Start", logger.WithError(err))
		return err
	}
	asq.recognizer = recognizer
	now := time.Now()
	asq.sendReqTime = &now
	asq.endReqTime = &now
	return nil
}

// Activity returns true if the engine is actively connected.
func (asq *QCloudASR) Activity() bool {
	return asq.recognizer != nil
}

// RestartClient stops the current connection and re-establishes a new one
// with a fresh dialog ID.
func (asq *QCloudASR) RestartClient() {
	_ = asq.StopConn()
	dialogID, _ := gonanoid.Nanoid()
	_ = asq.ConnAndReceive(dialogID)
}

// SendAudioBytes sends audio data for recognition. If the recognizer is not
// running it will be restarted automatically.
func (asq *QCloudASR) SendAudioBytes(data []byte) error {
	if data == nil {
		return nil
	}
	if asq.recognizer == nil {
		if len(data) == 0 {
			return nil
		}
		asq.RestartClient()
		if asq.recognizer == nil {
			return fmt.Errorf("recognizer is not running")
		}
	}
	err := asq.recognizer.Write(data)
	if err == nil {
		return nil
	}
	msg := err.Error()
	if !strings.Contains(msg, "not running") {
		return err
	}
	asq.RestartClient()
	if asq.recognizer == nil {
		return err
	}
	return asq.recognizer.Write(data)
}

// SendEnd signals end of audio stream and stops the recognizer.
func (asq *QCloudASR) SendEnd() error {
	if asq.recognizer != nil {
		_ = asq.recognizer.Stop()
		asq.recognizer = nil
	}
	return nil
}

// StopConn stops the connection and cleans up resources.
func (asq *QCloudASR) StopConn() error {
	if asq.recognizer != nil {
		_ = asq.recognizer.Stop()
		asq.recognizer = nil
	}
	return nil
}

// OnRecognitionStart implementation of asr.SpeechRecognitionListener
func (asq *QCloudASR) OnRecognitionStart(response *asr.SpeechRecognitionResponse) {
	logger.Info("OnRecognitionStart", logger.WithFields(map[string]interface{}{"voice_id": response.VoiceID})...)
}

// OnSentenceBegin implementation of asr.SpeechRecognitionListener
func (asq *QCloudASR) OnSentenceBegin(response *asr.SpeechRecognitionResponse) {
	sendReqTime := time.Now()
	asq.sendReqTime = &sendReqTime
}

// OnRecognitionResultChange implementation of asr.SpeechRecognitionListener
func (asq *QCloudASR) OnRecognitionResultChange(response *asr.SpeechRecognitionResponse) {
	if asq.transcribeResult != nil {
		duration := time.Duration(0)
		if asq.sendReqTime != nil {
			duration = time.Since(*asq.sendReqTime)
		}
		asq.transcribeResult(response.Result.VoiceTextStr, false, duration, asq.dialogID)
		return
	}
}

// OnSentenceEnd — 一句说完，isLast 应为 true
func (asq *QCloudASR) OnSentenceEnd(response *asr.SpeechRecognitionResponse) {
	logger.Info("qcloud: on sentence end", logger.WithFields(map[string]interface{}{
		"voiceTextStr": response.Result.VoiceTextStr,
	})...)

	asq.sentence += response.Result.VoiceTextStr
	asq.sliceType = response.Result.SliceType
	asq.startTime = response.Result.StartTime
	asq.endTime = response.Result.EndTime

	completed := strings.TrimSpace(asq.sentence)
	if completed == "" {
		return
	}

	duration := time.Duration(0)
	if asq.sendReqTime != nil {
		duration = time.Since(*asq.sendReqTime)
	}

	if asq.transcribeResult != nil {
		asq.transcribeResult(completed, true, duration, asq.dialogID)
		asq.sentence = ""
		return
	}

	// Engine-only mode without a result callback: nothing more to do.
	asq.sentence = ""
}

// OnRecognitionComplete — 会话结束，只 flush 没碰到 OnSentenceEnd 的尾巴
func (asq *QCloudASR) OnRecognitionComplete(response *asr.SpeechRecognitionResponse) {
	finalSentence := strings.TrimSpace(asq.sentence)
	asq.sentence = ""
	asq.sliceType = 0

	logger.Info("qcloud: on recognition complete", logger.WithFields(map[string]interface{}{
		"voiceTextStr":  response.Result.VoiceTextStr,
		"finalSentence": finalSentence,
	})...)

	if finalSentence != "" {
		duration := time.Duration(0)
		if asq.sendReqTime != nil {
			duration = time.Since(*asq.sendReqTime)
		}

		if asq.transcribeResult != nil {
			asq.transcribeResult(finalSentence, true, duration, asq.dialogID)
		}
	}

	// Vendor closed the stream (idle / max duration). Clear handle so the
	// next SendAudioBytes path restarts; do not Start here to avoid races
	// with concurrent Write.
	asq.recognizer = nil
}

// OnFail implementation of asr.SpeechRecognitionListener
func (asq *QCloudASR) OnFail(response *asr.SpeechRecognitionResponse, err error) {
	if response.Code == 4008 {
		// no audio data send error
		return
	}
	if strings.Contains(err.Error(), "EOF") {
		logger.Warn("qcloud: eof onfail", logger.WithFields(map[string]interface{}{
			"voice_id": response.VoiceID,
			"error":    err,
		})...)
		return
	}
	logger.Error("OnFail", logger.WithFields(map[string]interface{}{
		"voice_id": response.VoiceID,
		"error":    err,
	})...)

	// 优先使用 processError 回调
	if asq.processError != nil {
		asq.processError(err, true)
		return
	}
}

// Compile-time guard ensuring QCloudASR implements base.Engine.
var _ base.Engine = (*QCloudASR)(nil)
