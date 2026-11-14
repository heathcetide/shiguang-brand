// Package synthesizer implements the Baidu TTS adapter for ling-base.
package synthesizer

import (
	"context"
	"fmt"
	"net/url"
	"strings"

	"github.com/heathcetide/DietDigiDose/pkg/common/logger"
	base "github.com/heathcetide/DietDigiDose/pkg/providers/voice/synthesizer"
	"github.com/carlmjohnson/requests"
)

// BaiduTTSConfig 百度语音合成配置
type BaiduTTSConfig struct {
	Tok           string `json:"tok" env:"BAIDU_ACCESS_TOKEN"`
	Cuid          string `json:"cuid" env:"cuid"`
	Ctp           string `json:"ctp" env:"ctp" default:"1"`
	Lan           string `json:"lan" env:"lan" default:"zh"`
	Spd           string `json:"spd" env:"spd" default:"5"`
	Pit           string `json:"pit" env:"pit" default:"5"`
	Vol           string `json:"vol" env:"vol" default:"5"`
	Aue           string `json:"aue" env:"aue" default:"3"`
	Channels      int    `json:"channels" env:"channels" default:"1"`
	SampleRate    int    `json:"sampleRate" env:"sample_rate" default:"16000"`
	BitDepth      int    `json:"bitDepth" env:"bit_depth" default:"16"`
	FrameDuration string `json:"frameDuration" env:"frame_duration" default:"20ms"`
}

// GetProvider returns the TTS provider type
func (c *BaiduTTSConfig) GetProvider() base.Provider {
	return base.ProviderBaidu
}

func (opt *BaiduTTSConfig) String() string {
	return fmt.Sprintf("BaiduTTSOption{Cuid: %s, Ctp: %s, Lan: %s, Spd: %s, Pit: %s, Vol: %s, Aue: %s, Channel: %d, SampleRate: %d, BitDepth: %d}",
		opt.Cuid, opt.Ctp, opt.Lan, opt.Spd, opt.Pit, opt.Vol, opt.Aue, opt.Channels, opt.SampleRate, opt.BitDepth)
}

// NewBaiduTTSOption creates a BaiduTTSConfig with sensible defaults.
func NewBaiduTTSOption(token string) BaiduTTSConfig {
	return BaiduTTSConfig{
		Tok:           token,
		Ctp:           "1",
		Lan:           "zh",
		Spd:           "5",
		Pit:           "5",
		Vol:           "5",
		Aue:           "3",
		Channels:      1,
		SampleRate:    16000,
		BitDepth:      16,
		FrameDuration: "20ms",
	}
}

// BaiduTTSService 百度语音合成服务
type BaiduTTSService struct {
	opt BaiduTTSConfig
}

// Compile-time guard ensuring BaiduTTSService implements base.Engine.
var _ base.Engine = (*BaiduTTSService)(nil)

// Close releases resources held by the service.
func (bs *BaiduTTSService) Close() error {
	return nil
}

// NewBaiduService creates a new BaiduTTSService from the given config.
func NewBaiduService(opt BaiduTTSConfig) *BaiduTTSService {
	return &BaiduTTSService{
		opt: opt,
	}
}

// Provider returns the TTS provider identifier.
func (bs *BaiduTTSService) Provider() base.Provider {
	return base.ProviderBaidu
}

// Format returns the audio output format.
func (bs *BaiduTTSService) Format() base.StreamFormat {
	return base.StreamFormat{
		FrameDuration: base.NormalizeFramePeriod(bs.opt.FrameDuration),
		Channels:      bs.opt.Channels,
		SampleRate:    bs.opt.SampleRate,
		BitDepth:      bs.opt.BitDepth,
	}
}

// CacheKey returns a unique cache key for the given text.
func (bs *BaiduTTSService) CacheKey(text string) string {
	digest := base.HashText(text)
	return fmt.Sprintf("baidu.tts-%s-%s-%s.pcm", bs.opt.Lan, bs.opt.Ctp, digest)
}

// baiduSpeechSynthesisListener handles incoming TTS audio chunks.
type baiduSpeechSynthesisListener struct {
	handler base.Handler
}

// Synthesize converts text to speech and delivers audio via the handler.
func (bs *BaiduTTSService) Synthesize(ctx context.Context, handler base.Handler, text string) error {
	ttsReq := baiduSpeechSynthesisListener{
		handler: handler,
	}
	dataBytes, err := bs.sendRequest(ctx, text)
	if err != nil {
		return err
	}
	ttsReq.OnMessage(dataBytes)
	return nil
}

// sendRequest posts the text to the Baidu text2audio endpoint and returns the audio bytes.
func (bs *BaiduTTSService) sendRequest(ctx context.Context, text string) ([]byte, error) {
	var data string
	reUrl := "https://tsn.baidu.com/text2audio"
	values := url.Values{
		"tex":  []string{bs.DoubleURLEncode(text)},
		"tok":  []string{bs.opt.Tok},
		"cuid": []string{"cuid"},
		"ctp":  []string{bs.opt.Ctp},
		"lan":  []string{bs.opt.Lan},
		"aue":  []string{bs.opt.Aue},
		"spd":  []string{bs.opt.Spd},
		"pit":  []string{bs.opt.Pit},
		"vol":  []string{bs.opt.Vol},
	}
	err := requests.
		URL(reUrl).
		BodyForm(values).
		Header("Content-Type", "application/x-www-form-urlencoded").
		Header("Accept", "*/*").
		ToString(&data).
		Fetch(ctx)
	if err != nil {
		return nil, err
	}
	if strings.Contains(data, "err_no") {
		return nil, fmt.Errorf("baidu tts: %s", data)
	}
	return []byte(data), nil
}

// DoubleURLEncode applies URL query escaping twice, as required by the Baidu TTS API.
func (bs *BaiduTTSService) DoubleURLEncode(text string) string {
	encoded1 := url.QueryEscape(text)
	encoded2 := url.QueryEscape(encoded1)
	return encoded2
}

// OnComplete logs the completion of synthesis.
func (b *baiduSpeechSynthesisListener) OnComplete() {
	logger.Info("baidu tts: complete", logger.WithFields(map[string]interface{}{})...)
}

// OnMessage forwards the audio chunk to the handler and signals completion.
func (b *baiduSpeechSynthesisListener) OnMessage(data []byte) {
	b.handler.OnMessage(data)
	b.OnComplete()
}
