// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package sms

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

// NewChannel creates an SMS Channel backed by the given MultiSender.
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

// Type returns notification.TypeSMS.
func (c *Channel) Type() notification.MessageType { return notification.TypeSMS }

// Enabled reports whether the channel is active.
func (c *Channel) Enabled() bool { return c.enabled }

// SetEnabled toggles the channel on or off.
func (c *Channel) SetEnabled(enabled bool) { c.enabled = enabled }

// Send delivers a notification.Message via the underlying MultiSender.
// The notification.Message is translated into an SMS SendRequest.
func (c *Channel) Send(ctx context.Context, msg notification.Message) error {
	if c.sender == nil {
		return fmt.Errorf("sms: channel %q has no sender", c.name)
	}

	// Determine the recipient phone number.
	phone := strings.TrimSpace(msg.PhoneNumber)
	if phone == "" {
		phone = strings.TrimSpace(msg.To)
	}
	if phone == "" {
		return fmt.Errorf("sms: no recipient phone number")
	}

	// Strip a leading '+' if present; the country code is handled
	// separately when available.
	number := strings.TrimPrefix(phone, "+")
	cc := msg.CountryCode
	if cc == 0 {
		cc = guessCountryCode(number)
	}

	content := msg.Content
	if content == "" {
		content = msg.Body
	}

	req := SendRequest{
		To: []PhoneNumber{{Number: number, CountryCode: cc}},
		Message: Message{
			Content:  content,
			Template: msg.Template,
			SignName: msg.SignName,
		},
		Extras: msg.Extras,
	}
	if len(msg.Data) > 0 {
		data := make(map[string]string, len(msg.Data))
		for k, v := range msg.Data {
			data[k] = fmt.Sprintf("%v", v)
		}
		req.Message.Data = data
	}

	result, err := c.sender.Send(ctx, req)
	if err != nil {
		if result != nil && result.Error != "" {
			return fmt.Errorf("sms: %w (%s)", err, result.Error)
		}
		return err
	}
	if result != nil && !result.Accepted && result.Error != "" {
		return fmt.Errorf("sms: send rejected: %s", result.Error)
	}
	return nil
}

// guessCountryCode returns a best-effort country code from the leading
// digits of a phone number. It returns 0 when no known prefix matches.
func guessCountryCode(number string) int {
	number = strings.TrimSpace(number)
	if len(number) < 2 {
		return 0
	}
	// A small lookup of common prefixes is enough for the adapter; the
	// real provider will normalise further.
	prefixes := map[string]int{
		"86": 86, "1": 1, "44": 44, "81": 81, "82": 82, "49": 49, "33": 33,
	}
	for pl := 3; pl >= 1; pl-- {
		if len(number) >= pl {
			if cc, ok := prefixes[number[:pl]]; ok {
				return cc
			}
		}
	}
	return 0
}
