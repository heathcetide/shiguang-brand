package redis

import "time"

type config struct {
	key string
	ttl time.Duration
}

// Option configures a Redis-backed bitmap.
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

// WithKey sets the Redis string key holding the bit array. Required.
func WithKey(key string) Option {
	return func(c *config) { c.key = key }
}

// WithTTL refreshes key expiration after each mutating write. Zero means no TTL.
func WithTTL(ttl time.Duration) Option {
	return func(c *config) { c.ttl = ttl }
}
