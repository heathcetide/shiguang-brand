package parser

import (
	"bytes"
	"context"
	"strings"
	"time"
)

// VCFParser parses vCard (.vcf) contact files and extracts contact information.
type VCFParser struct{}

func (p *VCFParser) Provider() string { return FileTypeVCF }

func (p *VCFParser) SupportedTypes() []string { return []string{FileTypeVCF} }

func (p *VCFParser) Parse(ctx context.Context, req *ParseRequest, opts *ParseOptions) (*ParseResult, error) {
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

	text := extractVCFText(string(data))
	text = normalizeText(text, opts)
	text = truncateText(text, opts)

	return &ParseResult{
		FileType: FileTypeVCF,
		FileName: fileName,
		Text:     text,
		Sections: []Section{{Type: SectionTypeDocument, Index: 0, Title: fileName, Text: text}},
		Metadata: req.Metadata,
		ParsedAt: time.Now(),
	}, nil
}

func extractVCFText(raw string) string {
	// Unfold line continuations.
	var unfolded strings.Builder
	for _, line := range strings.Split(raw, "\n") {
		line = strings.TrimRight(line, "\r")
		if strings.HasPrefix(line, " ") || strings.HasPrefix(line, "\t") {
			unfolded.WriteString(line[1:])
		} else {
			if unfolded.Len() > 0 {
				unfolded.WriteString("\n")
			}
			unfolded.WriteString(line)
		}
	}

	var b strings.Builder
	inCard := false
	cardIdx := 0
	for _, line := range strings.Split(unfolded.String(), "\n") {
		line = strings.TrimSpace(line)
		switch {
		case strings.EqualFold(line, "BEGIN:VCARD"):
			inCard = true
			if b.Len() > 0 {
				b.WriteString("\n\n")
			}
			b.WriteString("=== Contact ")
			b.WriteString(itoa(cardIdx + 1))
			b.WriteString(" ===\n")
			cardIdx++
		case strings.EqualFold(line, "END:VCARD"):
			inCard = false
		case inCard:
			parts := strings.SplitN(line, ":", 2)
			if len(parts) != 2 {
				continue
			}
			key := strings.ToUpper(strings.SplitN(parts[0], ";", 2)[0])
			val := parts[1]
			switch key {
			case "FN", "N", "TEL", "EMAIL", "ORG", "TITLE", "ADR", "URL", "NOTE":
				b.WriteString(key)
				b.WriteString(": ")
				b.WriteString(unescapeVCF(val))
				b.WriteString("\n")
			}
		}
	}

	if b.Len() == 0 {
		for _, line := range strings.Split(unfolded.String(), "\n") {
			line = strings.TrimSpace(line)
			if line == "" || strings.HasPrefix(line, "BEGIN:") || strings.HasPrefix(line, "END:") {
				continue
			}
			if b.Len() > 0 {
				b.WriteString("\n")
			}
			b.WriteString(line)
		}
	}
	return strings.TrimSpace(b.String())
}

func unescapeVCF(s string) string {
	s = strings.ReplaceAll(s, `\n`, "\n")
	s = strings.ReplaceAll(s, `\,`, ",")
	s = strings.ReplaceAll(s, `\;`, ";")
	s = strings.ReplaceAll(s, `\\`, `\`)
	return s
}
