// Copyright (c) 2026 heathcetide. All rights reserved.

package handlers

import (
	"net/http"
	"os"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
)

// chinaProviders mirrors server/src/providers/profiles.ts for the default china profile.
var chinaProviders = gin.H{
	"storage":      "local-filesystem",
	"notification": "expo-push",
	"auth":         "password-jwt",
	"analytics":    "server-events",
	"map":          "disabled",
	"payment":      "disabled",
}

var globalProviders = gin.H{
	"storage":      "supabase-storage",
	"notification": "expo-push",
	"auth":         "password-jwt",
	"analytics":    "server-events",
	"map":          "disabled",
	"payment":      "disabled",
}

// ApiHealth returns Express-compatible GET /api/v1/health (raw JSON, no response envelope).
func (h *Handlers) ApiHealth(c *gin.Context) {
	profile := strings.TrimSpace(h.cfg.Deployment.Profile)
	if profile == "" {
		profile = "china"
	}
	driver := strings.TrimSpace(h.DatabaseDriver)
	if driver == "" {
		driver = strings.TrimSpace(h.cfg.Deployment.DatabaseDriver)
	}
	if driver == "" {
		driver = h.cfg.Database.Driver
	}
	if driver == "" {
		driver = "sqlite"
	}

	providers := chinaProviders
	if strings.EqualFold(profile, "global") {
		providers = globalProviders
	}

	c.JSON(http.StatusOK, gin.H{
		"status":            "ok",
		"databaseDriver":    driver,
		"deploymentProfile": profile,
		"providers":         providers,
	})
}

// ApiVersion returns Express-compatible GET /api/v1/version (raw JSON).
func (h *Handlers) ApiVersion(c *gin.Context) {
	gitSha := h.info.GitCommit
	if gitSha == "none" || gitSha == "unknown" || gitSha == "" {
		gitSha = ""
	}
	var serverGitSha any
	if len(gitSha) == 40 {
		serverGitSha = gitSha
	} else {
		serverGitSha = nil
	}

	serverVersion := h.info.Version
	if serverVersion == "" || serverVersion == "dev" {
		if v := strings.TrimSpace(os.Getenv("SERVER_VERSION")); v != "" {
			serverVersion = v
		} else {
			serverVersion = "1.0.6"
		}
	}
	serverBuildTime := h.info.BuildTime
	if serverBuildTime == "" || serverBuildTime == "unknown" {
		if v := strings.TrimSpace(os.Getenv("SERVER_BUILD_TIME")); v != "" {
			serverBuildTime = v
		} else {
			serverBuildTime = "开发模式"
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"serverVersion":   serverVersion,
		"serverBuildTime": serverBuildTime,
		"serverGitSha":    serverGitSha,
		"clientVersion":   headerOrNull(c.GetHeader("x-client-version")),
		"clientBuildTime": headerOrNull(c.GetHeader("x-client-build-time")),
	})
}

// ApiAIDataPolicy returns Express-compatible GET /api/v1/ai-data-policy (raw JSON).
func (h *Handlers) ApiAIDataPolicy(c *gin.Context) {
	retention := 90
	if raw := strings.TrimSpace(os.Getenv("AI_CONVERSATION_RETENTION_DAYS")); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n >= 1 {
			retention = n
		}
	}

	providerPrivacy := strings.TrimSpace(os.Getenv("AI_PROVIDER_PRIVACY_URL"))
	var privacyURL any
	if providerPrivacy == "" {
		privacyURL = nil
	} else {
		privacyURL = providerPrivacy
	}

	providerName := strings.TrimSpace(os.Getenv("AI_PROVIDER_NAME"))
	if providerName == "" {
		providerName = "由部署运营方配置的 AI 模型服务商"
	}
	processingRegion := strings.TrimSpace(os.Getenv("AI_PROCESSING_REGION"))
	if processingRegion == "" {
		processingRegion = "以部署运营方正式披露为准"
	}
	supportContact := strings.TrimSpace(os.Getenv("PRIVACY_SUPPORT_CONTACT"))
	if supportContact == "" {
		supportContact = "应用商店开发者联系方式"
	}

	c.JSON(http.StatusOK, gin.H{
		"providerName":              providerName,
		"providerPrivacyUrl":        privacyURL,
		"processingRegion":          processingRegion,
		"conversationRetentionDays": retention,
		"supportContact":            supportContact,
	})
}

func headerOrNull(value string) any {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	return value
}
