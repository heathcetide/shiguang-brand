// Package google provides an OCR provider backed by Google Cloud Vision API
// (TEXT_DETECTION).
//
// Configure with a service account JSON key file path via GOOGLE_APPLICATION_CREDENTIALS
// or set the path explicitly in the Provider.
package google

import (
	"context"
	"fmt"
	"os"
	"strings"

	vision "cloud.google.com/go/vision/apiv1"
	"github.com/heathcetide/DietDigiDose/pkg/providers/ocr"
	"google.golang.org/api/option"
	visionpb "google.golang.org/genproto/googleapis/cloud/vision/v1"
)

// Provider implements ocr.Provider using Google Cloud Vision.
type Provider struct {
	// CredentialsFile is the path to a service account JSON key file.
	// If empty, GOOGLE_APPLICATION_CREDENTIALS is used.
	CredentialsFile string
	client          *vision.ImageAnnotatorClient
}

var _ ocr.Provider = (*Provider)(nil)

// New creates a Provider with an explicit credentials file path.
func New(credentialsFile string) *Provider {
	return &Provider{CredentialsFile: credentialsFile}
}

// NewFromEnv creates a Provider using GOOGLE_APPLICATION_CREDENTIALS.
func NewFromEnv() *Provider {
	return New(os.Getenv("GOOGLE_APPLICATION_CREDENTIALS"))
}

func (p *Provider) Name() string { return "google" }

func (p *Provider) clientLazy(ctx context.Context) (*vision.ImageAnnotatorClient, error) {
	if p.client != nil {
		return p.client, nil
	}
	var opts []option.ClientOption
	credFile := p.CredentialsFile
	if credFile == "" {
		credFile = os.Getenv("GOOGLE_APPLICATION_CREDENTIALS")
	}
	if credFile != "" {
		opts = append(opts, option.WithCredentialsFile(credFile))
	}
	c, err := vision.NewImageAnnotatorClient(ctx, opts...)
	if err != nil {
		return nil, fmt.Errorf("google vision: create client: %w", err)
	}
	p.client = c
	return c, nil
}

// Recognize sends image bytes to Google Cloud Vision TEXT_DETECTION.
func (p *Provider) Recognize(ctx context.Context, imageBytes []byte, opts *ocr.Options) (string, error) {
	c, err := p.clientLazy(ctx)
	if err != nil {
		return "", err
	}

	img := &visionpb.Image{Content: imageBytes}
	feat := &visionpb.Feature{Type: visionpb.Feature_TEXT_DETECTION}

	req := &visionpb.AnnotateImageRequest{
		Image:    img,
		Features: []*visionpb.Feature{feat},
	}
	if opts != nil {
		var hints []string
		if strings.TrimSpace(opts.Language) != "" && opts.Language != "auto" {
			for _, l := range strings.Split(opts.Language, ",") {
				l = strings.TrimSpace(l)
				if l != "" {
					hints = append(hints, l)
				}
			}
		}
		if len(hints) > 0 {
			req.ImageContext = &visionpb.ImageContext{
				LanguageHints: hints,
			}
		}
	}

	resp, err := c.AnnotateImage(ctx, req)
	if err != nil {
		return "", fmt.Errorf("google vision: AnnotateImage: %w", err)
	}
	if resp.Error != nil {
		return "", fmt.Errorf("google vision: %s", resp.Error.Message)
	}
	if resp.FullTextAnnotation == nil {
		return "", nil
	}
	return resp.FullTextAnnotation.Text, nil
}

func init() {
	ocr.RegisterProvider("google", NewFromEnv())
}
