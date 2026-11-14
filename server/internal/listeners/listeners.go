// Copyright (c) 2026 heathcetide. All rights reserved.

// Package listeners registers signal handlers for post-processing of
// domain events. It uses ling-base/common.Signals (common.Sig()) as the
// process-wide synchronous event bus.
//
// Events are defined in internal/constants/events.go and emitted by
// handlers after successful operations. Listeners connect to those events
// and perform side-effects such as logging, cache invalidation, audit
// trails, notification dispatch, etc.
//
// Register all listeners during application startup:
//
//	app.AddInitHook("register-listeners", func(ctx context.Context) error {
//	    listeners.Register(db)
//	    return nil
//	})
package listeners

import (
	"github.com/heathcetide/DietDigiDose/pkg/common"
	"github.com/heathcetide/DietDigiDose/pkg/common/logger"
	"go.uber.org/zap"
	"gorm.io/gorm"
)

// Register connects all event listeners to the signal bus.
// Pass nil for db if database access is not needed in listeners.
func Register(db *gorm.DB) {
	registerUserListeners(db)
	logger.Lg.Info("event listeners registered")
}

// safeEmit is a convenience wrapper that logs panics from handlers
// instead of crashing the process. Signal handlers should be fast and
// non-blocking; if a listener needs to do heavy work it should spawn
// a goroutine internally.
func safeEmit(event string, handler common.SignalHandler) common.SignalHandler {
	return func(sender any, params ...any) {
		defer func() {
			if r := recover(); r != nil {
				logger.Lg.Error("event listener panicked",
					zap.String("event", event),
					zap.Any("panic", r),
				)
			}
		}()
		handler(sender, params...)
	}
}
