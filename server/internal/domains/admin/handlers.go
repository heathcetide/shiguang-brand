// Copyright (c) 2026 heathcetide. All rights reserved.

package admin

import (
	"encoding/json"
	"github.com/heathcetide/DietDigiDose/internal/dbx"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/heathcetide/DietDigiDose/internal/expressauth"
	"github.com/heathcetide/DietDigiDose/internal/httpx"
)

// Handlers implements /api/v1/admin for the Go gateway.
type Handlers struct {
	DB   *dbx.DB
	Auth *expressauth.Auth
}

func (h *Handlers) RegisterOn(engine *gin.Engine) {
	admin := engine.Group("/api/v1/admin")
	admin.Use(h.Auth.Middleware(), h.requireAdmin())
	{
		admin.GET("/dashboard", h.Dashboard)
		admin.GET("/site-settings", h.SiteSettingsGet)
		admin.PUT("/site-settings", h.SiteSettingsPut)

		admin.GET("/users", h.ListUsers)
		admin.GET("/users/:id/health-profile", h.UserHealthProfileGet)
		admin.PUT("/users/:id/role", h.UserRolePut)
		admin.PUT("/users/:id/status", h.UserStatusPut)
		admin.PUT("/users/:id/credentials", h.UserCredentialsPut)
		admin.PUT("/users/:id/expert", h.UserExpertPut)
		admin.POST("/users/:id/level-adjustments", h.UserLevelAdjustmentPost)
		admin.GET("/user-level-rule", h.UserLevelRuleGet)
		admin.PUT("/user-level-rule", h.UserLevelRulePut)

		admin.GET("/recipes/governance/coverage", h.RecipesGovernanceCoverage)
		admin.GET("/recipes", h.ListRecipes)
		admin.POST("/recipes", h.CreateRecipe)
		admin.PUT("/recipes/:id", h.UpdateRecipe)
		admin.DELETE("/recipes/:id", h.DeleteRecipe)
		admin.PUT("/recipes/:id/kitchenware", h.RecipeKitchenwarePut)
		admin.POST("/recipes/:id/duplicates/scan", h.RecipeDuplicatesScan)
		admin.POST("/recipes/:id/approve", h.RecipeApprove)
		admin.POST("/recipes/:id/reject", h.RecipeReject)
		admin.PUT("/recipes/:id/quality", h.RecipeQualityPut)
		admin.GET("/recipes/:id/execution", h.RecipeExecutionGet)
		admin.PUT("/recipes/:id/execution", h.RecipeExecutionPut)

		admin.GET("/community", h.ListCommunity)
		admin.DELETE("/community/:id", h.DeleteCommunity)
		admin.GET("/community/:id/comments", h.CommunityComments)
		admin.DELETE("/community/comments/:id", h.DeleteCommunityComment)
		admin.PUT("/community/:id/event", h.CommunityEventPut)
		admin.PUT("/community/:id/question", h.CommunityQuestionPut)

		admin.GET("/kitchenware/catalog", h.KitchenwareCatalogList)
		admin.POST("/kitchenware/catalog", h.KitchenwareCatalogCreate)
		admin.PUT("/kitchenware/catalog/:id", h.KitchenwareCatalogUpdate)
		admin.DELETE("/kitchenware/catalog/:id", h.KitchenwareCatalogDelete)
		admin.GET("/kitchenware/mapping-reviews", h.KitchenwareMappingReviews)
		admin.POST("/kitchenware/mapping-reviews/:id", h.KitchenwareMappingReviewPost)
		admin.GET("/kitchenware/catalog/:id/capabilities", h.KitchenwareCapabilitiesGet)
		admin.PUT("/kitchenware/catalog/:id/capabilities", h.KitchenwareCapabilitiesPut)
		admin.GET("/kitchenware", h.KitchenwareAdminList)
		admin.PUT("/kitchenware/:id/status", h.KitchenwareStatusPut)
		admin.DELETE("/kitchenware/:id", h.KitchenwareDelete)

		admin.GET("/ingredients", h.ListIngredients)
		admin.POST("/ingredients", h.CreateIngredient)
		admin.PUT("/ingredients/:id", h.UpdateIngredient)
		admin.DELETE("/ingredients/:id", h.DeleteIngredient)
		admin.POST("/ingredients/:id/aliases", h.IngredientAliasesPost)
		admin.POST("/ingredients/:id/merge", h.IngredientMergePost)
		admin.GET("/ingredients/governance/coverage", h.IngredientsGovernanceCoverage)
		admin.GET("/custom-foods/pending", h.CustomFoodsPending)
		admin.POST("/custom-foods/:id/approve", h.CustomFoodApprove)
		admin.POST("/custom-foods/:id/reject", h.CustomFoodReject)

		admin.GET("/ai-config/resources", h.AIConfigResourcesGet)
		admin.PUT("/ai-config/resources", h.AIConfigResourcesPut)
		admin.POST("/ai-config/resources/migrate", h.AIConfigResourcesAction)
		admin.POST("/ai-config/resources/test", h.AIConfigResourcesAction)
		admin.POST("/ai-config/resources/publish", h.AIConfigResourcesAction)
		admin.POST("/ai-config/resources/discard", h.AIConfigResourcesAction)
		admin.GET("/ai-config", h.AIConfigGet)
		admin.PUT("/ai-config", h.AIConfigPut)
		admin.POST("/ai-config", h.AIConfigPostDeprecated)
		admin.POST("/ai-config/test", h.AIConfigTest)

		admin.GET("/notifications", h.NotificationsList)
		admin.POST("/notifications/campaigns", h.NotificationCampaignPost)

		admin.GET("/app-updates", h.AppUpdatesList)
		admin.POST("/app-updates/publish", h.AppUpdatesPublish)
		admin.POST("/app-updates/revoke", h.AppUpdatesRevoke)

		admin.GET("/agent-runs", h.AgentRunsList)
		admin.GET("/agent-runs/:runId", h.AgentRunDetail)

		admin.GET("/media-cleanup-jobs", h.MediaCleanupJobs)
		admin.POST("/media-cleanup-jobs/:id/retry", h.MediaCleanupRetry)

		admin.GET("/voice-packs", h.VoicePacksList)
		admin.GET("/voice-packs/:id/history", h.VoicePackHistory)
		admin.POST("/voice-packs", h.VoicePackCreate)
		admin.PUT("/voice-packs/:id", h.VoicePackUpdate)
		admin.POST("/voice-packs/:id/publish", h.VoicePackPublish)
		admin.POST("/voice-packs/:id/disable", h.VoicePackDisable)
		admin.POST("/voice-packs/:id/revoke", h.VoicePackRevoke)

		admin.GET("/worker-runs", h.WorkerRunsList)

		admin.GET("/core-loops", h.CoreLoopsList)
		admin.GET("/core-loops/settings", h.CoreLoopsSettingsGet)
		admin.PUT("/core-loops/settings", h.CoreLoopsSettingsPut)
		admin.GET("/core-loops/actors/:userId", h.CoreLoopsActorGet)
		admin.PUT("/core-loops/actors/:userId", h.CoreLoopsActorPut)
		admin.GET("/stats", h.StatsGet)
		admin.GET("/funnel", h.FunnelGet)
		admin.GET("/audit-logs", h.AuditLogsList)
		admin.GET("/inventory-scan-jobs", h.InventoryScanJobsList)
		admin.GET("/inventory-scan-jobs/:jobId", h.InventoryScanJobDetail)
		admin.GET("/chat-conversations", h.ChatConversationsList)
		admin.GET("/chat-conversations/:userId/:sessionId", h.ChatConversationDetail)
		admin.GET("/trash", h.TrashList)
		admin.POST("/trash/:resource/:id/restore", h.TrashRestore)
		admin.GET("/ai-usage", h.AIUsageGet)
		admin.GET("/stats/trends", h.StatsTrends)
		admin.GET("/stats/recent", h.StatsRecent)
	}
}

