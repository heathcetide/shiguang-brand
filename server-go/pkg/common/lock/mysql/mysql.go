// Package mysql implements a MySQL GET_LOCK based distributed lock.
package mysql

import (
	"context"
	"database/sql"
	"errors"
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

// Mutex is a MySQL named lock.
type Mutex struct {
	db   DB
	key  string
	opts lock.Options
	held bool
}

// NewMutex creates a MySQL GET_LOCK mutex.
func NewMutex(db DB, key string, opts ...lock.Option) (*Mutex, error) {
	if db == nil {
		return nil, errors.New("mysql: db must not be nil")
	}
	if key == "" {
		return nil, lock.ErrEmptyKey
	}
	o := lock.ApplyOptions(opts...)
	return &Mutex{db: db, key: key, opts: o}, nil
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
	var result sql.NullInt64
	err := m.db.QueryRowContext(ctx, "SELECT GET_LOCK(?, 0)", m.key).Scan(&result)
	if err != nil {
		return err
	}
	if !result.Valid || result.Int64 != 1 {
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
	var result sql.NullInt64
	err := m.db.QueryRowContext(ctx, "SELECT RELEASE_LOCK(?)", m.key).Scan(&result)
	if err != nil {
		return err
	}
	if !result.Valid || result.Int64 != 1 {
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

var _ lock.Locker = (*Mutex)(nil)
