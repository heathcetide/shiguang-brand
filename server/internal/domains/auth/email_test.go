package auth_test

import (
	"errors"
	"github.com/heathcetide/DietDigiDose/internal/dbx"
	"github.com/heathcetide/DietDigiDose/internal/domains/auth"
	"github.com/heathcetide/DietDigiDose/internal/expressauth"
	"github.com/heathcetide/DietDigiDose/internal/testutil"
	"testing"
)

func TestExpiredEmailChallengeCannotVerify(t *testing.T) {
	t.Setenv("NODE_ENV", "test")
	t.Setenv("APP_APP_ENVIRONMENT", "test")
	testutil.Databases(t, func(t *testing.T, db *dbx.DB) {
		s := auth.Service{DB: db, Auth: expressauth.New(testutil.Secret, db)}
		registered, err := s.Register("expired@example.test", "expired", "Initial123!")
		if err != nil {
			t.Fatal(err)
		}
		uid := registered["user"].(map[string]any)["id"].(int)
		challenge, err := s.SendEmailVerification(uid, "Initial123!")
		if err != nil {
			t.Fatal(err)
		}
		var code string
		if err := db.QueryRow(`SELECT code FROM email_dev_outbox WHERE email=? ORDER BY id DESC LIMIT 1`, "expired@example.test").Scan(&code); err != nil {
			t.Fatal(err)
		}
		id := challenge["challengeId"].(string)
		testutil.Exec(t, db, `UPDATE email_auth_challenges SET expires_at='2000-01-01T00:00:00Z' WHERE id=?`, id)
		_, err = s.VerifyEmailChallenge(id, code, "email_verify", &uid)
		var apiErr *auth.APIError
		if !errors.As(err, &apiErr) || apiErr.Status != 400 {
			t.Fatalf("expired challenge accepted: %v", err)
		}
		var n int
		if err := db.QueryRow(`SELECT COUNT(*) FROM users WHERE id=? AND email_verified_at IS NOT NULL`, uid).Scan(&n); err != nil || n != 0 {
			t.Fatal("expired challenge verified the account")
		}
	})
}
func TestProductionEmailDoesNotPretendDevOutboxIsDelivery(t *testing.T) {
	t.Setenv("NODE_ENV", "production")
	testutil.Databases(t, func(t *testing.T, db *dbx.DB) {
		s := auth.Service{DB: db, Auth: expressauth.New(testutil.Secret, db)}
		_, err := s.SendEmailRecovery("synthetic@example.test")
		var apiErr *auth.APIError
		if !errors.As(err, &apiErr) || apiErr.Status != 503 {
			t.Fatalf("unsupported delivery reported success: %v", err)
		}
		if testutil.Count(t, db, "email_dev_outbox") != 0 {
			t.Fatal("production code written to plaintext development outbox")
		}
	})
}
