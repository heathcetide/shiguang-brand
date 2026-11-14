// Copyright (c) 2026 heathcetide. All rights reserved.

// Package retry wraps ling-base/common/retry as a package-level singleton.
//
// Usage:
//
//	// Initialize at startup in main.go
//	pkgretry.Init(cfg.Retry)
//
//	// Call directly from handler / service
//	err := pkgretry.Do(ctx, func(ctx context.Context) error {
//	    return callRemoteAPI(ctx)
//	})
package retry

import (
	"context"
	"strconv"
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common/retry"
)

// Package-level singleton.
var (
	// Opts is the active retry option set. Defaults are used until Init() is called.
	Opts []retry.Option
)

// Init initializes the retry singleton from configuration.
func Init(maxAttempts int, initialDelay, maxDelay, factor string, jitter bool) {
	delay, _ := time.ParseDuration(initialDelay)
	if delay <= 0 {
		delay = 100 * time.Millisecond
	}
	mxDelay, _ := time.ParseDuration(maxDelay)
	if mxDelay <= 0 {
		mxDelay = 10 * time.Second
	}
	f := 2.0
	if parsed, err := strconv.ParseFloat(factor, 64); err == nil && parsed > 1.0 {
		f = parsed
	}
	attempts := maxAttempts
	if attempts <= 0 {
		attempts = 3
	}
	Opts = []retry.Option{
		retry.WithMaxAttempts(attempts),
		retry.WithExponentialBackoff(delay, mxDelay, f, jitter),
	}
}

// Do executes a retryable operation using the global Opts.
func Do(ctx context.Context, op retry.Operation) error {
	return retry.Do(ctx, op, Opts...)
}

// DoWith executes a retryable operation with custom options (overrides global Opts).
func DoWith(ctx context.Context, op retry.Operation, opts ...retry.Option) error {
	return retry.Do(ctx, op, opts...)
}
