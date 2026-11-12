package db_test

import (
	"path/filepath"
	"strings"
	"testing"

	appdb "github.com/heathcetide/DietDigiDose/internal/db"
	"github.com/heathcetide/DietDigiDose/internal/dbx"
	"github.com/heathcetide/DietDigiDose/internal/testutil"
	"golang.org/x/crypto/bcrypt"
)

func TestMigrationsAndAdminBootstrap(t *testing.T) {
	testutil.Databases(t, func(t *testing.T, db *dbx.DB) {
		if n := testutil.Count(t, db, "users"); n != 0 {
			t.Fatal("migrations must not seed users")
		}
		if err := appdb.BootstrapAdmin(db, ""); err != nil {
			t.Fatal(err)
		}
		if n := testutil.Count(t, db, "users"); n != 0 {
			t.Fatal("empty password created an admin")
		}
		if err := appdb.BootstrapAdmin(db, "short"); err == nil {
			t.Fatal("weak bootstrap password accepted")
		}
		if err := appdb.BootstrapAdmin(db, "BootstrapOnly123!"); err != nil {
			t.Fatal(err)
		}
		var before string
		var mustChange int
		if err := db.QueryRow(`SELECT password_hash,must_change_password FROM users WHERE username='admin' AND role='admin'`).Scan(&before, &mustChange); err != nil {
			t.Fatal(err)
		}
		if mustChange != 1 || bcrypt.CompareHashAndPassword([]byte(before), []byte("BootstrapOnly123!")) != nil {
			t.Fatal("admin bootstrap credentials are incorrect")
		}
		if err := appdb.BootstrapAdmin(db, "DoNotOverwrite123!"); err != nil {
			t.Fatal(err)
		}
		if err := appdb.Migrate(db); err != nil {
			t.Fatal(err)
		}
		var after string
		if err := db.QueryRow(`SELECT password_hash FROM users WHERE username='admin'`).Scan(&after); err != nil {
			t.Fatal(err)
		}
		if before != after || testutil.Count(t, db, "users") != 1 {
			t.Fatal("repeat migration/bootstrap changed existing account")
		}
		if n := testutil.Count(t, db, "go_schema_migrations"); n != 4 {
			t.Fatalf("migration count=%d", n)
		}
		if err := appdb.CheckSchema(db); err != nil {
			t.Fatal(err)
		}
		testutil.Exec(t, db, `UPDATE go_schema_migrations SET checksum='tampered' WHERE version=?`, "001_core.sql")
		if err := appdb.CheckSchema(db); err == nil {
			t.Fatal("read-only schema verification accepted a changed checksum")
		}
		if err := appdb.Migrate(db); err == nil {
			t.Fatal("modified migration checksum accepted")
		}
	})
}
func TestLegacyExpressPostgresSchemaIsRejectedWithoutChangingUsers(t *testing.T) {
	testutil.Databases(t, func(t *testing.T, db *dbx.DB) {
		if db.Dialect != "postgresql" {
			return
		}
		id := testutil.User(t, db, "preserved_legacy", "user")
		// Simulate the native boolean representation that distinguishes Express PG.
		testutil.Exec(t, db, `ALTER TABLE users ALTER COLUMN is_disabled DROP DEFAULT`)
		testutil.Exec(t, db, `ALTER TABLE users ALTER COLUMN is_disabled TYPE BOOLEAN USING (is_disabled<>0)`)
		if err := appdb.Migrate(db); err == nil || !strings.Contains(err.Error(), "legacy Express PostgreSQL schema") {
			t.Fatalf("legacy schema was not refused: %v", err)
		}
		var name string
		if err := db.QueryRow(`SELECT username FROM users WHERE id=?`, id).Scan(&name); err != nil || name != "preserved_legacy" {
			t.Fatalf("migration changed existing user: %s %v", name, err)
		}
	})
}

func TestLegacySQLiteUpgradePreservesRows(t *testing.T) {
	db, _, err := appdb.Open("sqlite", filepath.Join(t.TempDir(), "old.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	testutil.Exec(t, db, `CREATE TABLE inventory_items(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER,food_name TEXT,category TEXT,quantity TEXT,expiration_date TEXT,storage_location TEXT,image_url TEXT,is_available INTEGER,version INTEGER,quantity_value TEXT,quantity_unit TEXT,note TEXT,deleted_at TEXT,created_at TEXT)`)
	testutil.Exec(t, db, `INSERT INTO inventory_items(user_id,food_name,quantity) VALUES (1,'preserved','3')`)
	if err := appdb.Migrate(db); err != nil {
		t.Fatal(err)
	}
	var name string
	if err := db.QueryRow(`SELECT food_name FROM inventory_items WHERE id=1`).Scan(&name); err != nil || name != "preserved" {
		t.Fatalf("existing row changed: %q %v", name, err)
	}
	if !db.HasColumn("inventory_items", "batch_code") || !db.HasColumn("inventory_items", "updated_at") {
		t.Fatal("additive columns missing")
	}
}
