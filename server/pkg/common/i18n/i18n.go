// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package i18n provides a unified internationalization module supporting
// locale detection, translation lookup with fallback, locale-specific
// formatting, and pluggable machine-translation backends.
//
// The core package has zero external dependencies. Optional integrations
// live in sub-modules:
//
//	i18n/gin       — Gin middleware and helpers
//	i18n/mymemory  — MyMemory API translator
package i18n

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

// Locale represents a BCP 47 locale identifier (e.g. "en", "zh-CN", "ja-JP").
type Locale string

// Common locale constants.
const (
	LocaleEn   Locale = "en"
	LocaleEnUS Locale = "en-US"
	LocaleEnGB Locale = "en-GB"
	LocaleZhCN Locale = "zh-CN"
	LocaleZhTW Locale = "zh-TW"
	LocaleJaJP Locale = "ja-JP"
	LocaleKoKR Locale = "ko-KR"
	LocaleFrFR Locale = "fr-FR"
	LocaleDeDE Locale = "de-DE"
	LocaleEsES Locale = "es-ES"
)

// DefaultLocale is used when no locale can be determined.
const DefaultLocale Locale = LocaleEn

// Translator is the interface for external machine-translation services.
// Implementations live in sub-modules (e.g. i18n/mymemory).
type Translator interface {
	Translate(text, from, to string) (string, error)
}

// Config holds i18n Manager configuration.
type Config struct {
	DefaultLocale    Locale   // fallback when no locale is detected; defaults to "en"
	SupportedLocales []Locale // locales this manager recognises
	FallbackLocale   Locale   // secondary fallback for missing keys; defaults to DefaultLocale
	// TranslationsPath is a directory of JSON translation files.
	// Filenames must follow the pattern: <prefix>.<locale>.json
	// e.g. messages.en.json, messages.zh-CN.json
	TranslationsPath string
	// Translator is an optional external MT backend.
	Translator Translator
}

// Manager handles internationalization: translation storage, lookup,
// locale detection, and formatting.
type Manager struct {
	mu               sync.RWMutex
	translations     map[Locale]map[string]string
	defaultLocale    Locale
	supportedLocales []Locale
	fallbackLocale   Locale
	translator       Translator
}

// NewManager creates a new i18n manager from the given config.
// If config is nil, sensible defaults are applied.
func NewManager(config *Config) *Manager {
	if config == nil {
		config = &Config{}
	}
	if config.DefaultLocale == "" {
		config.DefaultLocale = DefaultLocale
	}
	if config.FallbackLocale == "" {
		config.FallbackLocale = config.DefaultLocale
	}
	if len(config.SupportedLocales) == 0 {
		config.SupportedLocales = []Locale{config.DefaultLocale}
	}

	m := &Manager{
		translations:     make(map[Locale]map[string]string),
		defaultLocale:    config.DefaultLocale,
		supportedLocales: config.SupportedLocales,
		fallbackLocale:   config.FallbackLocale,
		translator:       config.Translator,
	}

	if config.TranslationsPath != "" {
		_ = m.LoadTranslations(config.TranslationsPath)
	}
	return m
}

// LoadTranslations walks path and loads all *.json translation files.
// The locale is extracted from the filename suffix (e.g. "messages.zh-CN.json" → "zh-CN").
func (m *Manager) LoadTranslations(path string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if _, err := os.Stat(path); os.IsNotExist(err) {
		return fmt.Errorf("translations path does not exist: %s", path)
	}

	for _, loc := range m.supportedLocales {
		if m.translations[loc] == nil {
			m.translations[loc] = make(map[string]string)
		}
	}

	return filepath.Walk(path, func(filePath string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() || !strings.HasSuffix(filePath, ".json") {
			return nil
		}

		baseName := strings.TrimSuffix(info.Name(), ".json")
		parts := strings.Split(baseName, ".")
		if len(parts) < 2 {
			return nil
		}

		loc := Locale(parts[len(parts)-1])
		if !m.isSupportedLocale(loc) {
			return nil
		}

		data, err := os.ReadFile(filePath)
		if err != nil {
			return fmt.Errorf("failed to read translation file %s: %w", filePath, err)
		}

		var trans map[string]string
		if err := json.Unmarshal(data, &trans); err != nil {
			return fmt.Errorf("failed to parse translation file %s: %w", filePath, err)
		}

		if m.translations[loc] == nil {
			m.translations[loc] = make(map[string]string)
		}
		for k, v := range trans {
			m.translations[loc][k] = v
		}
		return nil
	})
}

// LoadTranslationFile loads a single JSON translation file for a locale.
func (m *Manager) LoadTranslationFile(locale Locale, filePath string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if !m.isSupportedLocale(locale) {
		return fmt.Errorf("unsupported locale: %s", locale)
	}

	data, err := os.ReadFile(filePath)
	if err != nil {
		return fmt.Errorf("failed to read translation file: %w", err)
	}

	var trans map[string]string
	if err := json.Unmarshal(data, &trans); err != nil {
		return fmt.Errorf("failed to parse translation file: %w", err)
	}

	if m.translations[locale] == nil {
		m.translations[locale] = make(map[string]string)
	}
	for k, v := range trans {
		m.translations[locale][k] = v
	}
	return nil
}

// SetTranslation sets a single key-value pair for a locale.
func (m *Manager) SetTranslation(locale Locale, key, value string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.translations[locale] == nil {
		m.translations[locale] = make(map[string]string)
	}
	m.translations[locale][key] = value
}

// GetTranslation looks up a key in the requested locale, falling back to
// the fallback locale, then returning the key itself if not found.
func (m *Manager) GetTranslation(locale Locale, key string) string {
	m.mu.RLock()
	defer m.mu.RUnlock()

	if trans, ok := m.translations[locale]; ok {
		if v, ok := trans[key]; ok {
			return v
		}
	}
	if locale != m.fallbackLocale {
		if trans, ok := m.translations[m.fallbackLocale]; ok {
			if v, ok := trans[key]; ok {
				return v
			}
		}
	}
	return key
}

// T translates a key with optional printf-style arguments.
func (m *Manager) T(locale Locale, key string, args ...interface{}) string {
	msg := m.GetTranslation(locale, key)
	if len(args) > 0 {
		return fmt.Sprintf(msg, args...)
	}
	return msg
}

// Translate uses the external translator backend (if configured).
func (m *Manager) Translate(text, from, to string) (string, error) {
	if m.translator == nil {
		return text, fmt.Errorf("translator not configured")
	}
	return m.translator.Translate(text, from, to)
}

// GetDefaultLocale returns the manager's default locale.
func (m *Manager) GetDefaultLocale() Locale { return m.defaultLocale }

// GetSupportedLocales returns the list of supported locales.
func (m *Manager) GetSupportedLocales() []Locale { return m.supportedLocales }

// IsSupportedLocale reports whether the locale is in the supported list.
func (m *Manager) IsSupportedLocale(locale Locale) bool { return m.isSupportedLocale(locale) }

func (m *Manager) isSupportedLocale(locale Locale) bool {
	for _, l := range m.supportedLocales {
		if l == locale {
			return true
		}
	}
	return false
}

// GetTranslations returns a copy of all translations for a locale.
func (m *Manager) GetTranslations(locale Locale) map[string]string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := make(map[string]string)
	if trans, ok := m.translations[locale]; ok {
		for k, v := range trans {
			out[k] = v
		}
	}
	return out
}
