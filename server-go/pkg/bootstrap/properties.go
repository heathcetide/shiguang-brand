// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package bootstrap

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Properties stores application configuration key-value pairs, analogous to
// Spring's Environment / @Value / PropertySources. Values can be loaded from
// environment variables, a .env-style map, or set programmatically.
type Properties struct {
	mu      sync.RWMutex
	values  map[string]string
	sources []string // track source names for debugging
}

// NewProperties creates a new empty Properties.
func NewProperties() *Properties {
	return &Properties{
		values: make(map[string]string),
	}
}

// Set sets a property value.
func (p *Properties) Set(key, value string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.values[key] = value
}

// Get retrieves a property value. Returns empty string if not found.
func (p *Properties) Get(key string) string {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.values[key]
}

// GetDefault retrieves a property value, returning the default if not found.
func (p *Properties) GetDefault(key, defaultVal string) string {
	p.mu.RLock()
	defer p.mu.RUnlock()
	if v, ok := p.values[key]; ok {
		return v
	}
	return defaultVal
}

// GetInt retrieves a property as an integer, returning the default if not found
// or invalid.
func (p *Properties) GetInt(key string, defaultVal int) int {
	v := p.Get(key)
	if v == "" {
		return defaultVal
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return defaultVal
	}
	return n
}

// GetInt64 retrieves a property as int64.
func (p *Properties) GetInt64(key string, defaultVal int64) int64 {
	v := p.Get(key)
	if v == "" {
		return defaultVal
	}
	n, err := strconv.ParseInt(v, 10, 64)
	if err != nil {
		return defaultVal
	}
	return n
}

// GetBool retrieves a property as a boolean. Recognizes: true/false, 1/0,
// yes/no, on/off (case-insensitive).
func (p *Properties) GetBool(key string, defaultVal bool) bool {
	v := strings.ToLower(p.Get(key))
	switch v {
	case "true", "1", "yes", "on":
		return true
	case "false", "0", "no", "off":
		return false
	default:
		return defaultVal
	}
}

// GetDuration retrieves a property as a time.Duration (e.g. "30s", "5m").
func (p *Properties) GetDuration(key string, defaultVal time.Duration) time.Duration {
	v := p.Get(key)
	if v == "" {
		return defaultVal
	}
	d, err := time.ParseDuration(v)
	if err != nil {
		return defaultVal
	}
	return d
}

// GetFloat64 retrieves a property as float64.
func (p *Properties) GetFloat64(key string, defaultVal float64) float64 {
	v := p.Get(key)
	if v == "" {
		return defaultVal
	}
	f, err := strconv.ParseFloat(v, 64)
	if err != nil {
		return defaultVal
	}
	return f
}

// GetStringSlice retrieves a property as a string slice, splitting on the
// given separator (default ",").
func (p *Properties) GetStringSlice(key string, sep string) []string {
	if sep == "" {
		sep = ","
	}
	v := p.Get(key)
	if v == "" {
		return nil
	}
	parts := strings.Split(v, sep)
	result := make([]string, 0, len(parts))
	for _, part := range parts {
		trimmed := strings.TrimSpace(part)
		if trimmed != "" {
			result = append(result, trimmed)
		}
	}
	return result
}

// Has reports whether a property exists.
func (p *Properties) Has(key string) bool {
	p.mu.RLock()
	defer p.mu.RUnlock()
	_, ok := p.values[key]
	return ok
}

// Keys returns all property keys.
func (p *Properties) Keys() []string {
	p.mu.RLock()
	defer p.mu.RUnlock()
	result := make([]string, 0, len(p.values))
	for k := range p.values {
		result = append(result, k)
	}
	return result
}

// LoadFromEnv loads properties from environment variables with the given prefix.
// For example, with prefix "APP", the env var APP_DB_HOST becomes db.host.
func (p *Properties) LoadFromEnv(prefix string) {
	if prefix == "" {
		prefix = "APP"
	}
	prefix = strings.ToUpper(prefix) + "_"
	p.mu.Lock()
	defer p.mu.Unlock()
	for _, env := range os.Environ() {
		parts := strings.SplitN(env, "=", 2)
		if len(parts) != 2 {
			continue
		}
		key, value := parts[0], parts[1]
		if !strings.HasPrefix(key, prefix) {
			continue
		}
		// Convert APP_DB_HOST → db.host
		rest := strings.TrimPrefix(key, prefix)
		rest = strings.ToLower(strings.ReplaceAll(rest, "_", "."))
		p.values[rest] = value
	}
	p.sources = append(p.sources, fmt.Sprintf("env(%s)", prefix))
}

// LoadFromMap loads properties from a string map.
func (p *Properties) LoadFromMap(m map[string]string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	for k, v := range m {
		p.values[k] = v
	}
	p.sources = append(p.sources, "map")
}

// LoadFromFile loads properties from a simple key=value file (one per line).
// Lines starting with # or empty lines are ignored.
func (p *Properties) LoadFromFile(filename string) error {
	data, err := os.ReadFile(filename)
	if err != nil {
		return fmt.Errorf("read properties file %s: %w", filename, err)
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		parts := strings.SplitN(line, "=", 2)
		if len(parts) != 2 {
			continue
		}
		key := strings.TrimSpace(parts[0])
		value := strings.TrimSpace(parts[1])
		p.values[key] = value
	}
	p.sources = append(p.sources, fmt.Sprintf("file(%s)", filename))
	return nil
}

// Sources returns the list of source names that have loaded properties.
func (p *Properties) Sources() []string {
	p.mu.RLock()
	defer p.mu.RUnlock()
	result := make([]string, len(p.sources))
	copy(result, p.sources)
	return result
}

// Count returns the number of properties.
func (p *Properties) Count() int {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return len(p.values)
}
