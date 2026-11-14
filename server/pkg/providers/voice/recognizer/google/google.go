// Package synthesizer implements the Google Cloud Speech-to-Text ASR adapter for ling-base.
package synthesizer

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common/logger"
	"github.com/heathcetide/DietDigiDose/pkg/common/netutil"
	base "github.com/heathcetide/DietDigiDose/pkg/providers/voice/recognizer"
	"github.com/google/uuid"
)

// Compile-time guard ensuring GoogleASR implements base.Engine.
var _ base.Engine = (*GoogleASR)(nil)

// GoogleASR is the Google Cloud Speech-to-Text streaming ASR engine.
// It uses the REST streamingRecognize endpoint over HTTP/2.
type GoogleASR struct {
	Handler interface{}

	sentence    string
	startTime   *time.Time
	endTime     *time.Time
	sendReqTime *time.Time
	endReqTime  *time.Time

	opt GoogleASROption

	ctx    context.Context
	cancel context.CancelFunc

	dialogID string

	tr base.ResultFunc
	er base.ErrorFunc

	isStreaming bool
	mu          sync.Mutex

	audioQueue chan []byte
}

// GoogleASROption configures the Google ASR engine.
type GoogleASROption struct {
	CredentialsJSON string `json:"credentialsJson" yaml:"credentials_json"`
	AccessToken     string `json:"accessToken" yaml:"access_token"`
	LanguageCode    string `json:"languageCode" yaml:"language_code" default:"en-US"`
	SampleRate      int    `json:"sampleRate" yaml:"sample_rate" default:"16000"`
	Encoding        string `json:"encoding" yaml:"encoding" default:"LINEAR16"`
	Model           string `json:"model" yaml:"model" default:"latest_long"`
	ReqChanSize     int    `json:"reqChanSize" yaml:"req_chan_size" default:"128"`
}

// GetVendor returns the vendor identifier.
func (opt *GoogleASROption) GetVendor() base.Vendor {
	return base.VendorGoogle
}

// NewGoogleASROption creates a default GoogleASROption.
func NewGoogleASROption(credentialsJSON string) GoogleASROption {
	return GoogleASROption{
		CredentialsJSON: credentialsJSON,
		LanguageCode:    "en-US",
		SampleRate:      16000,
		Encoding:        "LINEAR16",
		Model:           "latest_long",
		ReqChanSize:     128,
	}
}

// NewGoogleASR builds a Google ASR engine.
func NewGoogleASR(opt GoogleASROption) *GoogleASR {
	if opt.ReqChanSize <= 0 {
		opt.ReqChanSize = 128
	}
	if opt.LanguageCode == "" {
		opt.LanguageCode = "en-US"
	}
	if opt.SampleRate <= 0 {
		opt.SampleRate = 16000
	}
	if opt.Encoding == "" {
		opt.Encoding = "LINEAR16"
	}
	if opt.Model == "" {
		opt.Model = "latest_long"
	}
	return &GoogleASR{
		opt:        opt,
		audioQueue: make(chan []byte, 1024),
	}
}

func (g *GoogleASR) Init(tr base.ResultFunc, er base.ErrorFunc) {
	g.tr = tr
	g.er = er
}

func (g *GoogleASR) Vendor() string { return "google" }

func (g *GoogleASR) ConnAndReceive(dialogID string) error {
	g.mu.Lock()
	defer g.mu.Unlock()

	g.dialogID = dialogID
	now := time.Now()
	g.sendReqTime = &now
	g.endReqTime = nil
	g.sentence = ""

	ctx, cancel := context.WithCancel(context.Background())
	g.ctx = ctx
	g.cancel = cancel

	// Get access token
	token, err := g.getAccessToken()
	if err != nil {
		return fmt.Errorf("google asr: get access token: %w", err)
	}
	g.opt.AccessToken = token

	g.isStreaming = true
	go g.handleStream()

	return nil
}

func (g *GoogleASR) getAccessToken() (string, error) {
	if g.opt.AccessToken != "" {
		return g.opt.AccessToken, nil
	}
	if g.opt.CredentialsJSON == "" {
		return "", fmt.Errorf("google asr: credentials JSON is required")
	}

	var creds struct {
		ClientEmail string `json:"client_email"`
		PrivateKey  string `json:"private_key"`
		TokenURI    string `json:"token_uri"`
	}
	if err := json.Unmarshal([]byte(g.opt.CredentialsJSON), &creds); err != nil {
		return "", fmt.Errorf("google asr: parse credentials: %w", err)
	}

	// For simplicity, use the REST API with the service account JWT
	// In production, use google.golang.org/api/oauth2/jwt
	// Here we just return an error if no access token is available
	if creds.TokenURI == "" {
		return "", fmt.Errorf("google asr: no token_uri in credentials")
	}

	// Use HTTP POST to get token (simplified - in production use JWT signing)
	return "", fmt.Errorf("google asr: automatic token fetching requires the google SDK; please provide an access token directly")
}

