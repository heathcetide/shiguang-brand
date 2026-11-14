// Package redlock implements the Redis Redlock algorithm across multiple nodes.
package redlock

import (
	"context"
	"errors"
	"sync"
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common/lock"
	lockredis "github.com/heathcetide/DietDigiDose/pkg/common/lock/redis"
)

// Mutex is a Redlock across multiple Redis instances.
type Mutex struct {
	clients []lockredis.Client
	key     string
	opts    lock.Options
	quorum  int
}

// NewMutex creates a Redlock. At least 3 clients are recommended.
func NewMutex(clients []lockredis.Client, key string, opts ...lock.Option) (*Mutex, error) {
	if len(clients) == 0 {
		return nil, errors.New("redlock: at least one client is required")
	}
	for i, c := range clients {
		if c == nil {
			return nil, errors.New("redlock: client must not be nil")
		}
		_ = i
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
	return &Mutex{
		clients: clients,
		key:     key,
		opts:    o,
		quorum:  len(clients)/2 + 1,
	}, nil
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
	start := time.Now()
	var wg sync.WaitGroup
	var mu sync.Mutex
	success := 0

	for _, client := range m.clients {
		wg.Add(1)
		go func(c lockredis.Client) {
			defer wg.Done()
			mx, err := lockredis.NewMutex(c, m.key, lock.WithTTL(m.opts.TTL), lock.WithValue(m.opts.Value))
			if err != nil {
				return
			}
			if err := mx.TryLock(ctx); err == nil {
				mu.Lock()
				success++
				mu.Unlock()
			}
		}(client)
	}
	wg.Wait()

	elapsed := time.Since(start)
	validity := m.opts.TTL - elapsed - m.opts.TTL/10
	if success >= m.quorum && validity > 0 {
		return nil
	}
	_ = m.Unlock(context.Background())
	return lock.ErrNotObtained
}

func (m *Mutex) Unlock(ctx context.Context) error {
	var wg sync.WaitGroup
	for _, client := range m.clients {
		wg.Add(1)
		go func(c lockredis.Client) {
			defer wg.Done()
			mx, err := lockredis.NewMutex(c, m.key, lock.WithTTL(m.opts.TTL), lock.WithValue(m.opts.Value))
			if err != nil {
				return
			}
			_ = mx.Unlock(ctx)
		}(client)
	}
	wg.Wait()
	return nil
}

func (m *Mutex) Refresh(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	var wg sync.WaitGroup
	var mu sync.Mutex
	success := 0
	for _, client := range m.clients {
		wg.Add(1)
		go func(c lockredis.Client) {
			defer wg.Done()
			mx, err := lockredis.NewMutex(c, m.key, lock.WithTTL(m.opts.TTL), lock.WithValue(m.opts.Value))
			if err != nil {
				return
			}
			if err := mx.Refresh(ctx); err == nil {
				mu.Lock()
				success++
				mu.Unlock()
			}
		}(client)
	}
	wg.Wait()
	if success < m.quorum {
		return lock.ErrNotHeld
	}
	return nil
}

var _ lock.Locker = (*Mutex)(nil)
