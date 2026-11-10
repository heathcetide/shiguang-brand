// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package email

import (
	"fmt"
	"regexp"
	"strings"
	"time"
)

// MailProvider is the interface implemented by email backends (SMTP,
// third-party HTTP APIs, etc.). Each provider knows how to render and
// deliver a single message.
type MailProvider interface {
	// Kind returns a short identifier for the provider (e.g. "smtp").
	Kind() string

	// SendHTMLWith sends an HTML message, applying the given template
	// variables to the subject and body before delivery. It returns the
	// provider-assigned message ID (if any) and an error.
	SendHTMLWith(to, subject, htmlBody string, vars map[string]any) (string, error)

	// SendTextWith sends a plain-text message, applying the given
	// template variables to the subject and body before delivery. It
	// returns the provider-assigned message ID (if any) and an error.
	SendTextWith(to, subject, textBody string, vars map[string]any) (string, error)
}

// SMTPConfig holds the connection settings for an SMTP server.
type SMTPConfig struct {
	Host     string // SMTP server host (e.g. "smtp.example.com")
	Port     int    // SMTP server port (e.g. 25, 465, 587)
	Username string // authentication username (optional)
	Password string // authentication password (optional)
	From     string // sender address, may be "Name <addr@example.com>"
	FromName string // fallback sender display name when From has no name
}

// RetryPolicy controls retry behaviour for the Mailer.
type RetryPolicy struct {
	MaxAttempts    int           // total attempts per provider (>=1)
	InitialBackoff time.Duration // backoff before the first retry
	MaxBackoff     time.Duration // upper bound for backoff growth
}

// DefaultRetryPolicy returns a sensible default retry policy:
// 3 attempts, starting at 1s, capped at 10s.
func DefaultRetryPolicy() RetryPolicy {
	return RetryPolicy{
		MaxAttempts:    3,
		InitialBackoff: 1 * time.Second,
		MaxBackoff:     10 * time.Second,
	}
}

// Delivery status constants. These mirror the values used by the
// parent notification package's LogEntry.Status field.
const (
	StatusSent       = "sent"
	StatusFailed     = "failed"
	StatusPending    = "pending"
	StatusDelivered  = "delivered"
	StatusSoftBounce = "soft_bounce"
	StatusInvalid    = "invalid"
)

// placeholderRe matches {{.Key}} style placeholders.
var placeholderRe = regexp.MustCompile(`\{\{\s*\.([A-Za-z0-9_]+)\s*\}\}`)

// ReplacePlaceholders substitutes every "{{.Key}}" occurrence in
// template with the stringified value of vars[Key]. Missing keys are
// left untouched (the placeholder text is preserved).
func ReplacePlaceholders(template string, vars map[string]any) string {
	if vars == nil || len(vars) == 0 {
		return template
	}
	return placeholderRe.ReplaceAllStringFunc(template, func(m string) string {
		sub := placeholderRe.FindStringSubmatch(m)
		if len(sub) < 2 {
			return m
		}
		val, ok := vars[sub[1]]
		if !ok {
			return m
		}
		return fmt.Sprintf("%v", val)
	})
}

// senderRe parses "Name <email@x.com>" formatted strings.
var senderRe = regexp.MustCompile(`^\s*(.*?)\s*<\s*([^>]+?)\s*>\s*$`)

// emailRe performs a lightweight email address sanity check.
var emailRe = regexp.MustCompile(`^[^\s@]+@[^\s@]+\.[^\s@]+$`)

// ParseSender parses a "From" header value of the form
// "Name <email@x.com>" or a bare "email@x.com". When no name is
// present, nameFallback is returned as the display name. The returned
// email is validated; an error is returned for malformed input.
func ParseSender(fromField, nameFallback string) (name, email string, err error) {
	fromField = strings.TrimSpace(fromField)
	if fromField == "" {
		return "", "", fmt.Errorf("email: empty sender field")
	}

	if m := senderRe.FindStringSubmatch(fromField); m != nil {
		name = strings.TrimSpace(m[1])
		email = strings.TrimSpace(m[2])
		if name == "" {
			name = nameFallback
		}
	} else {
		// No angle-bracket section: treat the whole thing as an address.
		email = fromField
		name = nameFallback
	}

	if !emailRe.MatchString(email) {
		return "", "", fmt.Errorf("email: invalid sender address %q", email)
	}
	return name, email, nil
}
