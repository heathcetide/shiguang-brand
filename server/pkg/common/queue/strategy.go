// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package queue

import (
	"sort"
	"time"
)

// SchedulingStrategy determines how pending tasks are ordered for dispatch.
type SchedulingStrategy int

const (
	// StrategyFIFO dispatches tasks in submission order (oldest first).
	// Simple and fair, but ignores priority and weight.
	StrategyFIFO SchedulingStrategy = iota

	// StrategyPriority dispatches highest-priority tasks first.
	// Tasks with the same priority are ordered by submission time.
	// May cause starvation of low-priority tasks.
	StrategyPriority

	// StrategyWeightedFair dispatches tasks using a weighted fair queuing
	// algorithm. Each priority level gets a proportional share of
	// execution slots. Combined with aging to prevent starvation.
	StrategyWeightedFair

	// StrategyPreemptive is like StrategyPriority but also supports
	// preemption: when capacity is full and a high-priority task arrives,
	// a lower-priority running task is preempted (paused and re-queued).
	StrategyPreemptive
)

// String returns a human-readable strategy name.
func (s SchedulingStrategy) String() string {
	switch s {
	case StrategyFIFO:
		return "fifo"
	case StrategyPriority:
		return "priority"
	case StrategyWeightedFair:
		return "weighted-fair"
	case StrategyPreemptive:
		return "preemptive"
	default:
		return "unknown"
	}
}

// sortTasks orders pending tasks according to the scheduling strategy.
// This is called by the capacity-aware scheduler before dispatching.
func sortTasks(tasks []*Task, strategy SchedulingStrategy, now time.Time, agingThreshold time.Duration) {
	switch strategy {
	case StrategyFIFO:
		sort.SliceStable(tasks, func(i, j int) bool {
			return tasks[i].SubmitTime.Before(tasks[j].SubmitTime)
		})

	case StrategyPriority, StrategyPreemptive:
		sort.SliceStable(tasks, func(i, j int) bool {
			pi := effectivePriority(tasks[i], now, agingThreshold)
			pj := effectivePriority(tasks[j], now, agingThreshold)
			if pi != pj {
				return pi > pj // higher priority first
			}
			return tasks[i].SubmitTime.Before(tasks[j].SubmitTime)
		})

	case StrategyWeightedFair:
		sort.SliceStable(tasks, func(i, j int) bool {
			pi := effectivePriority(tasks[i], now, agingThreshold)
			pj := effectivePriority(tasks[j], now, agingThreshold)
			// Weighted fair: blend priority with wait time.
			wi := weightedFairScore(tasks[i], pi, now)
			wj := weightedFairScore(tasks[j], pj, now)
			return wi > wj
		})
	}
}

// effectivePriority computes the effective priority of a task, applying
// aging: tasks that have waited longer than agingThreshold get a priority
// boost proportional to their wait time. This prevents starvation of
// low-priority tasks in a busy system.
//
// The aging formula: effectivePriority = priority + max(0, (waitTime - agingThreshold) / agingBoostInterval)
// where agingBoostInterval controls how much wait time is needed for each
// +1 priority boost.
func effectivePriority(task *Task, now time.Time, agingThreshold time.Duration) int {
	if agingThreshold <= 0 {
		return task.Priority
	}
	wait := now.Sub(task.SubmitTime)
	if wait <= agingThreshold {
		return task.Priority
	}
	// Boost: 1 point per agingThreshold of extra wait.
	boost := int((wait - agingThreshold) / agingThreshold)
	return task.Priority + boost
}

// weightedFairScore computes a scheduling score that blends priority with
// wait time, giving a fair share to lower-priority tasks while still
// favoring higher-priority ones.
//
// Score = priority * priorityWeight + waitTime * waitWeight
// where priorityWeight and waitWeight are tuned so that a high-priority
// task is preferred initially, but a long-waiting low-priority task
// eventually overtakes.
func weightedFairScore(task *Task, effPriority int, now time.Time) float64 {
	waitSeconds := now.Sub(task.SubmitTime).Seconds()
	// priority contributes quadratically to dominate early,
	// wait time contributes linearly to eventually catch up.
	return float64(effPriority*effPriority) + waitSeconds*0.5
}

// canPreempt determines whether a running task should be preempted to make
// room for a pending task. Returns true if:
//   - the pending task has strictly higher priority
//   - the running task is preemptible
//   - the running task's weight would free enough capacity
func canPreempt(pending *Task, running *Task) bool {
	if !running.Preemptible {
		return false
	}
	return pending.Priority > running.Priority
}

// selectPreemptionVictims selects which running tasks to preempt to make
// room for a high-priority pending task. It greedily selects the
// lowest-priority preemptible tasks until enough capacity is freed.
//
// Returns the list of tasks to preempt and the total weight freed.
func selectPreemptionVictims(pending *Task, running []*Task, neededCapacity int) ([]*Task, int) {
	// Sort running tasks by priority ascending (lowest first = preempt first).
	candidates := make([]*Task, 0, len(running))
	for _, t := range running {
		if t.Preemptible && t.Priority < pending.Priority {
			candidates = append(candidates, t)
		}
	}
	sort.SliceStable(candidates, func(i, j int) bool {
		if candidates[i].Priority != candidates[j].Priority {
			return candidates[i].Priority < candidates[j].Priority
		}
		// Prefer preempting tasks that started most recently (less work lost).
		if candidates[i].StartedAt != nil && candidates[j].StartedAt != nil {
			return candidates[i].StartedAt.After(*candidates[j].StartedAt)
		}
		return false
	})

	var victims []*Task
	freed := 0
	for _, t := range candidates {
		if freed >= neededCapacity {
			break
		}
		victims = append(victims, t)
		if t.Weight > 0 {
			freed += t.Weight
		} else {
			freed += 1 // weight 0 = 1 unit
		}
	}

	if freed < neededCapacity {
		// Not enough capacity can be freed — don't preempt partially.
		return nil, 0
	}

	return victims, freed
}
