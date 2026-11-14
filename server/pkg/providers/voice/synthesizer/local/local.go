// Package synthesizer provides local (command-line) text-to-speech adapters
// that wrap system TTS tools such as say, espeak, festival and pico2wave.
//
// This is the local adapter submodule of github.com/LingByte/ling-base/synthesizer.
// It depends on the provider-agnostic core package (imported as `base`) for the
// Engine interface, StreamFormat and helper utilities.
package synthesizer

// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: AGPL-3.0

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common/logger"
	base "github.com/heathcetide/DietDigiDose/pkg/providers/voice/synthesizer"
)

// Compile-time guards ensuring both services satisfy the base Engine interface.
var (
	_ base.Engine = (*LocalService)(nil)
	_ base.Engine = (*LocalGoSpeechService)(nil)
)

// -----------------------------------------------------------------------------
// LocalService (simple command-line TTS: say / espeak / festival / generic)
// -----------------------------------------------------------------------------

// LocalTTSConfig 本地TTS配置
type LocalTTSConfig struct {
	Command       string `json:"command" yaml:"command" default:"say"`           // TTS 命令（如 say, festival, espeak）
	Voice         string `json:"voice" yaml:"voice" default:""`                  // 音色（可选）
	SampleRate    int    `json:"sample_rate" yaml:"sample_rate" default:"16000"` // 采样率
	Channels      int    `json:"channels" yaml:"channels" default:"1"`           // 声道数
	BitDepth      int    `json:"bit_depth" yaml:"bit_depth" default:"16"`        // 位深度
	Codec         string `json:"codec" yaml:"codec" default:"wav"`               // 音频编解码器
	FrameDuration string `json:"frame_duration" yaml:"frame_duration" default:"20ms"`
	OutputDir     string `json:"output_dir" yaml:"output_dir" default:"/tmp"` // 输出目录
}

// GetProvider returns the TTS provider type.
func (c *LocalTTSConfig) GetProvider() base.Provider {
	return base.ProviderLocal
}

// LocalService 本地TTS服务
type LocalService struct {
	opt LocalTTSConfig
	mu  sync.Mutex // 保护 opt 的并发访问
}

// NewLocalTTSConfig 创建本地TTS配置
func NewLocalTTSConfig(command string) LocalTTSConfig {
	opt := LocalTTSConfig{
		Command:       command,
		Voice:         "",
		SampleRate:    16000,
		Channels:      1,
		BitDepth:      16,
		Codec:         "wav",
		FrameDuration: "20ms",
		OutputDir:     "/tmp",
	}

	if opt.Command == "" {
		// 根据操作系统选择默认命令
		if _, err := exec.LookPath("say"); err == nil {
			opt.Command = "say" // macOS
		} else if _, err := exec.LookPath("espeak"); err == nil {
			opt.Command = "espeak" // Linux/Unix
		} else if _, err := exec.LookPath("festival"); err == nil {
			opt.Command = "festival" // Linux
		}
	}

	return opt
}

// NewLocalService 创建本地TTS服务
func NewLocalService(opt LocalTTSConfig) *LocalService {
	return &LocalService{
		opt: opt,
	}
}

// Provider 返回提供商
func (ls *LocalService) Provider() base.Provider {
	return base.ProviderLocal
}

// Format 返回音频格式
func (ls *LocalService) Format() base.StreamFormat {
	ls.mu.Lock()
	defer ls.mu.Unlock()
	return base.StreamFormat{
		SampleRate:    ls.opt.SampleRate,
		BitDepth:      ls.opt.BitDepth,
		Channels:      ls.opt.Channels,
		Codec:         ls.opt.Codec,
		FrameDuration: base.NormalizeFramePeriod(ls.opt.FrameDuration),
	}
}

// CacheKey 生成缓存键
func (ls *LocalService) CacheKey(text string) string {
	ls.mu.Lock()
	defer ls.mu.Unlock()
	digest := base.HashText(text)
	return fmt.Sprintf("local.tts-%s-%d-%s.%s", ls.opt.Command, ls.opt.SampleRate, digest, ls.opt.Codec)
}

