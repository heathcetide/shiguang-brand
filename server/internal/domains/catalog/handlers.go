// Copyright (c) 2026 heathcetide. All rights reserved.

package catalog

import (
	"database/sql"
	"github.com/heathcetide/DietDigiDose/internal/dbx"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/heathcetide/DietDigiDose/internal/expressauth"
	"github.com/heathcetide/DietDigiDose/internal/httpx"
)

// Handlers covers recipes, foods, kitchenware, shopping, recommendations.
type Handlers struct {
	DB   *dbx.DB
	Auth *expressauth.Auth
}

func (h *Handlers) RegisterOn(engine *gin.Engine) {
	recipes := engine.Group("/api/v1/recipes")
	{
		recipes.GET("", h.optionalAuth(), h.ListRecipes)
		recipes.GET("/mine", h.Auth.Middleware(), h.RecipesMine)
		recipes.GET("/library-summary", h.optionalAuth(), h.RecipesLibrarySummary)
		recipes.GET("/favorites", h.Auth.Middleware(), h.RecipesFavorites)
		recipes.GET("/favorites/count", h.Auth.Middleware(), h.RecipesFavoriteCount)
		recipes.GET("/submissions", h.Auth.Middleware(), h.RecipesListSubmissions)
		recipes.POST("/submissions", h.Auth.Middleware(), h.RecipesCreateSubmission)
		recipes.PUT("/submissions/:id", h.Auth.Middleware(), h.RecipesUpdateSubmission)
		recipes.DELETE("/submissions/:id", h.Auth.Middleware(), h.RecipesDeleteSubmission)
		recipes.GET("/:id/favorite", h.Auth.Middleware(), h.RecipesFavoriteStatus)
		recipes.POST("/:id/favorite", h.Auth.Middleware(), h.FavoriteRecipe)
		recipes.DELETE("/:id/favorite", h.Auth.Middleware(), h.UnfavoriteRecipe)
		recipes.GET("/:id", h.optionalAuth(), h.GetRecipe)
	}

	foods := engine.Group("/api/v1/foods")
	{
		foods.GET("/search", h.SearchFoods)
		foods.GET("/barcode/:code", h.FoodByBarcode)
		foods.GET("", h.Auth.Middleware(), h.ListFoods)
		foods.POST("/custom", h.Auth.Middleware(), h.CreateCustomFood)
	}

	kw := engine.Group("/api/v1/kitchenware")
	kw.Use(h.Auth.Middleware())
	{
		kw.GET("", h.ListKitchenware)
		kw.GET("/catalog", h.KitchenwareCatalog)
		kw.GET("/capabilities", h.KitchenwareCapabilities)
		kw.GET("/recipes/:id/compatibility", h.KitchenwareRecipeCompatibility)
		kw.POST("", h.CreateKitchenware)
		kw.PUT("/:id", h.UpdateKitchenware)
		kw.POST("/:id/maintain", h.MaintainKitchenware)
		kw.DELETE("/:id", h.DeleteKitchenware)
	}

	shop := engine.Group("/api/v1/shopping-list")
	shop.Use(h.Auth.Middleware())
	{
		shop.GET("", h.ListShopping)
		shop.POST("", h.CreateShopping)
		shop.POST("/import", h.ImportShopping)
		shop.PUT("/:id", h.UpdateShopping)
		shop.PATCH("/:id", h.UpdateShopping)
		shop.DELETE("/:id", h.DeleteShopping)
	}

	rec := engine.Group("/api/v1/recommendations")
	rec.Use(h.Auth.Middleware())
	{
		rec.GET("", h.Recommendations)
		rec.GET("/versions", h.RecommendationVersions)
		rec.GET("/preferences", h.RecommendationGetPreferences)
		rec.PATCH("/preferences", h.RecommendationPatchPreferences)
		rec.POST("/weekly-plan", h.RecommendationWeeklyPlan)
		rec.POST("/plan-requirements", h.RecommendationPlanRequirements)
		rec.POST("/cooking-plan", h.RecommendationCookingPlan)
		rec.POST("/cooking-plan/replace", h.RecommendationCookingPlanReplace)
		rec.POST("/recipes", h.RecommendationRecipes)
		rec.POST("/events", h.RecommendationEvents)
	}
}

func (h *Handlers) optionalAuth() gin.HandlerFunc {
	return h.Auth.OptionalMiddleware()
}

