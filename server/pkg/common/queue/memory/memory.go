// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package memory provides an in-process priority queue backend for the
// queue package. It is fast and simple but not distributed or persistent —
// tasks are lost when the process exits.
package memory

import (
	"context"
	"sort"
	"sync"
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common/queue"
)

// Queue is an in-memory priority queue.
type Queue struct {
	name   string
	mu     sync.Mutex
	cond   *sync.Cond
	tasks  []*queue.Task
	byID   map[string]*queue.Task
	logs   map[string][]*queue.TaskLogEntry
	closed bool

	stats queue.QueueStats
}

// New creates a new in-memory queue with the given name.
func New(name string) *Queue {
	q := &Queue{
		name: name,
		byID: make(map[string]*queue.Task),
		logs: make(map[string][]*queue.TaskLogEntry),
	}
	q.cond = sync.NewCond(&q.mu)
	return q
}

// Enqueue adds a task to the queue.
func (q *Queue) Enqueue(ctx context.Context, task *queue.Task) error {
	q.mu.Lock()
	defer q.mu.Unlock()
	if q.closed {
		return queue.ErrQueueClosed
	}
	if _, exists := q.byID[task.ID]; exists {
		return queue.ErrDuplicateTask
	}
	task.Status = queue.StatusPending
	if task.SubmitTime.IsZero() {
		task.SubmitTime = time.Now()
	}
	q.byID[task.ID] = task
	q.tasks = append(q.tasks, task)
	q.sortLocked()
	q.stats.Pending++
	q.stats.Total++
	q.cond.Signal()
	return nil
}

// Dequeue removes and returns the highest-priority pending task.
// If no task is available, it blocks up to timeout (if > 0).
func (q *Queue) Dequeue(ctx context.Context, timeout time.Duration) (*queue.Task, error) {
	// Fast path with lock.
	q.mu.Lock()
	if len(q.tasks) > 0 {
		task := q.popLocked()
		q.mu.Unlock()
		return task, nil
	}

	if q.closed {
		q.mu.Unlock()
		return nil, queue.ErrQueueClosed
	}

	if timeout <= 0 {
		q.mu.Unlock()
		return nil, queue.ErrQueueEmpty
	}

	// Blocking path: poll with deadline.
	deadline := time.Now().Add(timeout)
	for len(q.tasks) == 0 && !q.closed {
		remaining := time.Until(deadline)
		if remaining <= 0 {
			q.mu.Unlock()
			return nil, queue.ErrQueueEmpty
		}

		// Use a timer to wake up the cond.Wait.
		woken := make(chan struct{}, 1)
		timer := time.AfterFunc(remaining, func() {
			q.mu.Lock()
			select {
			case woken <- struct{}{}:
			default:
			}
			q.cond.Broadcast()
			q.mu.Unlock()
		})

		// Wait for signal or timer.
		q.cond.Wait()

		timer.Stop()
		select {
		case <-woken:
			// Timer fired — timeout.
			if len(q.tasks) == 0 && !q.closed {
				q.mu.Unlock()
				return nil, queue.ErrQueueEmpty
			}
		default:
			// Signal from Enqueue/Close — check again.
		}

		if ctx.Err() != nil {
			q.mu.Unlock()
			return nil, ctx.Err()
		}
	}

	if q.closed {
		q.mu.Unlock()
		return nil, queue.ErrQueueClosed
	}

	if len(q.tasks) == 0 {
		q.mu.Unlock()
		return nil, queue.ErrQueueEmpty
	}

	task := q.popLocked()
	q.mu.Unlock()
	return task, nil
}

func (q *Queue) popLocked() *queue.Task {
	task := q.tasks[0]
	q.tasks = q.tasks[1:]
	task.Status = queue.StatusRunning
	now := time.Now()
	task.StartedAt = &now
	q.stats.Pending--
	return task
}

// Ack marks a task as completed.
func (q *Queue) Ack(ctx context.Context, taskID string, status queue.TaskStatus, errMsg string) error {
	q.mu.Lock()
	defer q.mu.Unlock()
	task, ok := q.byID[taskID]
	if !ok {
		return queue.ErrTaskNotFound
	}
	task.Status = status
	task.ErrorMsg = errMsg
	now := time.Now()
	task.FinishedAt = &now
	if status == queue.StatusSuccess {
		task.Progress = 100
		q.stats.Completed++
	} else if status == queue.StatusFailed {
		q.stats.Failed++
	}
	if status.IsTerminal() {
		delete(q.byID, taskID)
	}
	return nil
}

