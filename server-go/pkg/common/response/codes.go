// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package response

import "net/http"

// Code is a stable, human-readable business error identifier. Clients
// branch on the string value; do not reuse a Code's semantics across
// releases.
type Code string

// Standard stable string codes. These are the canonical identifiers
// returned in the "error" field of error envelopes.
const (
	CodeBadRequest        Code = "BAD_REQUEST"
	CodeUnauthorized      Code = "UNAUTHORIZED"
	CodeForbidden         Code = "FORBIDDEN"
	CodeNotFound          Code = "NOT_FOUND"
	CodeConflict          Code = "CONFLICT"
	CodeDuplicate         Code = "DUPLICATE"
	CodeRateLimited       Code = "RATE_LIMITED"
	CodeQuotaExceeded     Code = "QUOTA_EXCEEDED"
	CodeValidation        Code = "VALIDATION_FAILED"
	CodeTenantMismatch    Code = "TENANT_MISMATCH"
	CodeAuthFailed        Code = "AUTH_FAILED"
	CodeCredentialInvalid Code = "CREDENTIAL_INVALID"
	CodeUpstreamTimeout   Code = "UPSTREAM_TIMEOUT"
	CodeServiceUnavail    Code = "SERVICE_UNAVAILABLE"
	CodeProviderError     Code = "PROVIDER_ERROR"
	CodeInternal          Code = "INTERNAL"
)

// Numeric business codes returned in the "code" field of envelopes.
// 200 = success; 1000-1999 = client/business errors; 2000-2999 = system
// errors. Ranges above 3000 are reserved for application-specific codes.
const (
	CodeSuccess = 200

	// Business errors (1000-1999)
	CodeNumInvalidParams    = 1000
	CodeNumNotFound         = 1001
	CodeNumUnauthorized     = 1002
	CodeNumForbidden        = 1003
	CodeNumConflict         = 1004
	CodeNumRateLimited      = 1005
	CodeNumTenantMismatch   = 1006
	CodeNumQuotaExceeded    = 1007
	CodeNumUpstreamTimeout  = 1008
	CodeNumServiceUnavail   = 1009
	CodeNumDuplicate        = 1010
	CodeNumValidationFailed = 1011

	// Auth errors (1100-1199)
	CodeNumInvalidCredentials = 1100
	CodeNumMissingToken       = 1104
	CodeNumInvalidToken       = 1105

	// Tenant errors (1200-1299)
	CodeNumRegisterDisabled = 1200
	CodeNumEmailExists      = 1201
	CodeNumTenantNotFound   = 1203
	CodeNumTenantSuspended  = 1204
	CodeNumUserUnavailable  = 1205

	// Permission errors (1300-1399)
	CodeNumPermInsufficient = 1300

	// System errors (2000-2999)
	CodeNumInternal        = 2000
	CodeNumDatabaseUnavail = 2001
	CodeNumProviderErr     = 2002
)

// HTTPStatusFor returns the default HTTP status code for a Code.
func HTTPStatusFor(code Code) int {
	switch code {
	case CodeBadRequest, CodeValidation:
		return http.StatusBadRequest
	case CodeUnauthorized, CodeAuthFailed, CodeCredentialInvalid:
		return http.StatusUnauthorized
	case CodeForbidden, CodeTenantMismatch:
		return http.StatusForbidden
	case CodeNotFound:
		return http.StatusNotFound
	case CodeConflict, CodeDuplicate:
		return http.StatusConflict
	case CodeRateLimited:
		return http.StatusTooManyRequests
	case CodeQuotaExceeded:
		return http.StatusPaymentRequired
	case CodeUpstreamTimeout:
		return http.StatusGatewayTimeout
	case CodeServiceUnavail, CodeProviderError:
		return http.StatusServiceUnavailable
	default:
		return http.StatusInternalServerError
	}
}

// ErrCodeFor returns the numeric business code for a string Code.
func ErrCodeFor(code Code) int {
	switch code {
	case CodeBadRequest:
		return CodeNumInvalidParams
	case CodeValidation:
		return CodeNumValidationFailed
	case CodeUnauthorized, CodeAuthFailed, CodeCredentialInvalid:
		return CodeNumUnauthorized
	case CodeForbidden:
		return CodeNumForbidden
	case CodeTenantMismatch:
		return CodeNumTenantMismatch
	case CodeNotFound:
		return CodeNumNotFound
	case CodeConflict, CodeDuplicate:
		return CodeNumConflict
	case CodeRateLimited:
		return CodeNumRateLimited
	case CodeQuotaExceeded:
		return CodeNumQuotaExceeded
	case CodeUpstreamTimeout:
		return CodeNumUpstreamTimeout
	case CodeServiceUnavail, CodeProviderError:
		return CodeNumServiceUnavail
	default:
		return CodeNumInternal
	}
}

// CodeForHTTPStatus returns the default string Code for an HTTP status.
func CodeForHTTPStatus(status int) Code {
	switch status {
	case http.StatusBadRequest:
		return CodeBadRequest
	case http.StatusUnauthorized:
		return CodeUnauthorized
	case http.StatusForbidden:
		return CodeForbidden
	case http.StatusNotFound:
		return CodeNotFound
	case http.StatusConflict:
		return CodeConflict
	case http.StatusTooManyRequests:
		return CodeRateLimited
	case http.StatusPaymentRequired:
		return CodeQuotaExceeded
	case http.StatusGatewayTimeout:
		return CodeUpstreamTimeout
	case http.StatusServiceUnavailable:
		return CodeServiceUnavail
	default:
		return CodeInternal
	}
}
