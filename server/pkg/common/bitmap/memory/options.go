package memory

import "github.com/heathcetide/DietDigiDose/pkg/common/bitmap"

type config struct {
	// capacity is the initial / fixed number of bits. Zero means grow from empty.
	capacity uint64
	// fixed rejects Set beyond capacity (ErrOffsetOutOfRange).
	fixed bool
}

// Option configures a memory bitmap.
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

// WithCapacity pre-allocates room for capacity bits (dense []byte of
// ceil(capacity/8) bytes). The bitmap still grows past capacity unless
// WithFixed is also set.
func WithCapacity(capacity uint64) Option {
	return func(c *config) {
		c.capacity = capacity
	}
}

// WithFixed makes WithCapacity a hard upper bound: Set/Get/Clear beyond
// capacity return bitmap.ErrOffsetOutOfRange. Capacity must be > 0.
func WithFixed(capacity uint64) Option {
	return func(c *config) {
		c.capacity = capacity
		c.fixed = true
	}
}

// validate returns an error if the config is inconsistent.
func (c config) validate() error {
	if c.fixed && c.capacity == 0 {
		return bitmap.ErrInvalidCapacity
	}
	return nil
}
