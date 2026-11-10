// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package pool

import (
	"sync"
	"sync/atomic"
	"time"
)

// ConnConfig configures a ConnPool.
type ConnConfig struct {
	MaxOpen      int
	MaxIdle      int
	MaxIdleTime  time.Duration
	MaxLifetime  time.Duration
	HealthCheck  func(any) error
	HealthPeriod time.Duration
}

// pooledConn wraps a pooled value with bookkeeping timestamps.
type pooledConn[T any] struct {
	value      T
	createdAt  time.Time
	lastUsedAt time.Time
}

// ConnPool is a connection pool that extends the object-pool concept with
// health checks, per-connection max lifetime and background idle eviction.
//
// On Get, idle connections are validated against MaxLifetime and the
// configured HealthCheck function; invalid connections are destroyed and
// another is tried. A background janitor goroutine periodically evicts idle
// connections that have been idle longer than MaxIdleTime and runs health
// checks at HealthPeriod intervals.
type ConnPool[T any] struct {
	factory     Factory[T]
	destroyer   Destroyer[T]
	healthCheck func(any) error
	cfg         ConnConfig

	idle    chan *pooledConn[T]
	maxOpen int

	openCount atomic.Int32
	closed    atomic.Bool

	mu    sync.Mutex
	cond  *sync.Cond
	inUse map[any]*pooledConn[T]

	stopCh chan struct{}
	wg     sync.WaitGroup
}

// NewConnPool returns a new ConnPool with the given factory, destroyer and
// configuration. The pool is ready to use immediately and starts its
// background janitor goroutine when MaxIdleTime or HealthPeriod is positive.
func NewConnPool[T any](factory Factory[T], destroyer Destroyer[T], cfg ConnConfig) *ConnPool[T] {
	maxOpen := cfg.MaxOpen
	if maxOpen < 0 {
		maxOpen = 0
	}
	maxIdle := cfg.MaxIdle
	if maxIdle <= 0 {
		maxIdle = maxOpen
	}
	if maxIdle > maxOpen {
		maxIdle = maxOpen
	}

	p := &ConnPool[T]{
		factory:     factory,
		destroyer:   destroyer,
		healthCheck: cfg.HealthCheck,
		cfg:         cfg,
		idle:        make(chan *pooledConn[T], maxIdle),
		maxOpen:     maxOpen,
		inUse:       make(map[any]*pooledConn[T]),
		stopCh:      make(chan struct{}),
	}
	p.cond = sync.NewCond(&p.mu)

	if p.janitorInterval() > 0 {
		p.wg.Add(1)
		go p.janitor()
	}
	return p
}

// Get returns a healthy connection from the idle queue, or creates a new one
// if the pool is below MaxOpen. It blocks while the pool is at capacity.
// Idle connections are checked against MaxLifetime and HealthCheck; those
// that fail are destroyed and another connection is tried.
func (p *ConnPool[T]) Get() (T, error) {
	var zero T
	if p.closed.Load() {
		return zero, ErrPoolClosed
	}

	for {
		select {
		case c := <-p.idle:
			if p.validateConn(c) {
				p.mu.Lock()
				p.inUse[any(c.value)] = c
				p.mu.Unlock()
				return c.value, nil
			}
			continue
		default:
		}

		p.mu.Lock()
		for {
			if p.closed.Load() {
				p.mu.Unlock()
				return zero, ErrPoolClosed
			}
			select {
			case c := <-p.idle:
				p.mu.Unlock()
				if p.validateConn(c) {
					p.mu.Lock()
					p.inUse[any(c.value)] = c
					p.mu.Unlock()
					return c.value, nil
				}
				p.mu.Lock()
				continue
			default:
			}
			if p.openCount.Load() < int32(p.maxOpen) {
				p.openCount.Add(1)
				p.mu.Unlock()

				v, err := p.factory()
				if err != nil {
					p.mu.Lock()
					p.openCount.Add(-1)
					p.cond.Signal()
					p.mu.Unlock()
					return zero, err
				}
				now := time.Now()
				c := &pooledConn[T]{value: v, createdAt: now, lastUsedAt: now}
				p.mu.Lock()
				p.inUse[any(v)] = c
				p.mu.Unlock()
				return v, nil
			}
			p.cond.Wait()
		}
	}
}

