package cache

import "time"

// Options holds shared configuration knobs used by cache backends.
type Options struct {
	// Prefix is prepended to every key before it is sent to the backend.
	Prefix string

	// DefaultTTL is applied by Set when the caller passes ttl == 0 and the
	// backend supports expiration. A zero DefaultTTL means "no expiration".
	DefaultTTL time.Duration
}

// Option mutates Options.
type Option func(*Options)

// WithPrefix sets a key prefix.
func WithPrefix(prefix string) Option {
	return func(o *Options) {
		o.Prefix = prefix
	}
}

// WithDefaultTTL sets the default TTL used when Set is called with ttl == 0.
func WithDefaultTTL(ttl time.Duration) Option {
	return func(o *Options) {
		o.DefaultTTL = ttl
	}
}

// ApplyOptions builds Options from the given Option list.
func ApplyOptions(opts ...Option) Options {
	var o Options
	for _, opt := range opts {
		if opt != nil {
			opt(&o)
		}
	}
	return o
}

// ResolveTTL returns ttl if positive, otherwise DefaultTTL.
func (o Options) ResolveTTL(ttl time.Duration) time.Duration {
	if ttl > 0 {
		return ttl
	}
	return o.DefaultTTL
}

// Key prefixes key with Prefix when Prefix is non-empty.
func (o Options) Key(key string) string {
	if o.Prefix == "" {
		return key
	}
	return o.Prefix + key
}
