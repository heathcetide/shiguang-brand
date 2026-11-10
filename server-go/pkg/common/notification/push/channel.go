// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package push

import (
	"context"
	"fmt"
	"strings"

	"github.com/heathcetide/DietDigiDose/pkg/common/notification"
)

// Channel adapts a MultiSender to the notification.Channel interface so
// it can be registered with a Dispatcher.
type Channel struct {
	name    string
	sender  *MultiSender
	enabled bool
}

// NewChannel creates a push Channel backed by the given MultiSender.
// The channel is enabled by default.
func NewChannel(name string, sender *MultiSender) *Channel {
	return &Channel{
		name:    name,
		sender:  sender,
		enabled: true,
	}
}

// Name returns the channel name.
func (c *Channel) Name() string { return c.name }

// Type returns notification.TypePush.
func (c *Channel) Type() notification.MessageType { return notification.TypePush }

// Enabled reports whether the channel is active.
func (c *Channel) Enabled() bool { return c.enabled }

// SetEnabled toggles the channel on or off.
func (c *Channel) SetEnabled(enabled bool) { c.enabled = enabled }

// Send delivers a notification.Message via the underlying MultiSender.
// The notification.Message is translated into a push SendRequest.
func (c *Channel) Send(ctx context.Context, msg notification.Message) error {
	if c.sender == nil {
		return fmt.Errorf("push: channel %q has no sender", c.name)
	}

	// Determine the recipient device token(s).
	tokens := extractDeviceTokens(msg)
	if len(tokens) == 0 {
		return fmt.Errorf("push: no recipient device token")
	}

	title := strings.TrimSpace(msg.Title)
	if title == "" {
		title = strings.TrimSpace(msg.Subject)
	}
	body := strings.TrimSpace(msg.Body)
	if body == "" {
		body = strings.TrimSpace(msg.Content)
	}

	// Build custom payload data from msg.Data (excluding the token key).
	data := map[string]string{}
	for k, v := range msg.Data {
		if k == "token" || k == "device_token" {
			continue
		}
		data[k] = fmt.Sprintf("%v", v)
	}

	req := SendRequest{
		To: tokens,
		Notification: Notification{
			Title: title,
			Body:  body,
			Data:  data,
		},
		Extras: msg.Extras,
	}

	result, err := c.sender.Send(ctx, req)
	if err != nil {
		if result != nil && result.Error != "" {
			return fmt.Errorf("push: %w (%s)", err, result.Error)
		}
		return err
	}
	if result != nil && !result.Accepted && result.Error != "" {
		return fmt.Errorf("push: send rejected: %s", result.Error)
	}
	return nil
}

// extractDeviceTokens collects device tokens from the notification Message.
// It looks at msg.Data (under "token" or "device_token" or "tokens"),
// msg.Extras (same keys), and finally msg.To.
func extractDeviceTokens(msg notification.Message) []DeviceToken {
	var out []DeviceToken

	platform := guessPlatform(msg)

	// msg.Data may carry a single token or a slice of tokens.
	if v, ok := msg.Data["tokens"]; ok {
		out = append(out, tokensFromAny(v, platform)...)
	}
	if v, ok := msg.Data["device_token"]; ok {
		out = append(out, tokensFromAny(v, platform)...)
	} else if v, ok := msg.Data["token"]; ok {
		out = append(out, tokensFromAny(v, platform)...)
	}

	// msg.Extras mirrors the same lookup.
	if msg.Extras != nil {
		if v, ok := msg.Extras["tokens"]; ok {
			out = append(out, tokensFromAny(v, platform)...)
		}
		if v, ok := msg.Extras["device_token"]; ok {
			out = append(out, tokensFromAny(v, platform)...)
		} else if v, ok := msg.Extras["token"]; ok {
			out = append(out, tokensFromAny(v, platform)...)
		}
	}

	// Fall back to msg.To when no explicit token was found.
	if len(out) == 0 {
		if t := strings.TrimSpace(msg.To); t != "" {
			out = append(out, DeviceToken{Token: t, Platform: platform})
		}
	}

	return out
}

// tokensFromAny converts a single value (string or []string or []any) into
// a slice of DeviceToken with the given platform.
func tokensFromAny(v any, platform Platform) []DeviceToken {
	switch x := v.(type) {
	case string:
		if t := strings.TrimSpace(x); t != "" {
			return []DeviceToken{{Token: t, Platform: platform}}
		}
	case []string:
		for _, s := range x {
			if t := strings.TrimSpace(s); t != "" {
				return []DeviceToken{{Token: t, Platform: platform}}
			}
		}
	case []any:
		var out []DeviceToken
		for _, item := range x {
			if t := strings.TrimSpace(fmt.Sprintf("%v", item)); t != "" {
				out = append(out, DeviceToken{Token: t, Platform: platform})
			}
		}
		return out
	}
	return nil
}

// guessPlatform returns the platform hinted in msg.Extras, defaulting to
// PlatformIOS.
func guessPlatform(msg notification.Message) Platform {
	if msg.Extras != nil {
		if v, ok := msg.Extras["platform"]; ok {
			p := Platform(fmt.Sprintf("%v", v))
			switch p {
			case PlatformIOS, PlatformAndroid, PlatformHuawei:
				return p
			}
		}
	}
	if v, ok := msg.Data["platform"]; ok {
		p := Platform(fmt.Sprintf("%v", v))
		switch p {
		case PlatformIOS, PlatformAndroid, PlatformHuawei:
			return p
		}
	}
	return PlatformIOS
}
