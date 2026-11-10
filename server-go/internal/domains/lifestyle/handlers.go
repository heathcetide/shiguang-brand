// Copyright (c) 2026 heathcetide. All rights reserved.

package lifestyle

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/heathcetide/DietDigiDose/internal/domains/inventory"
	"github.com/heathcetide/DietDigiDose/internal/expressauth"
	"github.com/heathcetide/DietDigiDose/internal/httpx"
)

// Handlers covers diet-records, health-data, onboarding, cooking-queue, meal-plans, insights, plan-maintenance.
type Handlers struct {
	DB        *sql.DB
	Auth      *expressauth.Auth
	Inventory *inventory.Service
}

func (h *Handlers) RegisterOn(engine *gin.Engine) {
	EnsureSchema(h.DB)
	auth := h.Auth.Middleware()

	diet := engine.Group("/api/v1/diet-records")
	diet.Use(auth)
	{
		diet.POST("/cooking-completions", h.CompleteCooking)
		diet.GET("/prepared-meals", h.ListPreparedMeals)
		diet.POST("/prepared-meals", h.CreatePreparedMeal)
		diet.POST("/prepared-meals/:id/events", h.PreparedMealEvent)
		diet.GET("", h.ListDiet)
		diet.POST("", h.CreateDiet)
		diet.DELETE("/:id", h.DeleteDiet)
	}

	health := engine.Group("/api/v1/health-data")
	health.Use(auth)
	{
		health.GET("", h.ListHealth)
		health.GET("/latest", h.LatestHealth)
		health.GET("/current-measurements", h.CurrentMeasurements)
		health.POST("/log", h.SaveHealthLog)
		health.DELETE("/log/:id", h.DeleteHealthLog)
		health.GET("/profile", h.GetHealthProfile)
		health.PUT("/profile", h.PutHealthProfile)
		health.PATCH("/profile", h.PatchHealthProfile)
	}

	onboarding := engine.Group("/api/v1/onboarding")
	onboarding.Use(auth)
	{
		onboarding.GET("", h.GetOnboarding)
		onboarding.POST("", h.SaveOnboarding)
		onboarding.PATCH("", h.PatchOnboarding)
		onboarding.POST("/save-failed", h.OnboardingSaveFailed)
	}

	cook := engine.Group("/api/v1/cooking-queue")
	cook.Use(auth)
	{
		cook.GET("", h.ListCookingQueue)
		cook.POST("", h.EnqueueCooking)
		cook.POST("/reorder", h.ReorderCookingQueue)
		cook.DELETE("", h.ClearCookingQueue)
		cook.PATCH("/:id", h.PatchCookingQueue)
		cook.POST("/:id/start", h.StartCookingQueue)
		cook.POST("/:id/complete", h.CompleteCookingQueue)
		cook.DELETE("/:id", h.RemoveCooking)
	}

	plans := engine.Group("/api/v1/meal-plans")
	plans.Use(auth)
	{
		plans.POST("/drafts", h.SaveMealPlanDraft)
		plans.GET("", h.ListMealPlans)
		plans.POST("", h.CreateMealPlan)
		plans.GET("/:id/changes", h.ListMealPlanChanges)
		plans.POST("/:id/changes/:changeId/review", h.ReviewMealPlanChange)
		plans.PATCH("/:id/draft", h.PatchMealPlanDraft)
		plans.POST("/:id/activate", h.ActivateMealPlan)
		plans.POST("/:id/items/:itemId/change-preview", h.MealPlanItemChangePreview)
		plans.POST("/:id/items/:itemId/confirm", h.MealPlanItemConfirm)
		plans.POST("/:id/items/:itemId/complete", h.MealPlanItemComplete)
		plans.POST("/:id/items/:itemId/queue", h.MealPlanItemQueue)
		plans.POST("/:id/items/:itemId/shopping", h.MealPlanItemShopping)
		plans.PATCH("/:id/items/:itemId", h.PatchMealPlanItem)
		plans.PATCH("/:id", h.PatchMealPlan)
		plans.GET("/:id", h.GetMealPlan)
		plans.DELETE("/:id", h.DeleteMealPlan)
	}

	insights := engine.Group("/api/v1/insights")
	insights.Use(auth)
	{
		insights.GET("", h.Insights)
		insights.POST("/inventory-outcomes", h.CreateInventoryOutcome)
		insights.GET("/inventory-outcomes/weekly", h.WeeklyInventoryOutcomes)
		insights.PATCH("/inventory-outcomes/:id", h.PatchInventoryOutcome)
	}

	maint := engine.Group("/api/v1/plan-maintenance")
	maint.Use(auth)
	{
		maint.GET("", h.PlanMaintenanceStatus)
		maint.GET("/runs", h.PlanMaintenanceRuns)
		maint.GET("/settings", h.PlanMaintenanceSettings)
		maint.PATCH("/settings", h.PatchPlanMaintenanceSettings)
		maint.POST("/recalculate", h.PlanMaintenanceRecalc)
	}
}

