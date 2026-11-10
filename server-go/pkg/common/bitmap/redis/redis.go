// Package redis provides a distributed exact bitmap backed by Redis SETBIT /
// GETBIT / BITCOUNT / DEL on a single string key.
//
// Multiple processes sharing the same key see the same bits. Persistence
// follows Redis RDB/AOF: application restarts do not lose data; Redis restarts
// depend on the server's durability settings. Optional WithTTL expires the
// whole key.
//
// Note: Redis stores a dense bit string. Setting a very large sparse offset
// allocates memory proportional to offset/8. Prefer the roaring backend for
// sparse local sets.
package redis

import (
	"context"
	"errors"
	"time"

	goredis "github.com/redis/go-redis/v9"

	"github.com/heathcetide/DietDigiDose/pkg/common/bitmap"
)

// Client is the Redis subset required by this bitmap.
type Client interface {
	SetBit(ctx context.Context, key string, offset int64, value int) *goredis.IntCmd
	GetBit(ctx context.Context, key string, offset int64) *goredis.IntCmd
	BitCount(ctx context.Context, key string, bitCount *goredis.BitCount) *goredis.IntCmd
	Del(ctx context.Context, keys ...string) *goredis.IntCmd
	Pipelined(ctx context.Context, fn func(goredis.Pipeliner) error) ([]goredis.Cmder, error)
	Expire(ctx context.Context, key string, expiration time.Duration) *goredis.BoolCmd
	BitOpAnd(ctx context.Context, destKey string, keys ...string) *goredis.IntCmd
	BitOpOr(ctx context.Context, destKey string, keys ...string) *goredis.IntCmd
	BitOpXor(ctx context.Context, destKey string, keys ...string) *goredis.IntCmd
	BitOpNot(ctx context.Context, destKey string, key string) *goredis.IntCmd
}

// Bitmap is a Redis-backed exact bitmap implementing bitmap.Bitmap and
// bitmap.Batcher.
type Bitmap struct {
	client Client
	cfg    config
	closed bool
	owns   bool // close underlying client on Close
}

// New creates a Redis bitmap from go-redis Options.
func New(redisOpts *goredis.Options, opts ...Option) (*Bitmap, error) {
	if redisOpts == nil {
		return nil, errors.New("redis: options must not be nil")
	}
	client := goredis.NewClient(redisOpts)
	b, err := NewWithClient(client, opts...)
	if err != nil {
		_ = client.Close()
		return nil, err
	}
	b.owns = true
	return b, nil
}

// NewWithClient wraps an existing Redis client (caller owns Close).
func NewWithClient(client Client, opts ...Option) (*Bitmap, error) {
	if client == nil {
		return nil, errors.New("redis: client must not be nil")
	}
	cfg := applyOptions(opts...)
	if cfg.key == "" {
		return nil, bitmap.ErrEmptyKey
	}
	return &Bitmap{client: client, cfg: cfg}, nil
}

func (b *Bitmap) Set(ctx context.Context, offset uint64) error {
	if err := b.check(ctx); err != nil {
		return err
	}
	if err := b.client.SetBit(ctx, b.cfg.key, int64(offset), 1).Err(); err != nil {
		return err
	}
	b.applyTTL(ctx)
	return nil
}

func (b *Bitmap) Get(ctx context.Context, offset uint64) (bool, error) {
	if err := b.check(ctx); err != nil {
		return false, err
	}
	v, err := b.client.GetBit(ctx, b.cfg.key, int64(offset)).Result()
	if err != nil {
		return false, err
	}
	return v == 1, nil
}

func (b *Bitmap) Clear(ctx context.Context, offset uint64) error {
	if err := b.check(ctx); err != nil {
		return err
	}
	if err := b.client.SetBit(ctx, b.cfg.key, int64(offset), 0).Err(); err != nil {
		return err
	}
	b.applyTTL(ctx)
	return nil
}

func (b *Bitmap) Count(ctx context.Context) (uint64, error) {
	if err := b.check(ctx); err != nil {
		return 0, err
	}
	n, err := b.client.BitCount(ctx, b.cfg.key, nil).Result()
	if err != nil {
		return 0, err
	}
	return uint64(n), nil
}

func (b *Bitmap) Reset(ctx context.Context) error {
	if err := b.check(ctx); err != nil {
		return err
	}
	return b.client.Del(ctx, b.cfg.key).Err()
}

