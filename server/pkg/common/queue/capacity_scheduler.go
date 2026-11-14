// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package queue

import (
	"context"
	"errors"
	"runtime"
	"sync"
	"sync/atomic"
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common/pool"
)

// CapacitySchedulerConfig configures the capacity-aware scheduler.
type CapacitySchedulerConfig struct {
	// Queue is the backend queue (memory or Redis).
	Queue Queue

	// Handler processes each task. If RichHandler is also set, RichHandler
	// takes precedence (it receives a TaskContext for progress + logging).
	Handler Handler

	// RichHandler is an optional handler that receives a TaskContext for
	// progress reporting and execution logging. If set, it takes precedence
	// over Handler.
	RichHandler RichHandler

	// Capacity is the maximum total weight of concurrently running tasks.
	// A task's Weight represents its resource cost. If Weight is 0, it
	// counts as 1. The scheduler will not dispatch a task if doing so
	// would exceed Capacity. Default: 0 (unlimited).
	Capacity int

	// WorkerCount is the maximum number of concurrent worker goroutines.
	// Default: runtime.NumCPU().
	WorkerCount int

	// Strategy is the scheduling strategy.
	// Default: StrategyPriority.
	Strategy SchedulingStrategy

	// AgingThreshold is the wait duration after which a task's priority
	// is boosted to prevent starvation. Default: 30s.
	// Set to 0 to disable aging.
	AgingThreshold time.Duration

	// DequeueTimeout is how long Dequeue blocks waiting for tasks.
	// Default: 500ms.
	DequeueTimeout time.Duration

	// EnablePreemption allows high-priority tasks to preempt
	// lower-priority running tasks when capacity is full.
	// Only effective with StrategyPreemptive. Default: false.
	EnablePreemption bool

	// PreemptionContext is passed to preempted tasks' context cancel
	// functions. The task handler should check ctx.Err() periodically.
	// If the handler doesn't respond to cancellation, preemption is
	// effectively cooperative-only.

	// WorkerPool is an optional external worker pool.
	WorkerPool *pool.WorkerPool

	// OnTaskStart is called when a task begins executing.
	OnTaskStart func(task *Task)

	// OnTaskComplete is called when a task finishes.
	OnTaskComplete func(task *Task, err error)

	// OnPreempt is called when a task is preempted.
	OnPreempt func(task *Task)

	// OnRecover is called after crash recovery.
	OnRecover func(count int)
}

// CapacityScheduler is a scheduler that enforces a total capacity limit
// on concurrently running tasks, supports job grouping (same JobID runs
// sequentially), priority-based scheduling, aging, and optional preemption.
//
// It is designed for the scenario: "limited computing power, large number
// of async jobs — how to queue, preempt resources, and schedule by priority."
type CapacityScheduler struct {
	cfg     CapacitySchedulerConfig
	queue   Queue
	handler Handler

	mu      sync.Mutex
	cond    *sync.Cond
	stopCh  chan struct{}
	stopped atomic.Bool
	wg      sync.WaitGroup

	// Pending tasks (sorted by strategy).
	pending []*Task

	// Running tasks keyed by task ID.
	running    map[string]*runningTask
	usedWeight atomic.Int64

	// Active job IDs — only one task per JobID can be running.
	activeJobs map[string]bool

	// Metrics.
	metrics CapacitySchedulerMetrics
}

type runningTask struct {
	task   *Task
	cancel context.CancelFunc
}

// CapacitySchedulerMetrics holds atomic counters.
type CapacitySchedulerMetrics struct {
	Dispatched   atomic.Int64
	Succeeded    atomic.Int64
	Failed       atomic.Int64
	Retried      atomic.Int64
	Preempted    atomic.Int64
	Recovered    atomic.Int64
	CapacityFull atomic.Int64
}

// NewCapacityScheduler creates a capacity-aware scheduler.
func NewCapacityScheduler(cfg CapacitySchedulerConfig) (*CapacityScheduler, error) {
	if cfg.Queue == nil {
		return nil, errors.New("queue: Queue is required")
	}
	if cfg.Handler == nil && cfg.RichHandler == nil {
		return nil, errors.New("queue: Handler or RichHandler is required")
	}
	if cfg.WorkerCount <= 0 {
		cfg.WorkerCount = runtime.NumCPU()
	}
	if cfg.AgingThreshold == 0 {
		cfg.AgingThreshold = 30 * time.Second
	}
	if cfg.DequeueTimeout <= 0 {
		cfg.DequeueTimeout = 500 * time.Millisecond
	}

	s := &CapacityScheduler{
		cfg:        cfg,
		queue:      cfg.Queue,
		handler:    cfg.Handler,
		stopCh:     make(chan struct{}),
		running:    make(map[string]*runningTask),
		activeJobs: make(map[string]bool),
	}
	s.cond = sync.NewCond(&s.mu)
	return s, nil
}

