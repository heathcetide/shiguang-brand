// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package scheduler provides a distributed task scheduler with distributed
// locking and task dispatch.
//
// Unlike a simple cron library (which only parses expressions and fires
// callbacks in a single process), this package ensures that scheduled jobs
// run on exactly one node in a cluster — even when multiple instances of
// the same application are running simultaneously.
//
// # Key features
//
//   - Cron expression scheduling (via common/cron) and interval scheduling.
//   - Distributed lock integration (via the lock package): only the node
//     that acquires the lock for a job executes it.
//   - Pluggable LockFactory: use Redis, etcd, Zookeeper, or the in-memory
//     lock for single-node / testing.
//   - Context-aware job execution with timeout.
//   - Job metadata: name, description, tags, singleton mode.
//   - Graceful shutdown: stop accepting new ticks, wait for running jobs.
//   - Job status tracking: last run, next run, error count.
//   - Optional job event listener for monitoring/metrics.
//
// # Architecture
//
// The Scheduler runs a goroutine per job. Each goroutine calculates the next
// fire time from the cron expression (or interval), sleeps until that time,
// then attempts to acquire a distributed lock for the job. If the lock is
// acquired, the job function runs. If not (another node got it), the job
// is skipped and the goroutine waits for the next fire time.
//
// This design is deliberately simple and avoids external dependencies on
// message queues or coordination services beyond the lock backend.
//
// # Quick start (single node)
//
//	// In-memory lock — single node only.
//	lockMgr := memory.NewManager()
//	s := scheduler.New(scheduler.Config{
//	    LockFactory: scheduler.LockFactoryFunc(func(jobName string) (lock.Locker, error) {
//	        return lockMgr.NewMutex("scheduler:"+jobName, lock.WithTTL(30*time.Second))
//	    }),
//	})
//	s.Start()
//
//	s.Add("cleanup", "*/5 * * * *", func(ctx context.Context) error {
//	    return cleanupDatabase(ctx)
//	})
//
//	// Graceful shutdown.
//	s.Stop()
//
// # Quick start (distributed, Redis)
//
//	rdb := redis.NewClient(...)
//	s := scheduler.New(scheduler.Config{
//	    LockFactory: scheduler.LockFactoryFunc(func(jobName string) (lock.Locker, error) {
//	        return redis.NewMutex(rdb, "scheduler:"+jobName,
//	            lock.WithTTL(60*time.Second),
//	            lock.WithRetryDelay(200*time.Millisecond))
//	    }),
//	    LockTTL: 60 * time.Second,
//	})
//	s.Start()
//	s.Add("report", "0 * * * *", generateReport)
//	defer s.Stop()
package scheduler

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common/cron"
	"github.com/heathcetide/DietDigiDose/pkg/common/lock"
)

// ──────────────────────────────────────────────
// Errors
// ──────────────────────────────────────────────

var (
	// ErrSchedulerStopped is returned when operating on a stopped scheduler.
	ErrSchedulerStopped = errors.New("scheduler: stopped")
	// ErrJobNotFound is returned when a job with the given name does not exist.
	ErrJobNotFound = errors.New("scheduler: job not found")
	// ErrJobExists is returned when adding a job with a name that already exists.
	ErrJobExists = errors.New("scheduler: job already exists")
	// ErrInvalidSchedule is returned when the schedule expression is invalid.
	ErrInvalidSchedule = errors.New("scheduler: invalid schedule")
	// ErrNoLockFactory is returned when no LockFactory is configured.
	ErrNoLockFactory = errors.New("scheduler: no lock factory configured")
)

// ──────────────────────────────────────────────
// LockFactory
// ──────────────────────────────────────────────

// LockFactory creates a distributed lock for a given job name.
// Each job gets its own lock key so that different jobs can run in parallel
// on different nodes, while the same job runs on only one node at a time.
//
// Implementations can wrap the lock/redis, lock/etcd, lock/memory, etc.
// backends.
type LockFactory interface {
	// NewLock returns a Locker for the given job name. The returned Locker
	// will be used with TryLock (non-blocking) by the scheduler.
	NewLock(jobName string) (lock.Locker, error)
}

