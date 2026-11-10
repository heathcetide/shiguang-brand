// Package synthesizer implements the Baidu ASR adapter for ling-base.
//
// This adapter uses the Baidu REST short-audio recognition API. Audio bytes
// are accumulated locally and sent in a single POST request when SendEnd is
// invoked, which fits the ling-base Engine interface (non-streaming vendor).
package synthesizer

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common/logger"
	"github.com/heathcetide/DietDigiDose/pkg/common/netutil"
	base "github.com/heathcetide/DietDigiDose/pkg/providers/voice/recognizer"
	"github.com/google/uuid"
)

const (
	// baiduTokenURL is the OAuth endpoint used to obtain an access token.
	baiduTokenURL = "https://vop.baidu.com/oauth/2.0/token"
	// baiduServerAPI is the REST endpoint for short audio recognition.
	baiduServerAPI = "https://vop.baidu.com/server_api"
	// baiduDefaultFormat is the default audio format (PCM).
	baiduDefaultFormat = "pcm"
	// baiduDefaultRate is the default sample rate.
	baiduDefaultRate = 16000
	// baiduDefaultChannel is the default number of channels.
	baiduDefaultChannel = 1
	// baiduDefaultDevPid is the default dev_pid (Mandarin).
	baiduDefaultDevPid = 1537
	// baiduHTTPTimeout is the timeout for HTTP requests to Baidu.
	baiduHTTPTimeout = 30 * time.Second
)

// Compile-time guard ensuring BaiduASR implements the base.Engine interface.
var _ base.Engine = (*BaiduASR)(nil)

// Handler is a generic media handler hook retained for compatibility with
// callers that previously relied on the LingEchoX media layer. It is not used
// by the REST-based recognition flow but kept so upstream code can attach
// session-scoped state if needed.
type Handler interface{}

// BaiduASR is the Baidu short-audio ASR engine.
type BaiduASR struct {
	Handler     Handler
	sentence    string
	startTime   *time.Time
	endTime     *time.Time
	sendReqTime *time.Time
	endReqTime  *time.Time
	opt         BaiduASROption
	dialogID    string
	tr          base.ResultFunc
	er          base.ErrorFunc
	audioBuffer []byte
	mu          sync.Mutex

	// accessToken is the cached OAuth access token.
	accessToken string
	// tokenExpiry is when the cached token expires.
	tokenExpiry time.Time
	// active indicates whether the engine has been initialised for a dialog.
	active bool
}

// BaiduASROption configures the Baidu ASR engine.
type BaiduASROption struct {
	APIKey      string `json:"apiKey" yaml:"api_key"`
	SecretKey   string `json:"secretKey" yaml:"secret_key"`
	AppID       string `json:"appId" yaml:"app_id"`
	Format      string `json:"format" yaml:"format"`
	Rate        int    `json:"rate" yaml:"rate"`
	Channel     int    `json:"channel" yaml:"channel"`
	Cuid        string `json:"cuid" yaml:"cuid"`
	DevPid      int    `json:"devPid" yaml:"dev_pid"`
	ReqChanSize int    `json:"reqChanSize" yaml:"req_chan_size"`
}

// GetVendor returns the vendor identifier.
func (opt *BaiduASROption) GetVendor() base.Vendor {
	return base.VendorBaidu
}

// NewBaiduASROption creates a default BaiduASROption.
func NewBaiduASROption(apiKey, secretKey string) BaiduASROption {
	return BaiduASROption{
		APIKey:      apiKey,
		SecretKey:   secretKey,
		Format:      baiduDefaultFormat,
		Rate:        baiduDefaultRate,
		Channel:     baiduDefaultChannel,
		Cuid:        "ling-base-cuid",
		DevPid:      baiduDefaultDevPid,
		ReqChanSize: 128,
	}
}

// NewBaiduASR builds a Baidu ASR engine from the supplied options.
func NewBaiduASR(opt BaiduASROption) *BaiduASR {
	if strings.TrimSpace(opt.Format) == "" {
		opt.Format = baiduDefaultFormat
	}
	if opt.Rate <= 0 {
		opt.Rate = baiduDefaultRate
	}
	if opt.Channel <= 0 {
		opt.Channel = baiduDefaultChannel
	}
	if strings.TrimSpace(opt.Cuid) == "" {
		opt.Cuid = "ling-base-cuid"
	}
	if opt.DevPid <= 0 {
		opt.DevPid = baiduDefaultDevPid
	}
	if opt.ReqChanSize <= 0 {
		opt.ReqChanSize = 128
	}
	return &BaiduASR{
		opt: opt,
	}
}

// Init registers the result and error callbacks.
func (b *BaiduASR) Init(tr base.ResultFunc, er base.ErrorFunc) {
	b.tr = tr
	b.er = er
}