// Start launches the scheduler. Recovers pending tasks from the backend,
// then starts worker goroutines and the dispatch loop.
func (s *CapacityScheduler) Start() error {
	// Recover tasks from persistent backend.
	tasks, err := s.queue.Recover(context.Background())
	if err != nil {
		return err
	}
	if len(tasks) > 0 {
		s.metrics.Recovered.Store(int64(len(tasks)))
		if s.cfg.OnRecover != nil {
			s.cfg.OnRecover(len(tasks))
		}
		s.mu.Lock()
		s.pending = append(s.pending, tasks...)
		s.sortPendingLocked()
		s.mu.Unlock()
	}

	// Start a background goroutine to pull new tasks from the queue.
	s.wg.Add(1)
	go s.ingestLoop()

	// Start worker goroutines.
	for i := 0; i < s.cfg.WorkerCount; i++ {
		s.wg.Add(1)
		go s.workerLoop()
	}

	return nil
}

// Stop gracefully shuts down the scheduler.
func (s *CapacityScheduler) Stop() error {
	if !s.stopped.CompareAndSwap(false, true) {
		return nil
	}
	close(s.stopCh)
	s.mu.Lock()
	s.cond.Broadcast()
	s.mu.Unlock()
	s.wg.Wait()
	return nil
}

// Stats returns a snapshot of scheduler statistics.
func (s *CapacityScheduler) Stats() CapacitySchedulerStats {
	s.mu.Lock()
	pending := len(s.pending)
	running := len(s.running)
	activeJobs := len(s.activeJobs)
	s.mu.Unlock()

	return CapacitySchedulerStats{
		Pending:      pending,
		Running:      running,
		ActiveJobs:   activeJobs,
		UsedWeight:   int(s.usedWeight.Load()),
		Capacity:     s.cfg.Capacity,
		Workers:      s.cfg.WorkerCount,
		Strategy:     s.cfg.Strategy.String(),
		Dispatched:   s.metrics.Dispatched.Load(),
		Succeeded:    s.metrics.Succeeded.Load(),
		Failed:       s.metrics.Failed.Load(),
		Retried:      s.metrics.Retried.Load(),
		Preempted:    s.metrics.Preempted.Load(),
		Recovered:    s.metrics.Recovered.Load(),
		CapacityFull: s.metrics.CapacityFull.Load(),
	}
}

// CapacitySchedulerStats is a point-in-time snapshot.
type CapacitySchedulerStats struct {
	Pending      int    `json:"pending"`
	Running      int    `json:"running"`
	ActiveJobs   int    `json:"active_jobs"`
	UsedWeight   int    `json:"used_weight"`
	Capacity     int    `json:"capacity"`
	Workers      int    `json:"workers"`
	Strategy     string `json:"strategy"`
	Dispatched   int64  `json:"dispatched"`
	Succeeded    int64  `json:"succeeded"`
	Failed       int64  `json:"failed"`
	Retried      int64  `json:"retried"`
	Preempted    int64  `json:"preempted"`
	Recovered    int64  `json:"recovered"`
	CapacityFull int64  `json:"capacity_full"`
}

// Position returns the queue position of a pending task (0 = next to
// dispatch). Returns -1 if the task is not pending. This checks the
// scheduler's internal pending list first, then falls back to the backend.
func (s *CapacityScheduler) Position(ctx context.Context, taskID string) (int, error) {
	s.mu.Lock()
	for i, t := range s.pending {
		if t.ID == taskID {
			s.mu.Unlock()
			return i, nil
		}
	}
	s.mu.Unlock()
	return s.queue.Position(ctx, taskID)
}

// UpdateProgress updates the execution progress of a running task (0-100).
// This is typically called from inside a RichHandler via TaskContext, but
// can also be called externally.
func (s *CapacityScheduler) UpdateProgress(ctx context.Context, taskID string, progress int) error {
	return s.queue.UpdateProgress(ctx, taskID, progress)
}

// AppendLog appends an execution log entry for a task.
func (s *CapacityScheduler) AppendLog(ctx context.Context, entry *TaskLogEntry) error {
	return s.queue.AppendLog(ctx, entry)
}

// ListLogs returns execution log entries for a task, newest first.
// limit of 0 means no limit (backend may apply its own cap).
func (s *CapacityScheduler) ListLogs(ctx context.Context, taskID string, limit int) ([]*TaskLogEntry, error) {
	return s.queue.ListLogs(ctx, taskID, limit)
}

