// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package redis provides a Redis-backed distributed task queue. It uses
// Redis sorted sets for priority scheduling and hashes for task metadata.
// This backend supports multiple consumer nodes, crash recovery, and
// persistent task storage.
package redis

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/heathcetide/DietDigiDose/pkg/common/queue"
	goredis "github.com/redis/go-redis/v9"
)

const (
	// keyPrefix is the Redis key namespace.
	keyPrefix = "lingbase:queue"

	// taskKeyPrefix stores task metadata as JSON hashes.
	taskKeyPrefix = keyPrefix + ":task"

	// queueKeyPrefix stores sorted sets of pending task IDs by priority.
	queueKeyPrefix = keyPrefix + ":pending"

	// runningKeyPrefix stores sorted sets of running task IDs.
	runningKeyPrefix = keyPrefix + ":running"

	// statsKeyPrefix stores queue stats as hashes.
	statsKeyPrefix = keyPrefix + ":stats"
)

func (q *Queue) taskKey(taskID string) string { return fmt.Sprintf("%s:%s", taskKeyPrefix, taskID) }
func (q *Queue) pendingKey() string           { return fmt.Sprintf("%s:%s", queueKeyPrefix, q.name) }
func (q *Queue) runningKey() string           { return fmt.Sprintf("%s:%s", runningKeyPrefix, q.name) }
func (q *Queue) statsKey() string             { return fmt.Sprintf("%s:%s", statsKeyPrefix, q.name) }

// Queue is a Redis-backed task queue.
type Queue struct {
	name   string
	client *goredis.Client
}

// New creates a new Redis-backed queue.
func New(name string, client *goredis.Client) *Queue {
	return &Queue{name: name, client: client}
}

// Enqueue adds a task to the Redis queue.
func (q *Queue) Enqueue(ctx context.Context, task *queue.Task) error {
	if task.ID == "" {
		return errors.New("redis queue: task ID is required")
	}
	task.Queue = q.name
	task.Status = queue.StatusPending
	if task.SubmitTime.IsZero() {
		task.SubmitTime = time.Now()
	}

	data, err := json.Marshal(task)
	if err != nil {
		return fmt.Errorf("redis queue: marshal task: %w", err)
	}

	// Atomic duplicate check: SETNX the task key. If it already exists,
	// the task is a duplicate.
	ok, err := q.client.SetNX(ctx, q.taskKey(task.ID), data, 0).Result()
	if err != nil {
		return fmt.Errorf("redis queue: setnx task: %w", err)
	}
	if !ok {
		return queue.ErrDuplicateTask
	}

	// Score: higher priority first, then earlier submit time.
	score := float64(task.Priority)*1e10 - float64(task.SubmitTime.UnixNano())

	pipe := q.client.Pipeline()
	pipe.ZAdd(ctx, q.pendingKey(), goredis.Z{Score: score, Member: task.ID})
	pipe.HIncrBy(ctx, q.statsKey(), "pending", 1)
	pipe.HIncrBy(ctx, q.statsKey(), "total", 1)
	_, err = pipe.Exec(ctx)
	if err != nil {
		// Rollback the SETNX on failure.
		q.client.Del(ctx, q.taskKey(task.ID))
		return err
	}
	return nil
}

// Dequeue removes and returns the highest-priority pending task.
//
// The pending sorted set is scored so that higher priority (and, within the
// same priority, earlier submit time) yields a higher score. We therefore pop
// the member with the highest score (ZPopMax / BZPopMax).
func (q *Queue) Dequeue(ctx context.Context, timeout time.Duration) (*queue.Task, error) {
	// Use BZPopMax for blocking dequeue if timeout > 0.
	if timeout > 0 {
		result, err := q.client.BZPopMax(ctx, timeout, q.pendingKey()).Result()
		if err != nil {
			if errors.Is(err, goredis.Nil) {
				return nil, queue.ErrQueueEmpty
			}
			return nil, err
		}
		return q.claimTask(ctx, result.Member.(string))
	}

	// Non-blocking: ZPopMax (highest score = highest priority first).
	members, err := q.client.ZPopMax(ctx, q.pendingKey(), 1).Result()
	if err != nil {
		return nil, err
	}
	if len(members) == 0 {
		return nil, queue.ErrQueueEmpty
	}
	return q.claimTask(ctx, members[0].Member.(string))
}

func (q *Queue) claimTask(ctx context.Context, taskID string) (*queue.Task, error) {
	data, err := q.client.Get(ctx, q.taskKey(taskID)).Result()
	if err != nil {
		if errors.Is(err, goredis.Nil) {
			return nil, queue.ErrTaskNotFound
		}
		return nil, err
	}

	var task queue.Task
	if err := json.Unmarshal([]byte(data), &task); err != nil {
		return nil, fmt.Errorf("redis queue: unmarshal task: %w", err)
	}

	// Mark as running.
	now := time.Now()
	task.Status = queue.StatusRunning
	task.StartedAt = &now

	updated, err := json.Marshal(&task)
	if err != nil {
		return nil, err
	}

	score := float64(task.Priority)*1e10 - float64(task.SubmitTime.UnixNano())
	pipe := q.client.Pipeline()
	pipe.Set(ctx, q.taskKey(taskID), updated, 0)
	pipe.ZAdd(ctx, q.runningKey(), goredis.Z{Score: score, Member: taskID})
	pipe.HIncrBy(ctx, q.statsKey(), "pending", -1)
	_, err = pipe.Exec(ctx)
	if err != nil {
		return nil, err
	}

	return &task, nil
}

