package parser

import (
	"bytes"
	"context"
	"strings"
	"time"
)

// TSVParser parses tab-separated value files.
type TSVParser struct{}

func (p *TSVParser) Provider() string { return FileTypeTSV }

func (p *TSVParser) SupportedTypes() []string { return []string{FileTypeTSV} }

func (p *TSVParser) Parse(ctx context.Context, req *ParseRequest, opts *ParseOptions) (*ParseResult, error) {
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

	lines := strings.Split(strings.TrimSpace(string(data)), "\n")
	var out []string
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		// TSV fields are separated by tabs; keep them as-is for readability.
		out = append(out, line)
	}

	text := strings.Join(out, "\n")
	text = normalizeText(text, opts)
	text = truncateText(text, opts)

	return &ParseResult{
		FileType: FileTypeTSV,
		FileName: fileName,
		Text:     text,
		Sections: []Section{{Type: SectionTypeDocument, Index: 0, Title: fileName, Text: text}},
		Metadata: req.Metadata,
		ParsedAt: time.Now(),
	}, nil
}
