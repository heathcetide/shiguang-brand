// Copyright (c) 2026 heathcetide. All rights reserved.

package worker

import (
	"testing"
	"time"

	"github.com/heathcetide/DietDigiDose/internal/dbx"
	"github.com/heathcetide/DietDigiDose/internal/domains/social"
	"github.com/heathcetide/DietDigiDose/internal/testutil"
)

func TestWorkerTaskLeaseExclusiveAndExpiry(t *testing.T) {
	testutil.Databases(t, func(t *testing.T, db *dbx.DB) {
		if !db.HasTable("worker_task_leases") {
			t.Fatal("expected worker_task_leases after migration 006")
		}
		rt := &Runtime{DB: db, Social: &social.Handlers{DB: db}, WorkerID: "test-worker"}
		ownerA, ok := rt.acquireLease("media-cleanup")
		if !ok || ownerA == "" {
			t.Fatal("first acquire should succeed")
		}
		if _, ok := rt.acquireLease("media-cleanup"); ok {
			t.Fatal("second acquire should fail while lease held")
		}
		if !rt.ownsLease("media-cleanup", ownerA) {
			t.Fatal("owner should still hold lease")
		}
		rt.releaseLease("media-cleanup", ownerA)
		ownerB, ok := rt.acquireLease("media-cleanup")
		if !ok || ownerB == "" || ownerB == ownerA {
			t.Fatalf("reacquire after release failed: ok=%v owner=%s", ok, ownerB)
		}
		rt.releaseLease("media-cleanup", ownerB)

		ownerC, ok := rt.acquireLease("notifications")
		if !ok {
			t.Fatal("notifications lease")
		}
		past := time.Now().UTC().Add(-time.Minute).Format(time.RFC3339)
		testutil.Exec(t, db, `UPDATE worker_task_leases SET lease_expires_at=? WHERE task_name=?`, past, "notifications")
		if rt.ownsLease("notifications", ownerC) {
			t.Fatal("expired lease should not be owned")
		}
		ownerD, ok := rt.acquireLease("notifications")
		if !ok || ownerD == ownerC {
			t.Fatal("expired lease should be reclaimable")
		}
		rt.releaseLease("notifications", ownerD)
	})
}