func (h *Handlers) ListDiet(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	rows, err := h.DB.Query(`SELECT id, meal_type, COALESCE(food_name,''), COALESCE(calories,0), COALESCE(recorded_at, created_at)
		FROM diet_records WHERE user_id=? ORDER BY id DESC LIMIT 200`, userID)
	if err != nil {
		httpx.SendError(c, http.StatusInternalServerError, "读取饮食记录失败", "DIET_FAILED")
		return
	}
	defer rows.Close()
	list := make([]map[string]any, 0)
	for rows.Next() {
		var id, calories int
		var mealType, foodName, recorded string
		if err := rows.Scan(&id, &mealType, &foodName, &calories, &recorded); err != nil {
			continue
		}
		list = append(list, map[string]any{"id": id, "meal_type": mealType, "food_name": foodName, "calories": calories, "recorded_at": recorded})
	}
	c.JSON(http.StatusOK, list)
}

func (h *Handlers) CreateDiet(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	var body map[string]any
	if err := c.ShouldBindJSON(&body); err != nil {
		httpx.SendError(c, http.StatusBadRequest, "请求参数无效", "INVALID_BODY")
		return
	}
	mealType := strings.TrimSpace(asString(body["meal_type"]))
	foodName := strings.TrimSpace(asString(body["food_name"]))
	calories := int(asFloat(body["calories"]))
	res, err := h.DB.Exec(`INSERT INTO diet_records (user_id, meal_type, food_name, calories) VALUES (?, ?, ?, ?)`,
		userID, mealType, foodName, calories)
	if err != nil {
		httpx.SendError(c, http.StatusInternalServerError, "创建饮食记录失败", "DIET_FAILED")
		return
	}
	id, _ := res.LastInsertId()
	c.JSON(http.StatusCreated, gin.H{"id": id, "meal_type": mealType, "food_name": foodName, "calories": calories})
}

func (h *Handlers) DeleteDiet(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	id, _ := strconv.Atoi(c.Param("id"))
	_, _ = h.DB.Exec(`DELETE FROM diet_records WHERE id=? AND user_id=?`, id, userID)
	c.JSON(http.StatusOK, gin.H{"deleted": true})
}

func (h *Handlers) ListHealth(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	rows, err := h.DB.Query(`SELECT id, COALESCE(weight,0), COALESCE(steps,0), COALESCE(sleep_hours,0), COALESCE(recorded_at, created_at)
		FROM health_logs WHERE user_id=? ORDER BY id DESC LIMIT 100`, userID)
	if err != nil {
		c.JSON(http.StatusOK, []any{})
		return
	}
	defer rows.Close()
	list := make([]map[string]any, 0)
	for rows.Next() {
		var id int
		var weight, steps, sleep float64
		var recorded string
		if err := rows.Scan(&id, &weight, &steps, &sleep, &recorded); err == nil {
			list = append(list, map[string]any{"id": id, "weight": weight, "steps": steps, "sleep_hours": sleep, "recorded_at": recorded})
		}
	}
	c.JSON(http.StatusOK, list)
}

func (h *Handlers) LatestHealth(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	var id int
	var weight, steps, sleep float64
	var recorded string
	err := h.DB.QueryRow(`SELECT id, COALESCE(weight,0), COALESCE(steps,0), COALESCE(sleep_hours,0), COALESCE(recorded_at, created_at)
		FROM health_logs WHERE user_id=? ORDER BY id DESC LIMIT 1`, userID).Scan(&id, &weight, &steps, &sleep, &recorded)
	if err != nil {
		c.JSON(http.StatusOK, nil)
		return
	}
	c.JSON(http.StatusOK, gin.H{"id": id, "weight": weight, "steps": steps, "sleep_hours": sleep, "recorded_at": recorded})
}

