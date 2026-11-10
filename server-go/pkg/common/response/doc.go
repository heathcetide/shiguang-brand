// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package response provides unified HTTP JSON envelopes, application
// errors, status code conventions, and i18n message key constants for
// ling-base APIs.
//
// # Success envelope
//
//	{"code": 200, "msg": "success", "data": ...}
//
// # Error envelope
//
//	{"code": 1001, "msg": "Not found", "error": "NOT_FOUND", "data": null}
//
// Service layers return *AppError; HTTP handlers render it once via the
// gin helpers in the response/gin subpackage or via ErrorEnvelope.
//
// # i18n
//
// AppError stores an i18n message key (MsgKey) and optional format
// arguments (MsgArgs). At render time, a MessageResolver translates the
// key to a localized string. The response/gin subpackage integrates with
// the i18n.Manager to resolve messages based on the request locale.
//
// # Error codes
//
// Two parallel code systems are used:
//   - Code (string): stable identifier like "NOT_FOUND" — clients branch
//     on this.
//   - Numeric code (int): business code like 1001 — returned in the
//     "code" field of the envelope.
//
// See codes.go for the full constant set and keys.go for i18n keys.
package response
