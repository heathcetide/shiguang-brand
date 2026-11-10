package admin_test

import (
	"fmt"
	"github.com/heathcetide/DietDigiDose/internal/dbx"
	"github.com/heathcetide/DietDigiDose/internal/domains/admin"
	"github.com/heathcetide/DietDigiDose/internal/expressauth"
	"github.com/heathcetide/DietDigiDose/internal/testutil"
	"golang.org/x/crypto/bcrypt"
	"testing"
)

func TestAuthorizationCredentialsAndPortableReports(t *testing.T) {
	testutil.Databases(t, func(t *testing.T, db *dbx.DB) {
		uid := testutil.User(t, db, "regular", "user")
		aid := testutil.User(t, db, "administrator", "admin")
		token := testutil.Token(t, db, uid)
		at := testutil.Token(t, db, aid)
		r := testutil.Router()
		a := expressauth.New(testutil.Secret, db)
		(&admin.Handlers{DB: db, Auth: a}).RegisterOn(r)
		testutil.Request(t, r, "GET", "/api/v1/admin/stats", "", nil, 401)
		testutil.Request(t, r, "GET", "/api/v1/admin/stats", token, nil, 403)
		stats := testutil.Request(t, r, "GET", "/api/v1/admin/stats", at, nil, 200).(map[string]any)
		if stats["users"] != float64(2) {
			t.Fatalf("incorrect stats: %v", stats)
		}
		testutil.Request(t, r, "PUT", fmt.Sprintf("/api/v1/admin/users/%d/credentials", uid), at, map[string]any{"newPassword": "Reset456!"}, 200)
		var hash string
		var version int
		if err := db.QueryRow(`SELECT password_hash,session_version FROM users WHERE id=?`, uid).Scan(&hash, &version); err != nil {
			t.Fatal(err)
		}
		if bcrypt.CompareHashAndPassword([]byte(hash), []byte("Reset456!")) != nil || version != 2 {
			t.Fatal("credential reset did not revoke sessions")
		}
		testutil.Request(t, r, "GET", "/api/v1/admin/stats", token, nil, 401)
		testutil.Exec(t, db, `INSERT INTO ai_usage_logs(user_id,endpoint,model,total_tokens,prompt_tokens,completion_tokens,estimated_cost_usd) VALUES (?,?,?,?,?,?,?)`, uid, "chat", "fake", 30, 20, 10, 0.125)
		report := testutil.Request(t, r, "GET", "/api/v1/admin/ai-usage?range=7d", at, nil, 200).(map[string]any)
		summary := report["summary"].(map[string]any)
		if summary["requests"] != float64(1) || summary["totalTokens"] != float64(30) || summary["estimatedCostUsd"] != 0.125 {
			t.Fatalf("SQL report/alias mismatch: %v", report)
		}
		trends := testutil.Request(t, r, "GET", "/api/v1/admin/stats/trends", at, nil, 200).([]any)
		if len(trends) != 7 {
			t.Fatal("missing daily trends")
		}
	})
}
