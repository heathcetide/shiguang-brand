package db_test

import (
	"testing"

	appdb "github.com/heathcetide/DietDigiDose/internal/db"
	"github.com/heathcetide/DietDigiDose/internal/dbx"
	"github.com/heathcetide/DietDigiDose/internal/testutil"
)

func TestVerificationRetirementPreservesAccounts(t *testing.T) {
	testutil.Databases(t, func(t *testing.T, db *dbx.DB) {
		id := testutil.User(t, db, "retained_account", "user")
		testutil.Exec(t, db, `UPDATE users SET password_hash='synthetic-preserved-hash' WHERE id=?`, id)
		var before string
		if err := db.QueryRow(`SELECT password_hash FROM users WHERE id=?`, id).Scan(&before); err != nil {
			t.Fatal(err)
		}
		testutil.Exec(t, db, `DELETE FROM go_schema_migrations WHERE version='003_retire_phone_verification.sql'`)
		for _, table := range []string{"sms_events", "sms_logs", "sms_auth_challenges", "sms_dev_outbox", "account_reauth_grants", "auth_verification_subjects", "auth_verification_challenges", "auth_verification_events", "auth_verification_usage_daily"} {
			testutil.Exec(t, db, "CREATE TABLE "+table+" (id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id))")
			testutil.Exec(t, db, "INSERT INTO "+table+" (id,user_id) VALUES (1,?)", id)
		}
		testutil.Exec(t, db, `INSERT INTO system_settings(key,value) VALUES ('auth.sms.enabled','1'),('retained.setting','kept')`)
		if err := appdb.Migrate(db); err != nil {
			t.Fatal(err)
		}
		for _, table := range []string{"sms_events", "sms_logs", "sms_auth_challenges", "sms_dev_outbox", "account_reauth_grants", "auth_verification_subjects", "auth_verification_challenges", "auth_verification_events", "auth_verification_usage_daily"} {
			if db.HasTable(table) {
				t.Fatalf("retired table remains: %s", table)
			}
		}
		var after string
		if err := db.QueryRow(`SELECT password_hash FROM users WHERE id=? AND username='retained_account' AND role='user'`, id).Scan(&after); err != nil || before != after {
			t.Fatalf("existing account changed: %v", err)
		}
		var count int
		if err := db.QueryRow(`SELECT COUNT(*) FROM system_settings WHERE key LIKE 'auth.sms.%'`).Scan(&count); err != nil || count != 0 {
			t.Fatal("retired settings remain")
		}
		if err := db.QueryRow(`SELECT COUNT(*) FROM system_settings WHERE key='retained.setting' AND value='kept'`).Scan(&count); err != nil || count != 1 {
			t.Fatal("unrelated setting removed")
		}
		if err := appdb.CheckSchema(db); err != nil {
			t.Fatal(err)
		}
	})
}
