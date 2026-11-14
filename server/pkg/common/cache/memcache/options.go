package memcache

import (
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common/cache"
)

type config struct {
	cache.Options
	timeout      time.Duration
	maxIdleConns int
}

// Option configures a Memcached cache.
type Option func(*config)

func applyOptions(opts ...Option) config {
	cfg := config{
		timeout:      100 * time.Millisecond,
		maxIdleConns: 2,
	}
	for _, opt := range opts {
		if opt != nil {
			opt(&cfg)
		}
	}
	return cfg
}

// WithPrefix sets a key prefix.
func WithPrefix(prefix string) Option {
	return func(c *config) {
		c.Prefix = prefix
	}
}

// WithDefaultTTL sets the default TTL used when Set is called with ttl == 0.
func WithDefaultTTL(ttl time.Duration) Option {
	return func(c *config) {
		c.DefaultTTL = ttl
	}
}

// WithTimeout sets the per-request timeout for Memcached operations.
func WithTimeout(d time.Duration) Option {
	return func(c *config) {
		c.timeout = d
	}
}

// WithMaxIdleConns sets the maximum number of idle connections per server.
func WithMaxIdleConns(n int) Option {
	return func(c *config) {
		c.maxIdleConns = n
	}
}
