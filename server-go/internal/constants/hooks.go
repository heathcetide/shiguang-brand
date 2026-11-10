// Copyright (c) 2026 heathcetide. All rights reserved.

package constants

// Init hook names used with bootstrap.Application.AddInitHook.
// Centralized here to avoid string-typo bugs and make hook ordering
// easy to audit.
const (
	// HookSeedRBAC seeds default roles, permissions, and admin
	// role-permission assignments (RBAC only).
	HookSeedRBAC = "seed-rbac"

	// HookRegisterListeners connects all signal event listeners to
	// the process-wide common.Sig() bus.
	HookRegisterListeners = "register-listeners"
)
