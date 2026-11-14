// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package im

import (
	"encoding/json"
	"fmt"
	"sort"
	"sync"
)

// ProviderFactory builds a Provider from a raw JSON config blob. The
// factory is responsible for unmarshalling the JSON into the
// provider-specific config struct.
type ProviderFactory func(configJSON string) (Provider, error)

var (
	registryMu sync.RWMutex
	registry   = make(map[string]ProviderFactory)
)

func init() {
	// Register the built-in providers.
	RegisterProvider(ProviderWeCom, func(configJSON string) (Provider, error) {
		var cfg WeComConfig
		if err := json.Unmarshal([]byte(configJSON), &cfg); err != nil {
			return nil, fmt.Errorf("im: parse wecom config: %w", err)
		}
		return NewWeComProvider(cfg), nil
	})

	RegisterProvider(ProviderFeishu, func(configJSON string) (Provider, error) {
		var cfg FeishuConfig
		if err := json.Unmarshal([]byte(configJSON), &cfg); err != nil {
			return nil, fmt.Errorf("im: parse feishu config: %w", err)
		}
		return NewFeishuProvider(cfg), nil
	})

	RegisterProvider(ProviderDingTalk, func(configJSON string) (Provider, error) {
		var cfg DingTalkConfig
		if err := json.Unmarshal([]byte(configJSON), &cfg); err != nil {
			return nil, fmt.Errorf("im: parse dingtalk config: %w", err)
		}
		return NewDingTalkProvider(cfg), nil
	})

	RegisterProvider(ProviderWeChat, func(configJSON string) (Provider, error) {
		var cfg WeChatConfig
		if err := json.Unmarshal([]byte(configJSON), &cfg); err != nil {
			return nil, fmt.Errorf("im: parse wechat config: %w", err)
		}
		return NewWeChatProvider(cfg), nil
	})
}

// RegisterProvider registers or replaces a provider factory under the
// given (case-insensitive) name. It is safe for concurrent use and is
// primarily intended for adding custom providers at startup.
func RegisterProvider(name string, factory ProviderFactory) {
	registryMu.Lock()
	defer registryMu.Unlock()
	registry[NormalizeProvider(name)] = factory
}

// RegisteredProviders returns the sorted list of registered provider
// names (canonical, lower-case form).
func RegisteredProviders() []string {
	registryMu.RLock()
	defer registryMu.RUnlock()
	names := make([]string, 0, len(registry))
	for name := range registry {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}

// NewProviderFromConfig looks up the factory for the given provider
// name (case-insensitive) and invokes it with configJSON. It returns
// an error for unknown providers or invalid JSON.
func NewProviderFromConfig(provider string, configJSON string) (Provider, error) {
	name := NormalizeProvider(provider)

	registryMu.RLock()
	factory, ok := registry[name]
	registryMu.RUnlock()

	if !ok {
		return nil, fmt.Errorf("im: unknown provider %q", provider)
	}
	return factory(configJSON)
}
