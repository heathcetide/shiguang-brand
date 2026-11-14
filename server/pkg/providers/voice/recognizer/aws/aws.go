// Package synthesizer implements the AWS Transcribe streaming ASR adapter for ling-base.
package synthesizer

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common/logger"
	base "github.com/heathcetide/DietDigiDose/pkg/providers/voice/recognizer"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/transcribestreaming"
	"github.com/aws/aws-sdk-go-v2/service/transcribestreaming/types"
)

// Compile-time guard ensuring AWSASR implements base.Engine.
var _ base.Engine = (*AWSASR)(nil)

// AWSASR is the AWS Transcribe streaming ASR engine.
type AWSASR struct {
	Handler interface{}

	sentence    string
	startTime   *time.Time
	endTime     *time.Time
	sendReqTime *time.Time
	endReqTime  *time.Time

	opt AWSASROption

	eventStream *transcribestreaming.StartStreamTranscriptionEventStream
	dialogID    string

	ctx    context.Context
	cancel context.CancelFunc

	isStreaming bool
	mu          sync.Mutex

	audioQueue chan []byte

	tr base.ResultFunc
	er base.ErrorFunc
}

// AWSASROption configures the AWS Transcribe ASR engine.
type AWSASROption struct {
	AccessKey     string `json:"accessKey" yaml:"access_key"`
	SecretKey     string `json:"secretKey" yaml:"secret_key"`
	Region        string `json:"region" yaml:"region" default:"us-east-1"`
	SampleRate    int    `json:"sampleRate" yaml:"sample_rate" default:"16000"`
	AudioEncoding string `json:"audioEncoding" yaml:"audio_encoding" default:"pcm"`
	LanguageCode  string `json:"languageCode" yaml:"language_code" default:"en-US"`
	ReqChanSize   int    `json:"reqChanSize" yaml:"req_chan_size" default:"128"`
	VocabName     string `json:"vocabName" yaml:"vocab_name"`
	VocabMethod   string `json:"vocabMethod" yaml:"vocab_method"`
}

// GetVendor returns the vendor identifier.
func (opt *AWSASROption) GetVendor() base.Vendor {
	return base.VendorAWS
}

// NewAWSASROption creates a default AWSASROption.
func NewAWSASROption(accessKey, secretKey, region string) AWSASROption {
	if region == "" {
		region = "us-east-1"
	}
	return AWSASROption{
		AccessKey:     accessKey,
		SecretKey:     secretKey,
		Region:        region,
		SampleRate:    16000,
		AudioEncoding: "pcm",
		LanguageCode:  "en-US",
		ReqChanSize:   128,
	}
}

// NewAWSASR builds an AWS Transcribe ASR engine.
func NewAWSASR(opt AWSASROption) *AWSASR {
	if opt.ReqChanSize <= 0 {
		opt.ReqChanSize = 128
	}
	if opt.Region == "" {
		opt.Region = "us-east-1"
	}
	if opt.SampleRate <= 0 {
		opt.SampleRate = 16000
	}
	if opt.AudioEncoding == "" {
		opt.AudioEncoding = "pcm"
	}
	if opt.LanguageCode == "" {
		opt.LanguageCode = "en-US"
	}
	return &AWSASR{
		opt:        opt,
		audioQueue: make(chan []byte, 1024),
	}
}

func (a *AWSASR) Init(tr base.ResultFunc, er base.ErrorFunc) {
	a.tr = tr
	a.er = er
}

func (a *AWSASR) Vendor() string { return "aws" }

