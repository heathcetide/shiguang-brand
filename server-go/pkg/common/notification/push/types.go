// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package push

import (
	"context"
	"fmt"
	"strings"
)

// ProviderKind identifies a mobile push backend provider.
type ProviderKind string

// Known provider kinds.
const (
	ProviderAPNs    ProviderKind = "apns"    // Apple Push Notification service
	ProviderFCM     ProviderKind = "fcm"     // Firebase Cloud Messaging
	ProviderUniPush ProviderKind = "unipush" // Unified Push (Huawei HMS, etc.)
	ProviderMock    ProviderKind = "mock"
)

// Platform identifies the target device platform. It is used by aggregators
// such as UniPush to route a device token to the correct vendor API.
type Platform string

const (
	PlatformIOS     Platform = "ios"     // Apple iOS (APNs)
	PlatformAndroid Platform = "android" // generic Android (FCM) or Huawei
	PlatformHuawei  Platform = "huawei"  // Huawei HMS Push
)

// DeviceToken is a single recipient device token together with its platform
// and an optional provider-specific app ID (e.g. a Huawei AppID).
type DeviceToken struct {
	Token    string   // provider-assigned device push token
	Platform Platform // target platform for routing
	AppID    string   // optional provider-specific app ID (e.g. Huawei AppID)
}

// Notification is the push payload. Title or Body must be non-empty for a
// visible alert; Data alone produces a silent data push.
type Notification struct {
	Title            string            // alert title
	Body             string            // alert body text
	Badge            int               // iOS badge number (0 = unchanged)
	Sound            string            // sound file name (default "default")
	Icon             string            // Android notification icon resource
	Tag              string            // Android notification tag
	Color            string            // Android notification accent color (e.g. "#RRGGBB")
	ClickAction      string            // click action: a URL, deep-link, or activity name
	Data             map[string]string // custom payload data
	LocalizationKey  string            // iOS localized alert key
	LocalizationArgs []string          // iOS localized alert format arguments
}

// SendRequest is the input to Provider.Send.
type SendRequest struct {
	To           []DeviceToken  // one or more recipient device tokens
	Notification Notification   // notification payload
	Extras       map[string]any // provider-specific extras
	CollapseKey  string         // FM collapse key (groups collapsible messages)
	TimeToLive   int            // seconds, 0 = provider default
	Priority     string         // "normal" or "high"
}

// SendResult is the outcome of a single send attempt.
type SendResult struct {
	Provider   ProviderKind // provider that produced this result
	MessageID  string       // provider-assigned message ID
	Accepted   bool         // whether the provider accepted the request
	Status     string       // delivery status string (provider-specific)
	Error      string       // error message, empty on success
	Raw        string       // raw provider response (for debugging)
	SentAtUnix int64        // send timestamp in unix seconds
}

// Provider is the interface implemented by every push backend.
type Provider interface {
	// Kind returns the provider identifier.
	Kind() ProviderKind

	// Send delivers the request through this provider.
	Send(ctx context.Context, req SendRequest) (*SendResult, error)
}

// ValidateBasic performs lightweight validation of a SendRequest: it
// requires at least one recipient with a non-empty token and either a
// non-empty Title or Body.
func ValidateBasic(req SendRequest) error {
	if len(req.To) == 0 {
		return fmt.Errorf("push: recipients list is empty")
	}
	for i, t := range req.To {
		if strings.TrimSpace(t.Token) == "" {
			return fmt.Errorf("push: recipient %d has empty token", i)
		}
	}
	if strings.TrimSpace(req.Notification.Title) == "" && strings.TrimSpace(req.Notification.Body) == "" {
		return fmt.Errorf("push: notification title or body is required")
	}
	return nil
}

// FirstDeviceToken returns the first recipient's DeviceToken or an error
// if there are none or the first token is empty.
func FirstDeviceToken(req SendRequest) (DeviceToken, error) {
	if len(req.To) == 0 {
		return DeviceToken{}, fmt.Errorf("push: no recipients")
	}
	t := req.To[0]
	if strings.TrimSpace(t.Token) == "" {
		return DeviceToken{}, fmt.Errorf("push: first recipient has empty token")
	}
	return t, nil
}
