package parser

import (
	"bytes"
	"context"
	"time"
)

// SVGParser extracts text content from SVG (Scalable Vector Graphics) files.
// SVG is XML-based; this parser extracts text from <text>, <tspan>, and
// <title> elements.
type SVGParser struct{}

func (p *SVGParser) Provider() string { return FileTypeSVG }

func (p *SVGParser) SupportedTypes() []string { return []string{FileTypeSVG} }

func (p *SVGParser) Parse(ctx context.Context, req *ParseRequest, opts *ParseOptions) (*ParseResult, error) {
	_ = ctx
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

	text, err := extractSVGText(data)
	if err != nil {
		return nil, err
	}
	text = normalizeText(text, opts)
	text = truncateText(text, opts)

	return &ParseResult{
		FileType: FileTypeSVG,
		FileName: fileName,
		Text:     text,
		Sections: []Section{{Type: SectionTypeDocument, Index: 0, Title: fileName, Text: text}},
		Metadata: req.Metadata,
		ParsedAt: time.Now(),
	}, nil
}

func extractSVGText(data []byte) (string, error) {
	// Reuse the XML text extractor, which walks CharData nodes.
	text, err := extractXMLText(data)
	if err != nil {
		// Fallback: strip tags manually.
		return stripXMLTags(string(data)), nil
	}
	return text, nil
}
