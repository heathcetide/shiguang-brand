// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package bootstrap

import (
	"github.com/heathcetide/DietDigiDose/pkg/common/eventbus"
)

// Common application event names.
const (
	EventAppStarting    = "app.starting"
	EventAppStarted     = "app.started"
	EventAppStopping    = "app.stopping"
	EventAppStopped     = "app.stopped"
	EventAppReady       = "app.ready"
	EventAppFailed      = "app.failed"
	EventComponentInit  = "component.init"
	EventComponentStart = "component.start"
	EventComponentStop  = "component.stop"
)

// newEventBus creates the default in-memory event bus for the application.
// Uses Async dispatch mode so Publish returns immediately — handlers run
// in background goroutines. This decouples event producers (e.g. HTTP
// handlers) from consumers (e.g. DB persistence listeners).
func newEventBus() eventbus.Bus {
	return eventbus.NewBus(eventbus.WithDispatchMode(eventbus.Async))
}
