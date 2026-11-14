// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package gin

import "github.com/gin-gonic/gin"

// Option configures the [Middleware].
type Option func(*options)

type options struct {
	onExtractError func(c *gin.Context, err error)
}

func applyOptions(opts ...Option) options {
	var o options
	for _, opt := range opts {
		if opt != nil {
			opt(&o)
		}
	}
	return o
}

// WithExtractError sets a custom handler for extraction errors.
// By default the middleware responds with 401 Unauthorized.
func WithExtractError(fn func(c *gin.Context, err error)) Option {
	return func(o *options) {
		o.onExtractError = fn
	}
}
