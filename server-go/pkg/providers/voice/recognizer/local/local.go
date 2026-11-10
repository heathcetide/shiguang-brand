// Package synthesizer implements the Local ASR adapter for ling-base.
// It supports local command-line ASR tools like whisper.cpp, vosk, etc.
package synthesizer

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common/logger"
	base "github.com/heathcetide/DietDigiDose/pkg/providers/voice/recognizer"
)

// Compile-time guard ensuring LocalASR implements base.Engine.
var _ base.Engine = (*LocalASR)(nil)

// LocalASR is the local command-line ASR engine.
type LocalASR struct {
	Handler interface{}

	sentence    string
	startTime   *time.Time
	endTime     *time.Time
	sendReqTime *time.Time
	endReqTime  *time.Time

	opt LocalASROption

	dialogID string

	tr base.ResultFunc
	er base.ErrorFunc

	mu sync.Mutex

	audioBuffer []byte
	tmpDir      string
}

// LocalASROption configures the local ASR engine.
type LocalASROption struct {
	Command     string `json:"command" yaml:"command"`
	Model       string `json:"model" yaml:"model"`
	Language    string `json:"language" yaml:"language" default:"en"`
	SampleRate  int    `json:"sampleRate" yaml:"sample_rate" default:"16000"`
	Format      string `json:"format" yaml:"format" default:"wav"`
	ReqChanSize int    `json:"reqChanSize" yaml:"req_chan_size" default:"128"`
}

// GetVendor returns the vendor identifier.
func (opt *LocalASROption) GetVendor() base.Vendor {
	return base.VendorLocal
}

// NewLocalASROption creates a default LocalASROption.
func NewLocalASROption(command string) LocalASROption {
	if command == "" {
		command = DetectLocalASRCommand()
	}
	return LocalASROption{
		Command:     command,
		Language:    "en",
		SampleRate:  16000,
		Format:      "wav",
		ReqChanSize: 128,
	}
}

// NewLocalASR builds a local ASR engine.
func NewLocalASR(opt LocalASROption) *LocalASR {
	if opt.Command == "" {
		opt.Command = DetectLocalASRCommand()
	}
	if opt.Language == "" {
		opt.Language = "en"
	}
	if opt.SampleRate <= 0 {
		opt.SampleRate = 16000
	}
	if opt.Format == "" {
		opt.Format = "wav"
	}
	return &LocalASR{
		opt: opt,
	}
}

func (l *LocalASR) Init(tr base.ResultFunc, er base.ErrorFunc) {
	l.tr = tr
	l.er = er
}

func (l *LocalASR) Vendor() string { return "local" }

func (l *LocalASR) ConnAndReceive(dialogID string) error {
	l.mu.Lock()
	defer l.mu.Unlock()

	l.dialogID = dialogID
	now := time.Now()
	l.sendReqTime = &now
	l.endReqTime = nil
	l.sentence = ""
	l.audioBuffer = make([]byte, 0)

	// Create temp directory
	tmpDir, err := os.MkdirTemp("", "local-asr-*")
	if err != nil {
		return fmt.Errorf("local asr: create temp dir: %w", err)
	}
	l.tmpDir = tmpDir

	return nil
}

func (l *LocalASR) Activity() bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.tmpDir != ""
}

func (l *LocalASR) RestartClient() {
	_ = l.StopConn()
	if err := l.ConnAndReceive(l.dialogID); err != nil {
		if l.er != nil {
			l.er(err, true)
		}
	}
}

func (l *LocalASR) SendAudioBytes(data []byte) error {
	if data == nil || len(data) == 0 {
		return nil
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	l.audioBuffer = append(l.audioBuffer, data...)
	return nil
}

func (l *LocalASR) SendEnd() error {
	l.mu.Lock()
	defer l.mu.Unlock()

	if len(l.audioBuffer) == 0 {
		return nil
	}

	// Write audio to temp file
	audioFile := filepath.Join(l.tmpDir, "audio."+l.opt.Format)
	if err := os.WriteFile(audioFile, l.audioBuffer, 0644); err != nil {
		return fmt.Errorf("local asr: write audio file: %w", err)
	}

	// Run ASR command
	text, err := l.runASRCommand(audioFile)
	if err != nil {
		if l.er != nil {
			l.er(err, false)
		}
		return err
	}

	text = strings.TrimSpace(text)
	if text != "" {
		dur := time.Duration(0)
		if l.sendReqTime != nil {
			dur = time.Since(*l.sendReqTime)
		}
		if l.tr != nil {
			l.tr(text, true, dur, l.dialogID)
		}
	}

	l.audioBuffer = l.audioBuffer[:0]
	return nil
}

func (l *LocalASR) StopConn() error {
	l.mu.Lock()
	defer l.mu.Unlock()

	if l.tmpDir != "" {
		_ = os.RemoveAll(l.tmpDir)
		l.tmpDir = ""
	}
	l.audioBuffer = nil
	return nil
}

func (l *LocalASR) runASRCommand(audioFile string) (string, error) {
	cmd := l.opt.Command
	if cmd == "" {
		return "", fmt.Errorf("local asr: no command configured")
	}

	parts := strings.Fields(cmd)
	if len(parts) == 0 {
		return "", fmt.Errorf("local asr: invalid command")
	}

	// Build command arguments
	args := parts[1:]
	args = append(args, audioFile)

	// Add model if specified
	if l.opt.Model != "" {
		args = append([]string{"-m", l.opt.Model}, args...)
	}

	// Add language if specified
	if l.opt.Language != "" {
		args = append([]string{"-l", l.opt.Language}, args...)
	}

	execCmd := exec.CommandContext(context.Background(), parts[0], args...)

	var stdout, stderr bytes.Buffer
	execCmd.Stdout = &stdout
	execCmd.Stderr = &stderr

	logger.Info("local asr: running command", logger.WithFields(map[string]interface{}{
		"command": parts[0],
		"args":    args,
	})...)

	if err := execCmd.Run(); err != nil {
		return "", fmt.Errorf("local asr: command failed: %w, stderr: %s", err, stderr.String())
	}

	return stdout.String(), nil
}

// DetectLocalASRCommand detects an available local ASR command.
func DetectLocalASRCommand() string {
	commands := []string{"whisper", "whisper-cpp", "vosk-transcriber", "deepspeech"}
	for _, cmd := range commands {
		if _, err := exec.LookPath(cmd); err == nil {
			return cmd
		}
	}
	return ""
}

// CheckLocalASRAvailable checks if a local ASR command is available.
func CheckLocalASRAvailable(command string) bool {
	if command == "" {
		return false
	}
	parts := strings.Fields(command)
	if len(parts) == 0 {
		return false
	}
	_, err := exec.LookPath(parts[0])
	return err == nil
}

// GetLocalASRInfo returns information about available local ASR tools.
func GetLocalASRInfo() map[string]bool {
	tools := []string{"whisper", "whisper-cpp", "vosk-transcriber", "deepspeech"}
	info := make(map[string]bool)
	for _, tool := range tools {
		_, err := exec.LookPath(tool)
		info[tool] = err == nil
	}
	return info
}
