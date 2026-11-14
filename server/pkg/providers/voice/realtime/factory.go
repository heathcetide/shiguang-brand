// Package realtime — credential-driven Agent factory.
//
// The tenant control plane persists JSON of the form
// `{ "provider": "<slug>", ...vendor fields }`. Callers call
// NewAgentFromCredential to materialise an Agent without importing any
// provider package directly — providers self-register via blank import
// at the application entrypoint.

package realtime

import (
	"fmt"
	"strings"
)

// NewAgentFromCredential resolves a Provider by `cfg["provider"]` and
// constructs an Agent. Returns ErrUnknownProvider when the slug is missing
// or unregistered.
func NewAgentFromCredential(cfg map[string]any, opts Options) (Agent, error) {
	if len(cfg) == 0 {
		return nil, fmt.Errorf("realtime: empty credential config")
	}
	slug := strings.ToLower(strings.TrimSpace(stringField(cfg, "provider")))
	if slug == "" {
		return nil, fmt.Errorf("realtime: missing provider field")
	}
	p := Lookup(slug)
	if p == nil {
		return nil, &ErrUnknownProvider{Provider: slug}
	}
	if opts.OnEvent == nil {
		return nil, fmt.Errorf("realtime: Options.OnEvent is required")
	}
	if opts.InputSampleRate <= 0 {
		opts.InputSampleRate = 16000
	}
	if opts.OutputSampleRate <= 0 {
		opts.OutputSampleRate = 24000
	}
	return p(cfg, opts)
}

// MustCreate is like NewAgentFromCredential but panics on error.
func MustCreate(cfg map[string]any, opts Options) Agent {
	agent, err := NewAgentFromCredential(cfg, opts)
	if err != nil {
		panic(err)
	}
	return agent
}

// AllProviders returns all registered provider slugs in sorted order.
func AllProviders() []string {
	return RegisteredProviders()
}

// stringField helpers — kept private; provider implementations should use
// their own typed config.
func stringField(m map[string]any, key string) string {
	if m == nil {
		return ""
	}
	if v, ok := m[key]; ok {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return ""
}

// StringField is the exported version of stringField for vendor sub-packages.
func StringField(m map[string]any, key string) string {
	return stringField(m, key)
}

// FirstString returns the first non-empty string value found for the given keys.
func FirstString(m map[string]any, keys ...string) string {
	for _, k := range keys {
		if v, ok := m[k]; ok {
			if s, ok := v.(string); ok && strings.TrimSpace(s) != "" {
				return s
			}
		}
	}
	return ""
}

// FirstInt returns the first non-zero int value found for the given keys.
func FirstInt(m map[string]any, keys ...string) int {
	for _, k := range keys {
		if v, ok := m[k]; ok {
			switch t := v.(type) {
			case int:
				return t
			case int64:
				return int(t)
			case float64:
				return int(t)
			}
		}
	}
	return 0
}