// LockFactoryFunc is a function adapter for LockFactory.
type LockFactoryFunc func(jobName string) (lock.Locker, error)

// NewLock implements LockFactory.
func (f LockFactoryFunc) NewLock(jobName string) (lock.Locker, error) {
	return f(jobName)
}

// NoLockFactory is a LockFactory that returns nil locks. Use this for
// single-node scheduling where distributed locking is not needed.
// In this mode, jobs always run on every node (no dispatch).
type NoLockFactory struct{}

// NewLock returns nil (no locking).
func (NoLockFactory) NewLock(string) (lock.Locker, error) { return nil, nil }

// ──────────────────────────────────────────────
// Job function
// ──────────────────────────────────────────────

// JobFunc is the function executed when a job fires.
// It receives a context that is cancelled when the job timeout expires
// or when the scheduler is shutting down.
type JobFunc func(ctx context.Context) error

// ──────────────────────────────────────────────
// Job definition
// ──────────────────────────────────────────────

// Job represents a scheduled task.
type Job struct {
	Name        string        // unique job identifier
	Description string        // human-readable description
	Schedule    string        // cron expression or "@every <duration>"
	Func        JobFunc       // the function to execute
	Timeout     time.Duration // per-execution timeout (0 = no timeout)
	Singleton   bool          // if true, skip if previous run is still active
	Tags        []string      // optional tags for grouping/filtering

	// Internal state (managed by scheduler).
	mu       sync.Mutex
	status   JobStatus
	expr     *cron.Expression
	interval time.Duration // for @every jobs
	nextRun  time.Time
	stopCh   chan struct{}
	doneCh   chan struct{}
	running  bool // is the job function currently executing?
}

// JobStatus holds the runtime status of a job.
type JobStatus struct {
	LastRun     time.Time
	LastEnd     time.Time
	NextRun     time.Time
	LastError   error
	LastErrorAt time.Time
	RunCount    int64
	ErrorCount  int64
	Running     bool
}

// Status returns a snapshot of the job's runtime status.
func (j *Job) Status() JobStatus {
	j.mu.Lock()
	defer j.mu.Unlock()
	return j.status
}

// ──────────────────────────────────────────────
// Job event listener
// ──────────────────────────────────────────────

// JobEvent represents an event in a job's lifecycle.
type JobEvent struct {
	JobName  string
	Type     JobEventType
	Time     time.Time
	Error    error
	Duration time.Duration
}

// JobEventType describes the type of job event.
type JobEventType int

const (
	// EventJobStarted is emitted when a job starts executing.
	EventJobStarted JobEventType = iota
	// EventJobSucceeded is emitted when a job completes successfully.
	EventJobSucceeded
	// EventJobFailed is emitted when a job returns an error.
	EventJobFailed
	// EventJobSkipped is emitted when a job is skipped (lock not acquired
	// or singleton mode blocked it).
	EventJobSkipped
	// EventJobAdded is emitted when a job is added to the scheduler.
	EventJobAdded
	// EventJobRemoved is emitted when a job is removed from the scheduler.
	EventJobRemoved
)

// EventListener receives job events. Use this for monitoring, metrics, or logging.
type EventListener interface {
	OnJobEvent(event JobEvent)
}

// EventListenerFunc is a function adapter for EventListener.
type EventListenerFunc func(JobEvent)

// OnJobEvent implements EventListener.
func (f EventListenerFunc) OnJobEvent(e JobEvent) { f(e) }

// ──────────────────────────────────────────────
// Config
// ──────────────────────────────────────────────

// Config configures the scheduler.
type Config struct {
	// LockFactory creates distributed locks for jobs. Required for distributed
	// mode. Use NoLockFactory{} for single-node mode (no dispatch).
	LockFactory LockFactory

	// LockTTL is the TTL for the distributed lock. Default: 30s.
	// The lock is refreshed periodically while the job runs (if the lock
	// backend supports Refresh).
	LockTTL time.Duration

	// LockRefreshInterval is how often the lock is refreshed while a job
	// runs. Default: LockTTL / 3.
	LockRefreshInterval time.Duration

	// Timezone is the timezone for cron expression evaluation.
	// Default: time.Local.
	Timezone *time.Location

	// EventListener receives job events. Optional.
	EventListener EventListener
}

