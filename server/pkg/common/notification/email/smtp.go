// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package email

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net/smtp"
	"strings"
	"time"
)

// SMTPProvider sends mail via a plain SMTP server using net/smtp.
type SMTPProvider struct {
	cfg SMTPConfig
}

// NewSMTPProvider constructs an SMTPProvider from the given config.
func NewSMTPProvider(cfg SMTPConfig) *SMTPProvider {
	return &SMTPProvider{cfg: cfg}
}

// Kind returns "smtp".
func (p *SMTPProvider) Kind() string { return "smtp" }

// SendHTMLWith renders the subject and HTML body with vars and sends
// the message as text/html.
func (p *SMTPProvider) SendHTMLWith(to, subject, htmlBody string, vars map[string]any) (string, error) {
	subject = ReplacePlaceholders(subject, vars)
	htmlBody = ReplacePlaceholders(htmlBody, vars)
	return p.sendMail(to, subject, htmlBody, "text/html")
}

// SendTextWith renders the subject and text body with vars and sends
// the message as text/plain.
func (p *SMTPProvider) SendTextWith(to, subject, textBody string, vars map[string]any) (string, error) {
	subject = ReplacePlaceholders(subject, vars)
	textBody = ReplacePlaceholders(textBody, vars)
	return p.sendMail(to, subject, textBody, "text/plain")
}

// sendMail builds a MIME message and delivers it via smtp.SendMail.
// It returns a generated Message-ID.
func (p *SMTPProvider) sendMail(to, subject, body, contentType string) (string, error) {
	name, fromAddr, err := ParseSender(p.cfg.From, p.cfg.FromName)
	if err != nil {
		return "", fmt.Errorf("smtp: invalid from address: %w", err)
	}

	messageID := generateMessageID()
	date := time.Now().Format(time.RFC1123Z)

	var headers strings.Builder
	fmt.Fprintf(&headers, "From: %s <%s>\r\n", name, fromAddr)
	fmt.Fprintf(&headers, "To: %s\r\n", to)
	fmt.Fprintf(&headers, "Subject: %s\r\n", subject)
	fmt.Fprintf(&headers, "MIME-Version: 1.0\r\n")
	fmt.Fprintf(&headers, "Content-Type: %s; charset=UTF-8\r\n", contentType)
	fmt.Fprintf(&headers, "Date: %s\r\n", date)
	fmt.Fprintf(&headers, "Message-ID: <%s>\r\n", messageID)
	headers.WriteString("\r\n")
	headers.WriteString(body)

	addr := fmt.Sprintf("%s:%d", p.cfg.Host, p.cfg.Port)
	var auth smtp.Auth
	if p.cfg.Username != "" && p.cfg.Password != "" {
		auth = smtp.PlainAuth("", p.cfg.Username, p.cfg.Password, p.cfg.Host)
	}

	if err := smtp.SendMail(addr, auth, fromAddr, []string{to}, []byte(headers.String())); err != nil {
		return "", fmt.Errorf("smtp: send failed: %w", err)
	}
	return messageID, nil
}

// generateMessageID produces a random-ish RFC-compliant Message-ID
// local part.
func generateMessageID() string {
	b := make([]byte, 12)
	_, _ = rand.Read(b)
	return fmt.Sprintf("%s@ling-base", hex.EncodeToString(b))
}
