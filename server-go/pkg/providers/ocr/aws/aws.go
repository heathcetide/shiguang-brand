// Package aws provides an OCR provider backed by AWS Textract.
//
// Configure with AWS credentials via environment variables (AWS_ACCESS_KEY_ID,
// AWS_SECRET_ACCESS_KEY, AWS_REGION) or an explicit Config.
package aws

import (
	"context"
	"fmt"
	"os"
	"sort"
	"strings"

	"github.com/heathcetide/DietDigiDose/pkg/providers/ocr"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/textract"
	"github.com/aws/aws-sdk-go-v2/service/textract/types"
)

// Provider implements ocr.Provider using AWS Textract.
type Provider struct {
	AccessKeyID     string
	SecretAccessKey string
	Region          string
	client          *textract.Client
}

var _ ocr.Provider = (*Provider)(nil)

// New creates a Provider from explicit credentials.
func New(accessKeyID, secretAccessKey, region string) *Provider {
	return &Provider{AccessKeyID: accessKeyID, SecretAccessKey: secretAccessKey, Region: region}
}

// NewFromEnv creates a Provider using standard AWS environment variables.
func NewFromEnv() *Provider {
	return New(
		os.Getenv("AWS_ACCESS_KEY_ID"),
		os.Getenv("AWS_SECRET_ACCESS_KEY"),
		os.Getenv("AWS_REGION"),
	)
}

func (p *Provider) Name() string { return "aws" }

func (p *Provider) clientLazy(ctx context.Context) (*textract.Client, error) {
	if p.client != nil {
		return p.client, nil
	}
	region := p.Region
	if region == "" {
		region = os.Getenv("AWS_REGION")
	}
	if region == "" {
		region = "us-east-1"
	}

	var cfg aws.Config
	var err error

	ak := p.AccessKeyID
	if ak == "" {
		ak = os.Getenv("AWS_ACCESS_KEY_ID")
	}
	sk := p.SecretAccessKey
	if sk == "" {
		sk = os.Getenv("AWS_SECRET_ACCESS_KEY")
	}

	if ak != "" && sk != "" {
		cfg, err = config.LoadDefaultConfig(ctx,
			config.WithRegion(region),
			config.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(ak, sk, "")),
		)
	} else {
		// Fall back to default credential chain (IAM role, shared credentials, etc.)
		cfg, err = config.LoadDefaultConfig(ctx, config.WithRegion(region))
	}
	if err != nil {
		return nil, fmt.Errorf("aws textract: load config: %w", err)
	}

	p.client = textract.NewFromConfig(cfg)
	return p.client, nil
}

// Recognize sends image bytes to AWS Textract DetectDocumentText API.
func (p *Provider) Recognize(ctx context.Context, imageBytes []byte, opts *ocr.Options) (string, error) {
	c, err := p.clientLazy(ctx)
	if err != nil {
		return "", err
	}

	input := &textract.DetectDocumentTextInput{
		Document: &types.Document{Bytes: imageBytes},
	}

	resp, err := c.DetectDocumentText(ctx, input)
	if err != nil {
		return "", fmt.Errorf("aws textract: DetectDocumentText: %w", err)
	}

	// Build text from LINE blocks, ordered by their geometry (top-to-bottom).
	type lineBlock struct {
		Text string
		Top  float32
	}
	var lines []lineBlock
	for _, b := range resp.Blocks {
		if b.BlockType == types.BlockTypeLine && b.Text != nil {
			top := float32(0)
			if b.Geometry != nil && b.Geometry.BoundingBox != nil {
				top = b.Geometry.BoundingBox.Top
			}
			lines = append(lines, lineBlock{Text: *b.Text, Top: top})
		}
	}
	sort.Slice(lines, func(i, j int) bool { return lines[i].Top < lines[j].Top })

	var result []string
	for _, l := range lines {
		result = append(result, l.Text)
	}
	return strings.Join(result, "\n"), nil
}

func init() {
	ocr.RegisterProvider("aws", NewFromEnv())
}
