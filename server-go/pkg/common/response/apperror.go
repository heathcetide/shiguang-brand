// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package response

import (
	"errors"
	"fmt"
)

// AppError is the unified application error shape. Service layers return
// *AppError; HTTP handlers render it once via the gin helpers or
// Envelope/HTTPStatusOf.
//
// AppError supports two message paths:
//   - i18n path: MsgKey + MsgArgs are resolved at render time via a
//     MessageResolver (e.g. i18n.Manager). This is the recommended path
//     for user-facing errors.
//   - direct path: Message is used as-is when MsgKey is empty or no
//     resolver is available.
type AppError struct {
	Code       Code           // Stable string identifier (e.g. "NOT_FOUND")
	MsgKey     string         // i18n message key (e.g. "common.not_found")
	MsgArgs    []any          // Arguments for i18n message formatting
	Message    string         // Direct message (non-i18n fallback)
	HTTPStatus int            // HTTP status code (0 = auto from Code)
	Cause      error          // Wrapped underlying error
	Details    map[string]any // Additional structured details
}

// ──────────────────────────────────────────────
// Constructors
// ──────────────────────────────────────────────

// Err creates an AppError from a Code only. The user-facing text is
// resolved at render time using the default i18n key for the Code.
func Err(code Code) *AppError {
	return &AppError{
		Code:   code,
		MsgKey: I18nKeyFor(code),
	}
}

// New constructs an AppError with an explicit (non-i18n) message.
func New(code Code, message string) *AppError {
	return &AppError{
		Code:    code,
		Message: message,
		MsgKey:  I18nKeyFor(code),
	}
}

// Newf is New with a formatted message.
func Newf(code Code, format string, args ...any) *AppError {
	return &AppError{
		Code:    code,
		Message: fmt.Sprintf(format, args...),
		MsgKey:  I18nKeyFor(code),
	}
}

// NewI18n constructs an AppError whose user-facing text is resolved at
// render time via a MessageResolver.
func NewI18n(code Code, msgKey string, args ...any) *AppError {
	return &AppError{
		Code:    code,
		MsgKey:  msgKey,
		MsgArgs: args,
	}
}

// Wrap attaches a cause to an AppError with an explicit message.
func Wrap(code Code, message string, cause error) *AppError {
	return &AppError{
		Code:    code,
		Message: message,
		MsgKey:  I18nKeyFor(code),
		Cause:   cause,
	}
}

// WrapErr creates an AppError from a code and underlying error. The
// user-facing text is resolved at render time.
func WrapErr(code Code, cause error) *AppError {
	return &AppError{
		Code:   code,
		MsgKey: I18nKeyFor(code),
		Cause:  cause,
	}
}

// WrapI18n attaches a cause; user text comes from msgKey at render time.
func WrapI18n(code Code, msgKey string, cause error, args ...any) *AppError {
	return &AppError{
		Code:    code,
		MsgKey:  msgKey,
		MsgArgs: args,
		Cause:   cause,
	}
}

// ──────────────────────────────────────────────
// Builder methods
// ──────────────────────────────────────────────

// WithStatus overrides the HTTP status code.
func (e *AppError) WithStatus(status int) *AppError {
	e.HTTPStatus = status
	return e
}

// WithDetails attaches structured details to the error.
func (e *AppError) WithDetails(d map[string]any) *AppError {
	e.Details = d
	return e
}

// WithCause attaches a wrapped underlying error.
func (e *AppError) WithCause(cause error) *AppError {
	e.Cause = cause
	return e
}

// WithArg appends a single i18n message argument.
func (e *AppError) WithArg(arg any) *AppError {
	e.MsgArgs = append(e.MsgArgs, arg)
	return e
}

// WithArgs sets the i18n message arguments.
func (e *AppError) WithArgs(args ...any) *AppError {
	e.MsgArgs = args
	return e
}

// ──────────────────────────────────────────────
// error interface
// ──────────────────────────────────────────────

// Error returns a human-readable string. If Message is set it is used;
// otherwise the MsgKey is returned so there is always a non-empty value.
func (e *AppError) Error() string {
	if e.Message != "" {
		if e.Cause != nil {
			return e.Message + ": " + e.Cause.Error()
		}
		return e.Message
	}
	if e.MsgKey != "" {
		if e.Cause != nil {
			return e.MsgKey + ": " + e.Cause.Error()
		}
		return e.MsgKey
	}
	return string(e.Code)
}

// Unwrap returns the wrapped cause for errors.Is / errors.As support.
func (e *AppError) Unwrap() error {
	return e.Cause
}

// Is reports whether target is an *AppError with the same Code. This
// enables errors.Is(err, response.Err(response.CodeNotFound)).
func (e *AppError) Is(target error) bool {
	var ae *AppError
	if errors.As(target, &ae) {
		return e.Code == ae.Code
	}
	return false
}

// ──────────────────────────────────────────────
// Accessors
// ──────────────────────────────────────────────

// HTTPStatusOf returns the HTTP status for an AppError, using the
// explicit override if set, otherwise the default for the Code.
func HTTPStatusOf(ae *AppError) int {
	if ae.HTTPStatus != 0 {
		return ae.HTTPStatus
	}
	return HTTPStatusFor(ae.Code)
}

// NumCode returns the numeric business code for an AppError.
func (ae *AppError) NumCode() int {
	return ErrCodeFor(ae.Code)
}

// IsAppError reports whether err is an *AppError.
func IsAppError(err error) bool {
	var ae *AppError
	return errors.As(err, &ae)
}

// From converts any error to *AppError. If err is already an *AppError
// it is returned as-is. nil input returns nil. Unknown errors become
// CodeInternal.
func From(err error) *AppError {
	if err == nil {
		return nil
	}
	var ae *AppError
	if errors.As(err, &ae) {
		return ae
	}
	return &AppError{
		Code:    CodeInternal,
		MsgKey:  KeyInternalError,
		Message: err.Error(),
		Cause:   err,
	}
}

// AsAppError is a convenience that wraps From and returns the result
// even for nil errors (returning a generic internal error). Useful when
// a non-nil *AppError is required.
func AsAppError(err error) *AppError {
	ae := From(err)
	if ae == nil {
		return Err(CodeInternal)
	}
	return ae
}
