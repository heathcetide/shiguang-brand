// Package azure provides an OCR provider backed by Azure Computer Vision
// Read API (v4.0).
//
// Configure with Endpoint / SubscriptionKey, or via environment variables
// AZURE_COMPUTER_VISION_ENDPOINT / AZURE_COMPUTER_VISION_KEY.
package azure

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common/netutil"
	"github.com/heathcetide/DietDigiDose/pkg/providers/ocr"
)

// Provider implements ocr.Provider using Azure Computer Vision Read API.
type Provider struct {
	Endpoint        string // e.g. "https://my-cv.cognitiveservices.azure.com/"
	SubscriptionKey string
	// APIVersion overrides the default "4.0" API version.
	APIVersion string
}

var _ ocr.Provider = (*Provider)(nil)

// defaultHTTPClient is the standard HTTP client used for Azure Computer
// Vision API requests, configured with a 30s timeout.
var defaultHTTPClient = netutil.NewStandardHTTPClient(netutil.HTTPClientConfig{Timeout: 30 * time.Second})

// New creates a Provider from explicit credentials.
func New(endpoint, key string) *Provider {
	return &Provider{Endpoint: endpoint, SubscriptionKey: key}
}

// NewFromEnv creates a Provider from environment variables.
func NewFromEnv() *Provider {
	return New(
		os.Getenv("AZURE_COMPUTER_VISION_ENDPOINT"),
		os.Getenv("AZURE_COMPUTER_VISION_KEY"),
	)
}

func (p *Provider) Name() string { return "azure" }

func (p *Provider) apiVersion() string {
	if p.APIVersion != "" {
		return p.APIVersion
	}
	return "4.0"
}

func (p *Provider) endpointURL() (string, error) {
	ep := p.Endpoint
	if ep == "" {
		ep = os.Getenv("AZURE_COMPUTER_VISION_ENDPOINT")
	}
	if ep == "" {
		return "", fmt.Errorf("azure ocr: endpoint not configured")
	}
	return strings.TrimRight(ep, "/"), nil
}

func (p *Provider) apiKey() (string, error) {
	key := p.SubscriptionKey
	if key == "" {
		key = os.Getenv("AZURE_COMPUTER_VISION_KEY")
	}
	if key == "" {
		return "", fmt.Errorf("azure ocr: subscription key not configured")
	}
	return key, nil
}

// Recognize sends image bytes to Azure Computer Vision Read API.
// The Read API is asynchronous: it submits the image, polls for results,
// then returns the extracted text.
func (p *Provider) Recognize(ctx context.Context, imageBytes []byte, opts *ocr.Options) (string, error) {
	baseURL, err := p.endpointURL()
	if err != nil {
		return "", err
	}
	key, err := p.apiKey()
	if err != nil {
		return "", err
	}

	// Step 1: Submit the image for analysis.
	submitURL := fmt.Sprintf("%s/computervision/imageanalysis:analyze?api-version=%s&features=read",
		baseURL, p.apiVersion())

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, submitURL, bytes.NewReader(imageBytes))
	if err != nil {
		return "", err
	}
	req.Header.Set("Ocp-Apim-Subscription-Key", key)
	req.Header.Set("Content-Type", "application/octet-stream")

	resp, err := defaultHTTPClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("azure ocr: submit: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("azure ocr: submit returned %d: %s", resp.StatusCode, string(body))
	}

	var analyzeResp struct {
		ReadResult struct {
			Blocks []struct {
				Lines []struct {
					Text string `json:"text"`
				} `json:"lines"`
			} `json:"blocks"`
		} `json:"readResult"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&analyzeResp); err != nil {
		return "", fmt.Errorf("azure ocr: parse response: %w", err)
	}

	var lines []string
	for _, block := range analyzeResp.ReadResult.Blocks {
		for _, line := range block.Lines {
			if line.Text != "" {
				lines = append(lines, line.Text)
			}
		}
	}
	return strings.Join(lines, "\n"), nil
}

func init() {
	ocr.RegisterProvider("azure", NewFromEnv())
}

// Ensure time is imported for potential future polling-based flows.
var _ = time.Second