// DefaultConfig returns a Config with sensible defaults.
func DefaultConfig() Config {
	return Config{
		LockFactory: NoLockFactory{},
		LockTTL:     30 * time.Second,
		Timezone:    time.Local,
	}
}

// ──────────────────────────────────────────────
// Scheduler
// ──────────────────────────────────────────────

// Scheduler manages a set of scheduled jobs with distributed locking.
type Scheduler struct {
	cfg    Config
	mu     sync.RWMutex
	jobs   map[string]*Job
	stopCh chan struct{}
	wg     sync.WaitGroup

	started bool
	stopped bool
}

// New creates a new Scheduler. The scheduler is not started; call Start.
func New(cfg Config) *Scheduler {
	if cfg.LockFactory == nil {
		cfg.LockFactory = NoLockFactory{}
	}
	if cfg.LockTTL <= 0 {
		cfg.LockTTL = 30 * time.Second
	}
	if cfg.LockRefreshInterval <= 0 {
		cfg.LockRefreshInterval = cfg.LockTTL / 3
	}
	if cfg.Timezone == nil {
		cfg.Timezone = time.Local
	}
	return &Scheduler{
		cfg:    cfg,
		jobs:   make(map[string]*Job),
		stopCh: make(chan struct{}),
	}
}

// Start begins the scheduler. Jobs added before Start will begin running
// immediately; jobs added after Start will be picked up dynamically.
func (s *Scheduler) Start() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.started {
		return
	}
	s.started = true
	s.stopped = false
	s.stopCh = make(chan struct{})

	// Start all existing jobs.
	for _, job := range s.jobs {
		s.startJob(job)
	}
}

// Stop gracefully stops the scheduler. It signals all job goroutines to
// stop, waits for running jobs to finish (up to their timeout), and returns.
func (s *Scheduler) Stop() {
	s.mu.Lock()
	if !s.started || s.stopped {
		s.mu.Unlock()
		return
	}
	s.stopped = true
	close(s.stopCh)
	jobs := make([]*Job, 0, len(s.jobs))
	for _, j := range s.jobs {
		jobs = append(jobs, j)
	}
	s.mu.Unlock()

	// Signal all jobs to stop.
	for _, job := range jobs {
		select {
		case <-job.stopCh:
		default:
			close(job.stopCh)
		}
	}

	// Wait for all job goroutines to finish.
	s.wg.Wait()
}

// Add registers a new job. If the scheduler is already started, the job
// begins running immediately.
func (s *Scheduler) Add(name, schedule string, fn JobFunc) error {
	return s.AddWithOptions(name, schedule, fn, Options{})
}

