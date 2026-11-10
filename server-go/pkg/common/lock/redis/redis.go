// Package redis implements a Redis distributed lock (SET NX PX + token compare).
package redis

import (
	"context"
	"errors"
	"time"

	goredis "github.com/redis/go-redis/v9"

	"github.com/heathcetide/DietDigiDose/pkg/common/lock"
)

const unlockScript = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
else
  return 0
end`

const refreshScript = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("PEXPIRE", KEYS[1], ARGV[2])
else
  return 0
end`

// Client is the Redis subset required by this lock.
type Client interface {
	SetNX(ctx context.Context, key string, value interface{}, expiration time.Duration) *goredis.BoolCmd
	Eval(ctx context.Context, script string, keys []string, args ...interface{}) *goredis.Cmd
}

// Mutex is a Redis-backed lock for a single key.
type Mutex struct {
	client Client
	key    string
	opts   lock.Options
}

// NewMutex creates a Redis lock for key.
func NewMutex(client Client, key string, opts ...lock.Option) (*Mutex, error) {
	if client == nil {
		return nil, errors.New("redis: client must not be nil")
	}
	if key == "" {
		return nil, lock.ErrEmptyKey
	}
	o := lock.ApplyOptions(opts...)
	if o.TTL <= 0 {
		return nil, lock.ErrInvalidTTL
	}
	if _, err := lock.ResolveValue(&o); err != nil {
		return nil, err
	}
	return &Mutex{client: client, key: key, opts: o}, nil
}

func (m *Mutex) Lock(ctx context.Context) error {
	for {
		if err := m.TryLock(ctx); err == nil {
			return nil
		} else if err != lock.ErrNotObtained {
			return err
		}
		timer := time.NewTimer(m.opts.RetryDelay)
		select {
		case <-ctx.Done():
			timer.Stop()
			return ctx.Err()
		case <-timer.C:
		}
	}
}

func (m *Mutex) TryLock(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	ok, err := m.client.SetNX(ctx, m.key, m.opts.Value, m.opts.TTL).Result()
	if err != nil {
		return err
	}
	if !ok {
		return lock.ErrNotObtained
	}
	return nil
}

func (m *Mutex) Unlock(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	n, err := m.client.Eval(ctx, unlockScript, []string{m.key}, m.opts.Value).Int()
	if err != nil {
		return err
	}
	if n == 0 {
		return lock.ErrNotHeld
	}
	return nil
}

func (m *Mutex) Refresh(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	ms := m.opts.TTL.Milliseconds()
	n, err := m.client.Eval(ctx, refreshScript, []string{m.key}, m.opts.Value, ms).Int()
	if err != nil {
		return err
	}
	if n == 0 {
		return lock.ErrNotHeld
	}
	return nil
}

var _ lock.Locker = (*Mutex)(nil)