// Synthesize 合成语音
func (ls *LocalService) Synthesize(ctx context.Context, handler base.Handler, text string) error {
	ls.mu.Lock()
	opt := ls.opt
	ls.mu.Unlock()

	// 检查命令是否存在
	cmdPath, err := exec.LookPath(opt.Command)
	if err != nil {
		return fmt.Errorf("TTS command not found: %s, please install a TTS tool", opt.Command)
	}

	logger.Info("local tts: starting synthesis", logger.WithFields(map[string]interface{}{
		"command": cmdPath,
		"text":    text,
	})...)

	// 根据不同的命令构建不同的参数
	audioData, err := ls.synthesizeWithCommand(ctx, text, cmdPath, opt)
	if err != nil {
		return fmt.Errorf("synthesis failed: %w", err)
	}

	// 发送音频数据到 handler
	if len(audioData) > 0 {
		handler.OnMessage(audioData)
	} else {
		// 如果没有音频数据，返回一个占位符
		return fmt.Errorf("no audio data generated")
	}

	logger.Info("local tts: synthesis completed", logger.WithFields(map[string]interface{}{
		"provider":   "local",
		"text":       text,
		"audio_size": len(audioData),
	})...)

	return nil
}

// synthesizeWithCommand 使用命令进行合成
func (ls *LocalService) synthesizeWithCommand(ctx context.Context, text, cmdPath string, opt LocalTTSConfig) ([]byte, error) {
	switch opt.Command {
	case "say":
		return ls.synthesizeWithSay(ctx, text, cmdPath, opt)
	case "espeak":
		return ls.synthesizeWithEspeak(ctx, text, cmdPath, opt)
	case "festival":
		return ls.synthesizeWithFestival(ctx, text, cmdPath, opt)
	default:
		// 尝试通用方法
		return ls.synthesizeGeneric(ctx, text, cmdPath, opt)
	}
}

// synthesizeWithSay 使用 macOS say 命令合成
func (ls *LocalService) synthesizeWithSay(ctx context.Context, text, cmdPath string, opt LocalTTSConfig) ([]byte, error) {
	// macOS say 命令无法直接输出音频文件，这里返回占位符
	// 在实际应用中，可能需要使用 afconvert 或其他工具
	logger.Warn("macOS say command cannot output audio directly, using placeholder")

	// 返回一个占位符音频数据（静音）
	// 实际应用中需要使用更复杂的实现
	duration := 2.0 // 估算2秒音频
	bytesPerSecond := opt.SampleRate * opt.Channels * (opt.BitDepth / 8)
	numBytes := int(float64(bytesPerSecond) * duration)
	audioData := make([]byte, numBytes)

	return audioData, nil
}

// synthesizeWithEspeak 使用 espeak 命令合成
func (ls *LocalService) synthesizeWithEspeak(ctx context.Context, text, cmdPath string, opt LocalTTSConfig) ([]byte, error) {
	// 构建 espeak 命令
	// espeak -s 160 --stdout "text" > output.wav
	cmd := exec.CommandContext(ctx, cmdPath, "-s", fmt.Sprintf("%d", opt.SampleRate), "--stdout", text)

	var stdout bytes.Buffer
	cmd.Stdout = &stdout

	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("espeak execution failed: %w", err)
	}

	return stdout.Bytes(), nil
}

// synthesizeWithFestival 使用 festival 命令合成
func (ls *LocalService) synthesizeWithFestival(ctx context.Context, text, cmdPath string, opt LocalTTSConfig) ([]byte, error) {
	// Festival 需要通过交互式输入或脚本
	// 这里使用简化实现
	festivalScript := fmt.Sprintf("(SayText \"%s\")", text)

	cmd := exec.CommandContext(ctx, cmdPath, "-b", "-")
	cmd.Stdin = bytes.NewReader([]byte(festivalScript))

	var stdout bytes.Buffer
	cmd.Stdout = &stdout

	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("festival execution failed: %w", err)
	}

	return stdout.Bytes(), nil
}

