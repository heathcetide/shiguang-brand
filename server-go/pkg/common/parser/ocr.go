package parser

import (
	"bytes"
	"context"
	"fmt"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"strings"
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/providers/ocr"
	_ "golang.org/x/image/bmp"
	_ "golang.org/x/image/tiff"
	_ "golang.org/x/image/webp"
)

// OCRParser implements the Parser interface for image files using a cloud OCR provider.
// If no OCR provider is registered (via the ocr package), Parse returns ErrUnsupportedFileType.
type OCRParser struct {
	// Language is a language hint passed to the OCR provider.
	Language string
	// Driver overrides the global provider for this parser instance.
	// If nil, the global provider (set via ocr.SetProvider) is used.
	Driver ocr.Provider
}

func (p *OCRParser) Provider() string { return "ocr" }

func (p *OCRParser) SupportedTypes() []string {
	return []string{FileTypePNG, FileTypeJPG, FileTypeJPEG, FileTypeWEBP, FileTypeGIF, FileTypeBMP, FileTypeTIFF, FileTypeTIF}
}

func (p *OCRParser) Parse(ctx context.Context, req *ParseRequest, opts *ParseOptions) (*ParseResult, error) {
	if req == nil {
		return nil, ErrEmptyInput
	}
	data, fileName, err := readRequestBytes(req)
	if err != nil {
		return nil, err
	}
	if len(bytes.TrimSpace(data)) == 0 {
		return nil, ErrEmptyInput
	}

	// Decode to ensure it is a supported image and to guard against invalid data.
	_, _, err = image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, err
	}

	// Select provider: instance-level > global.
	provider := p.Driver
	if provider == nil {
		provider = ocr.GetProvider()
	}
	if provider == nil {
		return nil, fmt.Errorf("no OCR provider registered: %w", ErrUnsupportedFileType)
	}

	ocrOpts := &ocr.Options{
		Language: strings.TrimSpace(p.Language),
	}
	if ocrOpts.Language == "" {
		ocrOpts.Language = "auto"
	}

	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	default:
	}

	text, err := provider.Recognize(ctx, data, ocrOpts)
	if err != nil {
		return nil, fmt.Errorf("ocr provider %s: %w", provider.Name(), err)
	}
	text = strings.TrimSpace(text)
	text = normalizeText(text, opts)
	text = truncateText(text, opts)

	ft := req.FileType
	if ft == "" {
		ft = DetectFileType(req)
	}

	return &ParseResult{
		FileType: ft,
		FileName: fileName,
		Text:     text,
		Sections: []Section{{Type: SectionTypeDocument, Index: 0, Title: fileName, Text: text}},
		Metadata: req.Metadata,
		ParsedAt: time.Now(),
	}, nil
}