func (h *Handlers) requireAdmin() gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, ok := expressauth.UserID(c)
		if !ok {
			httpx.AbortAuth(c)
			return
		}
		var role string
		if err := h.DB.QueryRow(`SELECT COALESCE(role,'user') FROM users WHERE id=?`, userID).Scan(&role); err != nil || role != "admin" {
			httpx.SendError(c, http.StatusForbidden, "需要管理员权限", "ADMIN_REQUIRED")
			return
		}
		c.Next()
	}
}

func (h *Handlers) Dashboard(c *gin.Context) {
	var users, recipes, posts int
	_ = h.DB.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&users)
	_ = h.DB.QueryRow(`SELECT COUNT(*) FROM recipes`).Scan(&recipes)
	if h.hasTable("community_posts") {
		_ = h.DB.QueryRow(`SELECT COUNT(*) FROM community_posts`).Scan(&posts)
	}
	c.JSON(http.StatusOK, gin.H{
		"users": users, "recipes": recipes, "communityPosts": posts,
	})
}

func (h *Handlers) SiteSettingsGet(c *gin.Context) {
	rows, err := h.DB.Query(`SELECT key, value FROM system_settings`)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"settings": map[string]string{}})
		return
	}
	defer rows.Close()
	settings := map[string]string{}
	for rows.Next() {
		var k, v string
		if err := rows.Scan(&k, &v); err == nil {
			settings[k] = v
		}
	}
	c.JSON(http.StatusOK, gin.H{"settings": settings})
}

func (h *Handlers) SiteSettingsPut(c *gin.Context) {
	var body struct {
		Settings map[string]string `json:"settings"`
	}
	if !bindJSON(c, &body) {
		return
	}
	for k, v := range body.Settings {
		h.upsertSetting(k, v)
	}
	h.recordAudit(c, "site_settings.update", "site_settings", "bulk", "更新站点设置")
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *Handlers) UserLevelRuleGet(c *gin.Context) {
	v, ok := h.getSetting("user_level_rule")
	if !ok {
		c.JSON(http.StatusOK, gin.H{"rule": map[string]any{}})
		return
	}
	var rule map[string]any
	if err := json.Unmarshal([]byte(v), &rule); err != nil {
		c.JSON(http.StatusOK, gin.H{"rule": map[string]any{"raw": v}})
		return
	}
	c.JSON(http.StatusOK, gin.H{"rule": rule})
}

func (h *Handlers) UserLevelRulePut(c *gin.Context) {
	var body map[string]any
	if !bindJSON(c, &body) {
		return
	}
	raw, _ := json.Marshal(body)
	h.upsertSetting("user_level_rule", string(raw))
	h.recordAudit(c, "user_level_rule.update", "system_settings", "user_level_rule", "更新用户等级规则")
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
