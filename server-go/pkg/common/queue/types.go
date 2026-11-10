// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package queue provides a durable, distributed task queue with pluggable
// backends (in-memory, Redis), priority scheduling, CPU-aware and
// goroutine-pool-aware dispatch, crash recovery, and consumer concurrency
// control.
//
// # Architecture
//
//   - Task:   a unit of work with ID, priority, payload, status, and metadata.
//   - Queue:  pluggable backend (memory, Redis) that stores and dispatches tasks.
//   - Scheduler: manages a worker pool, pulls tasks from the queue, and
//     executes them with optional CPU-based or goroutine-count-based
//     throttling.
//
// # Backends
//
//   - memory/  — in-process priority queue (single-node, fast, no persistence)
//   - redis/   — Redis-backed distributed queue (multi-node, persistent)
//
// # Scheduling modes
//
//   - GoroutinePool: fixed worker count (default)
//   - CPUAdaptive:   worker count scales with CPU usage (more workers when
//     CPU is idle, fewer when busy)
//
// # Persistence & recovery
//
// When a persistent backend (Redis or DB) is used, tasks survive process
// restarts. On startup, the scheduler recovers pending/running tasks and
// re-queues them.
package queue

import (
	"context"
	"encoding/json"
	"errors"
	"time"
)

// TaskStatus is the lifecycle state of a task.
type TaskStatus string

const (
	StatusPending  TaskStatus = "pending"
	StatusRunning  TaskStatus = "running"
	StatusSuccess  TaskStatus = "success"
	StatusFailed   TaskStatus = "failed"
	StatusCanceled TaskStatus = "canceled"
	StatusRetry    TaskStatus = "retry"
)

// String returns the status as a string.
func (s TaskStatus) String() string { return string(s) }

// IsTerminal reports whether the status is a final state.
func (s TaskStatus) IsTerminal() bool {
	return s == StatusSuccess || s == StatusFailed || s == StatusCanceled
}

// Task is a unit of work in the queue.
type Task struct {
	ID         string          `json:"id"`
	Queue      string          `json:"queue"`
	Kind       string          `json:"kind,omitempty"`
	JobID      string          `json:"job_id,omitempty"`
	Priority   int             `json:"priority"`
	Weight     int             `json:"weight,omitempty"`
	Payload    json.RawMessage `json:"payload"`
	Status     TaskStatus      `json:"status"`
	Progress   int             `json:"progress"`
	RetryCount int             `json:"retry_count"`
	MaxRetries int             `json:"max_retries"`
	ErrorMsg   string          `json:"error_msg,omitempty"`
	SubmitTime time.Time       `json:"submit_time"`
	StartedAt  *time.Time      `json:"started_at,omitempty"`
	FinishedAt *time.Time      `json:"finished_at,omitempty"`
	WorkerID   string          `json:"worker_id,omitempty"`

	// Preemptible indicates whether this task can be preempted by a
	// higher-priority task when capacity is full. Default: true.
	Preemptible bool `json:"preemptible,omitempty"`
}

// TaskResult holds the outcome of a task execution.
type TaskResult struct {
	TaskID  string
	Status  TaskStatus
	Error   error
	Elapsed time.Duration
}

// TaskLogEntry is a single execution log line for a task.
type TaskLogEntry struct {
	TaskID    string    `json:"task_id"`
	Level     string    `json:"level"` // "info", "warn", "error"
	Message   string    `json:"message"`
	Timestamp time.Time `json:"timestamp"`
}

// LogLevel constants for TaskLogEntry.
const (
	LogLevelInfo  = "info"
	LogLevelWarn  = "warn"
	LogLevelError = "error"
)

// Handler processes a task. The implementation is responsible for
// unmarshalling the payload and performing the work.
type Handler func(ctx context.Context, task *Task) error