// synthesizeGeneric 通用合成方法
func (ls *LocalService) synthesizeGeneric(ctx context.Context, text, cmdPath string, opt LocalTTSConfig) ([]byte, error) {
	// 对于其他命令，尝试直接执行
	cmd := exec.CommandContext(ctx, cmdPath, text)

	var stdout bytes.Buffer
	cmd.Stdout = &stdout

	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("command execution failed: %w", err)
	}

	return stdout.Bytes(), nil
}

// Close 释放资源
func (ls *LocalService) Close() error {
	return nil
}

// CheckLocalTTSAvailable 检查本地是否安装了 TTS 工具
func CheckLocalTTSAvailable() []string {
	var available []string

	commands := []string{"say", "espeak", "festival"}
	for _, cmd := range commands {
		if _, err := exec.LookPath(cmd); err == nil {
			available = append(available, cmd)
		}
	}

	return available
}

// DetectLocalTTSCommand 自动检测可用的本地 TTS 命令
func DetectLocalTTSCommand() string {
	available := CheckLocalTTSAvailable()
	if len(available) > 0 {
		return available[0]
	}
	return ""
}

// GetLocalTTSInfo 获取本地 TTS 信息
func GetLocalTTSInfo() map[string]interface{} {
	available := CheckLocalTTSAvailable()
	detected := DetectLocalTTSCommand()

	return map[string]interface{}{
		"available": available,
		"detected":  detected,
		"os":        os.Getenv("OS"),
		"platform":  "unknown",
	}
}

// -----------------------------------------------------------------------------
// LocalGoSpeechService (richer local TTS with provider-specific options)
// -----------------------------------------------------------------------------

// LocalGoSpeechProvider 本地TTS提供商类型
type LocalGoSpeechProvider string

const (
	LocalGoSpeechProviderEspeak   LocalGoSpeechProvider = "espeak"
	LocalGoSpeechProviderSay      LocalGoSpeechProvider = "say"
	LocalGoSpeechProviderFestival LocalGoSpeechProvider = "festival"
	LocalGoSpeechProviderPico     LocalGoSpeechProvider = "pico"
)

// LocalGoSpeechConfig 本地TTS配置
type LocalGoSpeechConfig struct {
	Provider    LocalGoSpeechProvider `json:"provider"`    // TTS提供商
	ModelPath   string                `json:"modelPath"`   // 模型文件路径（可选）
	Language    string                `json:"language"`    // 语言代码
	Speaker     string                `json:"speaker"`     // 发音人
	SampleRate  int                   `json:"sampleRate"`  // 采样率
	Channels    int                   `json:"channels"`    // 声道数
	BitDepth    int                   `json:"bitDepth"`    // 位深度
	Speed       float32               `json:"speed"`       // 语速
	Pitch       float32               `json:"pitch"`       // 音调
	Volume      float32               `json:"volume"`      // 音量
	EnableCache bool                  `json:"enableCache"` // 是否启用缓存
	CacheExpiry time.Duration         `json:"cacheExpiry"` // 缓存过期时间
	Command     string                `json:"command"`     // 自定义命令
	OutputDir   string                `json:"outputDir"`   // 输出目录
}

// GetProvider returns the TTS provider type.
func (c *LocalGoSpeechConfig) GetProvider() base.Provider {
	return base.ProviderLocalGoSpeech
}

// NewLocalGoSpeechConfig 创建默认本地TTS配置
func NewLocalGoSpeechConfig(provider LocalGoSpeechProvider, modelPath string) *LocalGoSpeechConfig {
	return &LocalGoSpeechConfig{
		Provider:    provider,
		ModelPath:   modelPath,
		Language:    "zh-CN",
		Speaker:     "default",
		SampleRate:  16000,
		Channels:    1,
		BitDepth:    16,
		Speed:       1.0,
		Pitch:       1.0,
		Volume:      1.0,
		EnableCache: true,
		CacheExpiry: 24 * time.Hour,
		OutputDir:   "/tmp",
	}
}

