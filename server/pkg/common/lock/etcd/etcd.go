// Package etcd implements an etcd lease-based distributed lock.
package etcd

import (
	"context"
	"errors"
	"time"

	clientv3 "go.etcd.io/etcd/client/v3"

	"github.com/heathcetide/DietDigiDose/pkg/common/lock"
)

// Backend abstracts etcd operations used by the lock.
type Backend interface {
	Grant(ctx context.Context, ttlSeconds int64) (leaseID int64, err error)
	Revoke(ctx context.Context, leaseID int64) error
	KeepAliveOnce(ctx context.Context, leaseID int64) error
	Acquire(ctx context.Context, key, value string, leaseID int64) (bool, error)
	Delete(ctx context.Context, key string) error
}

// etcdLease / etcdKV are the clientv3 surfaces used by clientBackend.
type etcdLease interface {
	Grant(ctx context.Context, ttl int64) (*clientv3.LeaseGrantResponse, error)
	Revoke(ctx context.Context, id clientv3.LeaseID) (*clientv3.LeaseRevokeResponse, error)
	KeepAliveOnce(ctx context.Context, id clientv3.LeaseID) (*clientv3.LeaseKeepAliveResponse, error)
}

type etcdKV interface {
	Txn(ctx context.Context) clientv3.Txn
	Delete(ctx context.Context, key string, opts ...clientv3.OpOption) (*clientv3.DeleteResponse, error)
}

type clientBackend struct {
	lease etcdLease
	kv    etcdKV
}

func (b clientBackend) Grant(ctx context.Context, ttlSeconds int64) (int64, error) {
	resp, err := b.lease.Grant(ctx, ttlSeconds)
	if err != nil {
		return 0, err
	}
	return int64(resp.ID), nil
}

func (b clientBackend) Revoke(ctx context.Context, leaseID int64) error {
	_, err := b.lease.Revoke(ctx, clientv3.LeaseID(leaseID))
	return err
}

func (b clientBackend) KeepAliveOnce(ctx context.Context, leaseID int64) error {
	_, err := b.lease.KeepAliveOnce(ctx, clientv3.LeaseID(leaseID))
	return err
}

func (b clientBackend) Acquire(ctx context.Context, key, value string, leaseID int64) (bool, error) {
	txn := b.kv.Txn(ctx).
		If(clientv3.Compare(clientv3.CreateRevision(key), "=", 0)).
		Then(clientv3.OpPut(key, value, clientv3.WithLease(clientv3.LeaseID(leaseID))))
	resp, err := txn.Commit()
	if err != nil {
		return false, err
	}
	return resp.Succeeded, nil
}

func (b clientBackend) Delete(ctx context.Context, key string) error {
	_, err := b.kv.Delete(ctx, key)
	return err
}

// Mutex is an etcd lock using a lease + compare-and-swap create.
type Mutex struct {
	backend Backend
	key     string
	opts    lock.Options
	leaseID int64
}

// NewMutex creates an etcd lock from a clientv3.Client.
func NewMutex(cli *clientv3.Client, key string, opts ...lock.Option) (*Mutex, error) {
	if cli == nil {
		return nil, errors.New("etcd: client must not be nil")
	}
	return NewMutexWithBackend(clientBackend{lease: cli, kv: cli}, key, opts...)
}

// NewMutexWithBackend creates an etcd lock with an injectable Backend.
func NewMutexWithBackend(backend Backend, key string, opts ...lock.Option) (*Mutex, error) {
	if backend == nil {
		return nil, errors.New("etcd: backend must not be nil")
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
	return &Mutex{backend: backend, key: key, opts: o}, nil
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
	ttlSec := int64(m.opts.TTL / time.Second)
	if ttlSec < 1 {
		ttlSec = 1
	}
	leaseID, err := m.backend.Grant(ctx, ttlSec)
	if err != nil {
		return err
	}
	ok, err := m.backend.Acquire(ctx, m.key, m.opts.Value, leaseID)
	if err != nil {
		_ = m.backend.Revoke(ctx, leaseID)
		return err
	}
	if !ok {
		_ = m.backend.Revoke(ctx, leaseID)
		return lock.ErrNotObtained
	}
	m.leaseID = leaseID
	return nil
}

func (m *Mutex) Unlock(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if m.leaseID == 0 {
		return lock.ErrNotHeld
	}
	if err := m.backend.Delete(ctx, m.key); err != nil {
		return err
	}
	_ = m.backend.Revoke(ctx, m.leaseID)
	m.leaseID = 0
	return nil
}

func (m *Mutex) Refresh(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if m.leaseID == 0 {
		return lock.ErrNotHeld
	}
	return m.backend.KeepAliveOnce(ctx, m.leaseID)
}

var _ lock.Locker = (*Mutex)(nil)