func (a *AWSASR) ConnAndReceive(dialogID string) error {
	a.mu.Lock()
	defer a.mu.Unlock()

	a.dialogID = dialogID
	now := time.Now()
	a.sendReqTime = &now
	a.endReqTime = nil
	a.sentence = ""

	ctx, cancel := context.WithCancel(context.Background())
	a.ctx = ctx
	a.cancel = cancel

	cfg, err := config.LoadDefaultConfig(ctx,
		config.WithRegion(a.opt.Region),
		config.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(a.opt.AccessKey, a.opt.SecretKey, "")),
	)
	if err != nil {
		return fmt.Errorf("aws asr: load config: %w", err)
	}

	client := transcribestreaming.NewFromConfig(cfg)

	mediaEncoding := types.MediaEncodingPcm
	if strings.ToLower(a.opt.AudioEncoding) == "ogg-opus" {
		mediaEncoding = types.MediaEncodingOggOpus
	} else if strings.ToLower(a.opt.AudioEncoding) == "flac" {
		mediaEncoding = types.MediaEncodingFlac
	}

	sampleRate := int32(a.opt.SampleRate)

	// StartStreamTranscription blocks until the stream is complete.
	// We run it in a goroutine and use the event stream for bidirectional communication.
	go func() {
		resp, err := client.StartStreamTranscription(ctx, &transcribestreaming.StartStreamTranscriptionInput{
			LanguageCode:         types.LanguageCode(a.opt.LanguageCode),
			MediaEncoding:        mediaEncoding,
			MediaSampleRateHertz: &sampleRate,
		})
		if err != nil {
			logger.Error("aws asr: start stream", logger.WithError(err))
			if a.er != nil {
				a.er(err, true)
			}
			return
		}

		stream := resp.GetStream()
		a.mu.Lock()
		a.eventStream = stream
		a.isStreaming = true
		a.mu.Unlock()

		// Start audio writer goroutine
		go a.handleAudioWrite(stream)

		// Process transcript events
		a.handleTranscriptEvents(stream)
	}()

	return nil
}

func (a *AWSASR) handleAudioWrite(stream *transcribestreaming.StartStreamTranscriptionEventStream) {
	for {
		select {
		case <-a.ctx.Done():
			return
		case data := <-a.audioQueue:
			if stream == nil {
				return
			}
			err := stream.Send(a.ctx, &types.AudioStreamMemberAudioEvent{
				Value: types.AudioEvent{AudioChunk: data},
			})
			if err != nil {
				logger.Error("aws asr: fail to send audio event", logger.WithError(err))
				if a.er != nil {
					a.er(err, false)
				}
				return
			}
		}
	}
}

func (a *AWSASR) handleTranscriptEvents(stream *transcribestreaming.StartStreamTranscriptionEventStream) {
	defer func() {
		a.mu.Lock()
		a.isStreaming = false
		a.mu.Unlock()
	}()

	if stream == nil {
		return
	}

	events := stream.Events()
	for {
		select {
		case <-a.ctx.Done():
			return
		case event, ok := <-events:
			if !ok {
				logger.Info("aws asr: event stream closed")
				return
			}

			if transEvent, ok := event.(*types.TranscriptResultStreamMemberTranscriptEvent); ok {
				if transEvent.Value.Transcript == nil {
					continue
				}
				for _, result := range transEvent.Value.Transcript.Results {
					if result.Alternatives == nil || len(result.Alternatives) == 0 {
						continue
					}
					text := ""
					if result.Alternatives[0].Transcript != nil {
						text = strings.TrimSpace(*result.Alternatives[0].Transcript)
					}
					if text == "" {
						continue
					}
					dur := time.Duration(0)
					if a.sendReqTime != nil {
						dur = time.Since(*a.sendReqTime)
					}
					if !result.IsPartial {
						a.sentence = text
						if a.tr != nil {
							a.tr(text, true, dur, a.dialogID)
						}
						a.sentence = ""
					} else {
						a.sentence = text
						if a.tr != nil {
							a.tr(text, false, dur, a.dialogID)
						}
					}
				}
			}
		}
	}
}

func (a *AWSASR) Activity() bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.isStreaming
}

func (a *AWSASR) RestartClient() {
	_ = a.StopConn()
	if err := a.ConnAndReceive(a.dialogID); err != nil {
		if a.er != nil {
			a.er(err, true)
		}
	}
}

func (a *AWSASR) SendAudioBytes(data []byte) error {
	if data == nil || len(data) == 0 {
		return nil
	}
	select {
	case a.audioQueue <- data:
		return nil
	case <-time.After(200 * time.Millisecond):
		return fmt.Errorf("aws asr: audio queue full")
	}
}

func (a *AWSASR) SendEnd() error {
	return nil
}

func (a *AWSASR) StopConn() error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.cancel != nil {
		a.cancel()
	}
	a.isStreaming = false
	if a.eventStream != nil {
		_ = a.eventStream.Close()
		a.eventStream = nil
	}
	return nil
}
