package ristretto

import (
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common/cache"
)

type config struct {
	cache.Options
	cost int64
}

// Option configures a Ristretto adapter.
type Option func(*config)

func applyOptions(opts ...Option) config {
	var cfg config
	for _, opt := range opts {
		if opt != nil {
			opt(&cfg)
		}
	}
	return cfg
}

// WithPrefix sets a key prefix.
func WithPrefix(prefix string) Option {
	return func(c *config) { c.Prefix = prefix }
}

// WithDefaultTTL sets the default TTL used when Set is called with ttl == 0.
func WithDefaultTTL(ttl time.Duration) Option {
	return func(c *config) { c.DefaultTTL = ttl }
}

// WithCost sets the cost charged per entry (default 1).
func WithCost(cost int64) Option {
	return func(c *config) { c.cost = cost }
}