// LocalGoSpeechService 本地TTS服务
type LocalGoSpeechService struct {
	config *LocalGoSpeechConfig
	mu     sync.RWMutex
	closed bool
}

// NewLocalGoSpeechService 创建本地TTS服务
func NewLocalGoSpeechService(config *LocalGoSpeechConfig) (*LocalGoSpeechService, error) {
	if config == nil {
		return nil, fmt.Errorf("配置不能为空")
	}

	service := &LocalGoSpeechService{
		config: config,
	}

	// 验证命令是否可用
	if err := service.validateCommand(); err != nil {
		return nil, fmt.Errorf("验证TTS命令失败: %w", err)
	}

	return service, nil
}

// validateCommand 验证TTS命令是否可用
func (s *LocalGoSpeechService) validateCommand() error {
	var cmd string

	switch s.config.Provider {
	case LocalGoSpeechProviderEspeak:
		cmd = "espeak"
	case LocalGoSpeechProviderSay:
		cmd = "say"
	case LocalGoSpeechProviderFestival:
		cmd = "festival"
	case LocalGoSpeechProviderPico:
		cmd = "pico2wave"
	default:
		if s.config.Command != "" {
			cmd = s.config.Command
		} else {
			return fmt.Errorf("不支持的TTS提供商: %s", s.config.Provider)
		}
	}

	// 检查命令是否存在
	_, err := exec.LookPath(cmd)
	if err != nil {
		return fmt.Errorf("TTS命令 '%s' 不可用: %w", cmd, err)
	}

	return nil
}

// Provider 返回提供商
func (s *LocalGoSpeechService) Provider() base.Provider {
	return base.Provider(fmt.Sprintf("local-gospeech-%s", s.config.Provider))
}

// Format 返回音频格式
func (s *LocalGoSpeechService) Format() base.StreamFormat {
	return base.StreamFormat{
		SampleRate:    s.config.SampleRate,
		Channels:      s.config.Channels,
		BitDepth:      s.config.BitDepth,
		FrameDuration: 20 * time.Millisecond, // 20ms帧
	}
}

// CacheKey 生成缓存键
func (s *LocalGoSpeechService) CacheKey(text string) string {
	if !s.config.EnableCache {
		return ""
	}

	return fmt.Sprintf("local-gospeech-%s-%s-%s-%f-%f-%f-%s",
		s.config.Provider,
		s.config.Language,
		s.config.Speaker,
		s.config.Speed,
		s.config.Pitch,
		s.config.Volume,
		base.HashText(text),
	)
}

// Synthesize 合成语音
func (s *LocalGoSpeechService) Synthesize(ctx context.Context, handler base.Handler, text string) error {
	s.mu.RLock()
	closed := s.closed
	s.mu.RUnlock()

	if closed {
		return fmt.Errorf("TTS服务已关闭")
	}

	if text == "" {
		return fmt.Errorf("文本不能为空")
	}

	logger.Info("开始本地TTS合成", logger.WithFields(map[string]interface{}{
		"provider": s.config.Provider,
		"language": s.config.Language,
		"speaker":  s.config.Speaker,
		"text":     text,
	})...)

	startTime := time.Now()

	var audioData []byte
	var err error

	switch s.config.Provider {
	case LocalGoSpeechProviderEspeak:
		audioData, err = s.synthesizeWithEspeak(ctx, text)
	case LocalGoSpeechProviderSay:
		audioData, err = s.synthesizeWithSay(ctx, text)
	case LocalGoSpeechProviderFestival:
		audioData, err = s.synthesizeWithFestival(ctx, text)
	case LocalGoSpeechProviderPico:
		audioData, err = s.synthesizeWithPico(ctx, text)
	default:
		if s.config.Command != "" {
			audioData, err = s.synthesizeWithCustomCommand(ctx, text)
		} else {
			err = fmt.Errorf("不支持的TTS提供商: %s", s.config.Provider)
		}
	}

	if err != nil {
		logger.Error("本地TTS合成失败", logger.WithError(err))
		return err
	}

	duration := time.Since(startTime)
	logger.Info("本地TTS合成完成", logger.WithFields(map[string]interface{}{
		"provider": s.config.Provider,
		"text":     text,
		"duration": duration,
		"size":     len(audioData),
	})...)

	// 检查上下文是否已取消
	select {
	case <-ctx.Done():
		return ctx.Err()
	default:
	}

	// 分块发送音频数据
	chunkSize := s.config.SampleRate * s.config.BitDepth / 8 * s.config.Channels * 20 / 1000 // 20ms
	if chunkSize <= 0 {
		chunkSize = 1024 // 默认1KB
	}

	for i := 0; i < len(audioData); i += chunkSize {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		end := i + chunkSize
		if end > len(audioData) {
			end = len(audioData)
		}

		chunk := audioData[i:end]
		handler.OnMessage(chunk)

		// 模拟实时播放延迟
		if s.config.SampleRate > 0 && s.config.BitDepth > 0 && s.config.Channels > 0 {
			chunkDuration := time.Duration(len(chunk)*1000/(s.config.SampleRate*s.config.BitDepth/8*s.config.Channels)) * time.Millisecond
			time.Sleep(chunkDuration / 10) // 10倍速发送，避免过慢
		}
	}

	return nil
}

