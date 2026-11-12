// Copyright (c) 2026 heathcetide. All rights reserved.

package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/heathcetide/DietDigiDose/internal/configs"
)

func TestApiHealthShape(t *testing.T) {
	gin.SetMode(gin.TestMode)
	cfg := configs.Default()
	h := New(cfg, AppInfo{Name: "Shiwei Daily", Version: "1.0.6", BuildTime: "开发模式", GitCommit: "none"}, nil)

	r := gin.New()
	r.GET("/api/v1/health", h.ApiHealth)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/health", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body["status"] != "ok" {
		t.Fatalf("status=%v", body["status"])
	}
	if body["databaseDriver"] != "sqlite" {
		t.Fatalf("databaseDriver=%v", body["databaseDriver"])
	}
	if body["deploymentProfile"] != "china" {
		t.Fatalf("deploymentProfile=%v", body["deploymentProfile"])
	}
	providers, ok := body["providers"].(map[string]any)
	if !ok || providers["storage"] != "local-filesystem" {
		t.Fatalf("providers=%v", body["providers"])
	}
	if _, hasCode := body["code"]; hasCode {
		t.Fatal("must not wrap with response envelope")
	}
}

func TestApiVersionShape(t *testing.T) {
	gin.SetMode(gin.TestMode)
	cfg := configs.Default()
	h := New(cfg, AppInfo{
		Name:      "Shiwei Daily",
		Version:   "1.0.6",
		BuildTime: "开发模式",
		GitCommit: "none",
	}, nil)

	r := gin.New()
	r.GET("/api/v1/version", h.ApiVersion)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/version", nil)
	req.Header.Set("x-client-version", "1.0.6")
	req.Header.Set("x-client-build-time", time.Now().Format(time.RFC3339))
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body["serverVersion"] != "1.0.6" {
		t.Fatalf("serverVersion=%v", body["serverVersion"])
	}
	if body["clientVersion"] != "1.0.6" {
		t.Fatalf("clientVersion=%v", body["clientVersion"])
	}
	if body["serverGitSha"] != nil {
		t.Fatalf("serverGitSha should be null for non-sha commit, got %v", body["serverGitSha"])
	}
}

func TestApiAIDataPolicyShape(t *testing.T) {
	gin.SetMode(gin.TestMode)
	cfg := configs.Default()
	h := New(cfg, AppInfo{Version: "1.0.6"}, nil)

	r := gin.New()
	r.GET("/api/v1/ai-data-policy", h.ApiAIDataPolicy)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/ai-data-policy", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body["conversationRetentionDays"].(float64) != 90 {
		t.Fatalf("retention=%v", body["conversationRetentionDays"])
	}
	if body["providerPrivacyUrl"] != nil {
		t.Fatalf("providerPrivacyUrl=%v", body["providerPrivacyUrl"])
	}
}
