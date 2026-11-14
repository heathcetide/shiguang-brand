package counting

import "github.com/heathcetide/DietDigiDose/pkg/common/bloom"

type config struct {
	m uint64
	k uint64
}

// Option configures a counting Bloom filter.
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
// hash functions k). m must be greater than zero and k must be at least 1.
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
