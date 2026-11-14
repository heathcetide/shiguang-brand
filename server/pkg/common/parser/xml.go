package parser

import (
	"bytes"
	"context"
	"encoding/xml"
	"io"
	"strings"
	"time"
)

// XMLParser extracts text content from XML files by walking the element tree
// and collecting character data.
type XMLParser struct{}

func (p *XMLParser) Provider() string { return FileTypeXML }

func (p *XMLParser) SupportedTypes() []string { return []string{FileTypeXML} }

func (p *XMLParser) Parse(ctx context.Context, req *ParseRequest, opts *ParseOptions) (*ParseResult, error) {
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

	text, err := extractXMLText(data)
	if err != nil {
		return nil, err
	}
	text = normalizeText(text, opts)
	text = truncateText(text, opts)

	return &ParseResult{
		FileType: FileTypeXML,
		FileName: fileName,
		Text:     text,
		Sections: []Section{{Type: SectionTypeDocument, Index: 0, Title: fileName, Text: text}},
		Metadata: req.Metadata,
		ParsedAt: time.Now(),
	}, nil
}

func extractXMLText(data []byte) (string, error) {
	dec := xml.NewDecoder(bytes.NewReader(data))
	var b strings.Builder

	for {
		tok, err := dec.Token()
		if err != nil {
			if err == io.EOF {
				break
			}
			// If the XML is malformed, fall back to stripping tags.
			return stripXMLTags(string(data)), nil
		}
		switch t := tok.(type) {
		case xml.CharData:
			s := strings.TrimSpace(string(t))
			if s != "" {
				if b.Len() > 0 {
					b.WriteString("\n")
				}
				b.WriteString(s)
			}
		}
	}
	return strings.TrimSpace(b.String()), nil
}

func stripXMLTags(s string) string {
	var b strings.Builder
	inTag := false
	for _, r := range s {
		switch {
		case r == '<':
			inTag = true
		case r == '>':
			inTag = false
		case !inTag:
			b.WriteRune(r)
		}
	}
	return strings.TrimSpace(b.String())
}