// synthesizeWithEspeak 使用 espeak 合成语音
func (s *LocalGoSpeechService) synthesizeWithEspeak(ctx context.Context, text string) ([]byte, error) {
	outputFile := filepath.Join(s.config.OutputDir, fmt.Sprintf("tts_%d.wav", time.Now().UnixNano()))
	defer os.Remove(outputFile)

	args := []string{
		"-w", outputFile,
		"-s", fmt.Sprintf("%.0f", s.config.Speed*175), // espeak 默认速度是 175 wpm
		"-p", fmt.Sprintf("%.0f", s.config.Pitch*50), // espeak 音调范围 0-99
		"-a", fmt.Sprintf("%.0f", s.config.Volume*200), // espeak 音量范围 0-200
	}

	// 添加语言参数
	if s.config.Language != "" {
		lang := s.convertLanguageCode(s.config.Language)
		args = append(args, "-v", lang)
	}

	args = append(args, text)

	cmd := exec.CommandContext(ctx, "espeak", args...)
	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("espeak 执行失败: %w", err)
	}

	return os.ReadFile(outputFile)
}

// synthesizeWithSay 使用 macOS say 命令合成语音
func (s *LocalGoSpeechService) synthesizeWithSay(ctx context.Context, text string) ([]byte, error) {
	outputFile := filepath.Join(s.config.OutputDir, fmt.Sprintf("tts_%d.aiff", time.Now().UnixNano()))
	defer os.Remove(outputFile)

	args := []string{
		"-o", outputFile,
		"-r", fmt.Sprintf("%.0f", s.config.Speed*200), // say 默认速度约 200 wpm
	}

	// 添加语音参数
	if s.config.Speaker != "" && s.config.Speaker != "default" {
		args = append(args, "-v", s.config.Speaker)
	}

	args = append(args, text)

	cmd := exec.CommandContext(ctx, "say", args...)
	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("say 执行失败: %w", err)
	}

	return os.ReadFile(outputFile)
}

// synthesizeWithFestival 使用 Festival 合成语音
func (s *LocalGoSpeechService) synthesizeWithFestival(ctx context.Context, text string) ([]byte, error) {
	outputFile := filepath.Join(s.config.OutputDir, fmt.Sprintf("tts_%d.wav", time.Now().UnixNano()))
	defer os.Remove(outputFile)

	// 创建 Festival 脚本
	script := fmt.Sprintf(`(voice_%s)
(Parameter.set 'Duration_Stretch %.2f)
(SayText "%s")
(utt.save.wave (utt.synth (Utterance Text "%s")) "%s")`,
		s.config.Speaker,
		1.0/s.config.Speed,
		text,
		text,
		outputFile)

	cmd := exec.CommandContext(ctx, "festival", "--batch", script)
	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("festival 执行失败: %w", err)
	}

	return os.ReadFile(outputFile)
}

