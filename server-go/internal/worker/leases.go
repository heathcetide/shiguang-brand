// Copyright (c) 2026 heathcetide. All rights reserved.

package worker

import (
	"crypto/rand"
	"encoding/hex"
	"os"
	"strconv"
	"strings"
	"time"
)

func leaseDuration() time.Duration {
	ms := 10 * 60_000
	if raw := strings.TrimSpace(os.Getenv("WORKER_LEASE_MS")); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n >= 5_000 {
			ms = n
		}
	}
	return time.Duration(ms) * time.Millisecond
}

func newLeaseOwnerID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// acquireLease claims exclusive ownership of a task. Missing lease table is a
// no-op success so older databases keep running until migration 006 applies.
func (r *Runtime) acquireLease(task string) (ownerID string, acquired bool) {
	if r.DB == nil || !r.DB.HasTable("worker_task_leases") {
		return "", true
	}
	ownerID = newLeaseOwnerID()
	now := time.Now().UTC()
	expires := now.Add(leaseDuration()).Format(time.RFC3339)
	nowStr := now.Format(time.RFC3339)
	res, err := r.DB.Exec(`INSERT INTO worker_task_leases (task_name, owner_id, lease_expires_at, updated_at)
		VALUES (?, ?, ?, ?)
		ON CONFLICT(task_name) DO UPDATE SET
			owner_id=excluded.owner_id,
			lease_expires_at=excluded.lease_expires_at,
			updated_at=excluded.updated_at
		WHERE worker_task_leases.lease_expires_at <= ?`,
		task, ownerID, expires, nowStr, nowStr)
	if err != nil {
		return "", false
	}
	n, _ := res.RowsAffected()
	return ownerID, n > 0
}

func (r *Runtime) releaseLease(task, ownerID string) {
	if ownerID == "" || r.DB == nil || !r.DB.HasTable("worker_task_leases") {
		return
	}
	_, _ = r.DB.Exec(`DELETE FROM worker_task_leases WHERE task_name=? AND owner_id=?`, task, ownerID)
}

func (r *Runtime) ownsLease(task, ownerID string) bool {
	if ownerID == "" || r.DB == nil || !r.DB.HasTable("worker_task_leases") {
		return true
	}
	nowStr := time.Now().UTC().Format(time.RFC3339)
	var one int
	err := r.DB.QueryRow(`SELECT 1 FROM worker_task_leases
		WHERE task_name=? AND owner_id=? AND lease_expires_at > ?`, task, ownerID, nowStr).Scan(&one)
	return err == nil
}