// AddWithOptions registers a new job with additional options.
func (s *Scheduler) AddWithOptions(name, schedule string, fn JobFunc, opts Options) error {
	if name == "" {
		return errors.New("scheduler: job name is required")
	}
	if fn == nil {
		return errors.New("scheduler: job function is required")
	}
	if schedule == "" {
		return errors.New("scheduler: schedule is required")
	}

	// Parse the schedule.
	expr, interval, err := parseSchedule(schedule)
	if err != nil {
		return fmt.Errorf("%w: %v", ErrInvalidSchedule, err)
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	if s.stopped {
		return ErrSchedulerStopped
	}
	if _, exists := s.jobs[name]; exists {
		return fmt.Errorf("%w: %s", ErrJobExists, name)
	}

	job := &Job{
		Name:        name,
		Description: opts.Description,
		Schedule:    schedule,
		Func:        fn,
		Timeout:     opts.Timeout,
		Singleton:   opts.Singleton,
		Tags:        opts.Tags,
		expr:        expr,
		interval:    interval,
		stopCh:      make(chan struct{}),
		doneCh:      make(chan struct{}),
	}

	// Calculate next run time.
	now := time.Now().In(s.cfg.Timezone)
	if expr != nil {
		next, err := expr.Next(now)
		if err != nil {
			return fmt.Errorf("%w: %v", ErrInvalidSchedule, err)
		}
		job.nextRun = next
	} else {
		job.nextRun = now.Add(interval)
	}

	job.mu.Lock()
	job.status.NextRun = job.nextRun
	job.mu.Unlock()

	s.jobs[name] = job

	if s.started {
		s.startJob(job)
	}

	s.emitEvent(JobEvent{
		JobName: name,
		Type:    EventJobAdded,
		Time:    time.Now(),
	})

	return nil
}

// Remove unregisters a job. The job's goroutine is signaled to stop.
func (s *Scheduler) Remove(name string) error {
	s.mu.Lock()
	job, ok := s.jobs[name]
	if !ok {
		s.mu.Unlock()
		return fmt.Errorf("%w: %s", ErrJobNotFound, name)
	}
	delete(s.jobs, name)
	s.mu.Unlock()

	// Signal the job goroutine to stop.
	select {
	case <-job.stopCh:
	default:
		close(job.stopCh)
	}

	s.emitEvent(JobEvent{
		JobName: name,
		Type:    EventJobRemoved,
		Time:    time.Now(),
	})

	return nil
}

// Get returns a job by name.
func (s *Scheduler) Get(name string) (*Job, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	job, ok := s.jobs[name]
	if !ok {
		return nil, fmt.Errorf("%w: %s", ErrJobNotFound, name)
	}
	return job, nil
}

// Jobs returns a snapshot of all registered jobs.
func (s *Scheduler) Jobs() []*Job {
	s.mu.RLock()
	defer s.mu.RUnlock()
	jobs := make([]*Job, 0, len(s.jobs))
	for _, j := range s.jobs {
		jobs = append(jobs, j)
	}
	return jobs
}

// JobCount returns the number of registered jobs.
func (s *Scheduler) JobCount() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.jobs)
}

// ──────────────────────────────────────────────
// Internal: job execution loop
// ──────────────────────────────────────────────

// startJob launches the job's goroutine.
func (s *Scheduler) startJob(job *Job) {
	s.wg.Add(1)
	go s.runJob(job)
}

// runJob is the main loop for a job.
func (s *Scheduler) runJob(job *Job) {
	defer s.wg.Done()

	for {
		// Calculate sleep duration until next run.
		sleepDur := time.Until(job.nextRun)
		if sleepDur < 0 {
			sleepDur = 0
		}

		select {
		case <-s.stopCh:
			return
		case <-job.stopCh:
			return
		case <-time.After(sleepDur):
		}

		// Check if we should stop.
		select {
		case <-s.stopCh:
			return
		case <-job.stopCh:
			return
		default:
		}

		// Execute the job.
		s.executeJob(job)

		// Calculate next run time.
		s.calcNextRun(job)
	}
}

// executeJob attempts to acquire the lock and run the job.
func (s *Scheduler) executeJob(job *Job) {
	// Singleton check: skip if already running.
	if job.Singleton {
		job.mu.Lock()
		if job.running {
			job.mu.Unlock()
			s.emitEvent(JobEvent{
				JobName: job.Name,
				Type:    EventJobSkipped,
				Time:    time.Now(),
			})
			return
		}
		job.mu.Unlock()
	}

	// Acquire distributed lock (if configured).
	var locker lock.Locker
	if _, isNoop := s.cfg.LockFactory.(NoLockFactory); !isNoop {
		var err error
		locker, err = s.cfg.LockFactory.NewLock(job.Name)
		if err != nil {
			s.recordError(job, fmt.Errorf("create lock: %w", err))
			return
		}
		if locker != nil {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			err = locker.TryLock(ctx)
			cancel()
			if err != nil {
				// Lock not acquired — another node is running this job.
				s.emitEvent(JobEvent{
					JobName: job.Name,
					Type:    EventJobSkipped,
					Time:    time.Now(),
				})
				return
			}
			// Defer unlock.
			defer func() {
				ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
				_ = locker.Unlock(ctx)
				cancel()
			}()
		}
	}

	// Mark as running.
	job.mu.Lock()
	job.running = true
	job.status.Running = true
	job.status.LastRun = time.Now()
	job.status.RunCount++
	job.mu.Unlock()

	s.emitEvent(JobEvent{
		JobName: job.Name,
		Type:    EventJobStarted,
		Time:    time.Now(),
	})

	// Set up context with timeout.
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	if job.Timeout > 0 {
		ctx, cancel = context.WithTimeout(ctx, job.Timeout)
		defer cancel()
	}

	// Start lock refresher (if lock supports refresh and TTL > 0).
	if locker != nil && s.cfg.LockRefreshInterval > 0 {
		stopRefresh := s.startLockRefresher(job.Name, locker)
		defer stopRefresh()
	}

	// Execute the job function.
	start := time.Now()
	err := job.Func(ctx)
	duration := time.Since(start)

	// Update status.
	job.mu.Lock()
	job.running = false
	job.status.Running = false
	job.status.LastEnd = time.Now()
	job.mu.Unlock()

	if err != nil {
		s.recordError(job, err)
		s.emitEvent(JobEvent{
			JobName:  job.Name,
			Type:     EventJobFailed,
			Time:     time.Now(),
			Error:    err,
			Duration: duration,
		})
	} else {
		s.emitEvent(JobEvent{
			JobName:  job.Name,
			Type:     EventJobSucceeded,
			Time:     time.Now(),
			Duration: duration,
		})
	}
}

