package parser

import (
	"bytes"
	"context"
	"strings"
	"time"
)

// LOGParser parses log files. Log files are text-based but may have structured
// entries (timestamps, levels). The parser preserves line structure and
// optionally extracts key fields.
type LOGParser struct{}

func (p *LOGParser) Provider() string { return FileTypeLOG }

func (p *LOGParser) SupportedTypes() []string { return []string{FileTypeLOG} }

func (p *LOGParser) Parse(ctx context.Context, req *ParseRequest, opts *ParseOptions) (*ParseResult, error) {
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

	text := string(data)
	text = normalizeText(text, opts)
	text = truncateText(text, opts)

	// Build sections by log level for better structure.
	sections := extractLogSections(text, fileName)

	return &ParseResult{
		FileType: FileTypeLOG,
		FileName: fileName,
		Text:     text,
		Sections: sections,
		Metadata: req.Metadata,
		ParsedAt: time.Now(),
	}, nil
}

func extractLogSections(text, fileName string) []Section {
	lines := strings.Split(text, "\n")
	var allLines []string
	allLines = append(allLines, lines...)

	// Group lines by detected log level.
	levelMap := map[string][]string{
		"ERROR": {},
		"WARN":  {},
		"INFO":  {},
		"DEBUG": {},
		"TRACE": {},
		"FATAL": {},
	}
	var other []string

	for _, line := range allLines {
		upper := strings.ToUpper(line)
		classified := false
		for level := range levelMap {
			if strings.HasPrefix(upper, level+" ") || strings.HasPrefix(upper, level+"\t") ||
				strings.Contains(upper, " "+level+" ") || strings.Contains(upper, "\t"+level+"\t") ||
				strings.Contains(upper, "]"+level+"[") || strings.Contains(upper, "["+level+"]") ||
				strings.Contains(upper, "="+level+"") || strings.Contains(upper, level+":") {
				levelMap[level] = append(levelMap[level], line)
				classified = true
				break
			}
		}
		if !classified {
			other = append(other, line)
		}
	}

	sections := []Section{{Type: SectionTypeDocument, Index: 0, Title: fileName, Text: text}}

	// Add level-specific sections if they have content.
	idx := 1
	for _, level := range []string{"FATAL", "ERROR", "WARN", "INFO", "DEBUG", "TRACE"} {
		if len(levelMap[level]) > 0 {
			sections = append(sections, Section{
				Type:  SectionTypeDocument,
				Index: idx,
				Title: level,
				Text:  strings.Join(levelMap[level], "\n"),
			})
			idx++
		}
	}

	return sections
}
