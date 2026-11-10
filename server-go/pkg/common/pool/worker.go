// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package pool

import (
	"sync"
	"sync/atomic"
)

// WorkerStats describes a snapshot of a WorkerPool's current state.
type WorkerStats struct {
	Submitted int64
	Completed int64
	Failed    int64
	Pending   int
	Workers   int
}

// WorkerPool is a fixed-size goroutine worker pool. Tasks submitted via
// Submit are dispatched to one of N worker goroutines. The pool supports
// graceful shutdown via Stop, which waits for all in-flight tasks to
// complete, and recovers from task panics so that a panicking task never
// brings down a worker.
type WorkerPool struct {
	workers   int
	queue     chan func()
	wg        sync.WaitGroup
	quit      chan struct{}
	closed    atomic.Bool
	submitted atomic.Int64
	completed atomic.Int64
	failed    atomic.Int64
	stopOnce  sync.Once
}

// NewWorkerPool returns a new WorkerPool with the given worker count and
// queue size. The pool is not started until Start is called.
func NewWorkerPool(workers int, queueSize int) *WorkerPool {
	if workers < 1 {
		workers = 1
	}
	if queueSize < 0 {
		queueSize = 0
	}
	return &WorkerPool{
		workers: workers,
		queue:   make(chan func(), queueSize),
		quit:    make(chan struct{}),
	}
}

// Start launches the worker goroutines. It must be called before Submit.
func (p *WorkerPool) Start() {
	for i := 0; i < p.workers; i++ {
		p.wg.Add(1)
		go p.worker()
	}
}

// Submit enqueues task for execution by a worker. It returns ErrPoolClosed
// if the pool has been stopped. When the queue is full, Submit blocks until
// space is available or the pool is stopped.
func (p *WorkerPool) Submit(task func()) error {
	if p.closed.Load() {
		return ErrPoolClosed
	}
	p.submitted.Add(1)
	select {
	case p.queue <- task:
		return nil
	case <-p.quit:
		p.submitted.Add(-1)
		return ErrPoolClosed
	}
}

// Stop initiates a graceful shutdown: it stops accepting new tasks, lets
// workers finish all queued tasks, and waits for all workers to exit. It is
// safe to call Stop more than once.
func (p *WorkerPool) Stop() {
	p.stopOnce.Do(func() {
		p.closed.Store(true)
		close(p.quit)
	})
	p.wg.Wait()
}

// Stats returns a snapshot of the pool's current metrics.
func (p *WorkerPool) Stats() WorkerStats {
	return WorkerStats{
		Submitted: p.submitted.Load(),
		Completed: p.completed.Load(),
		Failed:    p.failed.Load(),
		Pending:   len(p.queue),
		Workers:   p.workers,
	}
}

func (p *WorkerPool) worker() {
	defer p.wg.Done()
	for {
		select {
		case task, ok := <-p.queue:
			if !ok {
				return
			}
			p.runTask(task)
		case <-p.quit:
			p.drain()
			return
		}
	}
}

func (p *WorkerPool) drain() {
	for {
		select {
		case task, ok := <-p.queue:
			if !ok {
				return
			}
			p.runTask(task)
		default:
			return
		}
	}
}

func (p *WorkerPool) runTask(task func()) {
	defer func() {
		if r := recover(); r != nil {
			p.failed.Add(1)
		}
	}()
	task()
	p.completed.Add(1)
}
