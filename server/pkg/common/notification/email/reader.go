// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package email

import (
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"net/mail"
	"strings"
	"time"
)

// ──────────────────────────────────────────────
// Mail reader — fetch and parse inbound emails
// ──────────────────────────────────────────────

// MailMessage is a parsed inbound email message.
type MailMessage struct {
	ID          string      // message ID from headers
	From        string      // sender address
	FromName    string      // sender display name
	To          []string    // recipient addresses
	Cc          []string    // CC addresses
	Subject     string      // subject line
	TextBody    string      // plain text body
	HTMLBody    string      // HTML body
	ReplyTo     string      // Reply-To header
	Date        time.Time   // Date header
	Headers     mail.Header // raw headers
	Attachments []MailAttachment
}

// MailAttachment is a parsed email attachment.
type MailAttachment struct {
	Filename    string
	ContentType string
	Size        int64
	Data        []byte
}

// MailReader is the abstraction for fetching and reading emails from
// a mailbox (IMAP, POP3, API-based, etc.).
type MailReader interface {
	// ReadMessages fetches up to limit unread messages from the mailbox.
	// If limit <= 0, all unread messages are fetched.
	ReadMessages(limit int) ([]*MailMessage, error)
	// MarkRead marks the message with the given ID as read.
	MarkRead(id string) error
	// DeleteMessage deletes the message with the given ID.
	DeleteMessage(id string) error
	// Close closes the reader and releases any resources.
	Close() error
}

// ──────────────────────────────────────────────
// RFC 822 message parsing
// ──────────────────────────────────────────────

// ParseMailMessage parses a raw RFC 822 message (as returned by IMAP
// FETCH or POP3 RETR) into a MailMessage. It extracts text and HTML
// bodies, handles multipart/alternative and multipart/mixed, and
// collects attachments.
func ParseMailMessage(raw []byte) (*MailMessage, error) {
	msg, err := mail.ReadMessage(strings.NewReader(string(raw)))
	if err != nil {
		return nil, fmt.Errorf("email: parse message: %w", err)
	}

	result := &MailMessage{
		Headers: msg.Header,
	}

	// Parse standard headers.
	result.ID = strings.TrimSpace(msg.Header.Get("Message-Id"))
	result.Subject = decodeMimeHeader(msg.Header.Get("Subject"))
	result.ReplyTo = strings.TrimSpace(msg.Header.Get("Reply-To"))

	// Parse From.
	from := msg.Header.Get("From")
	if addr, err := mail.ParseAddress(from); err == nil {
		result.From = addr.Address
		result.FromName = addr.Name
	} else {
		result.From = strings.TrimSpace(from)
	}

	// Parse To.
	result.To = parseAddressList(msg.Header.Get("To"))
	result.Cc = parseAddressList(msg.Header.Get("Cc"))

	// Parse Date.
	if dateStr := msg.Header.Get("Date"); dateStr != "" {
		if d, err := mail.ParseDate(dateStr); err == nil {
			result.Date = d
		}
	}

	// Parse body and attachments.
	contentType := msg.Header.Get("Content-Type")
	if contentType == "" {
		// Plain text message.
		body, err := io.ReadAll(msg.Body)
		if err != nil {
			return nil, fmt.Errorf("email: read body: %w", err)
		}
		result.TextBody = string(body)
		return result, nil
	}

	mediaType, params, err := mime.ParseMediaType(contentType)
	if err != nil {
		// Fallback: treat as plain text.
		body, _ := io.ReadAll(msg.Body)
		result.TextBody = string(body)
		return result, nil
	}

	if strings.HasPrefix(mediaType, "multipart/") {
		if err := parseMultipart(msg.Body, params["boundary"], result); err != nil {
			return nil, fmt.Errorf("email: parse multipart: %w", err)
		}
	} else {
		// Single part message.
		body, err := io.ReadAll(msg.Body)
		if err != nil {
			return nil, fmt.Errorf("email: read body: %w", err)
		}
		assignBody(result, mediaType, string(body))
	}

	return result, nil
}

