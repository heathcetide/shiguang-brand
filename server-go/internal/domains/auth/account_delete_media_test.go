// Copyright (c) 2026 heathcetide. All rights reserved.

package auth_test

import (
	"testing"

	"github.com/heathcetide/DietDigiDose/internal/dbx"
	"github.com/heathcetide/DietDigiDose/internal/domains/auth"
	"github.com/heathcetide/DietDigiDose/internal/expressauth"
	"github.com/heathcetide/DietDigiDose/internal/testutil"
	"golang.org/x/crypto/bcrypt"
)

func TestDeleteAccountEnqueuesMediaCleanup(t *testing.T) {
	testutil.Databases(t, func(t *testing.T, db *dbx.DB) {
		uid := testutil.User(t, db, "delete_media_user", "user")
		hash, err := bcrypt.GenerateFromPassword([]byte("Secret123!"), bcrypt.MinCost)
		if err != nil {
			t.Fatal(err)
		}
		testutil.Exec(t, db, `UPDATE users SET password_hash=? WHERE id=?`, string(hash), uid)
		if db.HasColumn("community_posts", "image_url") {
			testutil.Exec(t, db, `INSERT INTO community_posts (user_id, content, image_url) VALUES (?, 'bye', ?)`,
				uid, "/media/uploads/user-bye.jpg")
		} else {
			t.Skip("community_posts.image_url unavailable")
		}

		svc := &auth.Service{DB: db, Auth: expressauth.New(testutil.Secret, db)}
		out, err := svc.DeleteAccount(uid, "Secret123!")
		if err != nil {
			t.Fatal(err)
		}
		if out["deleted"] != true {
			t.Fatalf("expected deleted: %v", out)
		}
		if out["cleanupJobId"] == nil {
			t.Fatalf("expected cleanupJobId, got %v", out)
		}
		var status, urls string
		if err := db.QueryRow(`SELECT status, urls_json FROM media_cleanup_jobs WHERE id=?`, out["cleanupJobId"]).
			Scan(&status, &urls); err != nil {
			t.Fatal(err)
		}
		if status != "pending" || urls == "" || urls == "[]" {
			t.Fatalf("unexpected cleanup job status=%s urls=%s", status, urls)
		}
	})
}