// TaskContext is passed to handlers when using a scheduler that supports
// progress reporting and execution logging. It wraps the base context and
// task, and provides methods to update progress and append log entries
// to the queue backend.
//
// Usage:
//
//	func myHandler(tctx queue.TaskContext, task *queue.Task) error {
//	    tctx.SetProgress(10)
//	    tctx.Log(queue.LogLevelInfo, "starting work")
//	    // ... do work ...
//	    tctx.SetProgress(100)
//	    return nil
//	}
type TaskContext interface {
	context.Context
	Task() *Task
	SetProgress(progress int) error
	Log(level string, message string) error
}

// RichHandler is a handler that receives a TaskContext for progress and
// logging. Schedulers that support rich handlers will call this instead of
// the plain Handler when configured.
type RichHandler func(tctx TaskContext, task *Task) error

// Sentinel errors.
var (
	// ErrQueueEmpty is returned when no tasks are available.
	ErrQueueEmpty = errors.New("queue: empty")

	// ErrQueueClosed is returned when the queue is closed.
	ErrQueueClosed = errors.New("queue: closed")

	// ErrTaskNotFound is returned when a task ID does not exist.
	ErrTaskNotFound = errors.New("queue: task not found")

	// ErrDuplicateTask is returned when a task ID already exists.
	ErrDuplicateTask = errors.New("queue: duplicate task")
)

// QueueStats is a snapshot of queue metrics.
type QueueStats struct {
	Queue     string `json:"queue"`
	Pending   int64  `json:"pending"`
	Running   int64  `json:"running"`
	Completed int64  `json:"completed"`
	Failed    int64  `json:"failed"`
	Total     int64  `json:"total"`
}

// Queue is the backend interface for storing and dispatching tasks.
// Implementations must be safe for concurrent use.
type Queue interface {
	// Enqueue adds a task to the queue. Returns ErrDuplicateTask if the
	// task ID already exists.
	Enqueue(ctx context.Context, task *Task) error

	// Dequeue removes and returns the highest-priority pending task.
	// Returns ErrQueueEmpty if no tasks are available. Blocks up to
	// timeout if non-zero.
	Dequeue(ctx context.Context, timeout time.Duration) (*Task, error)

	// Ack marks a task as completed (success or failure).
	Ack(ctx context.Context, taskID string, status TaskStatus, errMsg string) error

	// Requeue moves a task back to pending status.
	Requeue(ctx context.Context, taskID string) error

	// Get retrieves a task by ID.
	Get(ctx context.Context, taskID string) (*Task, error)

	// Cancel removes a pending task or marks a running task as canceled.
	Cancel(ctx context.Context, taskID string) error

	// Position returns the queue position of a pending task (0 = next to
	// dispatch). Returns -1 if the task is not in the pending queue.
	Position(ctx context.Context, taskID string) (int, error)

	// UpdateProgress updates the execution progress of a running task.
	// progress should be 0-100.
	UpdateProgress(ctx context.Context, taskID string, progress int) error

	// AppendLog appends an execution log entry for a task.
	AppendLog(ctx context.Context, entry *TaskLogEntry) error

	// ListLogs returns execution log entries for a task, newest first.
	// limit of 0 means no limit.
	ListLogs(ctx context.Context, taskID string, limit int) ([]*TaskLogEntry, error)

	// Recover returns all pending and interrupted (running) tasks for
	// restart recovery. Running tasks are reset to pending.
	Recover(ctx context.Context) ([]*Task, error)

	// Stats returns current queue statistics.
	Stats(ctx context.Context) (QueueStats, error)

	// Close releases all backend resources.
	Close() error

	// Name returns the queue name.
	Name() string
}

// EncodePayload marshals a value to JSON for Task.Payload.
func EncodePayload(v any) (json.RawMessage, error) {
	return json.Marshal(v)
}

// DecodePayload unmarshals Task.Payload into a value.
func DecodePayload[T any](task *Task) (T, error) {
	var v T
	err := json.Unmarshal(task.Payload, &v)
	return v, err
}
