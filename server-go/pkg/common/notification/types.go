// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package notification

import "time"

// MessageType identifies the notification channel type.
type MessageType string

const (
	TypeEmail   MessageType = "email"
	TypeSMS     MessageType = "sms"
	TypeIM      MessageType = "im"
	TypeWebhook MessageType = "webhook"
	TypeInbox   MessageType = "inbox"
	TypePush    MessageType = "push"
)

// Message is the unified notification payload. Not all fields are
// relevant for every channel type; providers ignore fields they don't
// use.
type Message struct {
	Type    MessageType    // channel type (email, sms, im, webhook, inbox)
	To      string         // recipient (email address, phone number, user ID, URL)
	Subject string         // subject line (email, IM title)
	Body    string         // plain-text body
	HTML    string         // HTML body (email)
	Data    map[string]any // template variables or provider-specific data
	Extras  map[string]any // additional provider-specific fields

	// SMS-specific
	PhoneNumber string // full phone number with country code
	CountryCode int    // country code (e.g. 86 for China)
	Template    string // provider template ID
	SignName    string // SMS signature name

	// IM-specific
	Title   string // IM message title
	Content string // IM message content (markdown or plain)

	// Webhook-specific
	Event string // webhook event name
	URL   string // webhook target URL

	// Inbox-specific
	UserID      string // target user ID
	ActionURL   string // optional action link
	ActionLabel string // optional action button label

	// Metadata
	Locale    string // locale for i18n template rendering
	IPAddress string // client IP for audit logging
	Timestamp time.Time
}

// NewEmailMessage is a convenience constructor for email messages.
func NewEmailMessage(to, subject, body string) Message {
	return Message{
		Type:    TypeEmail,
		To:      to,
		Subject: subject,
		Body:    body,
	}
}

// NewSMSMessage is a convenience constructor for SMS messages.
func NewSMSMessage(phone, content string) Message {
	return Message{
		Type:        TypeSMS,
		To:          phone,
		PhoneNumber: phone,
		Body:        content,
		Content:     content,
	}
}

// NewIMMessage is a convenience constructor for IM messages.
func NewIMMessage(title, content string) Message {
	return Message{
		Type:    TypeIM,
		Title:   title,
		Content: content,
		Subject: title,
		Body:    content,
	}
}

// NewWebhookMessage is a convenience constructor for webhook messages.
func NewWebhookMessage(event, url string, data map[string]any) Message {
	return Message{
		Type:   TypeWebhook,
		Event:  event,
		URL:    url,
		To:     url,
		Data:   data,
		Extras: data,
	}
}

// NewInboxMessage is a convenience constructor for in-app inbox messages.
func NewInboxMessage(userID, title, content string) Message {
	return Message{
		Type:    TypeInbox,
		UserID:  userID,
		To:      userID,
		Subject: title,
		Title:   title,
		Body:    content,
		Content: content,
	}
}

// NewPushMessage is a convenience constructor for mobile push messages.
// The device token is placed in both To and Data so the push channel can
// recover it from either field.
func NewPushMessage(token, title, body string) Message {
	return Message{
		Type:    TypePush,
		To:      token,
		Subject: title,
		Title:   title,
		Body:    body,
		Content: body,
		Data:    map[string]any{"token": token},
	}
}