// Requeue moves a task back to pending.
func (q *Queue) Requeue(ctx context.Context, taskID string) error {
	q.mu.Lock()
	defer q.mu.Unlock()
	task, ok := q.byID[taskID]
	if !ok {
		return queue.ErrTaskNotFound
	}
	task.Status = queue.StatusPending
	task.RetryCount++
	task.StartedAt = nil
	task.FinishedAt = nil
	task.ErrorMsg = ""
	q.tasks = append(q.tasks, task)
	q.sortLocked()
	q.stats.Pending++
	q.cond.Signal()
	return nil
}

// Get retrieves a task by ID.
func (q *Queue) Get(ctx context.Context, taskID string) (*queue.Task, error) {
	q.mu.Lock()
	defer q.mu.Unlock()
	task, ok := q.byID[taskID]
	if !ok {
		return nil, queue.ErrTaskNotFound
	}
	cp := *task
	return &cp, nil
}

// Cancel removes a pending task or marks a running task as canceled.
func (q *Queue) Cancel(ctx context.Context, taskID string) error {
	q.mu.Lock()
	defer q.mu.Unlock()
	task, ok := q.byID[taskID]
	if !ok {
		return queue.ErrTaskNotFound
	}
	for i, t := range q.tasks {
		if t.ID == taskID {
			q.tasks = append(q.tasks[:i], q.tasks[i+1:]...)
			q.stats.Pending--
			break
		}
	}
	task.Status = queue.StatusCanceled
	now := time.Now()
	task.FinishedAt = &now
	delete(q.byID, taskID)
	return nil
}

// Position returns the queue position of a pending task (0 = next).
func (q *Queue) Position(ctx context.Context, taskID string) (int, error) {
	q.mu.Lock()
	defer q.mu.Unlock()
	for i, t := range q.tasks {
		if t.ID == taskID {
			return i, nil
		}
	}
	return -1, nil
}

// UpdateProgress updates the execution progress of a running task.
func (q *Queue) UpdateProgress(ctx context.Context, taskID string, progress int) error {
	q.mu.Lock()
	defer q.mu.Unlock()
	task, ok := q.byID[taskID]
	if !ok {
		return queue.ErrTaskNotFound
	}
	if progress < 0 {
		progress = 0
	}
	if progress > 100 {
		progress = 100
	}
	task.Progress = progress
	return nil
}

// AppendLog appends an execution log entry for a task.
func (q *Queue) AppendLog(ctx context.Context, entry *queue.TaskLogEntry) error {
	q.mu.Lock()
	defer q.mu.Unlock()
	if entry.Timestamp.IsZero() {
		entry.Timestamp = time.Now()
	}
	q.logs[entry.TaskID] = append(q.logs[entry.TaskID], entry)
	return nil
}

// ListLogs returns execution log entries for a task, newest first.
func (q *Queue) ListLogs(ctx context.Context, taskID string, limit int) ([]*queue.TaskLogEntry, error) {
	q.mu.Lock()
	defer q.mu.Unlock()
	entries := q.logs[taskID]
	if len(entries) == 0 {
		return nil, nil
	}
	// Return newest first.
	result := make([]*queue.TaskLogEntry, len(entries))
	copy(result, entries)
	// Reverse.
	for i, j := 0, len(result)-1; i < j; i, j = i+1, j-1 {
		result[i], result[j] = result[j], result[i]
	}
	if limit > 0 && len(result) > limit {
		result = result[:limit]
	}
	return result, nil
}

// Recover returns pending and interrupted tasks for restart recovery.
// In-memory queue has no persistence — nothing to recover.
func (q *Queue) Recover(ctx context.Context) ([]*queue.Task, error) {
	return nil, nil
}

// Stats returns current queue statistics.
func (q *Queue) Stats(ctx context.Context) (queue.QueueStats, error) {
	q.mu.Lock()
	defer q.mu.Unlock()
	stats := q.stats
	stats.Queue = q.name
	return stats, nil
}

// Close releases all resources.
func (q *Queue) Close() error {
	q.mu.Lock()
	defer q.mu.Unlock()
	q.closed = true
	q.cond.Broadcast()
	return nil
}

// Name returns the queue name.
func (q *Queue) Name() string { return q.name }

func (q *Queue) sortLocked() {
	sort.SliceStable(q.tasks, func(i, j int) bool {
		if q.tasks[i].Priority != q.tasks[j].Priority {
			return q.tasks[i].Priority > q.tasks[j].Priority
		}
		return q.tasks[i].SubmitTime.Before(q.tasks[j].SubmitTime)
	})
}
