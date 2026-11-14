// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package push

import (
	"context"
	"fmt"
	"time"
)

// MockProvider is a Provider whose Send result is fully configurable.
// It is intended for tests and local development.
type MockProvider struct {
	ShouldFail      bool   // when true, Send returns an error
	ResultMessageID string // message ID returned on success
	ResultStatus    string // status string returned on success (defaults to "sent")
	SentRequests    []SendRequest
}

// Kind returns ProviderMock.
func (m *MockProvider) Kind() ProviderKind { return ProviderMock }

// Send records the request and returns a configurable result.
func (m *MockProvider) Send(ctx context.Context, req SendRequest) (*SendResult, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	m.SentRequests = append(m.SentRequests, req)
	if m.ShouldFail {
		return &SendResult{
			Provider:   ProviderMock,
			Accepted:   false,
			Status:     "failed",
			Error:      "mock: configured failure",
			SentAtUnix: time.Now().Unix(),
		}, fmt.Errorf("mock: configured failure")
	}
	status := m.ResultStatus
	if status == "" {
		status = "sent"
	}
	mid := m.ResultMessageID
	if mid == "" {
		mid = "mock-message-id"
	}
	return &SendResult{
		Provider:   ProviderMock,
		MessageID:  mid,
		Accepted:   true,
		Status:     status,
		SentAtUnix: time.Now().Unix(),
	}, nil
}

// NewMockProvider builds a MockProvider from a ProviderConfig.
// Recognised keys:
//   - should_fail (bool)
//   - message_id  (string)
//   - status      (string)
func NewMockProvider(cfg ProviderConfig) (Provider, error) {
	m := &MockProvider{}
	if cfg != nil {
		if v, ok := cfg["should_fail"]; ok {
			if b, ok := toBool(v); ok {
				m.ShouldFail = b
			}
		}
		if v, ok := cfg["message_id"]; ok {
			m.ResultMessageID = fmt.Sprintf("%v", v)
		}
		if v, ok := cfg["status"]; ok {
			m.ResultStatus = fmt.Sprintf("%v", v)
		}
	}
	return m, nil
}

// toBool converts common truthy representations to bool.
func toBool(v any) (bool, bool) {
	switch x := v.(type) {
	case bool:
		return x, true
	case string:
		return x == "true" || x == "1" || x == "yes", true
	case int:
		return x != 0, true
	case float64:
		return x != 0, true
	}
	return false, false
}
