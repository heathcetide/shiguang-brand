// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package push

import (
	"fmt"
	"sort"
	"sync"
)

// ProviderConfig is the configuration map passed to a provider factory.
// Keys and value types are provider-specific.
type ProviderConfig map[string]any

// providerFactory builds a Provider from a ProviderConfig.
type providerFactory func(ProviderConfig) (Provider, error)

var (
	registryMu sync.RWMutex
	registry   = map[ProviderKind]providerFactory{}
)

// RegisterProvider registers a factory for the given kind. Registering
// the same kind twice overwrites the previous factory.
func RegisterProvider(kind ProviderKind, factory func(ProviderConfig) (Provider, error)) {
	registryMu.Lock()
	defer registryMu.Unlock()
	registry[kind] = factory
}

// MustRegisterProvider registers a factory and panics on duplicate
// registration. Intended for use in init() blocks.
func MustRegisterProvider(kind ProviderKind, factory func(ProviderConfig) (Provider, error)) {
	registryMu.Lock()
	defer registryMu.Unlock()
	if _, ok := registry[kind]; ok {
		panic(fmt.Sprintf("push: provider %q already registered", kind))
	}
	registry[kind] = factory
}

// NewProviderFromKind looks up the factory for kind and builds a
// provider from cfg. Returns an error for unknown kinds.
func NewProviderFromKind(kind ProviderKind, cfg ProviderConfig) (Provider, error) {
	registryMu.RLock()
	factory, ok := registry[kind]
	registryMu.RUnlock()
	if !ok {
		return nil, fmt.Errorf("push: unknown provider kind %q", kind)
	}
	if factory == nil {
		return nil, fmt.Errorf("push: nil factory for provider %q", kind)
	}
	return factory(cfg)
}

// RegisteredKinds returns the kinds currently registered, sorted for
// deterministic ordering.
func RegisteredKinds() []ProviderKind {
	registryMu.RLock()
	defer registryMu.RUnlock()
	kinds := make([]ProviderKind, 0, len(registry))
	for k := range registry {
		kinds = append(kinds, k)
	}
	sort.Slice(kinds, func(i, j int) bool { return kinds[i] < kinds[j] })
	return kinds
}

func init() {
	MustRegisterProvider(ProviderMock, NewMockProvider)
	MustRegisterProvider(ProviderAPNs, NewAPNsProvider)
	MustRegisterProvider(ProviderFCM, NewFCMProvider)
	MustRegisterProvider(ProviderUniPush, NewUniPushProvider)
}
