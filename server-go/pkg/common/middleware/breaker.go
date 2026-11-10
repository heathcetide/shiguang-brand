// Copyright (c) 2026 LingByte
// SPDX-License-Identifier: MIT

package middleware

import (
	"github.com/heathcetide/DietDigiDose/pkg/common/circuitbreaker"
)

// Breaker is the circuit-breaker interface used by the timeout/circuit
// middleware. Both ling-base/circuitbreaker.CircuitBreaker and
// circuitbreaker.SREBreaker satisfy this interface, so applications can
// choose the strategy that fits their traffic profile.
type Breaker interface {
	Allow() error
	MarkSuccess()
	MarkFailed()
}

// BreakerFactory creates a Breaker for a given endpoint key.
// Used by TimeoutCircuitManager to lazily create per-endpoint breakers.
type BreakerFactory func(endpoint string) Breaker

// DefaultBreakerFactory returns a factory that creates
// circuitbreaker.CircuitBreaker instances with the given config.
func DefaultBreakerFactory(cfg circuitbreaker.Config) BreakerFactory {
	return func(endpoint string) Breaker {
		c := cfg
		c.Name = endpoint
		return circuitbreaker.New(c)
	}
}

// SREBreakerFactory returns a factory that creates SRE-style adaptive
// breakers with the given options.
func SREBreakerFactory(opts ...circuitbreaker.SREOption) BreakerFactory {
	return func(endpoint string) Breaker {
		return circuitbreaker.NewSREBreaker(opts...)
	}
}

// noopBreaker is a Breaker that never rejects.
type noopBreaker struct{}

func (noopBreaker) Allow() error { return nil }
func (noopBreaker) MarkSuccess() {}
func (noopBreaker) MarkFailed()  {}

// NoopBreakerFactory returns a factory that creates breakers which never
// reject. Useful for disabling circuit breaking while keeping the
// middleware chain intact.
func NoopBreakerFactory() BreakerFactory {
	return func(endpoint string) Breaker { return noopBreaker{} }
}
