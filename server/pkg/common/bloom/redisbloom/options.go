package redisbloom

import (
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common/bloom"
)

// DefaultExpansion is the default sub-filter growth ratio used by RedisBloom
// when the filter fills up. A value of 2 means each new sub-filter is twice
// the capacity of the previous one.
const DefaultExpansion = 2

type config struct {
	key        string
	capacity   uint64
	errorRate  float64
	ttl        time.Duration
	expansion  int64
	nonScaling bool
	noCreate   bool
}

// Option configures a RedisBloom-backed Bloom filter.
type Option func(*config)

func applyOptions(opts ...Option) config {
	cfg := config{
		errorRate: 0.001, // RedisBloom default
		capacity:  1000,  // RedisBloom default
		expansion: DefaultExpansion,
	}
	for _, opt := range opts {
		if opt != nil {
			opt(&cfg)
		}
	}
	return cfg
}

// WithKey sets the Redis key holding the Bloom filter. Required; must be
// non-empty.
func WithKey(key string) Option {
	return func(c *config) { c.key = key }
}

// WithCapacity sets both the expected element count and the target
// false-positive probability, which RedisBloom uses to size the filter
// internally via BF.RESERVE. This is the primary sizing knob.
// n must be greater than zero and p must be in (0, 1); invalid values are
// rejected by New via validate.
func WithCapacity(n uint64, p float64) Option {
	return func(c *config) {
		c.capacity = n
		c.errorRate = p
	}
}

// WithErrorRate sets only the target false-positive probability. Use together
// with WithExpectedCapacity when you prefer to set them independently.
// p must be in (0, 1); invalid values are rejected by New via validate.
func WithErrorRate(p float64) Option {
	return func(c *config) {
		c.errorRate = p
	}
}

// WithExpectedCapacity sets only the expected element count.
// n must be greater than zero; invalid values are rejected by New via validate.
func WithExpectedCapacity(n uint64) Option {
	return func(c *config) {
		c.capacity = n
	}
}

// WithTTL sets an expiration on the Redis key. A zero TTL (the default) means
// the key persists until explicitly deleted.
func WithTTL(ttl time.Duration) Option {
	return func(c *config) { c.ttl = ttl }
}

// WithExpansion sets the sub-filter growth ratio (EXPANSION parameter in
// BF.RESERVE). When the filter is full, RedisBloom creates a new sub-filter
// with capacity multiplied by this value. Must be >= 1. Default 2.
//
// Set to 1 to disable growth (the filter will return errors when full unless
// WithNonScaling is also set).
func WithExpansion(n int) Option {
	return func(c *config) {
		if n >= 1 {
			c.expansion = int64(n)
		}
	}
}

// WithNonScaling marks the filter as non-scaling (NONSCALING flag in
// BF.RESERVE): it will not grow when full, and BF.ADD will fail once capacity
// is reached.
func WithNonScaling() Option {
	return func(c *config) { c.nonScaling = true }
}

// WithNoCreate skips the automatic BF.RESERVE call. The filter will rely on
// RedisBloom's implicit creation via BF.ADD, which uses default parameters.
// Use this when the filter was pre-created by another process or when you
// want to avoid the extra round-trip.
func WithNoCreate() Option {
	return func(c *config) { c.noCreate = true }
}

// validate checks the config for required fields.
func (c config) validate() error {
	if c.key == "" {
		return bloom.ErrEmptyKey
	}
	if c.capacity == 0 {
		return bloom.ErrInvalidCapacity
	}
	if !(c.errorRate > 0 && c.errorRate < 1) {
		return bloom.ErrInvalidFalsePositiveRate
	}
	return nil
}