func (g *GoogleASR) handleStream() {
	defer func() {
		g.isStreaming = false
	}()

	// Google Speech-to-Text streaming via REST API
	// POST https://speech.googleapis.com/v1/speech:streamingRecognize
	url := "https://speech.googleapis.com/v1/speech:streamingRecognize"

	var requestBody bytes.Buffer
	requestBody.WriteString("{")

	// Initial streaming config
	config := map[string]interface{}{
		"config": map[string]interface{}{
			"encoding":                   g.opt.Encoding,
			"sampleRateHertz":            g.opt.SampleRate,
			"languageCode":               g.opt.LanguageCode,
			"model":                      g.opt.Model,
			"enableAutomaticPunctuation": true,
		},
		"interimResults": true,
	}

	configJSON, _ := json.Marshal(config)
	requestBody.Write(configJSON)
	requestBody.WriteString("}")

	req, err := http.NewRequestWithContext(g.ctx, "POST", url+"?access_token="+g.opt.AccessToken, &requestBody)
	if err != nil {
		logger.Error("google asr: create request", logger.WithError(err))
		if g.er != nil {
			g.er(err, true)
		}
		return
	}
	req.Header.Set("Content-Type", "application/json")

	client := netutil.NewStandardHTTPClient(netutil.HTTPClientConfig{Timeout: 30 * time.Second})
	resp, err := client.Do(req)
	if err != nil {
		logger.Error("google asr: send request", logger.WithError(err))
		if g.er != nil {
			g.er(err, true)
		}
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		errMsg := fmt.Sprintf("google asr: HTTP %d: %s", resp.StatusCode, string(body))
		logger.Error(errMsg)
		if g.er != nil {
			g.er(fmt.Errorf("%s", errMsg), true)
		}
		return
	}

	// Read streaming responses
	decoder := json.NewDecoder(resp.Body)
	for {
		select {
		case <-g.ctx.Done():
			return
		default:
		}

		var result GoogleStreamingResponse
		if err := decoder.Decode(&result); err != nil {
			if err == io.EOF {
				break
			}
			logger.Error("google asr: decode response", logger.WithError(err))
			break
		}

		for _, res := range result.Results {
			if len(res.Alternatives) == 0 {
				continue
			}
			text := strings.TrimSpace(res.Alternatives[0].Transcript)
			if text == "" {
				continue
			}
			dur := time.Duration(0)
			if g.sendReqTime != nil {
				dur = time.Since(*g.sendReqTime)
			}
			if res.IsFinal {
				g.sentence = text
				if g.tr != nil {
					g.tr(text, true, dur, g.dialogID)
				}
				g.sentence = ""
			} else {
				g.sentence = text
				if g.tr != nil {
					g.tr(text, false, dur, g.dialogID)
				}
			}
		}
	}
}

func (g *GoogleASR) Activity() bool {
	g.mu.Lock()
	defer g.mu.Unlock()
	return g.isStreaming
}

func (g *GoogleASR) RestartClient() {
	_ = g.StopConn()
	if err := g.ConnAndReceive(g.dialogID); err != nil {
		if g.er != nil {
			g.er(err, true)
		}
	}
}

func (g *GoogleASR) SendAudioBytes(data []byte) error {
	if data == nil || len(data) == 0 {
		return nil
	}
	// Google streaming via REST requires sending audio in the request body
	// This is a simplified implementation - in production, use gRPC streaming
	select {
	case g.audioQueue <- data:
		return nil
	case <-time.After(200 * time.Millisecond):
		return fmt.Errorf("google asr: audio queue full")
	}
}

func (g *GoogleASR) SendEnd() error {
	return nil
}

func (g *GoogleASR) StopConn() error {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.cancel != nil {
		g.cancel()
	}
	g.isStreaming = false
	return nil
}

// GoogleStreamingResponse represents the streaming response from Google.
type GoogleStreamingResponse struct {
	Results []struct {
		Alternatives []struct {
			Transcript string  `json:"transcript"`
			Confidence float64 `json:"confidence"`
		} `json:"alternatives"`
		IsFinal bool `json:"isFinal"`
	} `json:"results"`
}

// Ensure uuid is referenced.
var _ = uuid.New
