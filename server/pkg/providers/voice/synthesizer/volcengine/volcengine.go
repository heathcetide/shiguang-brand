// Package synthesizer implements the Volcengine TTS adapter for ling-base.
package synthesizer

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"sync"

	"github.com/heathcetide/DietDigiDose/pkg/common/logger"
	base "github.com/heathcetide/DietDigiDose/pkg/providers/voice/synthesizer"
	"github.com/carlmjohnson/requests"
	"github.com/google/uuid"
)

const (
	SsmlSpeak = "<speak>"

	VolcengineCloneCluster = "volcano_icl"
	VolcengineLLMCluster   = "volcano_tts"
	optSubmit              = "submit"
	optQuery               = "query"
)

var defaultHeader = []byte{0x11, 0x10, 0x11, 0x00}

// VolcengineTTSServResponse 火山引擎TTS响应结构
type VolcengineTTSServResponse struct {
	ReqID     string       `json:"reqid"`
	Code      int          `json:"code"`
	Message   string       `json:"message"`
	Operation string       `json:"operation"`
	Sequence  int          `json:"sequence"`
	Data      string       `json:"data"`
	Addition  VolcAddition `json:"addition"`
}

// VolcAddition 火山引擎附加信息
type VolcAddition struct {
	Frontend string `json:"frontend"`
}

// VolcengineTTSOption 火山引擎标准TTS配置
type VolcengineTTSOption struct {
	AppID         string  `json:"appID"`
	AccessToken   string  `json:"accessToken"`
	Cluster       string  `json:"cluster"`
	VoiceType     string  `json:"voiceType"`
	Rate          int     `json:"rate"`
	Encoding      string  `json:"encoding"`
	SpeedRatio    float32 `json:"speedRatio"`
	VolumeRatio   float32 `json:"volumeRatio"`
	PitchRatio    float32 `json:"pitchRatio"`
	Channels      int     `json:"channels"`
	BitDepth      int     `json:"bitDepth"`
	FrameDuration string  `json:"frameDuration"`
	TextType      string  `json:"textType"`
	Ssml          bool    `json:"ssml"`
	Streaming     bool    `json:"streaming"`
}

// GetProvider returns the TTS provider type
func (c *VolcengineTTSOption) GetProvider() base.Provider {
	return base.ProviderVolcengine
}

// VolcengineService 火山引擎标准TTS服务
type VolcengineService struct {
	opt  VolcengineTTSOption
	mu   sync.Mutex
	pool *volcWSPool
}

// NewVolcengineTTSOption 创建火山引擎TTS配置
func NewVolcengineTTSOption(appID, accessToken, cluster string) VolcengineTTSOption {
	return VolcengineTTSOption{
		AppID:         appID,
		AccessToken:   accessToken,
		Cluster:       cluster,
		VoiceType:     "BV700_streaming",
		Rate:          16000,
		Encoding:      "pcm",
		SpeedRatio:    1.0,
		VolumeRatio:   1.0,
		PitchRatio:    1.0,
		Channels:      1,
		BitDepth:      16,
		FrameDuration: "20ms",
		TextType:      "plain",
		Ssml:          false,
		Streaming:     true,
	}
}

// NewVolcengineService 创建火山引擎TTS服务
func NewVolcengineService(opt VolcengineTTSOption) *VolcengineService {
	return &VolcengineService{
		opt:  opt,
		pool: newVolcWSPool(opt.AccessToken),
	}
}

func (v *VolcengineService) Provider() base.Provider {
	return base.ProviderVolcengine
}

func (v *VolcengineService) Format() base.StreamFormat {
	v.mu.Lock()
	defer v.mu.Unlock()
	return base.StreamFormat{
		SampleRate:    v.opt.Rate,
		BitDepth:      v.opt.BitDepth,
		Channels:      v.opt.Channels,
		Codec:         v.opt.Encoding,
		FrameDuration: base.NormalizeFramePeriod(v.opt.FrameDuration),
	}
}

