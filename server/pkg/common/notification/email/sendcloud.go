// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package email

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// SendCloudConfig holds SendCloud API credentials and sender defaults.
type SendCloudConfig struct {
	APIUser  string // SendCloud API user
	APIKey   string // SendCloud API key
	From     string // sender address (may be "Name <email@x.com>")
	FromName string // fallback sender display name
	Endpoint string // API endpoint override (defaults to the public endpoint)
}

// SendCloudProvider sends email via the SendCloud HTTP API.
type SendCloudProvider struct {
	cfg      SendCloudConfig
	client   *http.Client
	endpoint string
	from     string
	fromName string
}

// NewSendCloudProvider constructs a SendCloudProvider from the given config.
func NewSendCloudProvider(cfg SendCloudConfig) (*SendCloudProvider, error) {
	if strings.TrimSpace(cfg.APIUser) == "" || strings.TrimSpace(cfg.APIKey) == "" {
		return nil, fmt.Errorf("email: sendcloud api_user and api_key are required")
	}
	if strings.TrimSpace(cfg.From) == "" {
		return nil, fmt.Errorf("email: sendcloud from address is required")
	}
	// Validate the from address.
	_, _, err := ParseSender(cfg.From, cfg.FromName)
	if err != nil {
		return nil, fmt.Errorf("email: sendcloud invalid from: %w", err)
	}
	endpoint := strings.TrimSpace(cfg.Endpoint)
	if endpoint == "" {
		endpoint = "https://api.sendcloud.net/apiv2/mail/send"
	}
	return &SendCloudProvider{
		cfg:      cfg,
		client:   &http.Client{Timeout: 30 * time.Second},
		endpoint: endpoint,
		from:     cfg.From,
		fromName: cfg.FromName,
	}, nil
}

// Kind returns "sendcloud".
func (p *SendCloudProvider) Kind() string { return "sendcloud" }

// sendCloudSendResponse is the SendCloud API response.
type sendCloudSendResponse struct {
	Result    bool   `json:"result"`
	Message   string `json:"message"`
	MessageID string `json:"messageId"`
	Data      struct {
		MessageID string `json:"messageId"`
	} `json:"data"`
	Info struct {
		EmailIDList []string `json:"emailIdList"`
		MessageID   string   `json:"messageId"`
	} `json:"info"`
}

// SendHTMLWith renders the subject and HTML body with vars and sends
// the message via the SendCloud API.
func (p *SendCloudProvider) SendHTMLWith(to, subject, htmlBody string, vars map[string]any) (string, error) {
	return p.sendMail(to, subject, htmlBody, vars, "html")
}

// SendTextWith renders the subject and text body with vars and sends
// the message via the SendCloud API.
func (p *SendCloudProvider) SendTextWith(to, subject, textBody string, vars map[string]any) (string, error) {
	return p.sendMail(to, subject, textBody, vars, "plain")
}

// sendMail is the shared implementation for SendHTMLWith and SendTextWith.
func (p *SendCloudProvider) sendMail(to, subject, body string, vars map[string]any, bodyType string) (string, error) {
	fromName, fromAddr, err := ParseSender(p.from, p.fromName)
	if err != nil {
		return "", fmt.Errorf("sendcloud: invalid from: %w", err)
	}

	data := url.Values{}
	data.Set("apiUser", p.cfg.APIUser)
	data.Set("apiKey", p.cfg.APIKey)
	data.Set("to", to)
	data.Set("from", fromAddr)
	if fromName != "" {
		data.Set("fromName", fromName)
	}
	data.Set("subject", ReplacePlaceholders(subject, vars))
	data.Set(bodyType, ReplacePlaceholders(body, vars))

	req, err := http.NewRequest(http.MethodPost, p.endpoint, strings.NewReader(data.Encode()))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := p.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("sendcloud: request failed: %w", err)
	}
	defer resp.Body.Close()

	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("sendcloud: read body: %w", err)
	}

	var result sendCloudSendResponse
	_ = json.Unmarshal(responseBody, &result)

	if resp.StatusCode/100 != 2 {
		msg := strings.TrimSpace(result.Message)
		if msg == "" {
			msg = strings.TrimSpace(string(responseBody))
		}
		if msg == "" {
			msg = resp.Status
		}
		return "", fmt.Errorf("sendcloud: http %d: %s", resp.StatusCode, msg)
	}
	if !result.Result {
		msg := strings.TrimSpace(result.Message)
		if msg == "" {
			msg = "request failed"
		}
		return "", fmt.Errorf("sendcloud: %s", msg)
	}

	// Extract message ID from multiple possible locations.
	if len(result.Info.EmailIDList) > 0 && result.Info.EmailIDList[0] != "" {
		return result.Info.EmailIDList[0], nil
	}
	if result.Info.MessageID != "" {
		return result.Info.MessageID, nil
	}
	if result.Data.MessageID != "" {
		return result.Data.MessageID, nil
	}
	if result.MessageID != "" {
		return result.MessageID, nil
	}
	return "", nil
}

