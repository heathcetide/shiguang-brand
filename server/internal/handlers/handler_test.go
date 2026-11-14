// Copyright (c) 2026 heathcetide. All rights reserved.

package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/heathcetide/DietDigiDose/internal/configs"
	"github.com/heathcetide/DietDigiDose/pkg/apidocs"
)

func init() {
	gin.SetMode(gin.TestMode)
}

func newTestRouter(t *testing.T) *gin.Engine {
	t.Helper()
	return newTestRouterWithOptions(t, true)
}

func newTestRouterWithOptions(t *testing.T, scaffoldEnabled bool) *gin.Engine {
	t.Helper()
	cfg := configs.Default()
	cfg.Scaffold.Enabled = scaffoldEnabled
	r := gin.New()
	h := New(cfg, AppInfo{Name: "test", Version: "0.0.0-test", BuildTime: "开发模式"}, nil)
	api := apidocs.Mount(r, apidocs.Options{Title: "test", Version: "0.0.0-test"})
	h.Register(r, api)
	return r
}

func TestHealth(t *testing.T) {
	r := newTestRouter(t)

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var body map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	data, ok := body["data"].(map[string]any)
	if !ok {
		t.Fatalf("expected data object, got %v", body["data"])
	}
	if data["status"] != "healthy" {
		t.Errorf("expected status=healthy, got %v", data["status"])
	}
}

func TestLiveness(t *testing.T) {
	r := newTestRouter(t)
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/live", nil)
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}

func TestReadiness(t *testing.T) {
	r := newTestRouter(t)
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/ready", nil)
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}

func TestVersion(t *testing.T) {
	r := newTestRouter(t)
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/version", nil)
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	var body map[string]any
	json.Unmarshal(w.Body.Bytes(), &body)
	if body["serverVersion"] != "0.0.0-test" {
		t.Errorf("expected serverVersion=0.0.0-test, got %v", body["serverVersion"])
	}
	if _, wrapped := body["data"]; wrapped {
		t.Fatal("Express-compatible version must not use response envelope")
	}
}

func TestScaffoldDisabledHidesUsers(t *testing.T) {
	r := newTestRouterWithOptions(t, false)
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/users", nil)
	r.ServeHTTP(w, req)
	if w.Code == http.StatusOK {
		t.Fatalf("scaffold users route should be unavailable, body=%s", w.Body.String())
	}
}

func TestListUsers(t *testing.T) {
	r := newTestRouter(t)
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/users?page=1&size=10", nil)
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}

func TestCreateUser_InvalidEmail(t *testing.T) {
	r := newTestRouter(t)
	body := `{"username":"test","email":"not-an-email","password":"secret123"}`
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/users", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	// humax runs Gin handler; common/response returns HTTP 200 + error in body
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 (error in body), got %d", w.Code)
	}
	var resp map[string]any
	json.Unmarshal(w.Body.Bytes(), &resp)
	if resp["error"] != "BAD_REQUEST" {
		t.Errorf("expected error=BAD_REQUEST, got %v", resp["error"])
	}
}

func TestCreateUser_MissingName(t *testing.T) {
	r := newTestRouter(t)
	body := `{"email":"test@example.com","password":"secret123"}`
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/users", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 (error in body), got %d", w.Code)
	}
	var resp map[string]any
	json.Unmarshal(w.Body.Bytes(), &resp)
	if resp["error"] != "BAD_REQUEST" {
		t.Errorf("expected error=BAD_REQUEST, got %v", resp["error"])
	}
}

func TestCreateUser_Valid(t *testing.T) {
	r := newTestRouter(t)
	body := `{"username":"charlie","email":"charlie@example.com","password":"secret123"}`
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/users", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	// No DB in test mode, so CreateUser returns SERVICE_UNAVAILABLE
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d; body: %s", w.Code, w.Body.String())
	}
	var resp map[string]any
	json.Unmarshal(w.Body.Bytes(), &resp)
	if resp["error"] != "SERVICE_UNAVAILABLE" {
		t.Errorf("expected error=SERVICE_UNAVAILABLE (no DB in test), got %v", resp["error"])
	}
}

func TestGetUser_InvalidID(t *testing.T) {
	r := newTestRouter(t)
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/users/abc", nil)
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 (error in body), got %d", w.Code)
	}
	var body map[string]any
	json.Unmarshal(w.Body.Bytes(), &body)
	if body["error"] != "BAD_REQUEST" {
		t.Errorf("expected error=BAD_REQUEST, got %v", body["error"])
	}
}

func TestLogin_JWTDisabled(t *testing.T) {
	r := newTestRouter(t) // JWT disabled in default config
	body := `{"username":"admin","password":"secret123"}`
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	// humax runs Gin handler; common/response returns HTTP 200 + error in body
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 (error in body), got %d", w.Code)
	}
	var resp map[string]any
	json.Unmarshal(w.Body.Bytes(), &resp)
	if resp["error"] != "SERVICE_UNAVAILABLE" {
		t.Errorf("expected error=SERVICE_UNAVAILABLE, got %v", resp["error"])
	}
}

func TestRefresh_JWTDisabled(t *testing.T) {
	r := newTestRouter(t)
	body := `{"refresh_token":"some-token"}`
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/refresh", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 (error in body), got %d", w.Code)
	}
	var resp map[string]any
	json.Unmarshal(w.Body.Bytes(), &resp)
	if resp["error"] != "SERVICE_UNAVAILABLE" {
		t.Errorf("expected error=SERVICE_UNAVAILABLE, got %v", resp["error"])
	}
}

func TestOpenAPIContainsRoutes(t *testing.T) {
	r := newTestRouter(t)
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/openapi.json", nil)
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var spec map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &spec); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}

	paths, ok := spec["paths"].(map[string]any)
	if !ok {
		t.Fatal("no paths in OpenAPI spec")
	}

	expectedPaths := []string{
		"/health", "/live", "/ready",
		"/api/v1/health", "/api/v1/version", "/api/v1/ai-data-policy",
		"/api/v1/users", "/api/v1/users/{id}",
	}
	for _, p := range expectedPaths {
		if _, ok := paths[p]; !ok {
			t.Errorf("OpenAPI spec missing path: %s", p)
		}
	}
}
