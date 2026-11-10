// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package gin provides Gin middleware and helpers for the i18n module.
package gin

import (
	"github.com/heathcetide/DietDigiDose/pkg/common/i18n"
	"github.com/gin-gonic/gin"
)

const (
	ctxLocaleKey  = "i18n.locale"
	ctxManagerKey = "i18n.manager"
)

// Middleware returns a Gin middleware that detects the locale from
// query param "locale", then the Accept-Language header, then a cookie,
// and stores both the locale and the manager on the gin context.
func Middleware(manager *i18n.Manager) gin.HandlerFunc {
	return func(c *gin.Context) {
		locale := c.Query("locale")
		if locale == "" {
			locale = c.GetHeader("Accept-Language")
		}
		if locale == "" {
			if cookie, err := c.Cookie("locale"); err == nil {
				locale = cookie
			}
		}

		var detected i18n.Locale
		if locale != "" {
			detected = manager.ParseAcceptLanguage(locale)
		} else {
			detected = manager.GetDefaultLocale()
		}

		c.Set(ctxLocaleKey, detected)
		c.Set(ctxManagerKey, manager)
		c.Request = c.Request.WithContext(i18n.WithLocale(c.Request.Context(), detected))
		c.Next()
	}
}

// GetLocale retrieves the locale stored by Middleware on the gin context.
func GetLocale(c *gin.Context) i18n.Locale {
	if v, ok := c.Get(ctxLocaleKey); ok {
		if loc, ok := v.(i18n.Locale); ok {
			return loc
		}
	}
	return i18n.DefaultLocale
}

// SetLocale explicitly sets the locale on the gin context.
func SetLocale(c *gin.Context, locale i18n.Locale) {
	if c != nil {
		c.Set(ctxLocaleKey, locale)
	}
}

// GetManager retrieves the manager stored by Middleware.
func GetManager(c *gin.Context) *i18n.Manager {
	if v, ok := c.Get(ctxManagerKey); ok {
		if m, ok := v.(*i18n.Manager); ok {
			return m
		}
	}
	return nil
}

// T translates a key using the locale and manager on the gin context.
func T(c *gin.Context, key string, args ...interface{}) string {
	m := GetManager(c)
	if m == nil {
		return key
	}
	return m.T(GetLocale(c), key, args...)
}

// ResponseJSON sends a localized JSON response.
func ResponseJSON(c *gin.Context, code int, key string, data interface{}) {
	message := T(c, key)
	c.JSON(code, gin.H{
		"message": message,
		"data":    data,
		"locale":  GetLocale(c),
	})
}

// ErrorJSON sends a localized error JSON response.
func ErrorJSON(c *gin.Context, code int, key string, err error) {
	message := T(c, key)
	detail := ""
	if err != nil {
		detail = err.Error()
	}
	c.JSON(code, gin.H{
		"error":  message,
		"detail": detail,
		"locale": GetLocale(c),
	})
}
