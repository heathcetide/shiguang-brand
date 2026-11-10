// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package i18n

import "context"

type contextKey string

const localeKey contextKey = "i18n.locale"

// WithLocale returns a new context with the locale attached.
func WithLocale(ctx context.Context, locale Locale) context.Context {
	return context.WithValue(ctx, localeKey, locale)
}

// GetLocaleFromContext extracts the locale from a context, returning the
// default locale if none is set.
func GetLocaleFromContext(ctx context.Context) Locale {
	if locale, ok := ctx.Value(localeKey).(Locale); ok {
		return locale
	}
	return DefaultLocale
}

// SetLocale is an alias for WithLocale.
func SetLocale(ctx context.Context, locale Locale) context.Context {
	return WithLocale(ctx, locale)
}
