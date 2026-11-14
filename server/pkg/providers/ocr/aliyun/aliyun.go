// Package aliyun provides an OCR provider backed by Alibaba Cloud Vision Intelligence
// (阿里云视觉智能开放平台) OCR APIs.
//
// The provider calls the RecognizeGeneral API via the Alibaba Cloud SDK.
// Configure with AccessKeyID / AccessKeySecret / Endpoint, or via environment
// variables ALIBABA_CLOUD_ACCESS_KEY_ID / ALIBABA_CLOUD_ACCESS_KEY_SECRET.
package aliyun

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"strings"

	"github.com/heathcetide/DietDigiDose/pkg/providers/ocr"
	openapi "github.com/alibabacloud-go/darabonba-openapi/v2/client"
	ocrapi "github.com/alibabacloud-go/ocr-api-20210707/v3/client"
	"github.com/alibabacloud-go/tea/tea"
)

// Provider implements ocr.Provider using Alibaba Cloud OCR.
type Provider struct {
	AccessKeyID     string
	AccessKeySecret string
	Endpoint        string // e.g. "ocr-api.cn-hangzhou.aliyuncs.com"
	client          *ocrapi.Client
}

var _ ocr.Provider = (*Provider)(nil)

// New creates a Provider from explicit credentials.
func New(accessKeyID, accessKeySecret, endpoint string) *Provider {
	return &Provider{
		AccessKeyID:     accessKeyID,
		AccessKeySecret: accessKeySecret,
		Endpoint:        endpoint,
	}
}

// NewFromEnv creates a Provider from environment variables.
func NewFromEnv() *Provider {
	return New(
		os.Getenv("ALIBABA_CLOUD_ACCESS_KEY_ID"),
		os.Getenv("ALIBABA_CLOUD_ACCESS_KEY_SECRET"),
		os.Getenv("ALIBABA_CLOUD_OCR_ENDPOINT"),
	)
}

func (p *Provider) Name() string { return "aliyun" }

func (p *Provider) clientLazy() (*ocrapi.Client, error) {
	if p.client != nil {
		return p.client, nil
	}
	ak := p.AccessKeyID
	if ak == "" {
		ak = os.Getenv("ALIBABA_CLOUD_ACCESS_KEY_ID")
	}
	sk := p.AccessKeySecret
	if sk == "" {
		sk = os.Getenv("ALIBABA_CLOUD_ACCESS_KEY_SECRET")
	}
	endpoint := p.Endpoint
	if endpoint == "" {
		endpoint = "ocr-api.cn-hangzhou.aliyuncs.com"
	}
	if ak == "" || sk == "" {
		return nil, fmt.Errorf("aliyun ocr: AccessKeyID/AccessKeySecret not configured")
	}
	cfg := &openapi.Config{
		AccessKeyId:     tea.String(ak),
		AccessKeySecret: tea.String(sk),
		Endpoint:        tea.String(endpoint),
	}
	c, err := ocrapi.NewClient(cfg)
	if err != nil {
		return nil, fmt.Errorf("aliyun ocr: create client: %w", err)
	}
	p.client = c
	return c, nil
}

// Recognize sends image bytes to Alibaba Cloud RecognizeGeneral API.
// The API accepts image bytes via the Body field (io.Reader).
func (p *Provider) Recognize(ctx context.Context, imageBytes []byte, opts *ocr.Options) (string, error) {
	_ = ctx
	_ = opts

	c, err := p.clientLazy()
	if err != nil {
		return "", err
	}

	req := &ocrapi.RecognizeGeneralRequest{
		Body: bytes.NewReader(imageBytes),
	}

	resp, err := c.RecognizeGeneral(req)
	if err != nil {
		return "", fmt.Errorf("aliyun ocr: RecognizeGeneral: %w", err)
	}
	if resp == nil || resp.Body == nil || resp.Body.Data == nil {
		return "", fmt.Errorf("aliyun ocr: empty response")
	}
	return tea.StringValue(resp.Body.Data), nil
}

func init() {
	ocr.RegisterProvider("aliyun", NewFromEnv())
}

// Ensure strings is referenced (used for future language hint support).
var _ = strings.TrimSpace