// Put returns x to the idle queue. If the pool is closed or the idle queue is
// full, the destroyer (if any) is invoked on x.
func (p *ConnPool[T]) Put(x T) {
	p.mu.Lock()
	c, ok := p.inUse[any(x)]
	if !ok {
		p.mu.Unlock()
		return
	}
	delete(p.inUse, any(x))

	if p.closed.Load() {
		p.openCount.Add(-1)
		p.cond.Signal()
		p.mu.Unlock()
		p.destroy(x)
		return
	}

	c.lastUsedAt = time.Now()
	var overflow bool
	select {
	case p.idle <- c:
		p.cond.Signal()
	default:
		p.openCount.Add(-1)
		p.cond.Signal()
		overflow = true
	}
	p.mu.Unlock()

	if overflow {
		p.destroy(x)
	}
}

// Close closes the pool. It stops the background janitor, drains the idle
// queue invoking the destroyer on every idle connection, and marks the pool
// as closed. It is safe to call Close more than once.
func (p *ConnPool[T]) Close() {
	p.mu.Lock()
	if p.closed.Swap(true) {
		p.mu.Unlock()
		return
	}
	p.cond.Broadcast()
	close(p.stopCh)
	p.mu.Unlock()

	p.wg.Wait()

	var drained []*pooledConn[T]
	for {
		select {
		case c := <-p.idle:
			drained = append(drained, c)
		default:
			p.mu.Lock()
			if n := len(drained); n > 0 {
				p.openCount.Add(int32(-n))
			}
			p.mu.Unlock()
			for _, c := range drained {
				p.destroy(c.value)
			}
			return
		}
	}
}

// Stats returns a snapshot of the pool's current state.
func (p *ConnPool[T]) Stats() PoolStats {
	p.mu.Lock()
	defer p.mu.Unlock()
	return PoolStats{
		OpenCount: p.openCount.Load(),
		IdleCount: len(p.idle),
		InUse:     int32(len(p.inUse)),
	}
}

func (p *ConnPool[T]) validateConn(c *pooledConn[T]) bool {
	now := time.Now()
	if p.cfg.MaxLifetime > 0 && now.Sub(c.createdAt) > p.cfg.MaxLifetime {
		p.destroyConn(c)
		return false
	}
	if p.healthCheck != nil {
		if err := p.healthCheck(any(c.value)); err != nil {
			p.destroyConn(c)
			return false
		}
	}
	c.lastUsedAt = now
	return true
}

func (p *ConnPool[T]) destroyConn(c *pooledConn[T]) {
	p.mu.Lock()
	p.openCount.Add(-1)
	p.cond.Signal()
	p.mu.Unlock()
	p.destroy(c.value)
}

func (p *ConnPool[T]) janitorInterval() time.Duration {
	var interval time.Duration
	if p.cfg.MaxIdleTime > 0 {
		interval = p.cfg.MaxIdleTime / 2
		if interval <= 0 {
			interval = p.cfg.MaxIdleTime
		}
	}
	if p.cfg.HealthPeriod > 0 {
		if interval == 0 || p.cfg.HealthPeriod < interval {
			interval = p.cfg.HealthPeriod
		}
	}
	return interval
}

func (p *ConnPool[T]) janitor() {
	defer p.wg.Done()
	interval := p.janitorInterval()
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-p.stopCh:
			return
		case <-ticker.C:
			p.evictIdle()
		}
	}
}

func (p *ConnPool[T]) evictIdle() {
	now := time.Now()
	p.mu.Lock()

	var keep, evict []*pooledConn[T]
	for {
		select {
		case c := <-p.idle:
			if p.closed.Load() {
				evict = append(evict, c)
				continue
			}
			if p.cfg.MaxLifetime > 0 && now.Sub(c.createdAt) > p.cfg.MaxLifetime {
				evict = append(evict, c)
				continue
			}
			if p.cfg.MaxIdleTime > 0 && now.Sub(c.lastUsedAt) > p.cfg.MaxIdleTime {
				evict = append(evict, c)
				continue
			}
			if p.healthCheck != nil && p.cfg.HealthPeriod > 0 {
				if err := p.healthCheck(any(c.value)); err != nil {
					evict = append(evict, c)
					continue
				}
			}
			keep = append(keep, c)
		default:
			goto requeue
		}
	}

requeue:
	for _, c := range keep {
		select {
		case p.idle <- c:
		default:
			evict = append(evict, c)
		}
	}
	if n := len(evict); n > 0 {
		p.openCount.Add(int32(-n))
		p.cond.Signal()
	}
	p.mu.Unlock()

	for _, c := range evict {
		p.destroy(c.value)
	}
}

func (p *ConnPool[T]) destroy(x T) {
	if p.destroyer != nil {
		p.destroyer(x)
	}
}
