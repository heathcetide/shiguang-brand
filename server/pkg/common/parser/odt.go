package parser

import (
	"context"
	"encoding/xml"
	"fmt"
	"io"
	"path"
	"strings"
	"time"
)

// ODTParser parses OpenDocument Text (.odt) files, which are zip archives
// containing XML content. It extracts text from content.xml.
type ODTParser struct{}

func (p *ODTParser) Provider() string { return FileTypeODT }

func (p *ODTParser) SupportedTypes() []string { return []string{FileTypeODT, FileTypeODS, FileTypeODP} }

func (p *ODTParser) Parse(ctx context.Context, req *ParseRequest, opts *ParseOptions) (*ParseResult, error) {
	_ = ctx
	if req == nil {
		return nil, ErrEmptyInput
	}

	z, fileName, err := openZipFromRequest(req)
	if err != nil {
		return nil, err
	}

	// OpenDocument stores content in content.xml.
	contentXML, ok, err := readZipFile(z, "content.xml")
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, fmt.Errorf("odt: content.xml not found in archive")
	}

	text, err := extractODTText(contentXML)
	if err != nil {
		return nil, err
	}
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

// extractODTText walks the OpenDocument XML tree and extracts text from
// text:p, text:h, and text:span elements.
func extractODTText(xmlBytes []byte) (string, error) {
	dec := xml.NewDecoder(strings.NewReader(string(xmlBytes)))
	var b strings.Builder

	inText := false
	needNewline := false

	for {
		tok, err := dec.Token()
		if err != nil {
			if err == io.EOF {
				break
			}
			return "", err
		}
		switch t := tok.(type) {
		case xml.StartElement:
			local := t.Name.Local
			switch local {
			case "p", "h":
				inText = true
				needNewline = true
			case "span", "tab":
				inText = true
			case "line-break":
				b.WriteString("\n")
			}
		case xml.EndElement:
			if t.Name.Local == "p" || t.Name.Local == "h" {
				inText = false
			}
		case xml.CharData:
			if !inText {
				continue
			}
			s := strings.TrimSpace(string(t))
			if s == "" {
				continue
			}
			if needNewline && b.Len() > 0 {
				b.WriteString("\n")
				needNewline = false
			}
			if b.Len() > 0 {
				last := b.String()[b.Len()-1]
				if last != '\n' && last != ' ' {
					b.WriteByte(' ')
				}
			}
			b.WriteString(s)
		}
	}

	return strings.TrimSpace(b.String()), nil
}

// Ensure path is referenced (used for potential future media extraction).
var _ = path.Clean