func (v *VolcengineService) CacheKey(text string) string {
	v.mu.Lock()
	defer v.mu.Unlock()
	speedRatio := int(v.opt.SpeedRatio * 100)
	return fmt.Sprintf("volcengine.tts-%s-%s-%d-%d-%s.pcm", v.opt.VoiceType, v.opt.Encoding, v.opt.Rate, speedRatio, base.HashText(text))
}

func (v *VolcengineService) Capabilities() base.Capabilities {
	v.mu.Lock()
	streaming := v.opt.Streaming
	v.mu.Unlock()
	if streaming {
		return base.StreamingCapabilities()
	}
	return base.DefaultCapabilities()
}

func (v *VolcengineService) Synthesize(ctx context.Context, handler base.Handler, text string) error {
	v.mu.Lock()
	opt := v.opt
	pool := v.pool
	if pool == nil && strings.TrimSpace(opt.AccessToken) != "" {
		v.pool = newVolcWSPool(opt.AccessToken)
		pool = v.pool
	}
	v.mu.Unlock()

	ttsReq := &volcengineSpeechSynthesisListener{handler: handler, pool: pool}
	if text == "" {
		handler.OnMessage(make([]byte, 0))
		return nil
	}

	if opt.Streaming {
		ts, err := ttsReq.sendStreamRequest(ctx, opt, text)
		if err == nil {
			if len(ts.Words) > 0 {
				handler.OnTimestamp(ts)
			}
			return nil
		}
		if errors.Is(err, context.Canceled) {
			logger.Warn("volcengine tts: context canceled", logger.WithFields(map[string]interface{}{"text": text})...)
			return nil
		}
		logger.Warn("volcengine tts: websocket failed, falling back to http", logger.WithError(err))
	}

	dataBytes, timestamp, err := ttsReq.sendRequest(ctx, opt, text)
	if err != nil {
		if errors.Is(err, context.Canceled) {
			logger.Warn("volcengine tts: context canceled", logger.WithFields(map[string]interface{}{"text": text})...)
			return nil
		}
		return err
	}

	if len(dataBytes) == 0 {
		logger.Warn("volcengine tts: received empty audio data", logger.WithFields(map[string]interface{}{"text": text})...)
	} else {
		logger.Info("volcengine tts: received audio data", logger.WithFields(map[string]interface{}{
			"text":      text,
			"audioSize": len(dataBytes),
		})...)
	}

	emitCfg := base.PCMEmitConfigFromFormat(v.Format())
	if err := base.EmitPCMChunks(ctx, handler, dataBytes, emitCfg); err != nil {
		return err
	}
	handler.OnTimestamp(timestamp)
	return nil
}

func (v *VolcengineService) Close() error {
	v.mu.Lock()
	pool := v.pool
	v.pool = nil
	v.mu.Unlock()
	if pool != nil {
		pool.Close()
	}
	return nil
}

// Prewarm dials a Volcengine TTS WebSocket in the background.
func (v *VolcengineService) Prewarm(_ context.Context) {
	if v == nil {
		return
	}
	v.mu.Lock()
	pool := v.pool
	v.mu.Unlock()
	if pool != nil {
		pool.Prewarm()
	}
}

type volcengineSpeechSynthesisListener struct {
	handler base.Handler
	pool    *volcWSPool
}

