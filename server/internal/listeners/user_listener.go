// Copyright (c) 2026 heathcetide. All rights reserved.

package listeners

import (
	"github.com/heathcetide/DietDigiDose/internal/constants"

	"github.com/heathcetide/DietDigiDose/pkg/common"
	"github.com/heathcetide/DietDigiDose/pkg/common/logger"
	"go.uber.org/zap"
	"gorm.io/gorm"
)

// registerUserListeners connects handlers for user-related events.
func registerUserListeners(db *gorm.DB) {
	sig := common.Sig()

	// EventUserRegistered: log new registrations
	// Params: userID uint, username string, email string
	sig.Connect(constants.EventUserRegistered, safeEmit(constants.EventUserRegistered, func(sender any, params ...any) {
		if len(params) < 3 {
			return
		}
		userID, _ := params[0].(uint)
		username, _ := params[1].(string)
		email, _ := params[2].(string)
		logger.Lg.Info("user registered",
			zap.Uint("userID", userID),
			zap.String("username", username),
			zap.String("email", email),
		)
		// TODO: send welcome email, create default preferences, etc.
	}))

	// EventUserLogin: log successful logins
	// Params: userID uint, username string
	sig.Connect(constants.EventUserLogin, safeEmit(constants.EventUserLogin, func(sender any, params ...any) {
		if len(params) < 2 {
			return
		}
		userID, _ := params[0].(uint)
		username, _ := params[1].(string)
		logger.Lg.Info("user login",
			zap.Uint("userID", userID),
			zap.String("username", username),
		)
		// TODO: update audit log, check suspicious login patterns, etc.
	}))

	// EventUserPasswordChanged: log password changes
	// Params: userID uint
	sig.Connect(constants.EventUserPasswordChanged, safeEmit(constants.EventUserPasswordChanged, func(sender any, params ...any) {
		if len(params) < 1 {
			return
		}
		userID, _ := params[0].(uint)
		logger.Lg.Info("user password changed", zap.Uint("userID", userID))
		// TODO: send security notification email, invalidate sessions, etc.
	}))

	// EventUserDeleted: log user deletions
	// Params: userID uint
	sig.Connect(constants.EventUserDeleted, safeEmit(constants.EventUserDeleted, func(sender any, params ...any) {
		if len(params) < 1 {
			return
		}
		userID, _ := params[0].(uint)
		logger.Lg.Info("user deleted", zap.Uint("userID", userID))
		// TODO: cleanup user data, revoke tokens, notify related services, etc.
	}))
}
