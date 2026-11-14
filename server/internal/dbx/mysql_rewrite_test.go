package dbx

import "testing"

func TestRewriteMySQLConflict(t *testing.T) {
	got := Rewrite(`INSERT INTO t(a,b) VALUES (?,?) ON CONFLICT DO NOTHING`, "mysql")
	if got != `INSERT IGNORE INTO t(a,b) VALUES (?,?)` {
		t.Fatalf("ignore: %q", got)
	}
	got = Rewrite(`INSERT INTO t(a,b) VALUES (?,?) ON CONFLICT(a) DO UPDATE SET b=excluded.b`, "mysql")
	want := `INSERT INTO t(a,b) VALUES (?,?) ON DUPLICATE KEY UPDATE b=VALUES(b)`
	if got != want {
		t.Fatalf("upsert:\n got %q\nwant %q", got, want)
	}
	if Rewrite(`SELECT 1`, "sqlite") != `SELECT 1` {
		t.Fatal("non-mysql must be unchanged")
	}
}
