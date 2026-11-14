package memory

import "github.com/heathcetide/DietDigiDose/pkg/common/bloom"

type config struct {
	params bloom.Params
	// m and k override params when non-zero.
	m uint64
	k uint64
}

// Option configures a memory Bloom filter.
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

// WithParams sets the filter geometry directly (number of bits m and number of
// hash functions k). Use this when you have precomputed values, e.g. from
// bloom.Estimate. m must be greater than zero and k must be at least 1.
func WithParams(p bloom.Params) Option {
	return func(c *config) {
		c.params = p
		c.m = p.M
		c.k = p.K
	}
}

// WithCapacity computes the filter geometry from an expected element count n
// and a target false-positive probability p. This is a convenience wrapper
// around bloom.Estimate.
func WithCapacity(n uint64, p float64) Option {
	return func(c *config) {
		ps, err := bloom.Estimate(n, p)
		if err != nil {
			// Defer validation to New; stash a sentinel via zero values which
			// New will reject.
			c.m = 0
			return
		}
		c.params = ps
		c.m = ps.M
		c.k = ps.K
	}
}
