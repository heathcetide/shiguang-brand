// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package response

import "fmt"

// ──────────────────────────────────────────────
// Response envelope
// ──────────────────────────────────────────────

// Response is the standard JSON success envelope.
//
//	{"code": 200, "msg": "success", "data": ...}
type Response struct {
	Code    int    `json:"code"`
	Message string `json:"msg"`
	Data    any    `json:"data"`
}

// ErrorResponse is the standard JSON error envelope.
//
//	{"code": 1001, "msg": "Not found", "error": "NOT_FOUND", "data": null, "details": null}
type ErrorResponse struct {
	Code    int            `json:"code"`  // numeric business code
	Message string         `json:"msg"`   // localized or direct message
	Error   string         `json:"error"` // stable string Code
	Data    any            `json:"data"`  // optional payload (usually nil)
	Details map[string]any `json:"details,omitempty"`
}

// Page is a paginated list payload, intended to be embedded in
// Response.Data.
//
//	{"code": 200, "msg": "success", "data": {"list": [...], "total": 100, "page": 1, "size": 20, "total_page": 5}}
type Page struct {
	List      any   `json:"list"`
	Total     int64 `json:"total"`
	Page      int   `json:"page"`
	Size      int   `json:"size"`
	TotalPage int   `json:"total_page"`
}

// NewPage constructs a Page payload and computes TotalPage.
func NewPage(list any, total int64, page, size int) *Page {
	if size <= 0 {
		size = 1
	}
	totalPage := 0
	if total >= 0 {
		totalPage = int((total + int64(size) - 1) / int64(size))
	}
	return &Page{
		List:      list,
		Total:     total,
		Page:      page,
		Size:      size,
		TotalPage: totalPage,
	}
}

// Success builds a success Response envelope.
func Success(data any) *Response {
	return &Response{
		Code:    CodeSuccess,
		Message: KeySuccess,
		Data:    data,
	}
}

// SuccessMsg builds a success Response with a custom message.
func SuccessMsg(msg string, data any) *Response {
	return &Response{
		Code:    CodeSuccess,
		Message: msg,
		Data:    data,
	}
}

// ErrorEnvelope builds an ErrorResponse from an AppError using a
// MessageResolver to localize the message. If resolver is nil, the
// AppError.Message or MsgKey is used as the message.
func ErrorEnvelope(ae *AppError, resolver MessageResolver) *ErrorResponse {
	if ae == nil {
		ae = Err(CodeInternal)
	}
	msg := resolveMessage(ae, resolver)
	return &ErrorResponse{
		Code:    ae.NumCode(),
		Message: msg,
		Error:   string(ae.Code),
		Data:    nil,
		Details: ae.Details,
	}
}

// resolveMessage resolves the user-facing message for an AppError.
// Priority:
//  1. If a resolver is available and MsgKey is set, use the resolver.
//  2. If Message is set, use it directly.
//  3. Fall back to MsgKey.
//  4. Fall back to the Code string.
func resolveMessage(ae *AppError, resolver MessageResolver) string {
	if resolver != nil && ae.MsgKey != "" {
		if msg := resolver.Resolve(ae.MsgKey, ae.MsgArgs...); msg != "" {
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

// EnvelopeData wraps any value in a map under the "data" key. This is
// a convenience for handlers that need to return extra metadata.
func EnvelopeData(data any) map[string]any {
	return map[string]any{"data": data}
}

// EnvelopeError wraps an error message in a simple map for ad-hoc use.
func EnvelopeError(msg string) map[string]any {
	return map[string]any{"error": msg}
}

// FormatDetails converts Details to a flat "key=value" string for
// logging. Returns empty string if Details is nil or empty.
func FormatDetails(ae *AppError) string {
	if ae == nil || len(ae.Details) == 0 {
		return ""
	}
	out := ""
	for k, v := range ae.Details {
		if out != "" {
			out += ", "
		}
		out += fmt.Sprintf("%s=%v", k, v)
	}
	return out
}