// Vendor returns the vendor identifier string.
func (b *BaiduASR) Vendor() string { return "baidu" }

// ConnAndReceive prepares the engine for a new dialog. For the REST-based
// flow this fetches (or refreshes) the access token and resets the audio
// buffer. No persistent connection is opened.
func (b *BaiduASR) ConnAndReceive(dialogID string) error {
	b.mu.Lock()
	b.dialogID = dialogID
	b.audioBuffer = make([]byte, 0, 32*1024)
	b.sentence = ""
	b.active = true
	n := time.Now()
	b.startTime = &n
	b.endTime = nil
	b.sendReqTime = nil
	b.endReqTime = nil
	b.mu.Unlock()

	if b.accessToken == "" || time.Now().After(b.tokenExpiry) {
		if err := b.getAccessToken(); err != nil {
			return err
		}
	}
	return nil
}

// Activity returns true if the engine is initialised for an active dialog.
func (b *BaiduASR) Activity() bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.active
}

// RestartClient resets the engine and re-initialises for the current dialog.
func (b *BaiduASR) RestartClient() {
	_ = b.StopConn()
	id := strings.TrimSpace(b.dialogID)
	if id == "" {
		id = uuid.New().String()
	}
	if err := b.ConnAndReceive(id); err != nil {
		b.causeErr(err)
	}
}

