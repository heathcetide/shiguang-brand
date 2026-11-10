// Package consul implements a Consul session + KV distributed lock.
package consul

import (
	"context"
	"errors"
	"time"

	"github.com/hashicorp/consul/api"

	"github.com/heathcetide/DietDigiDose/pkg/common/lock"
)

// KVAPI is the Consul KV subset used by this lock.
type KVAPI interface {
	Acquire(p *api.KVPair, q *api.WriteOptions) (bool, *api.WriteMeta, error)
	Release(p *api.KVPair, q *api.WriteOptions) (bool, *api.WriteMeta, error)
}

// SessionAPI is the Consul Session subset used by this lock.
type SessionAPI interface {
	Create(se *api.SessionEntry, q *api.WriteOptions) (string, *api.WriteMeta, error)
	Destroy(id string, q *api.WriteOptions) (*api.WriteMeta, error)
	Renew(id string, q *api.WriteOptions) (*api.SessionEntry, *api.WriteMeta, error)
}

// Mutex is a Consul-backed lock.
type Mutex struct {
	kv      KVAPI
	session SessionAPI
	key     string
	opts    lock.Options
	sid     string
}

// NewMutex creates a Consul lock using a Consul API client.
func NewMutex(cli *api.Client, key string, opts ...lock.Option) (*Mutex, error) {
	if cli == nil {
		return nil, errors.New("consul: client must not be nil")
	}
	return NewMutexWithAPI(cli.KV(), cli.Session(), key, opts...)
}

// NewMutexWithAPI creates a Consul lock with injectable APIs.
func NewMutexWithAPI(kv KVAPI, session SessionAPI, key string, opts ...lock.Option) (*Mutex, error) {
	if kv == nil || session == nil {
		return nil, errors.New("consul: kv and session are required")
	}
	if key == "" {
		return nil, lock.ErrEmptyKey
	}
	o := lock.ApplyOptions(opts...)
	if o.TTL < time.Second {
		return nil, lock.ErrInvalidTTL
	}
	if _, err := lock.ResolveValue(&o); err != nil {
		return nil, err
	}
	return &Mutex{kv: kv, session: session, key: key, opts: o}, nil
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
	sid, _, err := m.session.Create(&api.SessionEntry{
		Name:     m.key,
		TTL:      m.opts.TTL.String(),
		Behavior: api.SessionBehaviorDelete,
	}, nil)
	if err != nil {
		return err
	}
	ok, _, err := m.kv.Acquire(&api.KVPair{
		Key:     m.key,
		Value:   []byte(m.opts.Value),
		Session: sid,
	}, nil)
	if err != nil {
		_, _ = m.session.Destroy(sid, nil)
		return err
	}
	if !ok {
		_, _ = m.session.Destroy(sid, nil)
		return lock.ErrNotObtained
	}
	m.sid = sid
	return nil
}

func (m *Mutex) Unlock(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if m.sid == "" {
		return lock.ErrNotHeld
	}
	_, _, err := m.kv.Release(&api.KVPair{Key: m.key, Session: m.sid}, nil)
	if err != nil {
		return err
	}
	_, _ = m.session.Destroy(m.sid, nil)
	m.sid = ""
	return nil
}

func (m *Mutex) Refresh(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if m.sid == "" {
		return lock.ErrNotHeld
	}
	_, _, err := m.session.Renew(m.sid, nil)
	return err
}

var _ lock.Locker = (*Mutex)(nil)