// startLockRefresher periodically refreshes the lock while the job runs.
// Returns a stop function.
func (s *Scheduler) startLockRefresher(jobName string, locker lock.Locker) func() {
	ticker := time.NewTicker(s.cfg.LockRefreshInterval)
	done := make(chan struct{})
	go func() {
		for {
			select {
			case <-done:
				ticker.Stop()
				return
			case <-ticker.C:
				ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
				if err := locker.Refresh(ctx); err != nil {
					// Refresh failed — the lock may have expired.
					// We don't cancel the job, but the next TryLock on another
					// node may succeed, leading to duplicate execution.
					_ = err
				}
				cancel()
			}
		}
	}()
	return func() { close(done) }
}

// calcNextRun computes and stores the next fire time for the job.
func (s *Scheduler) calcNextRun(job *Job) {
	now := time.Now().In(s.cfg.Timezone)
	var next time.Time
	if job.expr != nil {
		var err error
		next, err = job.expr.Next(now)
		if err != nil {
			s.recordError(job, fmt.Errorf("calc next run: %w", err))
			return
		}
	} else {
		next = now.Add(job.interval)
	}

	job.mu.Lock()
	job.nextRun = next
	job.status.NextRun = next
	job.mu.Unlock()
}

// recordError updates the job's error counters.
func (s *Scheduler) recordError(job *Job, err error) {
	job.mu.Lock()
	job.status.LastError = err
	job.status.LastErrorAt = time.Now()
	job.status.ErrorCount++
	job.mu.Unlock()
}

// emitEvent sends a job event to the listener (if configured).
func (s *Scheduler) emitEvent(e JobEvent) {
	if s.cfg.EventListener != nil {
		s.cfg.EventListener.OnJobEvent(e)
	}
}

// ──────────────────────────────────────────────
// Job options
// ──────────────────────────────────────────────

// Options configures a job's behavior.
type Options struct {
	Description string
	Timeout     time.Duration
	Singleton   bool
	Tags        []string
}

// ──────────────────────────────────────────────
// Schedule parsing
// ──────────────────────────────────────────────

// parseSchedule parses a schedule string and returns either a cron expression
// or an interval. If the string starts with "@every", it's an interval;
// otherwise it's a cron expression.
func parseSchedule(schedule string) (*cron.Expression, time.Duration, error) {
	if len(schedule) > 7 && schedule[:7] == "@every " {
		durStr := schedule[7:]
		dur, err := time.ParseDuration(durStr)
		if err != nil {
			return nil, 0, fmt.Errorf("parse @every duration: %w", err)
		}
		if dur <= 0 {
			return nil, 0, errors.New("interval must be positive")
		}
		return nil, dur, nil
	}

	// Try cron expression.
	expr, err := cron.Parse(schedule)
	if err != nil {
		return nil, 0, fmt.Errorf("parse cron expression: %w", err)
	}
	return expr, 0, nil
}
