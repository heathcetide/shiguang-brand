// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package gin provides gin-integrated helpers for the response package.
// It bridges response.AppError / response.Response with gin.Context,
// resolving i18n messages via an optional i18n.Manager.
//
// Usage:
//
//	// In your handler:
//	data, err := service.GetUser(id)
//	if err != nil {
//	    gin.WriteError(c, err)
//	    return
//	}
//	gin.Success(c, data)
//
//	// With i18n:
//	gin.SuccessI18n(c, response.KeySuccess, data)
//	gin.FailI18n(c, response.KeyNotFound, nil)
package gin

import (
	"net/http"

	"github.com/heathcetide/DietDigiDose/pkg/common/response"
	"github.com/gin-gonic/gin"
)

// Resolver is the package-level MessageResolver used by the gin helpers.
// Set this at startup (typically wrapping an i18n.Manager). If nil, the
// NoopResolver is used (keys returned as-is).
//
//	var manager *i18n.Manager = ...
//	gin.Resolver = gin.ResolverFunc(func(key string, args ...any) string {
//	    locale := gin.GetLocaleFromContext(...) // or your middleware
//	    return manager.T(locale, key, args...)
//	})
var Resolver response.MessageResolver

// ──────────────────────────────────────────────
// Success helpers
// ──────────────────────────────────────────────

// Success writes a 200 success envelope.
func Success(c *gin.Context, data any) {
	c.JSON(http.StatusOK, response.Response{
		Code:    response.CodeSuccess,
		Message: resolve(response.KeySuccess),
		Data:    data,
	})
}

// SuccessMsg writes a 200 success envelope with a custom message.
func SuccessMsg(c *gin.Context, msg string, data any) {
	c.JSON(http.StatusOK, response.Response{
		Code:    response.CodeSuccess,
		Message: msg,
		Data:    data,
	})
}

// SuccessI18n writes a 200 success envelope with a localized message.
func SuccessI18n(c *gin.Context, key string, data any, args ...any) {
	c.JSON(http.StatusOK, response.Response{
		Code:    response.CodeSuccess,
		Message: resolve(key, args...),
		Data:    data,
	})
}

// Created writes a 201 success envelope (resource created).
func Created(c *gin.Context, data any) {
	c.JSON(http.StatusCreated, response.Response{
		Code:    response.CodeSuccess,
		Message: resolve(response.KeyCreated),
		Data:    data,
	})
}

// NoContent writes a 204 with no body.
func NoContent(c *gin.Context) {
	c.Status(http.StatusNoContent)
}

// ──────────────────────────────────────────────
// Error helpers
// ──────────────────────────────────────────────

// WriteError renders any error as an error envelope. If err is already
// an *AppError it is used directly; otherwise it is wrapped as
// CodeInternal. The HTTP status is 200 so callers can uniformly inspect
// the JSON `code` field; the business error code is in the envelope.
func WriteError(c *gin.Context, err error) {
	ae := response.AsAppError(err)
	writeAppError(c, ae)
}

// HandleError is an alias for WriteError.
func HandleError(c *gin.Context, err error) {
	WriteError(c, err)
}

// Fail writes an error envelope with a direct message. The HTTP status
// is 200 so callers can uniformly inspect the JSON `code` field; the
// business error code is embedded in the envelope.
func Fail(c *gin.Context, msg string, data any) {
	ae := response.Err(response.CodeInternal).WithDetails(nil)
	ae.Message = msg
	c.JSON(http.StatusOK, buildEnvelope(ae, data))
}

// FailWithCode writes an error envelope with a custom numeric code and
// message. The HTTP status is 200; the business code is in the envelope.
func FailWithCode(c *gin.Context, code response.Code, msg string, data any) {
	ae := response.Err(code)
	if msg != "" {
		ae.Message = msg
	}
	c.JSON(http.StatusOK, buildEnvelope(ae, data))
}

// FailI18n writes an error envelope with a localized message derived
// from the i18n key. The HTTP status is 200; the business code is in
// the envelope.
func FailI18n(c *gin.Context, key string, data any, args ...any) {
	ae := response.NewI18n(codeForI18nKey(key), key, args...)
	c.JSON(http.StatusOK, buildEnvelope(ae, data))
}

