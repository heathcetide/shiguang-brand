// Package postgres implements a PostgreSQL advisory lock.
package postgres

import (
	"context"
	"database/sql"
	"errors"
	"hash/fnv"
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common/lock"
)

// Row is satisfied by *sql.Row.
type Row interface {
	Scan(dest ...any) error
}

// DB is the database/sql subset used by this lock.
type DB interface {
	QueryRowContext(ctx context.Context, query string, args ...any) Row
}

// StdDB adapts *sql.DB to DB.
type StdDB struct {
	DB *sql.DB
}

func (s StdDB) QueryRowContext(ctx context.Context, query string, args ...any) Row {
	return s.DB.QueryRowContext(ctx, query, args...)
}

// Mutex is a PostgreSQL session-level advisory lock.
type Mutex struct {
	db   DB
	key  int64
	name string
	opts lock.Options
	held bool
}

// NewMutex creates a Postgres advisory lock from a string key.
func NewMutex(db DB, key string, opts ...lock.Option) (*Mutex, error) {
	if db == nil {
		return nil, errors.New("postgres: db must not be nil")
	}
	if key == "" {
		return nil, lock.ErrEmptyKey
	}
	o := lock.ApplyOptions(opts...)
	return &Mutex{db: db, key: hashKey(key), name: key, opts: o}, nil
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
	var ok bool
	err := m.db.QueryRowContext(ctx, "SELECT pg_try_advisory_lock($1)", m.key).Scan(&ok)
	if err != nil {
		return err
	}
	if !ok {
		return lock.ErrNotObtained
	}
	m.held = true
	return nil
}

func (m *Mutex) Unlock(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if !m.held {
		return lock.ErrNotHeld
	}
	var ok bool
	err := m.db.QueryRowContext(ctx, "SELECT pg_advisory_unlock($1)", m.key).Scan(&ok)
	if err != nil {
		return err
	}
	if !ok {
		return lock.ErrNotHeld
	}
	m.held = false
	return nil
}

func (m *Mutex) Refresh(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if !m.held {
		return lock.ErrNotHeld
	}
	return nil
}

func hashKey(s string) int64 {
	h := fnv.New64a()
	_, _ = h.Write([]byte(s))
	return int64(h.Sum64())
}

var _ lock.Locker = (*Mutex)(nil)
