// Package zookeeper implements a ZooKeeper ephemeral-sequential distributed lock.
package zookeeper

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"

	"github.com/go-zookeeper/zk"

	"github.com/heathcetide/DietDigiDose/pkg/common/lock"
)

// Conn is the ZooKeeper subset required by this lock.
type Conn interface {
	Create(path string, data []byte, flags int32, acl []zk.ACL) (string, error)
	Delete(path string, version int32) error
	Exists(path string) (bool, *zk.Stat, error)
	Children(path string) ([]string, *zk.Stat, error)
	GetW(path string) ([]byte, *zk.Stat, <-chan zk.Event, error)
}

// Mutex is a ZooKeeper lock.
type Mutex struct {
	conn     Conn
	basePath string
	opts     lock.Options
	nodePath string
}

// NewMutex creates a ZooKeeper lock under basePath (e.g. "/locks/orders").
func NewMutex(conn Conn, basePath string, opts ...lock.Option) (*Mutex, error) {
	if conn == nil {
		return nil, errors.New("zookeeper: conn must not be nil")
	}
	if basePath == "" || basePath == "/" {
		return nil, lock.ErrEmptyKey
	}
	o := lock.ApplyOptions(opts...)
	if _, err := lock.ResolveValue(&o); err != nil {
		return nil, err
	}
	return &Mutex{conn: conn, basePath: strings.TrimRight(basePath, "/"), opts: o}, nil
}

func (m *Mutex) Lock(ctx context.Context) error {
	return m.LockWait(ctx)
}

func (m *Mutex) TryLock(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := m.ensurePath(); err != nil {
		return err
	}
	if m.nodePath == "" {
		path, err := m.conn.Create(
			m.basePath+"/lock-",
			[]byte(m.opts.Value),
			zk.FlagEphemeral|zk.FlagSequence,
			zk.WorldACL(zk.PermAll),
		)
		if err != nil {
			return err
		}
		m.nodePath = path
	}

	children, _, err := m.conn.Children(m.basePath)
	if err != nil {
		return err
	}
	seq := filterSeq(children, "lock-")
	if len(seq) == 0 {
		return lock.ErrNotObtained
	}
	sort.Strings(seq)
	mine := m.nodePath[strings.LastIndex(m.nodePath, "/")+1:]
	if seq[0] == mine {
		return nil
	}

	// Not the lowest sequence — not obtained for TryLock.
	return lock.ErrNotObtained
}

// LockWait acquires the lock, waiting on the predecessor node when needed.
func (m *Mutex) LockWait(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := m.ensurePath(); err != nil {
		return err
	}
	if m.nodePath == "" {
		path, err := m.conn.Create(
			m.basePath+"/lock-",
			[]byte(m.opts.Value),
			zk.FlagEphemeral|zk.FlagSequence,
			zk.WorldACL(zk.PermAll),
		)
		if err != nil {
			return err
		}
		m.nodePath = path
	}

	for {
		children, _, err := m.conn.Children(m.basePath)
		if err != nil {
			return err
		}
		seq := filterSeq(children, "lock-")
		sort.Strings(seq)
		mine := m.nodePath[strings.LastIndex(m.nodePath, "/")+1:]
		if len(seq) == 0 || seq[0] == mine {
			return nil
		}
		prev := ""
		for i, n := range seq {
			if n == mine && i > 0 {
				prev = seq[i-1]
				break
			}
		}
		if prev == "" {
			return nil
		}
		_, _, ch, err := m.conn.GetW(m.basePath + "/" + prev)
		if err != nil {
			if errors.Is(err, zk.ErrNoNode) {
				continue
			}
			return err
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ch:
		}
	}
}

func (m *Mutex) Unlock(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if m.nodePath == "" {
		return lock.ErrNotHeld
	}
	err := m.conn.Delete(m.nodePath, -1)
	if err != nil && !errors.Is(err, zk.ErrNoNode) {
		return err
	}
	m.nodePath = ""
	return nil
}

func (m *Mutex) Refresh(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if m.nodePath == "" {
		return lock.ErrNotHeld
	}
	// Ephemeral nodes are kept alive by the ZK session; nothing to refresh.
	return nil
}

func (m *Mutex) ensurePath() error {
	parts := strings.Split(strings.Trim(m.basePath, "/"), "/")
	path := ""
	for _, p := range parts {
		path += "/" + p
		exists, _, err := m.conn.Exists(path)
		if err != nil {
			return err
		}
		if exists {
			continue
		}
		_, err = m.conn.Create(path, []byte{}, 0, zk.WorldACL(zk.PermAll))
		if err != nil && !errors.Is(err, zk.ErrNodeExists) {
			return fmt.Errorf("zookeeper: create %s: %w", path, err)
		}
	}
	return nil
}

func filterSeq(children []string, prefix string) []string {
	out := make([]string, 0, len(children))
	for _, c := range children {
		if strings.HasPrefix(c, prefix) {
			out = append(out, c)
		}
	}
	return out
}

var _ lock.Locker = (*Mutex)(nil)