// Ack marks a task as completed.
func (q *Queue) Ack(ctx context.Context, taskID string, status queue.TaskStatus, errMsg string) error {
	data, err := q.client.Get(ctx, q.taskKey(taskID)).Bytes()
	if err != nil {
		if errors.Is(err, goredis.Nil) {
			return queue.ErrTaskNotFound
		}
		return err
	}

	var task queue.Task
	if err := json.Unmarshal(data, &task); err != nil {
		return err
	}

	task.Status = status
	task.ErrorMsg = errMsg
	now := time.Now()
	task.FinishedAt = &now
	if status == queue.StatusSuccess {
		task.Progress = 100
	}

	updated, err := json.Marshal(&task)
	if err != nil {
		return err
	}

	pipe := q.client.Pipeline()
	pipe.Set(ctx, q.taskKey(taskID), updated, 0)
	pipe.ZRem(ctx, q.runningKey(), taskID)
	if status == queue.StatusSuccess {
		pipe.HIncrBy(ctx, q.statsKey(), "completed", 1)
	} else if status == queue.StatusFailed {
		pipe.HIncrBy(ctx, q.statsKey(), "failed", 1)
	}
	// Clean up task data on terminal status.
	if status.IsTerminal() {
		pipe.Del(ctx, q.taskKey(taskID))
	}
	_, err = pipe.Exec(ctx)
	return err
}

// Requeue moves a task back to pending.
func (q *Queue) Requeue(ctx context.Context, taskID string) error {
	data, err := q.client.Get(ctx, q.taskKey(taskID)).Bytes()
	if err != nil {
		if errors.Is(err, goredis.Nil) {
			return queue.ErrTaskNotFound
		}
		return err
	}

	var task queue.Task
	if err := json.Unmarshal(data, &task); err != nil {
		return err
	}

	task.Status = queue.StatusPending
	task.RetryCount++
	task.StartedAt = nil
	task.FinishedAt = nil
	task.ErrorMsg = ""

	updated, err := json.Marshal(&task)
	if err != nil {
		return err
	}

	score := float64(task.Priority)*1e10 - float64(task.SubmitTime.UnixNano())
	pipe := q.client.Pipeline()
	pipe.Set(ctx, q.taskKey(taskID), updated, 0)
	pipe.ZRem(ctx, q.runningKey(), taskID)
	pipe.ZAdd(ctx, q.pendingKey(), goredis.Z{Score: score, Member: taskID})
	pipe.HIncrBy(ctx, q.statsKey(), "pending", 1)
	_, err = pipe.Exec(ctx)
	return err
}

// Get retrieves a task by ID.
func (q *Queue) Get(ctx context.Context, taskID string) (*queue.Task, error) {
	data, err := q.client.Get(ctx, q.taskKey(taskID)).Bytes()
	if err != nil {
		if errors.Is(err, goredis.Nil) {
			return nil, queue.ErrTaskNotFound
		}
		return nil, err
	}
	var task queue.Task
	if err := json.Unmarshal(data, &task); err != nil {
		return nil, err
	}
	return &task, nil
}

// Cancel removes a pending task or marks a running task as canceled.
func (q *Queue) Cancel(ctx context.Context, taskID string) error {
	pipe := q.client.Pipeline()
	pipe.ZRem(ctx, q.pendingKey(), taskID)
	pipe.ZRem(ctx, q.runningKey(), taskID)
	pipe.Del(ctx, q.taskKey(taskID))
	pipe.HIncrBy(ctx, q.statsKey(), "pending", -1)
	_, err := pipe.Exec(ctx)
	if err != nil {
		return err
	}
	return nil
}

// Position returns the queue position of a pending task (0 = next).
func (q *Queue) Position(ctx context.Context, taskID string) (int, error) {
	// Pending is dispatched highest-score first (see Dequeue), so the next
	// task to dispatch has the highest score -> ZRevRank 0.
	rank, err := q.client.ZRevRank(ctx, q.pendingKey(), taskID).Result()
	if err != nil {
		if errors.Is(err, goredis.Nil) {
			return -1, nil
		}
		return -1, err
	}
	return int(rank), nil
}

// UpdateProgress updates the execution progress of a running task.
func (q *Queue) UpdateProgress(ctx context.Context, taskID string, progress int) error {
	data, err := q.client.Get(ctx, q.taskKey(taskID)).Bytes()
	if err != nil {
		if errors.Is(err, goredis.Nil) {
			return queue.ErrTaskNotFound
		}
		return err
	}
	var task queue.Task
	if err := json.Unmarshal(data, &task); err != nil {
		return err
	}
	if progress < 0 {
		progress = 0
	}
	if progress > 100 {
		progress = 100
	}
	task.Progress = progress
	updated, err := json.Marshal(&task)
	if err != nil {
		return err
	}
	return q.client.Set(ctx, q.taskKey(taskID), updated, 0).Err()
}