// ──────────────────────────────────────────────
// SendCloud webhook event parsing
// ──────────────────────────────────────────────

// SendCloudWebhookEvent is a normalized webhook payload from SendCloud.
// It can be received as JSON or x-www-form-urlencoded.
type SendCloudWebhookEvent struct {
	Event      string `json:"event"`
	MessageID  string `json:"messageId"`
	Email      string `json:"email"`
	Timestamp  int64  `json:"timestamp"`
	SmtpStatus string `json:"smtpStatus"`
	SmtpError  string `json:"smtpError"`
}

// SendCloudEventToStatus maps SendCloud webhook event codes to mail status.
func SendCloudEventToStatus(event string) string {
	e := strings.TrimSpace(strings.ToLower(event))
	switch e {
	case "1", "deliver", "delivered":
		return StatusDelivered
	case "3", "spam":
		return StatusSpam
	case "4", "invalid":
		return StatusInvalid
	case "5", "soft_bounce", "softbounce", "hard_bounce", "hardbounce", "bounce":
		return StatusSoftBounce
	case "2", "reject", "rejected", "failed", "fail":
		return StatusFailed
	case "10", "click", "clicked":
		return StatusClicked
	case "11", "open", "opened":
		return StatusOpened
	case "12", "unsubscribe", "unsubscribed":
		return StatusUnsubscribed
	case "18", "request":
		return StatusSent
	default:
		return StatusUnknown
	}
}

// Additional delivery status constants for SendCloud webhook events.
const (
	StatusSpam         = "spam"
	StatusClicked      = "clicked"
	StatusOpened       = "opened"
	StatusUnsubscribed = "unsubscribed"
	StatusUnknown      = "unknown"
)

// ParseSendCloudWebhookEvent parses a JSON or x-www-form-urlencoded
// SendCloud webhook body into a normalized event.
func ParseSendCloudWebhookEvent(data []byte) (*SendCloudWebhookEvent, error) {
	// Try JSON first.
	var event SendCloudWebhookEvent
	if err := json.Unmarshal(data, &event); err == nil && (event.Event != "" || event.MessageID != "") {
		return &event, nil
	}

	// Fall back to form-encoded parsing.
	params, err := url.ParseQuery(string(data))
	if err != nil {
		return nil, fmt.Errorf("sendcloud webhook: parse form: %w", err)
	}

	messageID := params.Get("messageId")
	if messageID == "" {
		messageID = params.Get("emailId")
	}
	if strings.Contains(messageID, "@") {
		parts := strings.Split(messageID, "@")
		if len(parts) > 0 {
			messageID = parts[0]
		}
	}

	event = SendCloudWebhookEvent{
		Event:      params.Get("event"),
		MessageID:  messageID,
		Email:      params.Get("recipient"),
		SmtpStatus: params.Get("smtpStatus"),
		SmtpError:  params.Get("smtpError"),
	}
	if event.Email == "" {
		if emailID := params.Get("emailId"); strings.Contains(emailID, "@") {
			parts := strings.Split(emailID, "@")
			if len(parts) >= 2 {
				event.Email = strings.Join(parts[1:], "@")
			}
		}
	}
	if ts := params.Get("timestamp"); ts != "" {
		if t, err := time.Parse("2006-01-02 15:04:05", ts); err == nil {
			event.Timestamp = t.Unix()
		}
	}
	return &event, nil
}