func (h *Handlers) SaveHealthLog(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	var body map[string]any
	if err := c.ShouldBindJSON(&body); err != nil {
		httpx.SendError(c, http.StatusBadRequest, "请求参数无效", "INVALID_BODY")
		return
	}
	res, err := h.DB.Exec(`INSERT INTO health_logs (user_id, weight, steps, sleep_hours) VALUES (?, ?, ?, ?)`,
		userID, asFloat(body["weight"]), asFloat(body["steps"]), asFloat(body["sleep_hours"]))
	if err != nil {
		httpx.SendError(c, http.StatusInternalServerError, "保存健康日志失败", "HEALTH_FAILED")
		return
	}
	id, _ := res.LastInsertId()
	c.JSON(http.StatusCreated, gin.H{"id": id})
}

func (h *Handlers) DeleteHealthLog(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	id, _ := strconv.Atoi(c.Param("id"))
	_, _ = h.DB.Exec(`DELETE FROM health_logs WHERE id=? AND user_id=?`, id, userID)
	c.JSON(http.StatusOK, gin.H{"deleted": true})
}

func (h *Handlers) GetHealthProfile(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	row := map[string]any{"user_id": userID}
	var payload sql.NullString
	err := h.DB.QueryRow(`SELECT COALESCE(profile_json,'') FROM user_health_profiles WHERE user_id=?`, userID).Scan(&payload)
	if err == nil && payload.Valid && payload.String != "" {
		var parsed any
		if json.Unmarshal([]byte(payload.String), &parsed) == nil {
			c.JSON(http.StatusOK, parsed)
			return
		}
	}
	c.JSON(http.StatusOK, row)
}

func (h *Handlers) PutHealthProfile(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	var body map[string]any
	if err := c.ShouldBindJSON(&body); err != nil {
		httpx.SendError(c, http.StatusBadRequest, "请求参数无效", "INVALID_BODY")
		return
	}
	raw, _ := json.Marshal(body)
	_, err := h.DB.Exec(`INSERT INTO user_health_profiles (user_id, profile_json) VALUES (?, ?)
		ON CONFLICT(user_id) DO UPDATE SET profile_json=excluded.profile_json`, userID, string(raw))
	if err != nil {
		_, err = h.DB.Exec(`INSERT OR REPLACE INTO user_health_profiles (user_id, profile_json) VALUES (?, ?)`, userID, string(raw))
	}
	if err != nil {
		httpx.SendError(c, http.StatusInternalServerError, "保存健康档案失败", "HEALTH_PROFILE_FAILED")
		return
	}
	c.JSON(http.StatusOK, body)
}

func (h *Handlers) GetOnboarding(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	var payload sql.NullString
	_ = h.DB.QueryRow(`SELECT COALESCE(payload_json,'') FROM user_onboarding WHERE user_id=?`, userID).Scan(&payload)
	if payload.Valid && payload.String != "" {
		var parsed any
		if json.Unmarshal([]byte(payload.String), &parsed) == nil {
			c.JSON(http.StatusOK, parsed)
			return
		}
	}
	c.JSON(http.StatusOK, gin.H{"completed": false, "userId": userID})
}

func (h *Handlers) SaveOnboarding(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	var body map[string]any
	if err := c.ShouldBindJSON(&body); err != nil {
		httpx.SendError(c, http.StatusBadRequest, "请求参数无效", "INVALID_BODY")
		return
	}
	raw, _ := json.Marshal(body)
	_, err := h.DB.Exec(`INSERT INTO user_onboarding (user_id, payload_json, updated_at) VALUES (?, ?, ?)
		ON CONFLICT(user_id) DO UPDATE SET payload_json=excluded.payload_json, updated_at=excluded.updated_at`,
		userID, string(raw), time.Now().UTC().Format(time.RFC3339Nano))
	if err != nil {
		_, err = h.DB.Exec(`INSERT OR REPLACE INTO user_onboarding (user_id, payload_json, updated_at) VALUES (?, ?, ?)`,
			userID, string(raw), time.Now().UTC().Format(time.RFC3339Nano))
	}
	if err != nil {
		// Table may not exist in older DBs — still acknowledge for strangler continuity.
		c.JSON(http.StatusOK, body)
		return
	}
	c.JSON(http.StatusOK, body)
}

func (h *Handlers) ListCookingQueue(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	rows, err := h.DB.Query(`SELECT id, COALESCE(recipe_id,0), COALESCE(status,'queued'), COALESCE(position,0), COALESCE(version,1), COALESCE(created_at,'')
		FROM cooking_queue_items WHERE user_id=? ORDER BY COALESCE(position,0) ASC, created_at DESC LIMIT 100`, userID)
	if err != nil {
		c.JSON(http.StatusOK, []any{})
		return
	}
	defer rows.Close()
	list := make([]map[string]any, 0)
	for rows.Next() {
		var id string
		var recipeID, position, version int
		var status, created string
		if err := rows.Scan(&id, &recipeID, &status, &position, &version, &created); err == nil {
			list = append(list, map[string]any{
				"id": id, "recipe_id": recipeID, "status": status,
				"position": position, "version": version, "created_at": created,
			})
		}
	}
	c.JSON(http.StatusOK, list)
}

