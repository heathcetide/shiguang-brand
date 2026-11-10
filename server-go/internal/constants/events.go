// Copyright (c) 2026 heathcetide. All rights reserved.

package constants

// Event constants for the process-wide signal bus (common.Sig()).
// Emit these events with common.Sig().Emit(EventXxx, sender, params...).
// Listen in internal/listeners/ via common.Sig().Connect(EventXxx, handler).
const (
	// EventUserRegistered is emitted after a new user account is created.
	// Params: userID uint, username string, email string
	EventUserRegistered = "user.registered"

	// EventUserLogin is emitted after a successful login.
	// Params: userID uint, username string
	EventUserLogin = "user.login"

	// EventUserPasswordChanged is emitted after a password change.
	// Params: userID uint
	EventUserPasswordChanged = "user.password_changed"

	// EventUserDeleted is emitted after a user is soft-deleted.
	// Params: userID uint
	EventUserDeleted = "user.deleted"
)
