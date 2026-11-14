// Package memory provides a process-local lock (useful for tests / single instance).
package memory

import (
	"context"
	"sync"
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common/lock"
)

// Manager creates memory locks keyed by string.
type Manager struct {
	mu    sync.Mutex
	locks map[string]*entry
}

type entry struct {
	mu        sync.Mutex
	holder    string
	expiresAt time.Time
	cond      *sync.Cond
}

// NewManager creates a memory lock manager.
func NewManager() *Manager {
	return &Manager{locks: make(map[string]*entry)}
}

// NewMutex returns a Locker for key.
func (m *Manager) NewMutex(key string, opts ...lock.Option) (lock.Locker, error) {
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
	return &Mutex{manager: m, key: key, opts: o}, nil
}

// Mutex is a process-local lock.
type Mutex struct {
	manager *Manager
	key     string
	opts    lock.Options
	held    bool
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
	e := m.manager.get(m.key)
	e.mu.Lock()
	defer e.mu.Unlock()

	now := time.Now()
	if e.holder != "" && e.expiresAt.After(now) {
		return lock.ErrNotObtained
	}
	e.holder = m.opts.Value
	e.expiresAt = now.Add(m.opts.TTL)
	m.held = true
	return nil
}

func (m *Mutex) Unlock(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	e := m.manager.get(m.key)
	e.mu.Lock()
	defer e.mu.Unlock()
	if !m.held || e.holder != m.opts.Value {
		return lock.ErrNotHeld
	}
	e.holder = ""
	e.expiresAt = time.Time{}
	m.held = false
	return nil
}

func (m *Mutex) Refresh(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	e := m.manager.get(m.key)
	e.mu.Lock()
	defer e.mu.Unlock()
	if !m.held || e.holder != m.opts.Value || !e.expiresAt.After(time.Now()) {
		return lock.ErrNotHeld
	}
	e.expiresAt = time.Now().Add(m.opts.TTL)
	return nil
}

func (m *Manager) get(key string) *entry {
	m.mu.Lock()
	defer m.mu.Unlock()
	e, ok := m.locks[key]
	if !ok {
		e = &entry{}
		e.cond = sync.NewCond(&e.mu)
		m.locks[key] = e
	}
	return e
}

var _ lock.Locker = (*Mutex)(nil)