// parseMultipart recursively parses multipart bodies.
func parseMultipart(body io.Reader, boundary string, result *MailMessage) error {
	if boundary == "" {
		return fmt.Errorf("missing boundary")
	}
	mpr := multipart.NewReader(body, boundary)
	for {
		part, err := mpr.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}
		contentType := part.Header.Get("Content-Type")
		mediaType, params, err := mime.ParseMediaType(contentType)
		if err != nil {
			mediaType = "text/plain"
		}

		if strings.HasPrefix(mediaType, "multipart/") {
			if err := parseMultipart(part, params["boundary"], result); err != nil {
				return err
			}
			continue
		}

		data, err := io.ReadAll(part)
		if err != nil {
			return err
		}

		disposition := part.Header.Get("Content-Disposition")
		if strings.Contains(strings.ToLower(disposition), "attachment") ||
			(strings.Contains(strings.ToLower(disposition), "inline") && part.FileName() != "") {
			result.Attachments = append(result.Attachments, MailAttachment{
				Filename:    part.FileName(),
				ContentType: mediaType,
				Size:        int64(len(data)),
				Data:        data,
			})
			continue
		}

		assignBody(result, mediaType, string(data))
	}
	return nil
}

// assignBody sets the appropriate body field based on content type.
func assignBody(msg *MailMessage, contentType, body string) {
	switch {
	case strings.HasPrefix(contentType, "text/html"):
		if msg.HTMLBody == "" {
			msg.HTMLBody = body
		}
	case strings.HasPrefix(contentType, "text/plain"):
		if msg.TextBody == "" {
			msg.TextBody = body
		}
	default:
		// Non-text content without attachment disposition — store as text fallback.
		if msg.TextBody == "" {
			msg.TextBody = body
		}
	}
}

// parseAddressList parses a comma-separated list of email addresses.
func parseAddressList(list string) []string {
	if strings.TrimSpace(list) == "" {
		return nil
	}
	addrs, err := mail.ParseAddressList(list)
	if err != nil {
		return []string{strings.TrimSpace(list)}
	}
	result := make([]string, 0, len(addrs))
	for _, a := range addrs {
		result = append(result, a.Address)
	}
	return result
}

// decodeMimeHeader decodes RFC 2047 encoded-word headers.
func decodeMimeHeader(s string) string {
	dec := new(mime.WordDecoder)
	out, err := dec.DecodeHeader(s)
	if err != nil {
		return s
	}
	return out
}

// ──────────────────────────────────────────────
// In-memory mail reader (for testing)
// ──────────────────────────────────────────────

// MemoryMailReader is a simple in-memory MailReader for testing.
// It stores messages as raw bytes and parses them on demand.
type MemoryMailReader struct {
	messages map[string][]byte // keyed by ID
	readIDs  map[string]bool
	order    []string
}

// NewMemoryMailReader creates a new empty MemoryMailReader.
func NewMemoryMailReader() *MemoryMailReader {
	return &MemoryMailReader{
		messages: make(map[string][]byte),
		readIDs:  make(map[string]bool),
	}
}

// AddMessage adds a raw RFC 822 message to the reader.
func (r *MemoryMailReader) AddMessage(id string, raw []byte) {
	r.messages[id] = raw
	r.order = append(r.order, id)
}

// ReadMessages fetches up to limit unread messages.
func (r *MemoryMailReader) ReadMessages(limit int) ([]*MailMessage, error) {
	var result []*MailMessage
	count := 0
	for _, id := range r.order {
		if r.readIDs[id] {
			continue
		}
		raw, ok := r.messages[id]
		if !ok {
			continue
		}
		msg, err := ParseMailMessage(raw)
		if err != nil {
			continue
		}
		if msg.ID == "" {
			msg.ID = id
		}
		result = append(result, msg)
		count++
		if limit > 0 && count >= limit {
			break
		}
	}
	return result, nil
}

// MarkRead marks a message as read.
func (r *MemoryMailReader) MarkRead(id string) error {
	if _, ok := r.messages[id]; !ok {
		return fmt.Errorf("email: message %q not found", id)
	}
	r.readIDs[id] = true
	return nil
}

// DeleteMessage removes a message.
func (r *MemoryMailReader) DeleteMessage(id string) error {
	if _, ok := r.messages[id]; !ok {
		return fmt.Errorf("email: message %q not found", id)
	}
	delete(r.messages, id)
	delete(r.readIDs, id)
	// Remove from order slice.
	for i, oid := range r.order {
		if oid == id {
			r.order = append(r.order[:i], r.order[i+1:]...)
			break
		}
	}
	return nil
}

// Close is a no-op for the in-memory reader.
func (r *MemoryMailReader) Close() error { return nil }
