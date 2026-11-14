package bigcache

import (
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common/cache"
)

type config struct {
	cache.Options
	shards             int
	maxEntriesInWindow int
	maxEntrySize       int
	hardMaxCacheSize   int
	strictTTL          bool
}

// Option configures a BigCache adapter.
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

// WithDefaultTTL is accepted for API consistency; BigCache uses LifeWindow instead.
func WithDefaultTTL(ttl time.Duration) Option {
	return func(c *config) { c.DefaultTTL = ttl }
}

// WithShards sets the number of shards (must be a power of 2).
func WithShards(n int) Option {
	return func(c *config) { c.shards = n }
}

// WithMaxEntriesInWindow sets MaxEntriesInWindow.
func WithMaxEntriesInWindow(n int) Option {
	return func(c *config) { c.maxEntriesInWindow = n }
}

// WithMaxEntrySize sets MaxEntrySize in bytes.
func WithMaxEntrySize(n int) Option {
	return func(c *config) { c.maxEntrySize = n }
}

// WithHardMaxCacheSize sets HardMaxCacheSize in MB.
func WithHardMaxCacheSize(n int) Option {
	return func(c *config) { c.hardMaxCacheSize = n }
}

// WithStrictTTL makes Set return ErrPerKeyTTLUnsupported when ttl > 0,
// so callers cannot silently assume per-key expiration works.
func WithStrictTTL() Option {
	return func(c *config) { c.strictTTL = true }
}