// FailAppError writes a typed AppError directly.
func FailAppError(c *gin.Context, ae *response.AppError) {
	if ae == nil {
		ae = response.Err(response.CodeInternal)
	}
	writeAppError(c, ae)
}

// AbortWithStatusJSON aborts the request with an error envelope derived
// from the HTTP status and error. The HTTP status is 200 so callers can
// uniformly inspect the JSON `code` field; the business error code is
// in the envelope. The httpStatus argument is used only to derive the
// business code.
func AbortWithStatusJSON(c *gin.Context, httpStatus int, err error) {
	code := response.CodeForHTTPStatus(httpStatus)
	ae := response.AsAppError(err)
	if ae.Code == response.CodeInternal && httpStatus != http.StatusInternalServerError {
		ae.Code = code
	}
	ae.HTTPStatus = httpStatus
	c.AbortWithStatusJSON(http.StatusOK, buildEnvelope(ae, nil))
}

// ──────────────────────────────────────────────
// Panic recovery middleware
// ──────────────────────────────────────────────

// Recovery returns a gin middleware that recovers from panics and
// writes a 500 error envelope. It should be registered early.
func Recovery() gin.HandlerFunc {
	return func(c *gin.Context) {
		defer func() {
			if rec := recover(); rec != nil {
				ae := response.Newf(response.CodeInternal, "panic: %v", rec)
				writeAppError(c, ae)
				c.Abort()
			}
		}()
		c.Next()
	}
}

// ──────────────────────────────────────────────
// Internal helpers
// ──────────────────────────────────────────────

// writeAppError writes the AppError envelope with HTTP 200 so callers
// can uniformly inspect the JSON `code` field.
func writeAppError(c *gin.Context, ae *response.AppError) {
	c.JSON(http.StatusOK, buildEnvelope(ae, nil))
}

// buildEnvelope constructs the JSON envelope from an AppError.
func buildEnvelope(ae *response.AppError, data any) any {
	return gin.H{
		"code":    ae.NumCode(),
		"msg":     resolveMessage(ae),
		"error":   string(ae.Code),
		"data":    data,
		"details": ae.Details,
	}
}

// resolveMessage resolves the message for an AppError using the
// package-level Resolver.
func resolveMessage(ae *response.AppError) string {
	if Resolver != nil && ae.MsgKey != "" {
		if msg := Resolver.Resolve(ae.MsgKey, ae.MsgArgs...); msg != "" {
			return msg
		}
	}
	if ae.Message != "" {
		return ae.Message
	}
	if ae.MsgKey != "" {
		return ae.MsgKey
	}
	return string(ae.Code)
}

// resolve resolves a key via the package-level Resolver, falling back
// to the key itself.
func resolve(key string, args ...any) string {
	if Resolver != nil {
		if msg := Resolver.Resolve(key, args...); msg != "" {
			return msg
		}
	}
	return key
}

// codeForI18nKey maps common i18n keys to their default Code.
func codeForI18nKey(key string) response.Code {
	switch key {
	case response.KeyInvalidParams, response.KeyInvalidBody:
		return response.CodeBadRequest
	case response.KeyUnauthorized, response.KeyAuthInvalidCredentials,
		response.KeyAuthMissingToken, response.KeyAuthInvalidToken:
		return response.CodeUnauthorized
	case response.KeyForbidden, response.KeyPermInsufficient:
		return response.CodeForbidden
	case response.KeyNotFound, response.KeyTenantNotFound,
		response.KeyAuthEmailNotRegistered:
		return response.CodeNotFound
	case response.KeyConflict, response.KeyDuplicate,
		response.KeyTenantEmailExists:
		return response.CodeConflict
	case response.KeyRateLimited:
		return response.CodeRateLimited
	case response.KeyQuotaExceeded:
		return response.CodeQuotaExceeded
	case response.KeyUpstreamTimeout:
		return response.CodeUpstreamTimeout
	case response.KeyServiceUnavailable:
		return response.CodeServiceUnavail
	case response.KeyTenantMismatch:
		return response.CodeTenantMismatch
	case response.KeyTenantRegisterDisabled, response.KeyTenantSuspended,
		response.KeyTenantUserUnavailable:
		return response.CodeForbidden
	default:
		return response.CodeInternal
	}
}
