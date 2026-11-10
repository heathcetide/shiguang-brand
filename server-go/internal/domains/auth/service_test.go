package auth_test

import (
	"errors"
	"net/http"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/heathcetide/DietDigiDose/internal/dbx"
	"github.com/heathcetide/DietDigiDose/internal/domains/auth"
	"github.com/heathcetide/DietDigiDose/internal/expressauth"
	"github.com/heathcetide/DietDigiDose/internal/testutil"
)

func TestRegistrationLoginAndSessionRevocation(t *testing.T) {
	testutil.Databases(t, func(t *testing.T, db *dbx.DB) {
		a := expressauth.New(testutil.Secret, db)
		s := auth.Service{DB: db, Auth: a}
		registered, err := s.Register("person@example.test", "person", "Initial123!")
		if err != nil {
			t.Fatal(err)
		}
		uid := registered["user"].(map[string]any)["id"].(int)
		if uid <= 0 {
			t.Fatal("registration returned invalid id")
		}
		if _, err := s.Register("person@example.test", "different", "Initial123!"); err == nil {
			t.Fatal("duplicate identifier accepted")
		}
		if _, err := s.Login("person@example.test", "wrong", "127.0.0.1", "test"); err == nil {
			t.Fatal("wrong password accepted")
		}
		login, err := s.Login("person@example.test", "Initial123!", "127.0.0.1", "test")
		if err != nil {
			t.Fatal(err)
		}
		r := testutil.Router()
		r.GET("/protected", a.Middleware(), func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"ok": true}) })
		old := login["token"].(string)
		testutil.Request(t, r, "GET", "/protected", old, nil, 200)
		if _, err := s.ChangePassword(uid, "Initial123!", "Updated456!"); err != nil {
			t.Fatal(err)
		}
		testutil.Request(t, r, "GET", "/protected", old, nil, 401)
		next, err := s.Login("person@example.test", "Updated456!", "127.0.0.1", "test")
		if err != nil {
			t.Fatal(err)
		}
		testutil.Request(t, r, "GET", "/protected", next["token"].(string), nil, 200)
		testutil.Exec(t, db, `UPDATE users SET is_disabled=1 WHERE id=?`, uid)
		_, err = s.Login("person@example.test", "Updated456!", "127.0.0.1", "test")
		var apiErr *auth.APIError
		if !errors.As(err, &apiErr) || apiErr.Status != 403 {
			t.Fatalf("disabled login: %v", err)
		}
		testutil.Request(t, r, "GET", "/protected", next["token"].(string), nil, 403)
	})
}