func (b *Bitmap) Close() error {
	if b.closed {
		return nil
	}
	b.closed = true
	if b.owns {
		if closer, ok := b.client.(interface{ Close() error }); ok {
			return closer.Close()
		}
	}
	return nil
}

func (b *Bitmap) SetBatch(ctx context.Context, offsets []uint64) error {
	if err := b.check(ctx); err != nil {
		return err
	}
	if len(offsets) == 0 {
		return nil
	}
	_, err := b.client.Pipelined(ctx, func(pipe goredis.Pipeliner) error {
		for _, off := range offsets {
			pipe.SetBit(ctx, b.cfg.key, int64(off), 1)
		}
		return nil
	})
	if err != nil {
		return err
	}
	b.applyTTL(ctx)
	return nil
}

func (b *Bitmap) GetBatch(ctx context.Context, offsets []uint64) ([]bool, error) {
	if err := b.check(ctx); err != nil {
		return nil, err
	}
	if len(offsets) == 0 {
		return nil, nil
	}
	cmds := make([]*goredis.IntCmd, len(offsets))
	_, err := b.client.Pipelined(ctx, func(pipe goredis.Pipeliner) error {
		for i, off := range offsets {
			cmds[i] = pipe.GetBit(ctx, b.cfg.key, int64(off))
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	out := make([]bool, len(offsets))
	for i, cmd := range cmds {
		v, err := cmd.Result()
		if err != nil {
			return nil, err
		}
		out[i] = v == 1
	}
	return out, nil
}

func (b *Bitmap) ClearBatch(ctx context.Context, offsets []uint64) error {
	if err := b.check(ctx); err != nil {
		return err
	}
	if len(offsets) == 0 {
		return nil
	}
	_, err := b.client.Pipelined(ctx, func(pipe goredis.Pipeliner) error {
		for _, off := range offsets {
			pipe.SetBit(ctx, b.cfg.key, int64(off), 0)
		}
		return nil
	})
	if err != nil {
		return err
	}
	b.applyTTL(ctx)
	return nil
}

// BitOpAnd stores AND of source keys into destKey (Redis BITOP AND).
func (b *Bitmap) BitOpAnd(ctx context.Context, destKey string, keys ...string) error {
	if err := b.check(ctx); err != nil {
		return err
	}
	if destKey == "" || len(keys) == 0 {
		return bitmap.ErrEmptyKey
	}
	return b.client.BitOpAnd(ctx, destKey, keys...).Err()
}

// BitOpOr stores OR of source keys into destKey.
func (b *Bitmap) BitOpOr(ctx context.Context, destKey string, keys ...string) error {
	if err := b.check(ctx); err != nil {
		return err
	}
	if destKey == "" || len(keys) == 0 {
		return bitmap.ErrEmptyKey
	}
	return b.client.BitOpOr(ctx, destKey, keys...).Err()
}

// BitOpXor stores XOR of source keys into destKey.
func (b *Bitmap) BitOpXor(ctx context.Context, destKey string, keys ...string) error {
	if err := b.check(ctx); err != nil {
		return err
	}
	if destKey == "" || len(keys) == 0 {
		return bitmap.ErrEmptyKey
	}
	return b.client.BitOpXor(ctx, destKey, keys...).Err()
}

// BitOpNot stores NOT of key into destKey.
func (b *Bitmap) BitOpNot(ctx context.Context, destKey, key string) error {
	if err := b.check(ctx); err != nil {
		return err
	}
	if destKey == "" || key == "" {
		return bitmap.ErrEmptyKey
	}
	return b.client.BitOpNot(ctx, destKey, key).Err()
}

// Key returns the Redis key backing this bitmap.
func (b *Bitmap) Key() string { return b.cfg.key }

func (b *Bitmap) check(ctx context.Context) error {
	if b.closed {
		return bitmap.ErrClosed
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	return nil
}

func (b *Bitmap) applyTTL(ctx context.Context) {
	if b.cfg.ttl > 0 {
		_ = b.client.Expire(ctx, b.cfg.key, b.cfg.ttl).Err()
	}
}

var (
	_ bitmap.Bitmap  = (*Bitmap)(nil)
	_ bitmap.Batcher = (*Bitmap)(nil)
)