// AppendLog appends an execution log entry for a task using a Redis list.
func (q *Queue) AppendLog(ctx context.Context, entry *queue.TaskLogEntry) error {
	if entry.TaskID == "" {
		return errors.New("redis queue: log entry task ID is required")
	}
	if entry.Timestamp.IsZero() {
		entry.Timestamp = time.Now()
	}
	data, err := json.Marshal(entry)
	if err != nil {
		return err
	}
	// LPUSH so newest is at index 0 (ListLogs can use LRANGE 0 limit).
	return q.client.LPush(ctx, q.logKey(entry.TaskID), data).Err()
}

// ListLogs returns execution log entries for a task, newest first.
func (q *Queue) ListLogs(ctx context.Context, taskID string, limit int) ([]*queue.TaskLogEntry, error) {
	if limit <= 0 {
		limit = 100
	}
	results, err := q.client.LRange(ctx, q.logKey(taskID), 0, int64(limit-1)).Result()
	if err != nil {
		return nil, err
	}
	entries := make([]*queue.TaskLogEntry, 0, len(results))
	for _, raw := range results {
		var entry queue.TaskLogEntry
		if err := json.Unmarshal([]byte(raw), &entry); err != nil {
			continue
		}
		entries = append(entries, &entry)
	}
	return entries, nil
}

func (q *Queue) logKey(taskID string) string {
	return fmt.Sprintf("%s:log:%s", keyPrefix, taskID)
}

// Recover returns all pending and running tasks, resetting running to pending.
func (q *Queue) Recover(ctx context.Context) ([]*queue.Task, error) {
	// Get all running task IDs and reset them to pending.
	runningIDs, err := q.client.ZRange(ctx, q.runningKey(), 0, -1).Result()
	if err != nil {
		return nil, err
	}

	// Track IDs recovered from the running set so they are not returned again
	// when iterating the pending set (they are added to pending below).
	seen := make(map[string]struct{}, len(runningIDs))
	var recovered []*queue.Task
	for _, id := range runningIDs {
		data, err := q.client.Get(ctx, q.taskKey(id)).Bytes()
		if err != nil {
			if errors.Is(err, goredis.Nil) {
				q.client.ZRem(ctx, q.runningKey(), id)
				continue
			}
			continue
		}
		var task queue.Task
		if err := json.Unmarshal(data, &task); err != nil {
			continue
		}
		// Reset to pending.
		task.Status = queue.StatusPending
		task.StartedAt = nil
		task.ErrorMsg = ""
		updated, _ := json.Marshal(&task)
		score := float64(task.Priority)*1e10 - float64(task.SubmitTime.UnixNano())
		pipe := q.client.Pipeline()
		pipe.Set(ctx, q.taskKey(id), updated, 0)
		pipe.ZRem(ctx, q.runningKey(), id)
		pipe.ZAdd(ctx, q.pendingKey(), goredis.Z{Score: score, Member: id})
		pipe.Exec(ctx)
		seen[id] = struct{}{}
		recovered = append(recovered, &task)
	}

	// Also return pending tasks (for visibility), skipping any that were just
	// moved out of the running set to avoid duplicates.
	pendingIDs, err := q.client.ZRange(ctx, q.pendingKey(), 0, -1).Result()
	if err != nil {
		return recovered, err
	}
	for _, id := range pendingIDs {
		if _, ok := seen[id]; ok {
			continue
		}
		data, err := q.client.Get(ctx, q.taskKey(id)).Bytes()
		if err != nil {
			continue
		}
		var task queue.Task
		if err := json.Unmarshal(data, &task); err != nil {
			continue
		}
		recovered = append(recovered, &task)
	}

	return recovered, nil
}

// Stats returns current queue statistics.
func (q *Queue) Stats(ctx context.Context) (queue.QueueStats, error) {
	stats := queue.QueueStats{Queue: q.name}
	m, err := q.client.HGetAll(ctx, q.statsKey()).Result()
	if err != nil {
		return stats, err
	}
	stats.Pending = parseInt64(m["pending"])
	stats.Running = parseInt64(m["running"])
	stats.Completed = parseInt64(m["completed"])
	stats.Failed = parseInt64(m["failed"])
	stats.Total = parseInt64(m["total"])
	return stats, nil
}

// Close is a no-op: the Redis client is owned by the caller (passed to New)
// and must be closed by the caller when appropriate. This method exists to
// satisfy the queue.Queue interface.
func (q *Queue) Close() error { return nil }

// Name returns the queue name.
func (q *Queue) Name() string { return q.name }

func parseInt64(s string) int64 {
	var n int64
	fmt.Sscanf(s, "%d", &n)
	return n
}
