package dbx_test

import (
	"context"
	"database/sql"
	"errors"
	"testing"

	"github.com/heathcetide/DietDigiDose/internal/dbx"
	"github.com/heathcetide/DietDigiDose/internal/testutil"
)

func TestBind(t *testing.T) {
	for _, tc := range []struct{ in, want string }{
		{`SELECT ?,'?',"?",'it''s ?' -- ?
, ? /* ? /* ? */ ? */`, `SELECT $1,'?',"?",'it''s ?' -- ?
, $2 /* ? /* ? */ ? */`},
		{`SELECT $$?$$, $body$?$body$, ?`, `SELECT $$?$$, $body$?$body$, $1`},
		{`SELECT ?, ?, ?`, `SELECT $1, $2, $3`},
	} {
		if got := dbx.Bind(tc.in, "postgresql"); got != tc.want {
			t.Errorf("Bind(%q)=%q, want %q", tc.in, got, tc.want)
		}
		if got := dbx.Bind(tc.in, "sqlite"); got != tc.in {
			t.Errorf("SQLite query changed")
		}
	}
}
func TestPortableSQLAndTransactions(t *testing.T) {
	testutil.Databases(t, func(t *testing.T, db *dbx.DB) {
		if !db.HasTable("users") || !db.HasColumn("users", "role") || db.HasColumn("users", "missing") || db.HasTable("missing") {
			t.Fatal("database introspection is incorrect")
		}
		id := testutil.User(t, db, "sql_boundary", "user")
		if id <= 0 {
			t.Fatal("INSERT RETURNING did not return a positive id")
		}
		testutil.Exec(t, db, `INSERT INTO system_settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, "quoted?key", "first")
		testutil.Exec(t, db, `INSERT INTO system_settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, "quoted?key", "second'")
		var value string
		if err := db.QueryRow(`SELECT value FROM system_settings WHERE key=? AND '?'='?'`, "quoted?key").Scan(&value); err != nil || value != "second'" {
			t.Fatalf("parameter binding: %q %v", value, err)
		}
		tx, err := db.Begin()
		if err != nil {
			t.Fatal(err)
		}
		txID, err := tx.InsertID(`INSERT INTO inventory_items(user_id,food_name,category,quantity,expiration_date) VALUES (?,?,?,?,?)`, id, "rollback", "蔬菜", "1", "2030-01-01")
		if err != nil || txID <= 0 {
			t.Fatalf("transaction insert: %d %v", txID, err)
		}
		if err := tx.Rollback(); err != nil {
			t.Fatal(err)
		}
		if n := testutil.Count(t, db, "inventory_items"); n != 0 {
			t.Fatalf("rollback left %d rows", n)
		}
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		if _, err := db.ExecContext(ctx, `SELECT ?`, 1); !errors.Is(err, context.Canceled) {
			t.Fatalf("context cancellation not preserved: %v", err)
		}
		if err := db.QueryRow(`SELECT id FROM users WHERE id=?`, -1).Scan(new(int)); !errors.Is(err, sql.ErrNoRows) {
			t.Fatalf("no rows error changed: %v", err)
		}
	})
}