func (h *Handlers) ListRecipes(c *gin.Context) {
	q := strings.TrimSpace(c.Query("q"))
	if q == "" {
		q = strings.TrimSpace(c.Query("search"))
	}
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	if pageSize, err := strconv.Atoi(c.Query("pageSize")); err == nil && pageSize > 0 {
		limit = pageSize
	}
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	imageExpr := `COALESCE(NULLIF(image_url,''), NULLIF(cover_image_url,''), '')`
	cookExpr := `COALESCE(cook_time, cook_time_minutes, 0)`
	descExpr := `COALESCE(NULLIF(description,''), NULLIF(summary,''), '')`
	selectSQL := `SELECT id, title, ` + descExpr + `, ` + imageExpr + `, ` + cookExpr + `, COALESCE(difficulty,''),
		calories, protein, carbs, fat, COALESCE(nutrition_basis,''), COALESCE(category,'') FROM recipes WHERE COALESCE(deleted_at,'')=''`
	args := make([]any, 0)
	if q != "" {
		like := "%" + q + "%"
		selectSQL += ` AND (title LIKE ? OR summary LIKE ? OR description LIKE ?)`
		args = append(args, like, like, like)
	}
	selectSQL += ` ORDER BY CASE WHEN calories IS NOT NULL AND calories > 0 THEN 0 ELSE 1 END, id DESC LIMIT ?`
	args = append(args, limit)
	rows, err := h.DB.Query(selectSQL, args...)
	if err != nil {
		// Fallback without deleted_at / optional columns.
		if q == "" {
			rows, err = h.DB.Query(`SELECT id, title, COALESCE(summary,''), COALESCE(cover_image_url,''), COALESCE(cook_time_minutes,0), COALESCE(difficulty,''),
				calories, protein, carbs, fat, '', COALESCE(category,'') FROM recipes ORDER BY id DESC LIMIT ?`, limit)
		} else {
			like := "%" + q + "%"
			rows, err = h.DB.Query(`SELECT id, title, COALESCE(summary,''), COALESCE(cover_image_url,''), COALESCE(cook_time_minutes,0), COALESCE(difficulty,''),
				calories, protein, carbs, fat, '', COALESCE(category,'') FROM recipes WHERE title LIKE ? OR summary LIKE ? ORDER BY id DESC LIMIT ?`, like, like, limit)
		}
	}
	if err != nil {
		httpx.SendError(c, http.StatusInternalServerError, "读取菜谱失败", "RECIPES_FAILED")
		return
	}
	defer rows.Close()
	list := make([]map[string]any, 0)
	for rows.Next() {
		var id, cook int
		var title, summary, cover, difficulty, basis, category string
		var calories, protein, carbs, fat sql.NullFloat64
		if err := rows.Scan(&id, &title, &summary, &cover, &cook, &difficulty, &calories, &protein, &carbs, &fat, &basis, &category); err != nil {
			httpx.SendError(c, http.StatusInternalServerError, "读取菜谱失败", "RECIPES_FAILED")
			return
		}
		item := map[string]any{
			"id": id, "title": title, "summary": summary, "description": summary,
			"cover_image_url": emptyNil(cover), "image_url": emptyNil(cover),
			"cook_time_minutes": cook, "cook_time": cook, "difficulty": difficulty, "category": category,
		}
		if calories.Valid {
			item["calories"] = calories.Float64
		}
		if protein.Valid {
			item["protein"] = protein.Float64
		}
		if carbs.Valid {
			item["carbs"] = carbs.Float64
		}
		if fat.Valid {
			item["fat"] = fat.Float64
		}
		if basis != "" {
			item["nutrition_basis"] = basis
		} else if !calories.Valid {
			item["nutrition_basis"] = "unknown"
		}
		list = append(list, item)
	}
	c.JSON(http.StatusOK, gin.H{"items": list, "recipes": list, "total": len(list), "pageSize": limit, "nextCursor": nil})
}

func (h *Handlers) GetRecipe(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	var title, summary, cover, difficulty, ingredients, steps sql.NullString
	var cook int
	err := h.DB.QueryRow(`SELECT title, COALESCE(summary,''), COALESCE(cover_image_url,''), COALESCE(cook_time_minutes,0),
		COALESCE(difficulty,''), COALESCE(ingredients_json,''), COALESCE(steps_json,'')
		FROM recipes WHERE id=?`, id).Scan(&title, &summary, &cover, &cook, &difficulty, &ingredients, &steps)
	if err == sql.ErrNoRows {
		httpx.SendError(c, http.StatusNotFound, "菜谱不存在", "RECIPE_NOT_FOUND")
		return
	}
	if err != nil {
		httpx.SendError(c, http.StatusInternalServerError, "读取菜谱失败", "RECIPES_FAILED")
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"id": id, "title": title.String, "summary": summary.String, "cover_image_url": emptyNil(cover.String),
		"cook_time_minutes": cook, "difficulty": difficulty.String,
		"ingredients_json": ingredients.String, "steps_json": steps.String,
	})
}

