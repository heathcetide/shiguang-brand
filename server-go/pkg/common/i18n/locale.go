// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package i18n

import (
	"strings"
)

// ResolveLocale maps a raw locale string to one of the supported locales.
// If the raw string doesn't match, the manager's default locale is returned.
func (m *Manager) ResolveLocale(raw string) Locale {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return m.defaultLocale
	}

	// Try exact match (case-insensitive).
	for _, supported := range m.supportedLocales {
		if strings.EqualFold(string(supported), raw) {
			return supported
		}
	}

	// Try language-prefix match (e.g. "en" matches "en-US").
	rawLower := strings.ToLower(raw)
	for _, supported := range m.supportedLocales {
		supportedLower := strings.ToLower(string(supported))
		if strings.HasPrefix(supportedLower, rawLower+"-") || supportedLower == rawLower {
			return supported
		}
	}

	// Try underscore → hyphen normalisation (e.g. "zh_CN" → "zh-CN").
	if parts := strings.Split(rawLower, "_"); len(parts) >= 2 {
		candidate := Locale(parts[0] + "-" + strings.ToUpper(parts[1]))
		if m.isSupportedLocale(candidate) {
			return candidate
		}
		candidate = Locale(parts[0] + "-" + parts[1])
		if m.isSupportedLocale(candidate) {
			return candidate
		}
	}

	// Try just the language part.
	if parts := strings.Split(rawLower, "-"); len(parts) > 0 {
		for _, supported := range m.supportedLocales {
			supportedLower := strings.ToLower(string(supported))
			if strings.HasPrefix(supportedLower, parts[0]+"-") || supportedLower == parts[0] {
				return supported
			}
		}
	}

	return m.defaultLocale
}

// DetectLocale detects a locale from a language string (e.g. "en-US", "zh-CN").
func (m *Manager) DetectLocale(lang string) Locale {
	return m.ResolveLocale(lang)
}

// ParseAcceptLanguage parses an Accept-Language header value and returns
// the first supported locale found, or the default locale if none match.
//
// Example header: "en-US,en;q=0.9,zh-CN;q=0.8"
func (m *Manager) ParseAcceptLanguage(header string) Locale {
	if header == "" {
		return m.defaultLocale
	}
	for _, part := range strings.Split(header, ",") {
		tag := strings.TrimSpace(strings.Split(part, ";")[0])
		if tag == "" {
			continue
		}
		loc := m.ResolveLocale(tag)
		if m.isSupportedLocale(loc) {
			return loc
		}
	}
	return m.defaultLocale
}
