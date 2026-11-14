// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package response

// Message key constants for i18n. These follow the dotted convention
// "domain.message" and are intended to be resolved by an i18n.Manager
// or any MessageResolver implementation.
//
// Using keys (not hardcoded text) in errors lets the rendering layer
// localize messages at the last moment based on the request locale.
const (
	// common.* — generic success/error messages
	KeySuccess            = "common.success"
	KeyCreated            = "common.created"
	KeyUpdated            = "common.updated"
	KeyDeleted            = "common.deleted"
	KeyInvalidParams      = "common.invalid_params"
	KeyInvalidBody        = "common.invalid_body"
	KeyNotFound           = "common.not_found"
	KeyUnauthorized       = "common.unauthorized"
	KeyForbidden          = "common.forbidden"
	KeyConflict           = "common.conflict"
	KeyRateLimited        = "common.rate_limited"
	KeyInternalError      = "common.internal_error"
	KeyServiceUnavailable = "common.service_unavailable"
	KeyQuotaExceeded      = "common.quota_exceeded"
	KeyUpstreamTimeout    = "common.upstream_timeout"
	KeyTenantMismatch     = "common.tenant_mismatch"
	KeyDuplicate          = "common.duplicate"

	// auth.* — authentication
	KeyAuthInvalidCredentials = "auth.invalid_credentials"
	KeyAuthMissingToken       = "auth.missing_token"
	KeyAuthInvalidToken       = "auth.invalid_token"
	KeyAuthEmailNotRegistered = "auth.email_not_registered"
	KeyAuthEmailSameAsCurrent = "auth.email_same_as_current"

	// tenant.* — tenant/organization
	KeyTenantRegisterDisabled = "tenant.register_disabled"
	KeyTenantEmailExists      = "tenant.email_exists"
	KeyTenantNotFound         = "tenant.not_found"
	KeyTenantSuspended        = "tenant.suspended"
	KeyTenantUserUnavailable  = "tenant.user_unavailable"

	// perm.* — permissions
	KeyPermInsufficient = "perm.insufficient"

	// validation.* — field validation
	KeyValidationRequired        = "validation.required"
	KeyValidationEmail           = "validation.email"
	KeyValidationMin             = "validation.min"
	KeyValidationMax             = "validation.max"
	KeyValidationUsernameShort   = "validation.username_short"
	KeyValidationUsernameFormat  = "validation.username_format"
	KeyValidationPasswordShort   = "validation.password_short"
	KeyValidationCaptchaRequired = "validation.captcha_required"
	KeyValidationCaptchaInvalid  = "validation.captcha_invalid"
)

// I18nKeyFor returns the default i18n message key for a Code. The key
// can be passed to a MessageResolver to obtain a localized string.
func I18nKeyFor(code Code) string {
	switch code {
	case CodeBadRequest, CodeValidation:
		return KeyInvalidParams
	case CodeUnauthorized, CodeAuthFailed, CodeCredentialInvalid:
		return KeyUnauthorized
	case CodeForbidden:
		return KeyForbidden
	case CodeTenantMismatch:
		return KeyTenantMismatch
	case CodeNotFound:
		return KeyNotFound
	case CodeConflict, CodeDuplicate:
		return KeyConflict
	case CodeRateLimited:
		return KeyRateLimited
	case CodeQuotaExceeded:
		return KeyQuotaExceeded
	case CodeUpstreamTimeout:
		return KeyUpstreamTimeout
	case CodeServiceUnavail, CodeProviderError:
		return KeyServiceUnavailable
	default:
		return KeyInternalError
	}
}
