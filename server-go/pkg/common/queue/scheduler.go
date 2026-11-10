// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package queue

import (
	"context"
	"errors"
	"fmt"
	"runtime"
	"sync"
	"sync/atomic"
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common/pool"
)

// SchedulingMode controls how the scheduler manages worker concurrency.
type SchedulingMode int

const (
	// ModeFixedPool uses a fixed number of workers (default).
	ModeFixedPool SchedulingMode = iota
	// ModeCPUAdaptive scales workers based on CPU usage.
	ModeCPUAdaptive
)

// SchedulerConfig configures the scheduler.
type SchedulerConfig struct {
	// Queue is the backend queue (memory or Redis).
	Queue Queue

	// Handler processes each task.
	Handler Handler

	// WorkerCount is the initial/fixed number of workers.
	// Default: runtime.NumCPU().
	WorkerCount int

	// Mode is the scheduling mode.
	// Default: ModeFixedPool.
	Mode SchedulingMode

	// MinWorkers is the minimum workers in CPUAdaptive mode.
	// Default: 1.
	MinWorkers int

	// MaxWorkers is the maximum workers in CPUAdaptive mode.
	// Default: WorkerCount * 4.
	MaxWorkers int

	// CPUHighThreshold is the CPU usage % above which workers are reduced.
	// Default: 80.
	CPUHighThreshold float64

	// CPULowThreshold is the CPU usage % below which workers are added.
	// Default: 30.
	CPULowThreshold float64

	// CPUCheckInterval is how often CPU usage is evaluated.
	// Default: 5s.
	CPUCheckInterval time.Duration

	// DequeueTimeout is how long Dequeue blocks waiting for tasks.
	// Default: 1s.
	DequeueTimeout time.Duration

	// WorkerPool is an optional external worker pool. If set, the
	// scheduler dispatches tasks to this pool instead of spawning its
	// own worker goroutines.
	WorkerPool *pool.WorkerPool

	// OnTaskStart is called when a task begins executing.
	OnTaskStart func(task *Task)

	// OnTaskComplete is called when a task finishes.
	OnTaskComplete func(task *Task, err error)

	// OnRecover is called after crash recovery with the number of recovered tasks.
	OnRecover func(count int)
}

// Scheduler pulls tasks from a Queue and dispatches them to workers.
type Scheduler struct {
	cfg     SchedulerConfig
	queue   Queue
	handler Handler

	mu      sync.Mutex
	workers atomic.Int32
	running atomic.Int32
	stopped atomic.Bool
	wg      sync.WaitGroup
	quit    chan struct{}

	// CPU adaptive mode.
	cpuUsage  atomic.Int64 // stored as int64 (0-100 * 100 for 2 decimal places)
	adjustMu  sync.Mutex
	workerSem chan struct{} // semaphore for dynamic worker scaling

	metrics SchedulerMetrics
}

// SchedulerMetrics holds atomic counters.
type SchedulerMetrics struct {
	Dequeued  atomic.Int64
	Succeeded atomic.Int64
	Failed    atomic.Int64
	Retried   atomic.Int64
	Recovered atomic.Int64
}

// NewScheduler creates a scheduler with the given config.
func NewScheduler(cfg SchedulerConfig) (*Scheduler, error) {
	if cfg.Queue == nil {
		return nil, errors.New("queue: Queue is required")
	}
	if cfg.Handler == nil {
		return nil, errors.New("queue: Handler is required")
	}
	if cfg.WorkerCount <= 0 {
		cfg.WorkerCount = runtime.NumCPU()
	}
	if cfg.Mode == ModeCPUAdaptive {
		if cfg.MinWorkers <= 0 {
			cfg.MinWorkers = 1
		}
		if cfg.MaxWorkers <= 0 {
			cfg.MaxWorkers = cfg.WorkerCount * 4
		}
		if cfg.CPUHighThreshold <= 0 {
			cfg.CPUHighThreshold = 80
		}
		if cfg.CPULowThreshold <= 0 {
			cfg.CPULowThreshold = 30
		}
		if cfg.CPUCheckInterval <= 0 {
			cfg.CPUCheckInterval = 5 * time.Second
		}
	}
	if cfg.DequeueTimeout <= 0 {
		cfg.DequeueTimeout = 1 * time.Second
	}

	s := &Scheduler{
		cfg:     cfg,
		queue:   cfg.Queue,
		handler: cfg.Handler,
		quit:    make(chan struct{}),
	}
	s.workers.Store(int32(cfg.WorkerCount))
	if cfg.Mode == ModeCPUAdaptive {
		s.workerSem = make(chan struct{}, cfg.MaxWorkers)
	}
	return s, nil
}

// Start launches worker goroutines and begins processing tasks.
// If a persistent backend is used, pending tasks are recovered first.
func (s *Scheduler) Start() error {
	// Recover tasks from persistent backend.
	tasks, err := s.queue.Recover(context.Background())
	if err != nil {
		return fmt.Errorf("queue: recover failed: %w", err)
	}
	if len(tasks) > 0 {
		s.metrics.Recovered.Store(int64(len(tasks)))
		if s.cfg.OnRecover != nil {
			s.cfg.OnRecover(len(tasks))
		}
	}

	if s.cfg.Mode == ModeCPUAdaptive {
		go s.cpuMonitorLoop()
	}

	if s.cfg.WorkerPool != nil {
		// Use external worker pool — run a single dispatcher.
		s.wg.Add(1)
		go s.dispatchLoop()
	} else {
		workerCount := int(s.workers.Load())
		for i := 0; i < workerCount; i++ {
			s.wg.Add(1)
			go s.workerLoop()
		}
	}

	return nil
}

