package auth_test

import (
	"testing"

	"github.com/heathcetide/DietDigiDose/internal/dbx"
	"github.com/heathcetide/DietDigiDose/internal/domains/auth"
	"github.com/heathcetide/DietDigiDose/internal/expressauth"
	"github.com/heathcetide/DietDigiDose/internal/testutil"
)

func TestEmailOnlyRecoveryRetainsPasswordAndSessionSafety(t *testing.T) {
	t.Setenv("NODE_ENV", "test")
	t.Setenv("APP_APP_ENVIRONMENT", "test")
	testutil.Databases(t, func(t *testing.T, db *dbx.DB) {
		s := auth.Service{DB: db, Auth: expressauth.New(testutil.Secret, db)}
		created, err := s.Register("email-only@example.test", "email-only", "InitialPass123")
		if err != nil {
			t.Fatal(err)
		}
		id := created["user"].(map[string]any)["id"].(int)
		readCode := func() string {
			var code string
			if err := db.QueryRow(`SELECT code FROM email_dev_outbox WHERE email='email-only@example.test' ORDER BY id DESC LIMIT 1`).Scan(&code); err != nil {
				t.Fatal(err)
			}
			return code
		}
		verification, err := s.SendEmailVerification(id, "InitialPass123")
		if err != nil {
			t.Fatal(err)
		}
		if _, err := s.VerifyEmailChallenge(verification["challengeId"].(string), readCode(), "email_verify", &id); err != nil {
			t.Fatal(err)
		}
		grant := func() string {
			sent, err := s.SendEmailRecovery("email-only@example.test")
			if err != nil {
				t.Fatal(err)
			}
			verified, err := s.VerifyEmailChallenge(sent["challengeId"].(string), readCode(), "email_recovery", nil)
			if err != nil {
				t.Fatal(err)
			}
			return verified["recoveryToken"].(string)
		}
		stale := grant()
		if _, err := s.RecoverPassword(stale, "ChangedPass123", "retired"); err == nil {
			t.Fatal("unsupported recovery channel accepted")
		}
		testutil.Exec(t, db, `UPDATE users SET session_version=session_version+1 WHERE id=?`, id)
		if _, err := s.RecoverPassword(stale, "ChangedPass123", "email"); err == nil {
			t.Fatal("stale recovery proof accepted")
		}
		proof := grant()
		if _, err := s.RecoverPassword(proof, "ChangedPass123", "email"); err != nil {
			t.Fatal(err)
		}
		if _, err := s.RecoverPassword(proof, "OtherPass123", "email"); err == nil {
			t.Fatal("replayed recovery proof accepted")
		}
		if _, err := s.Login("email-only@example.test", "InitialPass123", "127.0.0.1", "test"); err == nil {
			t.Fatal("old password still works")
		}
		if _, err := s.Login("email-only@example.test", "ChangedPass123", "127.0.0.1", "test"); err != nil {
			t.Fatal(err)
		}
		admin := testutil.User(t, db, "protected_admin", "admin")
		if _, err := s.DeleteAccount(admin, "anything"); err == nil {
			t.Fatal("administrator deletion accepted")
		}
	})
}