// SendAudioBytes accumulates audio data into the local buffer. The actual
// recognition request is deferred until SendEnd is called.
func (b *BaiduASR) SendAudioBytes(data []byte) error {
	if data == nil || len(data) == 0 {
		return nil
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	if !b.active {
		return fmt.Errorf("baidu recognizer is not running")
	}
	if b.sendReqTime == nil {
		n := time.Now()
		b.sendReqTime = &n
		logger.Info("baidu asr start accumulating audio")
	}
	b.audioBuffer = append(b.audioBuffer, data...)
	return nil
}

// SendEnd flushes the accumulated audio to the Baidu REST API and parses the
// recognition result, dispatching it via the registered result callback.
func (b *BaiduASR) SendEnd() error {
	b.mu.Lock()
	if !b.active {
		b.mu.Unlock()
		return nil
	}
	audioData := make([]byte, len(b.audioBuffer))
	copy(audioData, b.audioBuffer)
	b.audioBuffer = b.audioBuffer[:0]
	n := time.Now()
	b.endReqTime = &n
	b.mu.Unlock()

	if len(audioData) == 0 {
		logger.Warn("baidu asr: no audio data to recognize")
		b.dispatchResult("", true)
		return nil
	}

	text, err := b.recognizeAudio(audioData)
	if err != nil {
		b.causeErr(err)
		return err
	}

	b.dispatchResult(text, true)
	return nil
}

// StopConn stops the engine and releases buffered audio.
func (b *BaiduASR) StopConn() error {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.active = false
	b.audioBuffer = b.audioBuffer[:0]
	en := time.Now()
	b.endTime = &en
	return nil
}

// dispatchResult forwards a recognition result through the callback.
func (b *BaiduASR) dispatchResult(text string, isLast bool) {
	b.mu.Lock()
	b.sentence = text
	duration := time.Duration(0)
	if b.sendReqTime != nil {
		duration = time.Since(*b.sendReqTime)
	}
	dialogID := b.dialogID
	tr := b.tr
	b.mu.Unlock()

	if tr != nil {
		tr(text, isLast, duration, dialogID)
	}
}

// causeErr forwards an error through the error callback.
func (b *BaiduASR) causeErr(err error) {
	if err == nil {
		return
	}
	if b.er != nil {
		b.er(err, true)
	}
}

// baiduTokenResponse is the OAuth token response from Baidu.
type baiduTokenResponse struct {
	AccessToken      string `json:"access_token"`
	ExpiresIn        int64  `json:"expires_in"`
	Error            string `json:"error"`
	ErrorDescription string `json:"error_description"`
}

// getAccessToken fetches an OAuth access token from Baidu.
func (b *BaiduASR) getAccessToken() error {
	params := url.Values{}
	params.Set("grant_type", "client_credentials")
	params.Set("client_id", b.opt.APIKey)
	params.Set("client_secret", b.opt.SecretKey)

	reqURL := fmt.Sprintf("%s?%s", baiduTokenURL, params.Encode())

	ctx, cancel := context.WithTimeout(context.Background(), baiduHTTPTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, reqURL, nil)
	if err != nil {
		return fmt.Errorf("baidu asr: build token request: %w", err)
	}

	client := netutil.NewStandardHTTPClient(netutil.HTTPClientConfig{Timeout: 30 * time.Second})
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("baidu asr: token request failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("baidu asr: read token response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("baidu asr: token request status %d: %s", resp.StatusCode, string(body))
	}

	var tokenResp baiduTokenResponse
	if err := json.Unmarshal(body, &tokenResp); err != nil {
		return fmt.Errorf("baidu asr: unmarshal token response: %w", err)
	}

	if tokenResp.Error != "" {
		return fmt.Errorf("baidu asr: token error: %s - %s", tokenResp.Error, tokenResp.ErrorDescription)
	}

	if tokenResp.AccessToken == "" {
		return fmt.Errorf("baidu asr: empty access token in response")
	}

	b.mu.Lock()
	b.accessToken = tokenResp.AccessToken
	// Subtract a safety margin to avoid using an expired token.
	b.tokenExpiry = time.Now().Add(time.Duration(tokenResp.ExpiresIn)*time.Second - 60*time.Second)
	b.mu.Unlock()

	logger.Info("baidu asr: access token acquired", logger.WithFields(map[string]interface{}{
		"expiresIn": tokenResp.ExpiresIn,
	})...)
	return nil
}

// baiduASRRequest is the JSON body sent to the Baidu server_api endpoint.
type baiduASRRequest struct {
	Format  string `json:"format"`
	Rate    int    `json:"rate"`
	Channel int    `json:"channel"`
	Cuid    string `json:"cuid"`
	Token   string `json:"token"`
	DevPid  int    `json:"dev_pid,omitempty"`
	Speech  string `json:"speech"`
	Len     int    `json:"len"`
}

// BaiduASRResponse is the parsed recognition response from Baidu.
type BaiduASRResponse struct {
	ErrNo    int      `json:"err_no"`
	ErrMsg   string   `json:"err_msg"`
	Sn       string   `json:"sn"`
	CorpusNo string   `json:"corpus_no"`
	Result   []string `json:"result"`
}

// recognizeAudio POSTs the accumulated audio to the Baidu server_api endpoint
// and returns the recognized text.
func (b *BaiduASR) recognizeAudio(audioData []byte) (string, error) {
	b.mu.Lock()
	token := b.accessToken
	opt := b.opt
	b.mu.Unlock()

	if token == "" {
		return "", fmt.Errorf("baidu asr: missing access token")
	}

	reqBody := baiduASRRequest{
		Format:  opt.Format,
		Rate:    opt.Rate,
		Channel: opt.Channel,
		Cuid:    opt.Cuid,
		Token:   token,
		DevPid:  opt.DevPid,
		Speech:  base64.StdEncoding.EncodeToString(audioData),
		Len:     len(audioData),
	}

	payload, err := json.Marshal(reqBody)
	if err != nil {
		return "", fmt.Errorf("baidu asr: marshal request: %w", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), baiduHTTPTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, baiduServerAPI, bytes.NewReader(payload))
	if err != nil {
		return "", fmt.Errorf("baidu asr: build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	client := netutil.NewStandardHTTPClient(netutil.HTTPClientConfig{Timeout: 30 * time.Second})
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("baidu asr: recognize request failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("baidu asr: read response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("baidu asr: recognize status %d: %s", resp.StatusCode, string(body))
	}

	var asrResp BaiduASRResponse
	if err := json.Unmarshal(body, &asrResp); err != nil {
		return "", fmt.Errorf("baidu asr: unmarshal response: %w", err)
	}

	if asrResp.ErrNo != 0 {
		return "", fmt.Errorf("baidu asr: error %d: %s", asrResp.ErrNo, asrResp.ErrMsg)
	}

	if len(asrResp.Result) == 0 {
		return "", nil
	}

	return strings.Join(asrResp.Result, ""), nil
}

// base64Encode encodes audio bytes to a standard base64 string without
// importing encoding/base64 at the package level (kept local for clarity).
func base64Encode(data []byte) string {
	const table = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
	if len(data) == 0 {
		return ""
	}
	n := len(data)
	enc := make([]byte, 0, ((n+2)/3)*4)
	for i := 0; i < n; i += 3 {
		var b0, b1, b2 byte
		b0 = data[i]
		switch {
		case i+2 < n:
			b1 = data[i+1]
			b2 = data[i+2]
			enc = append(enc, table[b0>>2], table[((b0&0x03)<<4)|(b1>>4)], table[((b1&0x0f)<<2)|(b2>>6)], table[b2&0x3f])
		case i+1 < n:
			b1 = data[i+1]
			enc = append(enc, table[b0>>2], table[((b0&0x03)<<4)|(b1>>4)], table[(b1&0x0f)<<2], '=')
		default:
			enc = append(enc, table[b0>>2], table[(b0&0x03)<<4], '=', '=')
		}
	}
	return string(enc)
}
