// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package tree

import "time"

// Option configures a [Tree] created via [New].
type Option func(*options)

type options struct {
	now func() time.Time
}

func applyOptions(opts ...Option) options {
	o := options{now: time.Now}
	for _, opt := range opts {
		if opt != nil {
			opt(&o)
		}
	}
	return o
}

// WithClock injects a custom clock used for CreatedAt/UpdatedAt.
// Useful for deterministic tests. Defaults to [time.Now].
func WithClock(fn func() time.Time) Option {
	return func(o *options) {
		if fn != nil {
			o.now = fn
		}
	}
}
