// Package synthesizer implements the AWS Polly TTS adapter for ling-base.
package synthesizer

import (
	"context"
	"fmt"
	"io"
	"sync"

	"github.com/heathcetide/DietDigiDose/pkg/common/logger"
	base "github.com/heathcetide/DietDigiDose/pkg/providers/voice/synthesizer"

	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/polly"
	"github.com/aws/aws-sdk-go-v2/service/polly/types"
)

// AmazonTTSConfig AWS Polly TTS 配置
type AmazonTTSConfig struct {
	SampleRate    int                `json:"sampleRate" env:"sample_rate" default:"16000"`
	Region        string             `json:"region"`
	OutputFormat  types.OutputFormat `json:"outputFormat" env:"output_format" default:"pcm"`
	VoiceId       types.VoiceId      `json:"voiceId" env:"voice_id"`
	Channels      int                `json:"channels" env:"channels" default:"1"`
	BitDepth      int                `json:"bitDepth" env:"bit_depth" default:"16"`
	FrameDuration string             `json:"frameDuration" env:"frame_duration" default:"20ms"`
}

// GetProvider returns the TTS provider type
func (c *AmazonTTSConfig) GetProvider() base.Provider {
	return base.ProviderAWS
}

func (opt *AmazonTTSConfig) String() string {
	return fmt.Sprintf("AmazonTTSOption{SampleRate: %d, Region: %s, Channel: %d, BitDepth: %d}",
		opt.SampleRate, opt.Region, opt.Channels, opt.BitDepth)
}

// NewAmazonTTSOption 创建 AWS Polly TTS 配置
func NewAmazonTTSOption(region string, outputFormat types.OutputFormat, voiceId types.VoiceId) AmazonTTSConfig {
	return AmazonTTSConfig{
		Region:        region,
		OutputFormat:  outputFormat,
		VoiceId:       voiceId,
		Channels:      1,
		SampleRate:    16000,
		BitDepth:      16,
		FrameDuration: "20ms",
	}
}

// AmazonService AWS Polly TTS 服务
type AmazonService struct {
	opt AmazonTTSConfig
	mu  sync.Mutex
}

// NewAmazonService 创建 AWS Polly TTS 服务
func NewAmazonService(opt AmazonTTSConfig) *AmazonService {
	return &AmazonService{opt: opt}
}

func (as *AmazonService) Close() error {
	return nil
}

func (as *AmazonService) Provider() base.Provider {
	return base.ProviderAWS
}

func (as *AmazonService) CacheKey(text string) string {
	as.mu.Lock()
	defer as.mu.Unlock()
	return fmt.Sprintf("amazon.tts-%s-%s-%s", as.opt.VoiceId, as.opt.Region, base.HashText(text))
}

func (as *AmazonService) Format() base.StreamFormat {
	as.mu.Lock()
	defer as.mu.Unlock()
	return base.StreamFormat{
		SampleRate:    as.opt.SampleRate,
		BitDepth:      as.opt.BitDepth,
		Channels:      as.opt.Channels,
		Codec:         "pcm",
		FrameDuration: base.NormalizeFramePeriod(as.opt.FrameDuration),
	}
}

func (as *AmazonService) Synthesize(ctx context.Context, handler base.Handler, text string) error {
	as.mu.Lock()
	opt := as.opt
	as.mu.Unlock()

	if text == "" {
		handler.OnMessage(nil)
		return nil
	}

	cfg, err := config.LoadDefaultConfig(ctx, config.WithRegion(opt.Region))
	if err != nil {
		logger.Error("amazon tts: load config failed", logger.WithError(err))
		return err
	}

	client := polly.NewFromConfig(cfg)
	input := &polly.SynthesizeSpeechInput{
		OutputFormat: opt.OutputFormat,
		Text:         &text,
		VoiceId:      opt.VoiceId,
	}

	resp, err := client.SynthesizeSpeech(ctx, input)
	if err != nil {
		logger.Error("amazon tts: synthesize failed", logger.WithError(err))
		return err
	}
	defer resp.AudioStream.Close()

	audioData, err := io.ReadAll(resp.AudioStream)
	if err != nil {
		logger.Error("amazon tts: read audio stream failed", logger.WithError(err))
		return err
	}

	if len(audioData) > 0 {
		handler.OnMessage(audioData)
	}

	logger.Info("amazon tts: synthesis complete", logger.WithFields(map[string]interface{}{
		"region":    opt.Region,
		"voiceId":   opt.VoiceId,
		"audioSize": len(audioData),
	})...)

	return nil
}

// Compile-time guard.
var _ base.Engine = (*AmazonService)(nil)