func (v *volcengineSpeechSynthesisListener) sendRequest(ctx context.Context, opt VolcengineTTSOption, text string) ([]byte, base.SentenceTimestamp, error) {
	reqID := uuid.NewString()
	params := make(map[string]map[string]interface{})
	params["app"] = make(map[string]interface{})
	params["app"]["appid"] = opt.AppID
	params["app"]["token"] = "access_token"
	params["app"]["cluster"] = opt.Cluster

	params["user"] = make(map[string]interface{})
	params["user"]["uid"] = "uid"

	params["audio"] = make(map[string]interface{})
	params["audio"]["voice_type"] = opt.VoiceType
	params["audio"]["encoding"] = opt.Encoding
	params["audio"]["speed_ratio"] = opt.SpeedRatio
	params["audio"]["volume_ratio"] = opt.VolumeRatio
	params["audio"]["pitch_ratio"] = opt.PitchRatio

	if opt.Rate > 0 {
		params["audio"]["rate"] = opt.Rate
	}

	params["request"] = make(map[string]interface{})
	params["request"]["reqid"] = reqID
	params["request"]["text"] = text
	if strings.HasPrefix(text, SsmlSpeak) {
		params["request"]["text_type"] = "ssml"
	} else {
		params["request"]["text_type"] = "plain"
	}
	params["request"]["operation"] = optQuery
	params["request"]["with_timestamp"] = "1"

	url := "https://openspeech.bytedance.com/api/v1/tts"

	paramsJSON, _ := json.Marshal(params)
	tokenLog := safeTokenPrefix(opt.AccessToken, 10)
	logger.Info("volcengine tts: sending request", logger.WithFields(map[string]interface{}{
		"url":           url,
		"appID":         opt.AppID,
		"cluster":       opt.Cluster,
		"voiceType":     opt.VoiceType,
		"accessToken":   tokenLog,
		"requestParams": string(paramsJSON),
	})...)

	var resp VolcengineTTSServResponse
	if err := requests.URL(url).BodyJSON(&params).
		Header("Content-Type", "application/json").
		Header("Authorization", fmt.Sprintf("Bearer;%s", opt.AccessToken)).
		ToJSON(&resp).Fetch(ctx); err != nil {
		if !strings.Contains(err.Error(), "context canceled") {
			logger.Error("volcengine tts: send request failed", append(logger.WithFields(map[string]interface{}{
				"params": params,
			}), logger.WithError(err))...)
		}
		return nil, base.SentenceTimestamp{}, err
	}

	dataBytes, err := base64.StdEncoding.DecodeString(resp.Data)
	if err != nil {
		logger.Error("volcengine tts: decode string failed", append(logger.WithFields(map[string]interface{}{
			"params":      params,
			"respCode":    resp.Code,
			"respMessage": resp.Message,
		}), logger.WithError(err))...)
		return nil, base.SentenceTimestamp{}, err
	}

	if resp.Code != 3000 {
		logger.Error("volcengine tts: api error", logger.WithFields(map[string]interface{}{
			"code":          resp.Code,
			"message":       resp.Message,
			"dataLength":    len(resp.Data),
			"decodedLength": len(dataBytes),
		})...)
		return nil, base.SentenceTimestamp{}, fmt.Errorf("volcengine tts error: code=%d, message=%s", resp.Code, resp.Message)
	}

	logger.Info("volcengine tts: synthesis success", logger.WithFields(map[string]interface{}{
		"reqID":         reqID,
		"text":          text,
		"audioDataSize": len(dataBytes),
		"respCode":      resp.Code,
	})...)

	var timestamp base.SentenceTimestamp
	if resp.Addition.Frontend != "" {
		err = json.Unmarshal([]byte(resp.Addition.Frontend), &timestamp)
		if err != nil {
			logger.Error("volcengine tts: decoding timestamp failed", logger.WithError(err))
		}
	}
	return dataBytes, timestamp, nil
}

// safeTokenPrefix returns the first n chars of token followed by "..." without
// panicking on short tokens.
func safeTokenPrefix(token string, n int) string {
	if token == "" {
		return ""
	}
	if len(token) <= n {
		return strings.Repeat("*", len(token))
	}
	return token[:n] + "..."
}

// gzipCompress 压缩数据
func gzipCompress(input []byte) []byte {
	var b bytes.Buffer
	w := gzip.NewWriter(&b)
	_, _ = w.Write(input)
	_ = w.Close()
	return b.Bytes()
}

// gzipDecompress 解压数据
func gzipDecompress(input []byte) ([]byte, error) {
	b := bytes.NewBuffer(input)
	r, err := gzip.NewReader(b)
	if err != nil {
		return nil, err
	}
	defer r.Close()
	out, err := io.ReadAll(r)
	if err != nil {
		return nil, err
	}
	return out, nil
}

// Compile-time guard.
var _ base.Engine = (*VolcengineService)(nil)
var _ base.CapableEngine = (*VolcengineService)(nil)