func (h *Handlers) FavoriteRecipe(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	id, _ := strconv.Atoi(c.Param("id"))
	_, err := h.DB.Exec(`INSERT INTO recipe_favorites (user_id, recipe_id) VALUES (?, ?) ON CONFLICT DO NOTHING`, userID, id)
	if err != nil {
		httpx.SendError(c, http.StatusInternalServerError, "收藏失败", "FAVORITE_FAILED")
		return
	}
	c.JSON(http.StatusOK, gin.H{"favorited": true})
}

func (h *Handlers) UnfavoriteRecipe(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	id, _ := strconv.Atoi(c.Param("id"))
	_, _ = h.DB.Exec(`DELETE FROM recipe_favorites WHERE user_id=? AND recipe_id=?`, userID, id)
	c.JSON(http.StatusOK, gin.H{"favorited": false})
}

func (h *Handlers) ListFoods(c *gin.Context) {
	q := strings.TrimSpace(c.Query("q"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	var rows *sql.Rows
	var err error
	if q == "" {
		rows, err = h.DB.Query(`SELECT id, name, COALESCE(category,''), COALESCE(unit,'') FROM ingredients_library ORDER BY id DESC LIMIT ?`, limit)
	} else {
		like := "%" + q + "%"
		rows, err = h.DB.Query(`SELECT id, name, COALESCE(category,''), COALESCE(unit,'') FROM ingredients_library WHERE name LIKE ? ORDER BY id DESC LIMIT ?`, like, limit)
	}
	if err != nil {
		httpx.SendError(c, http.StatusInternalServerError, "读取食材库失败", "FOODS_FAILED")
		return
	}
	defer rows.Close()
	list := make([]map[string]any, 0)
	for rows.Next() {
		var id int
		var name, category, unit string
		if err := rows.Scan(&id, &name, &category, &unit); err != nil {
			httpx.SendError(c, http.StatusInternalServerError, "读取食材库失败", "FOODS_FAILED")
			return
		}
		list = append(list, map[string]any{"id": id, "name": name, "category": category, "unit": unit})
	}
	c.JSON(http.StatusOK, list)
}

func (h *Handlers) CreateCustomFood(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	var body struct {
		Name     string `json:"name"`
		Category string `json:"category"`
		Unit     string `json:"unit"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || strings.TrimSpace(body.Name) == "" {
		httpx.SendError(c, http.StatusBadRequest, "请求参数无效", "INVALID_BODY")
		return
	}
	id, err := h.DB.InsertID(`INSERT INTO user_custom_foods (user_id, name, category, unit) VALUES (?, ?, ?, ?)`,
		userID, strings.TrimSpace(body.Name), strings.TrimSpace(body.Category), strings.TrimSpace(body.Unit))
	if err != nil {
		httpx.SendError(c, http.StatusInternalServerError, "创建自定义食材失败", "CUSTOM_FOOD_FAILED")
		return
	}

	c.JSON(http.StatusCreated, gin.H{"id": id, "name": body.Name, "category": body.Category, "unit": body.Unit})
}

func (h *Handlers) ListKitchenware(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	rows, err := h.DB.Query(`SELECT id, name, category, COALESCE(status,'良好'), COALESCE(note,'') FROM kitchenware_items WHERE user_id=? ORDER BY id DESC`, userID)
	if err != nil {
		httpx.SendError(c, http.StatusInternalServerError, "读取厨具失败", "KITCHENWARE_FAILED")
		return
	}
	defer rows.Close()
	list := make([]map[string]any, 0)
	for rows.Next() {
		var id int
		var name, category, status, note string
		if err := rows.Scan(&id, &name, &category, &status, &note); err != nil {
			httpx.SendError(c, http.StatusInternalServerError, "读取厨具失败", "KITCHENWARE_FAILED")
			return
		}
		list = append(list, map[string]any{"id": id, "name": name, "category": category, "status": status, "note": note})
	}
	c.JSON(http.StatusOK, list)
}

func (h *Handlers) CreateKitchenware(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	var body struct {
		Name     string `json:"name"`
		Category string `json:"category"`
		Status   string `json:"status"`
		Note     string `json:"note"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || strings.TrimSpace(body.Name) == "" {
		httpx.SendError(c, http.StatusBadRequest, "请求参数无效", "INVALID_BODY")
		return
	}
	if body.Status == "" {
		body.Status = "良好"
	}
	id, err := h.DB.InsertID(`INSERT INTO kitchenware_items (user_id, name, category, status, note) VALUES (?, ?, ?, ?, ?)`,
		userID, body.Name, body.Category, body.Status, body.Note)
	if err != nil {
		httpx.SendError(c, http.StatusInternalServerError, "创建厨具失败", "KITCHENWARE_FAILED")
		return
	}

	c.JSON(http.StatusCreated, gin.H{"id": id, "name": body.Name, "category": body.Category, "status": body.Status, "note": body.Note})
}

func (h *Handlers) DeleteKitchenware(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	id, _ := strconv.Atoi(c.Param("id"))
	_, _ = h.DB.Exec(`DELETE FROM kitchenware_items WHERE id=? AND user_id=?`, id, userID)
	c.JSON(http.StatusOK, gin.H{"deleted": true})
}

func (h *Handlers) ListShopping(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	c.JSON(http.StatusOK, h.listShoppingItems(userID))
}

func (h *Handlers) CreateShopping(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	var body struct {
		Name     string `json:"name"`
		Quantity string `json:"quantity"`
		Amount   string `json:"amount"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || strings.TrimSpace(body.Name) == "" {
		httpx.SendError(c, 400, "请求参数无效", "INVALID_BODY")
		return
	}
	id, err := newUUID()
	if err != nil {
		httpx.SendError(c, 500, "创建采购项失败", "SHOPPING_FAILED")
		return
	}
	amount := body.Amount
	if amount == "" {
		amount = body.Quantity
	}
	if amount == "" {
		amount = "适量"
	}
	qtyCol := "quantity"
	if h.hasColumn("shopping_list_items", "amount") {
		qtyCol = "amount"
	}
	_, err = h.DB.Exec(`INSERT INTO shopping_list_items (id,user_id,name,`+qtyCol+`,checked,version) VALUES (?,?,?,?,0,1)`, id, userID, body.Name, amount)
	if err != nil {
		httpx.SendError(c, 500, "创建采购项失败", "SHOPPING_FAILED")
		return
	}
	c.JSON(http.StatusCreated, gin.H{"id": id, "name": body.Name, "quantity": amount, "amount": amount, "checked": false, "version": 1})
}

func (h *Handlers) UpdateShopping(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	id := strings.TrimSpace(c.Param("id"))
	var body struct {
		Name     *string `json:"name"`
		Quantity *string `json:"quantity"`
		Checked  *bool   `json:"checked"`
		Version  int     `json:"version"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		httpx.SendError(c, http.StatusBadRequest, "请求参数无效", "INVALID_BODY")
		return
	}
	checked := 0
	if body.Checked != nil && *body.Checked {
		checked = 1
	}
	name := ""
	if body.Name != nil {
		name = *body.Name
	}
	quantity := ""
	if body.Quantity != nil {
		quantity = *body.Quantity
	}
	qtyCol := "quantity"
	if h.hasColumn("shopping_list_items", "amount") {
		qtyCol = "amount"
	}
	res, err := h.DB.Exec(`UPDATE shopping_list_items SET
		name=CASE WHEN ? != '' THEN ? ELSE name END,
		`+qtyCol+`=CASE WHEN ? != '' THEN ? ELSE `+qtyCol+` END,
		checked=CASE WHEN ? THEN ? ELSE checked END,
		version=version+1
		WHERE id=? AND user_id=? AND deleted_at IS NULL AND (?=0 OR version=?)`,
		name, name, quantity, quantity, body.Checked != nil, checked, id, userID, body.Version, body.Version)
	if err != nil {
		httpx.SendError(c, http.StatusInternalServerError, "更新采购项失败", "SHOPPING_FAILED")
		return
	}
	n, _ := res.RowsAffected()
	if n != 1 {
		httpx.SendError(c, http.StatusConflict, "采购项已变更，请刷新后重试", "SHOPPING_CONFLICT")
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *Handlers) DeleteShopping(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	id := strings.TrimSpace(c.Param("id"))
	_, _ = h.DB.Exec(`UPDATE shopping_list_items SET deleted_at=CURRENT_TIMESTAMP, version=version+1 WHERE id=? AND user_id=? AND deleted_at IS NULL`, id, userID)
	c.JSON(http.StatusOK, gin.H{"deleted": true})
}

func (h *Handlers) Recommendations(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	body := map[string]any{
		"pageSize": c.Query("pageSize"),
		"search":   c.Query("search"),
		"category": c.Query("category"),
		"cursor":   c.Query("cursor"),
	}
	page := h.recommendationPage(userID, body, 20)
	c.JSON(http.StatusOK, page)
}
