package middlewares_test

import (
	"crypto/tls"
	"github.com/gin-gonic/gin"
	"github.com/heathcetide/DietDigiDose/internal/middlewares"
	"net/http/httptest"
	"testing"
)

func TestAPISecurityOriginAndProxyBoundary(t *testing.T) {
	gin.SetMode(gin.TestMode)
	security, err := middlewares.APISecurity("https://app.example.test", "10.20.0.0/24", true)
	if err != nil {
		t.Fatal(err)
	}
	r := gin.New()
	r.Use(security)
	r.Any("/private", func(c *gin.Context) { c.Status(200) })
	r.GET("/api/v1/health", func(c *gin.Context) { c.Status(200) })
	for _, tc := range []struct {
		name, method, path, remote, origin, proto string
		tls                                       bool
		status                                    int
	}{
		{"health probe", "GET", "/api/v1/health", "127.0.0.1:1", "", "", false, 200},
		{"reject HTTP", "GET", "/private", "127.0.0.1:1", "", "", false, 426},
		{"spoofed forwarded TLS", "GET", "/private", "192.0.2.1:1", "", "https", false, 426},
		{"trusted proxy", "GET", "/private", "10.20.0.2:1", "https://app.example.test", "https", false, 200},
		{"bad origin", "GET", "/private", "10.20.0.2:1", "https://evil.example.test", "https", false, 403},
		{"native HTTPS", "GET", "/private", "192.0.2.1:1", "", "", true, 200},
		{"preflight", "OPTIONS", "/private", "10.20.0.2:1", "https://app.example.test", "https", false, 204},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(tc.method, tc.path, nil)
			req.RemoteAddr = tc.remote
			req.Header.Set("Origin", tc.origin)
			req.Header.Set("X-Forwarded-Proto", tc.proto)
			if tc.tls {
				req.TLS = &tls.ConnectionState{}
			}
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)
			if w.Code != tc.status {
				t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
			}
			if tc.origin == "https://app.example.test" && w.Code < 300 && w.Header().Get("Access-Control-Allow-Origin") != tc.origin {
				t.Fatal("allowed CORS origin not echoed")
			}
		})
	}
	if _, err := middlewares.APISecurity("", "not-a-cidr", true); err == nil {
		t.Fatal("invalid proxy network accepted")
	}
}
