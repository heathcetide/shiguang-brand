package scalable

import (
	"github.com/heathcetide/DietDigiDose/pkg/common/bloom"
)

// Defaults follow the Almeida et al. (2007) Scalable Bloom Filter paper:
// capacity grows by a factor of 2 per sub-filter and the false-positive
// probability tightens by a factor of 0.9, keeping the overall FPR bounded.
const (
	DefaultGrowthRatio = 2.0
	DefaultFPRRatio    = 0.9
)

type config struct {
	n0      uint64  // initial capacity of the first sub-filter
	p0      float64 // initial false-positive probability
	growth  float64 // capacity growth ratio per sub-filter (s)
	fpRatio float64 // FPR tightening ratio per sub-filter (r)
}

// Option configures a scalable Bloom filter.
type Option func(*config)

func applyOptions(opts ...Option) config {
	cfg := config{
		growth:  DefaultGrowthRatio,
		fpRatio: DefaultFPRRatio,
	}
	for _, opt := range opts {
		if opt != nil {
			opt(&cfg)
		}
	}
	return cfg
}

// WithInitialCapacity sets the expected element count for the first
// sub-filter (n0). Required; must be greater than zero.
func WithInitialCapacity(n uint64) Option {
	return func(c *config) { c.n0 = n }
}

// WithFalsePositiveRate sets the target false-positive probability for the
// first sub-filter (p0). Required; must be in (0, 1). Subsequent sub-filters
// use p0 * r^i, so the aggregate FPR stays bounded by p0/(1-r).
func WithFalsePositiveRate(p float64) Option {
	return func(c *config) { c.p0 = p }
}

// WithGrowthRatio sets the capacity growth ratio s between successive
// sub-filters (n_i = n0 * s^i). Defaults to 2. Must be greater than 1.
func WithGrowthRatio(s float64) Option {
	return func(c *config) { c.growth = s }
}

// WithFPRRatio sets the false-positive tightening ratio r between successive
// sub-filters (p_i = p0 * r^i). Defaults to 0.9. Must be in (0, 1).
func WithFPRRatio(r float64) Option {
	return func(c *config) { c.fpRatio = r }
}

// estimateFor computes Params for sub-filter i.
func (c config) estimateFor(i int) (bloom.Params, error) {
	n := float64(c.n0)
	for j := 0; j < i; j++ {
		n *= c.growth
	}
	p := c.p0
	for j := 0; j < i; j++ {
		p *= c.fpRatio
	}
	return bloom.Estimate(uint64(n), p)
}