func (h *Handlers) EnqueueCooking(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	var body struct {
		RecipeID int `json:"recipe_id"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		httpx.SendError(c, http.StatusBadRequest, "请求参数无效", "INVALID_BODY")
		return
	}
	item, status := h.enqueueCookingCompat(userID, body.RecipeID)
	if item == nil {
		httpx.SendError(c, http.StatusInternalServerError, "加入烹饪队列失败", "COOKING_QUEUE_FAILED")
		return
	}
	c.JSON(status, gin.H{"added": true, "item": item})
}

func (h *Handlers) RemoveCooking(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	id := strings.TrimSpace(c.Param("id"))
	_, _ = h.DB.Exec(`DELETE FROM cooking_queue_items WHERE id=? AND user_id=?`, id, userID)
	c.JSON(http.StatusOK, gin.H{"deleted": true})
}

func (h *Handlers) ListMealPlans(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	rows, err := h.DB.Query(`SELECT id, COALESCE(title,''), COALESCE(status,'draft'), COALESCE(version,1)
		FROM meal_plans WHERE user_id=? ORDER BY id DESC LIMIT 50`, userID)
	if err != nil {
		c.JSON(http.StatusOK, []any{})
		return
	}
	defer rows.Close()
	list := make([]map[string]any, 0)
	for rows.Next() {
		var id, version int
		var title, status string
		if err := rows.Scan(&id, &title, &status, &version); err == nil {
			list = append(list, map[string]any{"id": id, "title": title, "status": status, "version": version})
		}
	}
	c.JSON(http.StatusOK, list)
}

func (h *Handlers) CreateMealPlan(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	var body map[string]any
	if err := c.ShouldBindJSON(&body); err != nil {
		httpx.SendError(c, http.StatusBadRequest, "请求参数无效", "INVALID_BODY")
		return
	}
	title := strings.TrimSpace(asString(body["title"]))
	if title == "" {
		title = "未命名计划"
	}
	raw, _ := json.Marshal(body)
	res, err := h.DB.Exec(`INSERT INTO meal_plans (user_id, title, status, version, payload_json) VALUES (?, ?, 'draft', 1, ?)`,
		userID, title, string(raw))
	if err != nil {
		httpx.SendError(c, http.StatusInternalServerError, "创建餐计划失败", "MEAL_PLAN_FAILED")
		return
	}
	id, _ := res.LastInsertId()
	c.JSON(http.StatusCreated, gin.H{"id": id, "title": title, "status": "draft", "version": 1})
}

func (h *Handlers) GetMealPlan(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	planID, ok := h.resolvePlanID(c, userID)
	if !ok {
		httpx.SendError(c, http.StatusNotFound, "餐计划不存在", "MEAL_PLAN_NOT_FOUND")
		return
	}
	h.respondMealPlan(c, userID, planID)
}

func (h *Handlers) DeleteMealPlan(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	id, _ := strconv.Atoi(c.Param("id"))
	_, _ = h.DB.Exec(`DELETE FROM meal_plans WHERE id=? AND user_id=?`, id, userID)
	c.JSON(http.StatusOK, gin.H{"deleted": true})
}

func (h *Handlers) Insights(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	var inventoryCount, dietCount int
	_ = h.DB.QueryRow(`SELECT COUNT(*) FROM inventory_items WHERE user_id=? AND deleted_at IS NULL`, userID).Scan(&inventoryCount)
	_ = h.DB.QueryRow(`SELECT COUNT(*) FROM diet_records WHERE user_id=?`, userID).Scan(&dietCount)
	c.JSON(http.StatusOK, gin.H{
		"inventoryCount": inventoryCount,
		"dietRecordCount": dietCount,
		"generatedAt": time.Now().UTC().Format(time.RFC3339),
	})
}

func (h *Handlers) PlanMaintenanceStatus(c *gin.Context) {
	h.PlanMaintenanceStatusGet(c)
}

func (h *Handlers) PlanMaintenanceRecalc(c *gin.Context) {
	h.PlanMaintenanceRecalcPost(c)
}
