// Copyright (c) 2026 heathcetide. All rights reserved.

package worker

import (
	"context"
	"encoding/json"
	"log"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/heathcetide/DietDigiDose/internal/dbx"
	"github.com/heathcetide/DietDigiDose/internal/domains/social"
)

// Runtime runs the Express-parity background tasks on a shared interval.
type Runtime struct {
	DB       *dbx.DB
	Social   *social.Handlers
	Interval time.Duration
	Tasks    []string
	WorkerID string
}

func taskInterval() time.Duration {
	ms := 60_000
	if raw := strings.TrimSpace(os.Getenv("WORKER_INTERVAL_MS")); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n >= 5_000 {
			ms = n
		}
	}
	return time.Duration(ms) * time.Millisecond
}

func configuredTasks() []string {
	raw := strings.TrimSpace(os.Getenv("WORKER_TASKS"))
	if raw == "" {
		return []string{
			"notifications",
			"intervention-scan",
			"intervention-delivery",
			"media-cleanup",
			"plan-maintenance-dispatch",
			"plan-maintenance-process",
		}
	}
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		name := strings.TrimSpace(part)
		if name != "" {
			out = append(out, name)
		}
	}
	return out
}

// New builds a worker runtime with defaults from environment.
func New(db *dbx.DB, socialHandlers *social.Handlers) *Runtime {
	id := strings.TrimSpace(os.Getenv("WORKER_ID"))
	if id == "" {
		id = "go-worker"
	}
	return &Runtime{
		DB:       db,
		Social:   socialHandlers,
		Interval: taskInterval(),
		Tasks:    configuredTasks(),
		WorkerID: id,
	}
}

// Run blocks until ctx is cancelled, executing all configured tasks each tick.
func (r *Runtime) Run(ctx context.Context) {
	log.Printf("[worker] started id=%s interval=%s tasks=%v", r.WorkerID, r.Interval, r.Tasks)
	runOnce := func() {
		for _, task := range r.Tasks {
			if ctx.Err() != nil {
				return
			}
			r.runTask(ctx, task)
		}
	}
	runOnce()
	ticker := time.NewTicker(r.Interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			log.Printf("[worker] stopped")
			return
		case <-ticker.C:
			runOnce()
		}
	}
}

func (r *Runtime) runTask(ctx context.Context, task string) {
	runID := r.beginRun(task)
	summary := map[string]any{}
	var err error
	switch task {
	case "notifications":
		summary, err = r.Social.RunNotificationsTask(ctx)
	case "intervention-scan":
		scanned, created := r.Social.RunInterventionScanOnce()
		summary = map[string]any{"scanned": scanned, "candidates": created}
	case "intervention-delivery":
		summary, err = r.Social.RunInterventionDeliveryTask(ctx)
	case "media-cleanup":
		summary, err = r.Social.RunMediaCleanupTask(ctx)
	case "plan-maintenance-dispatch":
		summary, err = r.Social.RunPlanMaintenanceDispatch(ctx)
	case "plan-maintenance-process":
		summary, err = r.Social.RunPlanMaintenanceProcess(ctx)
	default:
		err = errUnknownTask(task)
	}
	r.finishRun(runID, summary, err)
	if err != nil {
		log.Printf("[worker] task=%s failed: %v summary=%v", task, err, summary)
		return
	}
	log.Printf("[worker] task=%s ok summary=%v", task, summary)
}

func errUnknownTask(task string) error {
	return &taskError{task: task}
}

type taskError struct{ task string }

func (e *taskError) Error() string { return "unknown worker task: " + e.task }

func (r *Runtime) beginRun(task string) int64 {
	if r.DB == nil || !r.hasWorkerRuns() {
		return 0
	}
	id, err := r.DB.InsertID(`INSERT INTO worker_task_runs (task_name, worker_id, status) VALUES (?, ?, 'running')`, task, r.WorkerID)
	if err != nil {
		return 0
	}
	return id
}

func (r *Runtime) finishRun(runID int64, summary map[string]any, err error) {
	if runID <= 0 || r.DB == nil || !r.hasWorkerRuns() {
		return
	}
	raw, _ := json.Marshal(summary)
	status := "completed"
	var errText any
	if err != nil {
		status = "failed"
		errText = err.Error()
	}
	_, _ = r.DB.Exec(`UPDATE worker_task_runs SET status=?, summary_json=?, finished_at=CURRENT_TIMESTAMP, error_text=? WHERE id=?`,
		status, string(raw), errText, runID)
}

func (r *Runtime) hasWorkerRuns() bool {
	return r.DB != nil && r.DB.HasTable("worker_task_runs")
}
