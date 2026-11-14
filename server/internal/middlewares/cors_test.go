package middlewares_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/heathcetide/DietDigiDose/internal/middlewares"
)

func TestCORSOriginsForLocalLoginPreflight(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, tc := range []struct {
		name, environment, configured, origin string
		status                                int
	}{
		{"Expo Web", "dev", "", "http://localhost:8080", 204},
		{"Expo Web loopback", "dev", "", "http://127.0.0.1:8080", 204},
		{"Expo fallback", "dev", "", "http://localhost:8081", 204},
		{"Expo fallback loopback", "dev", "", "http://127.0.0.1:8081", 204},
		{"admin", "dev", "", "http://localhost:5173", 204},
		{"admin loopback", "dev", "", "http://127.0.0.1:5173", 204},
		{"legacy Expo", "dev", "", "http://localhost:19006", 204},
		{"legacy Expo loopback", "dev", "", "http://127.0.0.1:19006", 204},
		{"unlisted port", "dev", "", "http://localhost:9999", 403},
		{"unlisted host", "dev", "", "https://evil.example.test", 403},
		{"lookalike host", "dev", "", "http://localhost.evil.example.test:8080", 403},
		{"production has no local fallback", "prod", "", "http://localhost:8080", 403},
		{"production explicit origin", "prod", "https://app.example.test", "https://app.example.test", 204},
		{"production rejects local origin", "prod", "https://app.example.test", "http://localhost:8080", 403},
		{"development override stays authoritative", "dev", "https://app.example.test", "http://localhost:8080", 403},
		{"development explicit origin", "dev", "https://app.example.test", "https://app.example.test", 204},
	} {
		t.Run(tc.name, func(t *testing.T) {
			origins := middlewares.ResolveCORSOrigins(tc.environment, tc.configured)
			security, err := middlewares.APISecurity(origins, "", false)
			if err != nil {
				t.Fatal(err)
			}
			r := gin.New()
			r.Use(security)
			r.Any("/api/v1/auth/login", func(c *gin.Context) {
				t.Error("preflight must not reach the login handler")
				c.Status(http.StatusInternalServerError)
			})
			req := httptest.NewRequest(http.MethodOptions, "/api/v1/auth/login", nil)
			req.Header.Set("Origin", tc.origin)
			req.Header.Set("Access-Control-Request-Method", "POST")
			req.Header.Set("Access-Control-Request-Headers", "content-type")
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)
			if w.Code != tc.status {
				t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
			}
			if tc.status == http.StatusNoContent {
				if w.Header().Get("Access-Control-Allow-Origin") != tc.origin {
					t.Fatal("allowed preflight must echo the exact origin")
				}
			} else if w.Header().Get("Access-Control-Allow-Origin") != "" {
				t.Fatal("rejected preflight must not allow an origin")
			}
		})
	}
}
