package parser

import (
	"bytes"
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/BurntSushi/toml"
)

// TOMLParser parses TOML configuration files and renders them as key=value text.
type TOMLParser struct{}

func (p *TOMLParser) Provider() string { return FileTypeTOML }

func (p *TOMLParser) SupportedTypes() []string { return []string{FileTypeTOML} }

func (p *TOMLParser) Parse(ctx context.Context, req *ParseRequest, opts *ParseOptions) (*ParseResult, error) {
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

	var v map[string]any
	if err := toml.Unmarshal(data, &v); err != nil {
		return nil, err
	}

	text := flattenTOMLMap(v, "")
	text = normalizeText(text, opts)
	text = truncateText(text, opts)

	return &ParseResult{
		FileType: FileTypeTOML,
		FileName: fileName,
		Text:     text,
		Sections: []Section{{Type: SectionTypeDocument, Index: 0, Title: fileName, Text: text}},
		Metadata: req.Metadata,
		ParsedAt: time.Now(),
	}, nil
}

func flattenTOMLMap(m map[string]any, prefix string) string {
	var b strings.Builder
	for k, v := range m {
		key := k
		if prefix != "" {
			key = prefix + "." + k
		}
		switch val := v.(type) {
		case map[string]any:
			b.WriteString(flattenTOMLMap(val, key))
		default:
			b.WriteString(key)
			b.WriteString(" = ")
			b.WriteString(formatTOMLValue(val))
			b.WriteString("\n")
		}
	}
	return b.String()
}

func formatTOMLValue(v any) string {
	switch val := v.(type) {
	case string:
		return val
	case bool:
		if val {
			return "true"
		}
		return "false"
	default:
		return strings.TrimSpace(strings.Trim(strings.TrimPrefix(strings.TrimSuffix(
			strings.TrimSpace(stringifyAny(v)), "]"), "["), "("))
	}
}

func stringifyAny(v any) string {
	return fmt.Sprintf("%v", v)
}
