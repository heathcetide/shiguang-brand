package memory

import (
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common/cache"
)

type config struct {
	cache.Options
	cleanupInterval time.Duration
}

// Option configures a memory cache.
type Option func(*config)

func applyOptions(opts ...Option) config {
	cfg := config{cleanupInterval: time.Minute}
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

// WithCleanupInterval sets expired-entry purge interval. 0 disables background GC.
func WithCleanupInterval(d time.Duration) Option {
	return func(c *config) { c.cleanupInterval = d }
}