// ──────────────────────────────────────────────
// Ingest loop — pulls new tasks from the backend queue
// ──────────────────────────────────────────────

func (s *CapacityScheduler) ingestLoop() {
	defer s.wg.Done()
	for {
		select {
		case <-s.stopCh:
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
		s.mu.Lock()
		s.pending = append(s.pending, task)
		s.sortPendingLocked()
		s.cond.Broadcast()
		s.mu.Unlock()
	}
}

// ──────────────────────────────────────────────
// Worker loop — waits for dispatchable tasks
// ──────────────────────────────────────────────

func (s *CapacityScheduler) workerLoop() {
	defer s.wg.Done()
	for {
		s.mu.Lock()
		// Wait until there's a dispatchable task, a preemption
		// opportunity, or we're stopping.
		for !s.stopped.Load() && !s.hasDispatchableLocked() && !s.hasPreemptionOpportunityLocked() {
			s.cond.Wait()
		}
		if s.stopped.Load() {
			s.mu.Unlock()
			return
		}

		task := s.pickDispatchableLocked()
		if task == nil {
			s.mu.Unlock()
			continue
		}

		// Mark as running.
		weight := taskWeight(task)
		s.usedWeight.Add(int64(weight))
		if task.JobID != "" {
			s.activeJobs[task.JobID] = true
		}
		now := time.Now()
		task.Status = StatusRunning
		task.StartedAt = &now
		s.running[task.ID] = &runningTask{task: task}
		s.metrics.Dispatched.Add(1)
		s.mu.Unlock()

		s.executeTask(task)
	}
}

// hasDispatchableLocked checks if any pending task can be dispatched
// given capacity and job-grouping constraints. Must hold mu.
func (s *CapacityScheduler) hasDispatchableLocked() bool {
	for _, t := range s.pending {
		if s.canDispatchLocked(t) {
			return true
		}
	}
	return false
}

// hasPreemptionOpportunityLocked checks if there's a pending task that
// could be dispatched by preempting running tasks. Must hold mu.
func (s *CapacityScheduler) hasPreemptionOpportunityLocked() bool {
	if !s.cfg.EnablePreemption || s.cfg.Strategy != StrategyPreemptive {
		return false
	}
	if len(s.pending) == 0 || len(s.running) == 0 {
		return false
	}
	// Check if the highest-priority pending task is higher than any
	// running preemptible task.
	for _, t := range s.pending {
		for _, rt := range s.running {
			if canPreempt(t, rt.task) {
				return true
			}
		}
	}
	return false
}

// canDispatchLocked checks if a specific task can be dispatched.
// Must hold mu.
func (s *CapacityScheduler) canDispatchLocked(t *Task) bool {
	// Job grouping: only one task per JobID can be running.
	if t.JobID != "" && s.activeJobs[t.JobID] {
		return false
	}
	// Capacity check.
	if s.cfg.Capacity > 0 {
		weight := taskWeight(t)
		if int(s.usedWeight.Load())+weight > s.cfg.Capacity {
			return false
		}
	}
	return true
}

// pickDispatchableLocked selects the highest-priority dispatchable task
// and removes it from the pending list. Must hold mu.
func (s *CapacityScheduler) pickDispatchableLocked() *Task {
	for i, t := range s.pending {
		if s.canDispatchLocked(t) {
			s.pending = append(s.pending[:i], s.pending[i+1:]...)
			return t
		}
	}
	// No dispatchable task — try preemption if enabled.
	if s.cfg.EnablePreemption && s.cfg.Strategy == StrategyPreemptive {
		return s.tryPreemptLocked()
	}
	s.metrics.CapacityFull.Add(1)
	return nil
}

// tryPreemptLocked attempts to preempt lower-priority running tasks
// to make room for the highest-priority pending task. Must hold mu.
func (s *CapacityScheduler) tryPreemptLocked() *Task {
	if len(s.pending) == 0 || len(s.running) == 0 {
		return nil
	}

	// Find the highest-priority pending task.
	sortTasks(s.pending, s.cfg.Strategy, time.Now(), s.cfg.AgingThreshold)
	pending := s.pending[0]
	if !s.canDispatchLocked(pending) {
		// Need to free capacity. Collect running tasks.
		runningList := make([]*Task, 0, len(s.running))
		for _, rt := range s.running {
			runningList = append(runningList, rt.task)
		}

		weight := taskWeight(pending)
		available := s.cfg.Capacity - int(s.usedWeight.Load())
		needed := weight - available
		if needed <= 0 {
			// Job grouping constraint — can't preempt for this.
			return nil
		}

		victims, _ := selectPreemptionVictims(pending, runningList, needed)
		if len(victims) == 0 {
			return nil
		}

		// Preempt victims.
		for _, v := range victims {
			if rt, ok := s.running[v.ID]; ok {
				rt.cancel() // cooperative cancellation
				delete(s.running, v.ID)
				if v.JobID != "" {
					delete(s.activeJobs, v.JobID)
				}
				vw := taskWeight(v)
				s.usedWeight.Add(-int64(vw))
				s.metrics.Preempted.Add(1)
				if s.cfg.OnPreempt != nil {
					s.cfg.OnPreempt(v)
				}
				// Add the preempted task back to local pending for
				// re-dispatch. We don't call Requeue on the backend
				// because the task is already tracked there (in running
				// state) and will be acked when it eventually completes.
				v.Status = StatusPending
				v.StartedAt = nil
				s.pending = append(s.pending, v)
			}
		}
		s.sortPendingLocked()

		// Now try to dispatch the pending task again.
		if s.canDispatchLocked(pending) {
			// Remove from pending.
			for i, t := range s.pending {
				if t.ID == pending.ID {
					s.pending = append(s.pending[:i], s.pending[i+1:]...)
					break
				}
			}
			return pending
		}
	}
	return nil
}

// sortPendingLocked re-sorts the pending list. Must hold mu.
func (s *CapacityScheduler) sortPendingLocked() {
	sortTasks(s.pending, s.cfg.Strategy, time.Now(), s.cfg.AgingThreshold)
}

// executeTask runs a task and handles completion.
func (s *CapacityScheduler) executeTask(task *Task) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Register the cancel function for preemption.
	s.mu.Lock()
	if rt, ok := s.running[task.ID]; ok {
		rt.cancel = cancel
	}
	s.mu.Unlock()

	if s.cfg.OnTaskStart != nil {
		s.cfg.OnTaskStart(task)
	}

	var err error
	if s.cfg.RichHandler != nil {
		tctx := &taskContextImpl{
			ctx:   ctx,
			task:  task,
			queue: s.queue,
		}
		err = s.cfg.RichHandler(tctx, task)
	} else {
		err = s.handler(ctx, task)
	}

	// Clean up running state.
	weight := taskWeight(task)
	s.usedWeight.Add(-int64(weight))

	s.mu.Lock()
	delete(s.running, task.ID)
	if task.JobID != "" {
		delete(s.activeJobs, task.JobID)
	}
	s.cond.Broadcast()
	s.mu.Unlock()

	// Handle result.
	if err == nil {
		s.metrics.Succeeded.Add(1)
		_ = s.queue.Ack(context.Background(), task.ID, StatusSuccess, "")
	} else if errors.Is(err, context.Canceled) {
		// Task was preempted — already handled in tryPreemptLocked.
		// The task has been re-queued; don't ack or retry here.
	} else {
		if task.RetryCount < task.MaxRetries {
			s.metrics.Retried.Add(1)
			_ = s.queue.Requeue(context.Background(), task.ID)
		} else {
			s.metrics.Failed.Add(1)
			_ = s.queue.Ack(context.Background(), task.ID, StatusFailed, err.Error())
		}
	}

	if s.cfg.OnTaskComplete != nil {
		s.cfg.OnTaskComplete(task, err)
	}
}

// taskContextImpl implements TaskContext for RichHandler execution.
type taskContextImpl struct {
	ctx   context.Context
	task  *Task
	queue Queue
}

func (t *taskContextImpl) Deadline() (time.Time, bool) { return t.ctx.Deadline() }
func (t *taskContextImpl) Done() <-chan struct{}       { return t.ctx.Done() }
func (t *taskContextImpl) Err() error                  { return t.ctx.Err() }
func (t *taskContextImpl) Value(key any) any           { return t.ctx.Value(key) }

func (t *taskContextImpl) Task() *Task { return t.task }

func (t *taskContextImpl) SetProgress(progress int) error {
	return t.queue.UpdateProgress(context.Background(), t.task.ID, progress)
}

func (t *taskContextImpl) Log(level string, message string) error {
	return t.queue.AppendLog(context.Background(), &TaskLogEntry{
		TaskID:    t.task.ID,
		Level:     level,
		Message:   message,
		Timestamp: time.Now(),
	})
}

// taskWeight returns the weight of a task (minimum 1).
func taskWeight(t *Task) int {
	if t.Weight <= 0 {
		return 1
	}
	return t.Weight
}
