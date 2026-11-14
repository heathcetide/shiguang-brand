// Package testutil never opens a default application database. SQLite files live
// under t.TempDir; PostgreSQL uses a random schema on an explicitly supplied URL.
package testutil

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"testing"

	"github.com/gin-gonic/gin"
	appdb "github.com/heathcetide/DietDigiDose/internal/db"
	"github.com/heathcetide/DietDigiDose/internal/dbx"
	"github.com/heathcetide/DietDigiDose/internal/expressauth"
)

const Secret = "isolated-go-tests-only-secret-at-least-32-bytes"

func Databases(t *testing.T, run func(*testing.T, *dbx.DB)) {
	t.Helper()
	t.Run("sqlite", func(t *testing.T) {
		db, _, err := appdb.Open("sqlite", filepath.Join(t.TempDir(), "isolated.db"))
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { db.Close() })
		if err := appdb.Migrate(db); err != nil {
			t.Fatal(err)
		}
		run(t, db)
	})
	t.Run("postgresql", func(t *testing.T) {
		dsn := os.Getenv("GO_TEST_POSTGRES_URL")
		if dsn == "" {
			if os.Getenv("GO_REQUIRE_POSTGRES") == "1" {
				t.Fatal("GO_TEST_POSTGRES_URL is required")
			}
			t.Skip("set GO_TEST_POSTGRES_URL to an isolated PostgreSQL test service")
		}
		control, _, err := appdb.Open("postgresql", dsn)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { control.Close() })
		var buf [12]byte
		if _, err := rand.Read(buf[:]); err != nil {
			t.Fatal(err)
		}
		schema := "go_test_" + hex.EncodeToString(buf[:])
		if _, err := control.Exec("CREATE SCHEMA " + schema); err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() {
			if _, err := control.Exec("DROP SCHEMA " + schema + " CASCADE"); err != nil {
				t.Errorf("clean test schema: %v", err)
			}
		})
		u, err := url.Parse(dsn)
		if err != nil {
			t.Fatal(err)
		}
		q := u.Query()
		q.Set("search_path", schema)
		u.RawQuery = q.Encode()
		db, _, err := appdb.Open("postgresql", u.String())
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { db.Close() })
		if err := appdb.Migrate(db); err != nil {
			t.Fatal(err)
		}
		run(t, db)
	})
}

func User(t *testing.T, db *dbx.DB, name, role string) int {
	t.Helper()
	id, err := db.InsertID(`INSERT INTO users(username, email, role) VALUES (?, ?, ?)`, name, name+"@example.test", role)
	if err != nil {
		t.Fatal(err)
	}
	return int(id)
}
func Token(t *testing.T, db *dbx.DB, userID int) string {
	t.Helper()
	token, err := expressauth.New(Secret, db).Sign(userID, 1)
	if err != nil {
		t.Fatal(err)
	}
	return token
}
func Router() *gin.Engine { gin.SetMode(gin.TestMode); return gin.New() }
func Request(t *testing.T, router http.Handler, method, path, token string, body any, status int) any {
	t.Helper()
	raw, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(method, path, bytes.NewReader(raw))
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	res := httptest.NewRecorder()
	router.ServeHTTP(res, req)
	if res.Code != status {
		t.Fatalf("%s %s: status=%d, want=%d, body=%s", method, path, res.Code, status, res.Body.String())
	}
	if res.Body.Len() == 0 {
		return nil
	}
	var out any
	if err := json.Unmarshal(res.Body.Bytes(), &out); err != nil {
		t.Fatalf("%s %s invalid JSON: %s", method, path, res.Body.String())
	}
	return out
}
func Exec(t *testing.T, db *dbx.DB, query string, args ...any) {
	t.Helper()
	if _, err := db.Exec(query, args...); err != nil {
		t.Fatal(err)
	}
}
func Count(t *testing.T, db *dbx.DB, table string) int {
	t.Helper()
	var n int
	if err := db.QueryRow("SELECT COUNT(*) FROM " + table).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}