// synthesizeWithPico 使用 Pico TTS 合成语音
func (s *LocalGoSpeechService) synthesizeWithPico(ctx context.Context, text string) ([]byte, error) {
	outputFile := filepath.Join(s.config.OutputDir, fmt.Sprintf("tts_%d.wav", time.Now().UnixNano()))
	defer os.Remove(outputFile)

	lang := s.convertLanguageCode(s.config.Language)

	cmd := exec.CommandContext(ctx, "pico2wave", "-l", lang, "-w", outputFile, text)
	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("pico2wave 执行失败: %w", err)
	}

	return os.ReadFile(outputFile)
}

// synthesizeWithCustomCommand 使用自定义命令合成语音
func (s *LocalGoSpeechService) synthesizeWithCustomCommand(ctx context.Context, text string) ([]byte, error) {
	outputFile := filepath.Join(s.config.OutputDir, fmt.Sprintf("tts_%d.wav", time.Now().UnixNano()))
	defer os.Remove(outputFile)

	// 替换占位符
	command := s.config.Command
	command = fmt.Sprintf(command, text, outputFile)

	cmd := exec.CommandContext(ctx, "sh", "-c", command)
	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("自定义命令执行失败: %w", err)
	}

	return os.ReadFile(outputFile)
}

// convertLanguageCode 转换语言代码
func (s *LocalGoSpeechService) convertLanguageCode(lang string) string {
	switch lang {
	case "zh-CN", "zh":
		return "zh"
	case "en-US", "en":
		return "en"
	case "ja-JP", "ja":
		return "ja"
	case "ko-KR", "ko":
		return "ko"
	default:
		return "en"
	}
}

// Close 关闭服务
func (s *LocalGoSpeechService) Close() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.closed {
		return nil
	}

	s.closed = true
	logger.Info("本地TTS服务已关闭")
	return nil
}

// UpdateConfig 更新配置
func (s *LocalGoSpeechService) UpdateConfig(config *LocalGoSpeechConfig) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.closed {
		return fmt.Errorf("服务已关闭")
	}

	s.config = config
	return s.validateCommand()
}

// GetConfig 获取配置
func (s *LocalGoSpeechService) GetConfig() *LocalGoSpeechConfig {
	s.mu.RLock()
	defer s.mu.RUnlock()

	// 返回配置的副本
	config := *s.config
	return &config
}

// IsReady 检查服务是否就绪
func (s *LocalGoSpeechService) IsReady() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()

	return !s.closed
}

// GetSupportedLanguages 获取支持的语言列表
func (s *LocalGoSpeechService) GetSupportedLanguages() []string {
	switch s.config.Provider {
	case LocalGoSpeechProviderEspeak:
		return []string{"zh-CN", "en-US", "ja-JP", "ko-KR", "fr-FR", "de-DE", "es-ES"}
	case LocalGoSpeechProviderSay:
		return []string{"en-US", "zh-CN", "ja-JP"}
	case LocalGoSpeechProviderFestival:
		return []string{"en-US", "en-GB"}
	case LocalGoSpeechProviderPico:
		return []string{"en-US", "en-GB", "de-DE", "es-ES", "fr-FR", "it-IT"}
	default:
		return []string{"zh-CN", "en-US"}
	}
}

// GetSupportedSpeakers 获取支持的发音人列表
func (s *LocalGoSpeechService) GetSupportedSpeakers() []string {
	switch s.config.Provider {
	case LocalGoSpeechProviderSay:
		return []string{"Alex", "Samantha", "Victoria", "Daniel", "Karen", "Moira", "Rishi", "Tessa", "Veena", "Yuri"}
	case LocalGoSpeechProviderFestival:
		return []string{"kal_diphone", "rab_diphone", "don_diphone"}
	default:
		return []string{"default"}
	}
}
