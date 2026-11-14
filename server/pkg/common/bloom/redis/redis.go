// Package redis provides a distributed Bloom filter backed by Redis using the
// SETBIT/GETBIT commands on a single string key.
//
// The bit positions are computed locally with the same double-hashing scheme
// used by the in-memory drivers, then applied to the shared Redis bit array.
// This lets multiple processes share one filter. All k bit operations for a
// single Add/Test are issued through a pipeline to amortize round-trips, and
// AddBatch/TestBatch extend this to multiple keys per pipeline.
//
// Removal is not supported (SETBIT bits are shared). Reset deletes the Redis
// key. An optional TTL expires the whole filter at once.
package redis

import (
	"context"
	"errors"
	"time"

	goredis "github.com/redis/go-redis/v9"

	"github.com/heathcetide/DietDigiDose/pkg/common/bloom"
)

// Client is the Redis subset required by this filter. *goredis.Client and
// *goredis.ClusterClient satisfy it.
type Client interface {
	SetBit(ctx context.Context, key string, offset int64, value int) *goredis.IntCmd
	GetBit(ctx context.Context, key string, offset int64) *goredis.IntCmd
	Del(ctx context.Context, keys ...string) *goredis.IntCmd
	Pipelined(ctx context.Context, fn func(goredis.Pipeliner) error) ([]goredis.Cmder, error)
	Expire(ctx context.Context, key string, expiration time.Duration) *goredis.BoolCmd
}

// Filter is a Redis-backed Bloom filter implementing bloom.Filter and
// bloom.Batcher.
type Filter struct {
	client Client
	cfg    config
	closed bool
}

// New creates a Redis Bloom filter from go-redis Options.
func New(redisOpts *goredis.Options, opts ...Option) (*Filter, error) {
	if redisOpts == nil {
		return nil, errors.New("redis: options must not be nil")
	}
	client := goredis.NewClient(redisOpts)
	f, err := NewWithClient(client, opts...)
	if err != nil {
		_ = client.Close()
		return nil, err
	}
	return f, nil
}

// NewWithClient wraps an existing Redis client.
func NewWithClient(client Client, opts ...Option) (*Filter, error) {
	if client == nil {
		return nil, errors.New("redis: client must not be nil")
	}
	cfg := applyOptions(opts...)
	if cfg.key == "" {
		return nil, bloom.ErrEmptyKey
	}
	if cfg.m == 0 {
		return nil, bloom.ErrInvalidCapacity
	}
	if cfg.k == 0 {
		return nil, bloom.ErrInvalidFalsePositiveRate
	}
	return &Filter{client: client, cfg: cfg}, nil
}

func (f *Filter) Add(ctx context.Context, key string) error {
	if err := f.check(ctx, key); err != nil {
		return err
	}
	idx := bloom.Indices(key, f.cfg.m, f.cfg.k, nil)
	_, err := f.client.Pipelined(ctx, func(pipe goredis.Pipeliner) error {
		for _, i := range idx {
			pipe.SetBit(ctx, f.cfg.key, int64(i), 1)
		}
		return nil
	})
	if err != nil {
		return err
	}
	f.applyTTL(ctx)
	return nil
}

func (f *Filter) AddBatch(ctx context.Context, keys []string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if f.closed {
		return bloom.ErrClosed
	}
	for _, k := range keys {
		if k == "" {
			return bloom.ErrEmptyKey
		}
	}
	if len(keys) == 0 {
		return nil
	}

	_, err := f.client.Pipelined(ctx, func(pipe goredis.Pipeliner) error {
		for _, key := range keys {
			idx := bloom.Indices(key, f.cfg.m, f.cfg.k, nil)
			for _, i := range idx {
				pipe.SetBit(ctx, f.cfg.key, int64(i), 1)
			}
		}
		return nil
	})
	if err != nil {
		return err
	}
	f.applyTTL(ctx)
	return nil
}

func (f *Filter) Test(ctx context.Context, key string) (bool, error) {
	if err := f.check(ctx, key); err != nil {
		return false, err
	}
	idx := bloom.Indices(key, f.cfg.m, f.cfg.k, nil)
	cmds, err := f.client.Pipelined(ctx, func(pipe goredis.Pipeliner) error {
		for _, i := range idx {
			pipe.GetBit(ctx, f.cfg.key, int64(i))
		}
		return nil
	})
	if err != nil && !isRedisNil(err) {
		return false, err
	}
	for _, cmd := range cmds {
		n, err := cmd.(*goredis.IntCmd).Result()
		if err != nil {
			return false, err
		}
		if n == 0 {
			return false, nil
		}
	}
	return true, nil
}

func (f *Filter) TestBatch(ctx context.Context, keys []string) ([]bool, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if f.closed {
		return nil, bloom.ErrClosed
	}
	for _, k := range keys {
		if k == "" {
			return nil, bloom.ErrEmptyKey
		}
	}
	results := make([]bool, len(keys))
	if len(keys) == 0 {
		return results, nil
	}

	// Issue all GETBITs in one pipeline; remember how many cmds per key.
	perKey := int(f.cfg.k)
	cmds, err := f.client.Pipelined(ctx, func(pipe goredis.Pipeliner) error {
		for _, key := range keys {
			idx := bloom.Indices(key, f.cfg.m, f.cfg.k, nil)
			for _, i := range idx {
				pipe.GetBit(ctx, f.cfg.key, int64(i))
			}
		}
		return nil
	})
	if err != nil && !isRedisNil(err) {
		return nil, err
	}

	for i := range keys {
		hit := true
		for j := 0; j < perKey; j++ {
			n, err := cmds[i*perKey+j].(*goredis.IntCmd).Result()
			if err != nil {
				return nil, err
			}
			if n == 0 {
				hit = false
			}
		}
		results[i] = hit
	}
	return results, nil
}

func (f *Filter) Reset(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if f.closed {
		return bloom.ErrClosed
	}
	return f.client.Del(ctx, f.cfg.key).Err()
}

func (f *Filter) Close() error {
	if f.closed {
		return nil
	}
	f.closed = true
	if closer, ok := f.client.(interface{ Close() error }); ok {
		return closer.Close()
	}
	return nil
}

// Key returns the Redis key backing the filter.
func (f *Filter) Key() string { return f.cfg.key }

// M returns the number of bits in the filter.
func (f *Filter) M() uint64 { return f.cfg.m }

// K returns the number of hash functions.
func (f *Filter) K() uint64 { return f.cfg.k }

func (f *Filter) check(ctx context.Context, key string) error {
	if f.closed {
		return bloom.ErrClosed
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if key == "" {
		return bloom.ErrEmptyKey
	}
	return nil
}

// applyTTL sets the configured expiration on the key, if any. Errors are
// ignored on purpose: the bit array is already set, and a failed EXPIRE should
// not turn a successful Add into a failure.
func (f *Filter) applyTTL(ctx context.Context) {
	if f.cfg.ttl > 0 {
		_ = f.client.Expire(ctx, f.cfg.key, f.cfg.ttl).Err()
	}
}

func isRedisNil(err error) bool {
	return errors.Is(err, goredis.Nil)
}

// Ensure Filter implements bloom.Filter and bloom.Batcher.
var (
	_ bloom.Filter  = (*Filter)(nil)
	_ bloom.Batcher = (*Filter)(nil)
)