// Stop gracefully shuts down the scheduler, waiting for in-flight tasks.
func (s *Scheduler) Stop() error {
	if !s.stopped.CompareAndSwap(false, true) {
		return nil
	}
	close(s.quit)
	s.wg.Wait()
	return nil
}

// Stats returns current scheduler statistics.
func (s *Scheduler) Stats() SchedulerStats {
	return SchedulerStats{
		Workers:   int(s.workers.Load()),
		Running:   int(s.running.Load()),
		Dequeued:  s.metrics.Dequeued.Load(),
		Succeeded: s.metrics.Succeeded.Load(),
		Failed:    s.metrics.Failed.Load(),
		Retried:   s.metrics.Retried.Load(),
		Recovered: s.metrics.Recovered.Load(),
		CPUUsage:  float64(s.cpuUsage.Load()) / 100.0,
	}
}

// SchedulerStats is a point-in-time snapshot.
type SchedulerStats struct {
	Workers   int     `json:"workers"`
	Running   int     `json:"running"`
	Dequeued  int64   `json:"dequeued"`
	Succeeded int64   `json:"succeeded"`
	Failed    int64   `json:"failed"`
	Retried   int64   `json:"retried"`
	Recovered int64   `json:"recovered"`
	CPUUsage  float64 `json:"cpu_usage"`
}

// ──────────────────────────────────────────────
// Worker loops
// ──────────────────────────────────────────────

func (s *Scheduler) workerLoop() {
	defer s.wg.Done()
	for {
		select {
		case <-s.quit:
			return
		default:
		}
		task, err := s.queue.Dequeue(context.Background(), s.cfg.DequeueTimeout)
		if err != nil {
			if errors.Is(err, ErrQueueEmpty) || errors.Is(err, ErrQueueClosed) {
				continue
			}
			continue
		}
		s.executeTask(task)
	}
}

// dispatchLoop is used when an external WorkerPool is provided.
func (s *Scheduler) dispatchLoop() {
	defer s.wg.Done()
	for {
		select {
		case <-s.quit:
			return
		default:
		}
		task, err := s.queue.Dequeue(context.Background(), s.cfg.DequeueTimeout)
		if err != nil {
			continue
		}
		t := task
		if err := s.cfg.WorkerPool.Submit(func() { s.executeTask(t) }); err != nil {
			// Pool stopped — requeue and exit.
			_ = s.queue.Requeue(context.Background(), t.ID)
			return
		}
	}
}

func (s *Scheduler) executeTask(task *Task) {
	s.running.Add(1)
	defer s.running.Add(-1)
	s.metrics.Dequeued.Add(1)

	if s.cfg.OnTaskStart != nil {
		s.cfg.OnTaskStart(task)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	start := time.Now()
	err := s.handler(ctx, task)
	elapsed := time.Since(start)

	var status TaskStatus
	var errMsg string
	if err == nil {
		status = StatusSuccess
		s.metrics.Succeeded.Add(1)
	} else if errors.Is(err, context.Canceled) {
		status = StatusCanceled
		errMsg = err.Error()
	} else {
		// Retry logic.
		if task.RetryCount < task.MaxRetries {
			s.metrics.Retried.Add(1)
			_ = s.queue.Requeue(context.Background(), task.ID)
			if s.cfg.OnTaskComplete != nil {
				s.cfg.OnTaskComplete(task, err)
			}
			return
		}
		status = StatusFailed
		errMsg = err.Error()
		s.metrics.Failed.Add(1)
	}

	_ = s.queue.Ack(context.Background(), task.ID, status, errMsg)

	if s.cfg.OnTaskComplete != nil {
		s.cfg.OnTaskComplete(task, err)
	}
	_ = elapsed
}

// ──────────────────────────────────────────────
// CPU adaptive mode
// ──────────────────────────────────────────────

func (s *Scheduler) cpuMonitorLoop() {
	ticker := time.NewTicker(s.cfg.CPUCheckInterval)
	defer ticker.Stop()
	for {
		select {
		case <-s.quit:
			return
		case <-ticker.C:
			usage := cpuUsage()
			s.cpuUsage.Store(int64(usage * 100))
			s.adjustWorkers(usage)
		}
	}
}

func (s *Scheduler) adjustWorkers(cpuPct float64) {
	s.adjustMu.Lock()
	defer s.adjustMu.Unlock()

	current := int(s.workers.Load())
	var target int

	if cpuPct >= s.cfg.CPUHighThreshold {
		target = current - 1
		if target < s.cfg.MinWorkers {
			target = s.cfg.MinWorkers
		}
	} else if cpuPct <= s.cfg.CPULowThreshold {
		target = current + 1
		if target > s.cfg.MaxWorkers {
			target = s.cfg.MaxWorkers
		}
	} else {
		return
	}

	if target == current {
		return
	}

	if target > current {
		for i := 0; i < target-current; i++ {
			s.wg.Add(1)
			go s.workerLoop()
		}
	}
	s.workers.Store(int32(target))
}

// cpuUsage returns the current process CPU usage as a percentage (0-100).
// This is a simple heuristic based on goroutine count and GC time.
func cpuUsage() float64 {
	var mem runtime.MemStats
	runtime.ReadMemStats(&mem)
	// Use GC CPU fraction as a proxy.
	gcCPU := float64(mem.GCCPUFraction) * 100
	if gcCPU > 100 {
		gcCPU = 100
	}
	// Blend with goroutine count heuristic.
	goroutines := runtime.NumGoroutine()
	goroutineLoad := float64(goroutines) / float64(runtime.NumCPU()*100)
	if goroutineLoad > 1.0 {
		goroutineLoad = 1.0
	}
	return gcCPU*0.5 + goroutineLoad*50
}
