// Package redisbloom provides a distributed Bloom filter backed by the
// RedisBloom module (https://redis.io/docs/latest/develop/data-types/probabilistic/bloom-filter/),
// which must be loaded on the Redis server.
//
// Unlike bloom/redis (which uses SETBIT/GETBIT on a plain Redis string), this
// driver delegates all probabilistic logic to the RedisBloom module via the
// BF.* command family:
//
//   - BF.RESERVE creates a filter with a target capacity and error rate.
//   - BF.ADD / BF.MADD add one or many items.
//   - BF.EXISTS / BF.MEXISTS test one or many items.
//
// RedisBloom manages the bit array, hash functions, and (optionally) sub-filter
// growth internally, so the client does not need to compute bit positions.
// This makes the filter geometry opaque to the caller and lets RedisBloom
// optimize storage and CPU on the server side.
//
// The filter is auto-created (via BF.RESERVE) on the first Add/AddBatch call
// unless WithNoCreate is set. If the filter already exists (created by another
// process), the "item exists" error from BF.RESERVE is silently ignored.
package redisbloom

import (
	"context"
	"errors"
	"sync"
	"time"

	goredis "github.com/redis/go-redis/v9"

	"github.com/heathcetide/DietDigiDose/pkg/common/bloom"
)

// Filter is a RedisBloom-backed Bloom filter implementing bloom.Filter and
// bloom.Batcher.
type Filter struct {
	backend  Backend
	cfg      config
	closer   func() error
	mu       sync.Mutex
	reserved bool
	closed   bool
}

// New creates a RedisBloom filter from go-redis Options. The underlying client
// is owned by the filter and closed by Close.
func New(redisOpts *goredis.Options, opts ...Option) (*Filter, error) {
	if redisOpts == nil {
		return nil, errors.New("redisbloom: options must not be nil")
	}
	client := goredis.NewClient(redisOpts)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := client.Ping(ctx).Err(); err != nil {
		_ = client.Close()
		return nil, err
	}

	f, err := NewWithBackend(NewBackend(client), opts...)
	if err != nil {
		_ = client.Close()
		return nil, err
	}
	f.closer = client.Close
	return f, nil
}

// NewWithClient wraps an existing go-redis client (Client, ClusterClient,
// etc.). The client is not closed by Close unless it implements io.Closer.
func NewWithClient(client cmdable, opts ...Option) (*Filter, error) {
	if client == nil {
		return nil, errors.New("redisbloom: client must not be nil")
	}
	f, err := NewWithBackend(NewBackend(client), opts...)
	if err != nil {
		return nil, err
	}
	if closer, ok := client.(interface{ Close() error }); ok {
		f.closer = closer.Close
	}
	return f, nil
}

// NewWithBackend creates a filter from a custom Backend. This is primarily
// useful for testing or when you need full control over the command layer.
func NewWithBackend(backend Backend, opts ...Option) (*Filter, error) {
	if backend == nil {
		return nil, errors.New("redisbloom: backend must not be nil")
	}
	cfg := applyOptions(opts...)
	if err := cfg.validate(); err != nil {
		return nil, err
	}
	return &Filter{
		backend: backend,
		cfg:     cfg,
	}, nil
}

func (f *Filter) Add(ctx context.Context, key string) error {
	if err := f.check(ctx, key); err != nil {
		return err
	}
	if err := f.ensureReserved(ctx); err != nil {
		return err
	}
	if _, err := f.backend.Add(ctx, f.cfg.key, key); err != nil {
		return err
	}
	f.applyTTL(ctx)
	return nil
}

func (f *Filter) AddBatch(ctx context.Context, keys []string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if f.isClosed() {
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
	if err := f.ensureReserved(ctx); err != nil {
		return err
	}
	if _, err := f.backend.MAdd(ctx, f.cfg.key, keys); err != nil {
		return err
	}
	f.applyTTL(ctx)
	return nil
}

func (f *Filter) Test(ctx context.Context, key string) (bool, error) {
	if err := f.check(ctx, key); err != nil {
		return false, err
	}
	return f.backend.Exists(ctx, f.cfg.key, key)
}

func (f *Filter) TestBatch(ctx context.Context, keys []string) ([]bool, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if f.isClosed() {
		return nil, bloom.ErrClosed
	}
	for _, k := range keys {
		if k == "" {
			return nil, bloom.ErrEmptyKey
		}
	}
	if len(keys) == 0 {
		return []bool{}, nil
	}
	return f.backend.MExists(ctx, f.cfg.key, keys)
}

func (f *Filter) Reset(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.closed {
		return bloom.ErrClosed
	}
	if err := f.backend.Del(ctx, f.cfg.key); err != nil {
		return err
	}
	f.reserved = false
	return nil
}

func (f *Filter) Close() error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.closed {
		return nil
	}
	f.closed = true
	if f.closer != nil {
		return f.closer()
	}
	return nil
}

// Key returns the Redis key backing the filter.
func (f *Filter) Key() string { return f.cfg.key }

// Capacity returns the configured expected element count.
func (f *Filter) Capacity() uint64 { return f.cfg.capacity }

// ErrorRate returns the configured target false-positive probability.
func (f *Filter) ErrorRate() float64 { return f.cfg.errorRate }

// IsReserved reports whether BF.RESERVE has been successfully called.
func (f *Filter) IsReserved() bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.reserved
}

func (f *Filter) check(ctx context.Context, key string) error {
	if f.isClosed() {
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

func (f *Filter) isClosed() bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.closed
}

// ensureReserved calls BF.RESERVE once (unless WithNoCreate is set). If the
// filter already exists on the server, the "item exists" error is ignored.
func (f *Filter) ensureReserved(ctx context.Context) error {
	f.mu.Lock()
	if f.reserved || f.cfg.noCreate {
		f.mu.Unlock()
		return nil
	}
	f.mu.Unlock()

	err := f.backend.Reserve(ctx, f.cfg.key, f.cfg.errorRate, int64(f.cfg.capacity), f.cfg.expansion, f.cfg.nonScaling)
	if err != nil {
		if isItemExistsError(err) {
			// Another process already created the filter; treat as success.
			f.mu.Lock()
			f.reserved = true
			f.mu.Unlock()
			return nil
		}
		return err
	}

	f.mu.Lock()
	f.reserved = true
	f.mu.Unlock()
	return nil
}

// applyTTL sets the configured expiration on the key, if any. Errors are
// ignored: a failed EXPIRE should not turn a successful Add into a failure.
func (f *Filter) applyTTL(ctx context.Context) {
	if f.cfg.ttl > 0 {
		_ = f.backend.Expire(ctx, f.cfg.key, f.cfg.ttl)
	}
}

// Ensure Filter implements bloom.Filter and bloom.Batcher.
var (
	_ bloom.Filter  = (*Filter)(nil)
	_ bloom.Batcher = (*Filter)(nil)
)
