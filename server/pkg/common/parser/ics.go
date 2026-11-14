package parser

import (
	"bytes"
	"context"
	"strings"
	"time"
)

// ICSParser parses iCalendar (.ics) files and extracts event summaries, descriptions,
// dates, and locations.
type ICSParser struct{}

func (p *ICSParser) Provider() string { return FileTypeICS }

func (p *ICSParser) SupportedTypes() []string { return []string{FileTypeICS} }

func (p *ICSParser) Parse(ctx context.Context, req *ParseRequest, opts *ParseOptions) (*ParseResult, error) {
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

	text := extractICSText(string(data))
	text = normalizeText(text, opts)
	text = truncateText(text, opts)

	return &ParseResult{
		FileType: FileTypeICS,
		FileName: fileName,
		Text:     text,
		Sections: []Section{{Type: SectionTypeDocument, Index: 0, Title: fileName, Text: text}},
		Metadata: req.Metadata,
		ParsedAt: time.Now(),
	}, nil
}

func extractICSText(raw string) string {
	// Unfold line continuations (lines starting with space/tab are continuations).
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
	inEvent := false
	eventIdx := 0
	for _, line := range strings.Split(unfolded.String(), "\n") {
		line = strings.TrimSpace(line)
		switch {
		case strings.EqualFold(line, "BEGIN:VEVENT"):
			inEvent = true
			if b.Len() > 0 {
				b.WriteString("\n\n")
			}
			b.WriteString("=== Event ")
			b.WriteString(itoa(eventIdx + 1))
			b.WriteString(" ===\n")
			eventIdx++
		case strings.EqualFold(line, "END:VEVENT"):
			inEvent = false
		case inEvent:
			// Extract key properties.
			parts := strings.SplitN(line, ":", 2)
			if len(parts) != 2 {
				continue
			}
			key := strings.ToUpper(strings.SplitN(parts[0], ";", 2)[0])
			val := parts[1]
			switch key {
			case "SUMMARY", "DESCRIPTION", "LOCATION", "DTSTART", "DTEND", "ORGANIZER", "ATTENDEE":
				b.WriteString(key)
				b.WriteString(": ")
				b.WriteString(unescapeICS(val))
				b.WriteString("\n")
			}
		}
	}

	if b.Len() == 0 {
		// No events found; return raw text without calendar metadata.
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

func unescapeICS(s string) string {
	s = strings.ReplaceAll(s, `\n`, "\n")
	s = strings.ReplaceAll(s, `\,`, ",")
	s = strings.ReplaceAll(s, `\;`, ";")
	s = strings.ReplaceAll(s, `\\`, `\`)
	return s
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var buf [20]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	return string(buf[i:])
}
