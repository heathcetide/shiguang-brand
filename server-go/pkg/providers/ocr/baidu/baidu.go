// Package baidu provides an OCR provider backed by Baidu Intelligent Cloud
// (百度智能云文字识别).
//
// Configure with APIKey / SecretKey, or via environment variables
// BAIDU_OCR_API_KEY / BAIDU_OCR_SECRET_KEY.
package baidu

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common/netutil"
	"github.com/heathcetide/DietDigiDose/pkg/providers/ocr"
)

// Provider implements ocr.Provider using Baidu Cloud OCR.
type Provider struct {
	APIKey    string
	SecretKey string
	// TokenURL overrides the default OAuth token endpoint.
	TokenURL string
	// OCRURL overrides the default general text recognition endpoint.
	OCRURL string

	accessToken string
}

var _ ocr.Provider = (*Provider)(nil)

// defaultHTTPClient is the standard HTTP client used for Baidu Cloud API
// requests, configured with a 30s timeout.
var defaultHTTPClient = netutil.NewStandardHTTPClient(netutil.HTTPClientConfig{Timeout: 30 * time.Second})

// New creates a Provider from explicit credentials.
func New(apiKey, secretKey string) *Provider {
	return &Provider{APIKey: apiKey, SecretKey: secretKey}
}

// NewFromEnv creates a Provider from environment variables.
func NewFromEnv() *Provider {
	return New(
		os.Getenv("BAIDU_OCR_API_KEY"),
		os.Getenv("BAIDU_OCR_SECRET_KEY"),
	)
}

func (p *Provider) Name() string { return "baidu" }

func (p *Provider) tokenEndpoint() string {
	if p.TokenURL != "" {
		return p.TokenURL
	}
	return "https://aip.baidubce.com/oauth/2.0/token"
}

func (p *Provider) ocrEndpoint() string {
	if p.OCRURL != "" {
		return p.OCRURL
	}
	return "https://aip.baidubce.com/rest/2.0/ocr/v1/general_basic"
}

func (p *Provider) fetchAccessToken(ctx context.Context) (string, error) {
	if p.accessToken != "" {
		return p.accessToken, nil
	}
	ak := p.APIKey
	if ak == "" {
		ak = os.Getenv("BAIDU_OCR_API_KEY")
	}
	sk := p.SecretKey
	if sk == "" {
		sk = os.Getenv("BAIDU_OCR_SECRET_KEY")
	}
	if ak == "" || sk == "" {
		return "", fmt.Errorf("baidu ocr: APIKey/SecretKey not configured")
	}

	u := p.tokenEndpoint() + "?grant_type=client_credentials&client_id=" + url.QueryEscape(ak) + "&client_secret=" + url.QueryEscape(sk)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, u, nil)
	if err != nil {
		return "", err
	}
	resp, err := defaultHTTPClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("baidu ocr: fetch token: %w", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}
	var tok struct {
		AccessToken string `json:"access_token"`
		Error       string `json:"error"`
	}
	if err := json.Unmarshal(body, &tok); err != nil {
		return "", fmt.Errorf("baidu ocr: parse token: %w", err)
	}
	if tok.Error != "" {
		return "", fmt.Errorf("baidu ocr: token error: %s", tok.Error)
	}
	if tok.AccessToken == "" {
		return "", fmt.Errorf("baidu ocr: empty access_token")
	}
	p.accessToken = tok.AccessToken
	return tok.AccessToken, nil
}

// Recognize sends image bytes to Baidu Cloud General Basic OCR API.
func (p *Provider) Recognize(ctx context.Context, imageBytes []byte, opts *ocr.Options) (string, error) {
	token, err := p.fetchAccessToken(ctx)
	if err != nil {
		return "", err
	}

	b64 := base64.StdEncoding.EncodeToString(imageBytes)
	form := url.Values{}
	form.Set("image", b64)
	form.Set("language_type", "CHN_ENG")
	if opts != nil && strings.TrimSpace(opts.Language) != "" && opts.Language != "auto" {
		lang := opts.Language
		if lang == "zh" {
			lang = "CHN_ENG"
		} else if lang == "en" {
			lang = "ENG"
		}
		form.Set("language_type", lang)
	}

	u := p.ocrEndpoint() + "?access_token=" + url.QueryEscape(token)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, u, strings.NewReader(form.Encode()))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := defaultHTTPClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("baidu ocr: request: %w", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}

	var result struct {
		WordsResult []struct {
			Words string `json:"words"`
		} `json:"words_result"`
		ErrorCode int    `json:"error_code"`
		ErrorMsg  string `json:"error_msg"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return "", fmt.Errorf("baidu ocr: parse response: %w", err)
	}
	if result.ErrorCode != 0 {
		return "", fmt.Errorf("baidu ocr: error %d: %s", result.ErrorCode, result.ErrorMsg)
	}

	var lines []string
	for _, w := range result.WordsResult {
		if w.Words != "" {
			lines = append(lines, w.Words)
		}
	}
	return strings.Join(lines, "\n"), nil
}

func init() {
	ocr.RegisterProvider("baidu", NewFromEnv())
}
