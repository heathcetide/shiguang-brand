package redis

import (
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common/bloom"
)

type config struct {
	key string
	m   uint64
	k   uint64
	ttl time.Duration
}

// Option configures a Redis-backed Bloom filter.
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

// WithKey sets the Redis key holding the bit array. Required; must be non-empty.
func WithKey(key string) Option {
	return func(c *config) { c.key = key }
}

// WithParams sets the filter geometry (number of bits m and hash functions k)
// directly. m must be greater than zero and k must be at least 1.
func WithParams(p bloom.Params) Option {
	return func(c *config) {
		c.m = p.M
		c.k = p.K
	}
}

// WithCapacity computes the filter geometry from an expected element count n
// and a target false-positive probability p.
func WithCapacity(n uint64, p float64) Option {
	return func(c *config) {
		ps, err := bloom.Estimate(n, p)
		if err != nil {
			c.m = 0
			return
		}
		c.m = ps.M
		c.k = ps.K
	}
}

// WithTTL sets an expiration on the Redis key holding the bit array. A zero TTL
// (the default) means the key persists until explicitly deleted.
func WithTTL(ttl time.Duration) Option {
	return func(c *config) { c.ttl = ttl }
}
