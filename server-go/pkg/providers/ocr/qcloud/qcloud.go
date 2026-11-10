// Package qcloud provides an OCR provider backed by Tencent Cloud OCR
// (腾讯云文字识别).
//
// Configure with SecretId / SecretKey / Region, or via environment variables
// TENCENTCLOUD_SECRET_ID / TENCENTCLOUD_SECRET_KEY / TENCENTCLOUD_REGION.
package qcloud

import (
	"context"
	"encoding/base64"
	"fmt"
	"os"

	"github.com/heathcetide/DietDigiDose/pkg/providers/ocr"
	"github.com/tencentcloud/tencentcloud-sdk-go/tencentcloud/common"
	"github.com/tencentcloud/tencentcloud-sdk-go/tencentcloud/common/profile"
	tcocr "github.com/tencentcloud/tencentcloud-sdk-go/tencentcloud/ocr/v20181119"
)

// Provider implements ocr.Provider using Tencent Cloud OCR.
type Provider struct {
	SecretID  string
	SecretKey string
	Region    string
	client    *tcocr.Client
}

var _ ocr.Provider = (*Provider)(nil)

// New creates a Provider from explicit credentials.
func New(secretID, secretKey, region string) *Provider {
	return &Provider{SecretID: secretID, SecretKey: secretKey, Region: region}
}

// NewFromEnv creates a Provider from environment variables.
func NewFromEnv() *Provider {
	region := os.Getenv("TENCENTCLOUD_REGION")
	if region == "" {
		region = "ap-guangzhou"
	}
	return New(
		os.Getenv("TENCENTCLOUD_SECRET_ID"),
		os.Getenv("TENCENTCLOUD_SECRET_KEY"),
		region,
	)
}

func (p *Provider) Name() string { return "qcloud" }

func (p *Provider) clientLazy() (*tcocr.Client, error) {
	if p.client != nil {
		return p.client, nil
	}
	id := p.SecretID
	if id == "" {
		id = os.Getenv("TENCENTCLOUD_SECRET_ID")
	}
	key := p.SecretKey
	if key == "" {
		key = os.Getenv("TENCENTCLOUD_SECRET_KEY")
	}
	region := p.Region
	if region == "" {
		region = "ap-guangzhou"
	}
	if id == "" || key == "" {
		return nil, fmt.Errorf("qcloud ocr: SecretID/SecretKey not configured")
	}
	cp := common.NewCredential(id, key)
	cpf := profile.NewClientProfile()
	c, err := tcocr.NewClient(cp, region, cpf)
	if err != nil {
		return nil, fmt.Errorf("qcloud ocr: create client: %w", err)
	}
	p.client = c
	return c, nil
}

// Recognize sends image bytes to Tencent Cloud GeneralBasicOCR API.
func (p *Provider) Recognize(ctx context.Context, imageBytes []byte, opts *ocr.Options) (string, error) {
	c, err := p.clientLazy()
	if err != nil {
		return "", err
	}

	b64 := base64.StdEncoding.EncodeToString(imageBytes)
	req := tcocr.NewGeneralBasicOCRRequest()
	req.ImageBase64 = common.StringPtr(b64)

	resp, err := c.GeneralBasicOCR(req)
	if err != nil {
		return "", fmt.Errorf("qcloud ocr: GeneralBasicOCR: %w", err)
	}
	if resp == nil || resp.Response == nil {
		return "", fmt.Errorf("qcloud ocr: empty response")
	}

	var result string
	for _, d := range resp.Response.TextDetections {
		if d.DetectedText != nil {
			result += *d.DetectedText + "\n"
		}
	}
	return result, nil
}

func init() {
	ocr.RegisterProvider("qcloud", NewFromEnv())
}
