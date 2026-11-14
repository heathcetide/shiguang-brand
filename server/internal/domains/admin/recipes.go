// Copyright (c) 2026 heathcetide. All rights reserved.

package admin

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/heathcetide/DietDigiDose/internal/httpx"
)

func (h *Handlers) ListRecipes(c *gin.Context) {
	page, pageSize, offset := parsePageParams(c, 50, 200)
	hasStatus := h.hasColumn("recipes", "status")
	hasCategory := h.hasColumn("recipes", "category")
	hasCalories := h.hasColumn("recipes", "calories")
	hasImage := h.hasColumn("recipes", "image_url")
	hasCover := h.hasColumn("recipes", "cover_image_url")
	hasQuality := h.hasColumn("recipes", "quality_status")
	hasSource := h.hasColumn("recipes", "source")
	hasIngredients := h.hasColumn("recipes", "ingredients_json")
	hasSteps := h.hasColumn("recipes", "steps_json")
	hasDeleted := h.hasColumn("recipes", "deleted_at")
	hasSummary := h.hasColumn("recipes", "summary")
	hasDescription := h.hasColumn("recipes", "description")
	hasCookTime := h.hasColumn("recipes", "cook_time")
	hasCookMinutes := h.hasColumn("recipes", "cook_time_minutes")
	hasDifficulty := h.hasColumn("recipes", "difficulty")

	where := []string{"1=1"}
	args := make([]any, 0)
	if hasDeleted {
		where = append(where, "deleted_at IS NULL")
	}
	if search := strings.TrimSpace(c.Query("search")); search != "" {
		where = append(where, "title LIKE ?")
		args = append(args, "%"+search+"%")
	}
	if category := strings.TrimSpace(c.Query("category")); category != "" && category != "全部" && hasCategory {
		where = append(where, "category=?")
		args = append(args, category)
	}
	if reviewStatus := strings.TrimSpace(c.Query("reviewStatus")); reviewStatus != "" && reviewStatus != "all" && hasStatus {
		where = append(where, "status=?")
		args = append(args, reviewStatus)
	}
	if qualityStatus := strings.TrimSpace(c.Query("qualityStatus")); qualityStatus != "" && qualityStatus != "all" && hasQuality {
		where = append(where, "quality_status=?")
		args = append(args, qualityStatus)
	}
	whereSQL := strings.Join(where, " AND ")

	var total, platform, user, pending, needsReview int
	_ = h.DB.QueryRow(`SELECT COUNT(*) FROM recipes WHERE `+whereSQL, args...).Scan(&total)
	if hasSource {
		_ = h.DB.QueryRow(`SELECT COUNT(*) FROM recipes WHERE `+whereSQL+` AND source IN ('official','system','platform','concept_base','howtocook')`, args...).Scan(&platform)
		_ = h.DB.QueryRow(`SELECT COUNT(*) FROM recipes WHERE `+whereSQL+` AND COALESCE(source,'') NOT IN ('official','system','platform','concept_base','howtocook')`, args...).Scan(&user)
	}
	if hasStatus {
		_ = h.DB.QueryRow(`SELECT COUNT(*) FROM recipes WHERE `+whereSQL+` AND status='pending'`, args...).Scan(&pending)
	}
	if hasQuality {
		_ = h.DB.QueryRow(`SELECT COUNT(*) FROM recipes WHERE `+whereSQL+` AND quality_status='needs_review'`, args...).Scan(&needsReview)
	}

	imageExpr := `''`
	switch {
	case hasImage && hasCover:
		imageExpr = `COALESCE(NULLIF(image_url,''), NULLIF(cover_image_url,''), '')`
	case hasImage:
		imageExpr = `COALESCE(image_url,'')`
	case hasCover:
		imageExpr = `COALESCE(cover_image_url,'')`
	}
	descExpr := `''`
	switch {
	case hasDescription && hasSummary:
		descExpr = `COALESCE(NULLIF(description,''), NULLIF(summary,''), '')`
	case hasDescription:
		descExpr = `COALESCE(description,'')`
	case hasSummary:
		descExpr = `COALESCE(summary,'')`
	}
	cookExpr := `0`
	switch {
	case hasCookTime && hasCookMinutes:
		cookExpr = `COALESCE(cook_time, cook_time_minutes, 0)`
	case hasCookTime:
		cookExpr = `COALESCE(cook_time,0)`
	case hasCookMinutes:
		cookExpr = `COALESCE(cook_time_minutes,0)`
	}

	q := `SELECT id, title`
	if hasStatus {
		q += `, COALESCE(status,'')`
	} else {
		q += `, ''`
	}
	if hasCategory {
		q += `, COALESCE(category,'')`
	} else {
		q += `, ''`
	}
	if hasCalories {
		q += `, COALESCE(calories,0)`
	} else {
		q += `, 0`
	}
	q += `, ` + imageExpr + `, ` + descExpr + `, ` + cookExpr
	if hasDifficulty {
		q += `, COALESCE(difficulty,'')`
	} else {
		q += `, ''`
	}
	if hasQuality {
		q += `, COALESCE(quality_status,'')`
	} else {
		q += `, ''`
	}
	if hasSource {
		q += `, COALESCE(source,'')`
	} else {
		q += `, ''`
	}
	if hasIngredients {
		q += `, COALESCE(ingredients_json,'[]')`
	} else {
		q += `, '[]'`
	}
	if hasSteps {
		q += `, COALESCE(steps_json,'[]')`
	} else {
		q += `, '[]'`
	}
	q += ` FROM recipes WHERE ` + whereSQL + ` ORDER BY id DESC LIMIT ? OFFSET ?`
	queryArgs := append(append([]any{}, args...), pageSize, offset)
	rows, err := h.DB.Query(q, queryArgs...)
	if err != nil {
		httpx.SendError(c, http.StatusInternalServerError, "读取菜谱失败", "ADMIN_RECIPES_FAILED")
		return
	}
	defer rows.Close()
	list := make([]map[string]any, 0)
	for rows.Next() {
		var id int
		var title, status, category, imageURL, description, difficulty, quality, source, ingredientsJSON, stepsJSON string
		var calories, cookTime float64
		if err := rows.Scan(&id, &title, &status, &category, &calories, &imageURL, &description, &cookTime, &difficulty, &quality, &source, &ingredientsJSON, &stepsJSON); err != nil {
			continue
		}
		item := map[string]any{
			"id": id, "title": title, "category": category, "calories": calories,
			"image_url": imageURL, "cover_image_url": imageURL, "description": description,
			"cook_time": cookTime, "difficulty": difficulty,
			"ingredients_json": ingredientsJSON, "steps_json": stepsJSON,
		}
		if status != "" {
			item["status"] = status
		}
		if quality != "" {
			item["quality_status"] = quality
		}
		if source != "" {
			item["source"] = source
		}
		list = append(list, item)
	}
	c.JSON(http.StatusOK, gin.H{
		"items": list, "recipes": list, "total": total, "page": page, "pageSize": pageSize, "nextCursor": nil,
		"summary": gin.H{"platform": platform, "user": user, "pending": pending, "needs_review": needsReview},
	})
}

func (h *Handlers) CreateRecipe(c *gin.Context) {
	var body map[string]any
	if !bindJSON(c, &body) {
		return
	}
	title, _ := body["title"].(string)
	if strings.TrimSpace(title) == "" {
		httpx.SendError(c, http.StatusBadRequest, "标题不能为空", "INVALID_BODY")
		return
	}
	if h.hasColumn("recipes", "description") {
		desc, _ := body["description"].(string)
		id, err := h.DB.InsertID(`INSERT INTO recipes (title, description) VALUES (?, ?)`, title, desc)
		if err != nil {
			httpx.SendError(c, http.StatusInternalServerError, "创建菜谱失败", "RECIPE_CREATE_FAILED")
			return
		}

		h.recordAudit(c, "recipe.create", "recipe", strconv.FormatInt(id, 10), "创建菜谱")
		c.JSON(http.StatusCreated, gin.H{"id": id})
		return
	}
	summary, _ := body["summary"].(string)
	id, err := h.DB.InsertID(`INSERT INTO recipes (title, summary) VALUES (?, ?)`, title, summary)
	if err != nil {
		httpx.SendError(c, http.StatusInternalServerError, "创建菜谱失败", "RECIPE_CREATE_FAILED")
		return
	}

	h.recordAudit(c, "recipe.create", "recipe", strconv.FormatInt(id, 10), "创建菜谱")
	c.JSON(http.StatusCreated, gin.H{"id": id})
}

func (h *Handlers) UpdateRecipe(c *gin.Context) {
	id, ok := parseIDParam(c)
	if !ok {
		return
	}
	var body map[string]any
	if !bindJSON(c, &body) {
		return
	}
	if title, ok := body["title"].(string); ok && strings.TrimSpace(title) != "" {
		_, _ = h.DB.Exec(`UPDATE recipes SET title=? WHERE id=?`, title, id)
	}
	if h.hasColumn("recipes", "description") {
		if desc, ok := body["description"].(string); ok {
			_, _ = h.DB.Exec(`UPDATE recipes SET description=? WHERE id=?`, desc, id)
		}
	} else if desc, ok := body["summary"].(string); ok {
		_, _ = h.DB.Exec(`UPDATE recipes SET summary=? WHERE id=?`, desc, id)
	}
	if ing, ok := body["ingredients_json"]; ok {
		raw, _ := json.Marshal(ing)
		if h.hasColumn("recipes", "ingredients_json") {
			_, _ = h.DB.Exec(`UPDATE recipes SET ingredients_json=? WHERE id=?`, string(raw), id)
		}
	}
	if steps, ok := body["steps_json"]; ok {
		raw, _ := json.Marshal(steps)
		if h.hasColumn("recipes", "steps_json") {
			_, _ = h.DB.Exec(`UPDATE recipes SET steps_json=? WHERE id=?`, string(raw), id)
		}
	}
	h.recordAudit(c, "recipe.update", "recipe", strconv.Itoa(id), "更新菜谱")
	okJSON(c)
}

func (h *Handlers) DeleteRecipe(c *gin.Context) {
	id, ok := parseIDParam(c)
	if !ok {
		return
	}
	_, err := h.DB.Exec(`DELETE FROM recipes WHERE id=?`, id)
	if err != nil {
		httpx.SendError(c, http.StatusInternalServerError, "删除菜谱失败", "RECIPE_DELETE_FAILED")
		return
	}
	h.recordAudit(c, "recipe.delete", "recipe", strconv.Itoa(id), "删除菜谱")
	okJSON(c)
}

func (h *Handlers) RecipeKitchenwarePut(c *gin.Context) {
	id, ok := parseIDParam(c)
	if !ok {
		return
	}
	h.recordAudit(c, "recipe.kitchenware.update", "recipe", strconv.Itoa(id), "更新菜谱厨具")
	okJSON(c)
}

func (h *Handlers) RecipeDuplicatesScan(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"duplicates": []any{}})
}

func (h *Handlers) setRecipeStatus(c *gin.Context, id int, status string) {
	if h.hasColumn("recipes", "status") {
		_, _ = h.DB.Exec(`UPDATE recipes SET status=? WHERE id=?`, status, id)
	}
	h.recordAudit(c, "recipe.status."+status, "recipe", strconv.Itoa(id), "菜谱审核 "+status)
	okJSON(c)
}

func (h *Handlers) RecipeApprove(c *gin.Context) {
	id, ok := parseIDParam(c)
	if !ok {
		return
	}
	h.setRecipeStatus(c, id, "approved")
}

func (h *Handlers) RecipeReject(c *gin.Context) {
	id, ok := parseIDParam(c)
	if !ok {
		return
	}
	h.setRecipeStatus(c, id, "rejected")
}

func (h *Handlers) RecipeQualityPut(c *gin.Context) {
	id, ok := parseIDParam(c)
	if !ok {
		return
	}
	h.recordAudit(c, "recipe.quality.update", "recipe", strconv.Itoa(id), "更新菜谱质量")
	okJSON(c)
}

func (h *Handlers) recipeExecutionKey(id int) string {
	return "recipe.execution." + strconv.Itoa(id)
}

func (h *Handlers) RecipeExecutionGet(c *gin.Context) {
	id, ok := parseIDParam(c)
	if !ok {
		return
	}
	v, ok := h.getSetting(h.recipeExecutionKey(id))
	if !ok {
		c.JSON(http.StatusOK, gin.H{"execution": map[string]any{}})
		return
	}
	c.JSON(http.StatusOK, gin.H{"execution": parseJSONMap(v)})
}

func (h *Handlers) RecipeExecutionPut(c *gin.Context) {
	id, ok := parseIDParam(c)
	if !ok {
		return
	}
	var body struct {
		Execution map[string]any `json:"execution"`
	}
	if !bindJSON(c, &body) {
		return
	}
	raw, _ := json.Marshal(body.Execution)
	h.upsertSetting(h.recipeExecutionKey(id), string(raw))
	h.recordAudit(c, "recipe.execution.update", "recipe", strconv.Itoa(id), "更新菜谱执行审核")
	okJSON(c)
}

func (h *Handlers) RecipesGovernanceCoverage(c *gin.Context) {
	coverage := map[string]any{"recipes": 0, "withIngredients": 0, "withSteps": 0}
	var total int
	_ = h.DB.QueryRow(`SELECT COUNT(*) FROM recipes`).Scan(&total)
	coverage["recipes"] = total
	if h.hasColumn("recipes", "ingredients_json") {
		var withIng int
		_ = h.DB.QueryRow(`SELECT COUNT(*) FROM recipes WHERE COALESCE(ingredients_json,'') != ''`).Scan(&withIng)
		coverage["withIngredients"] = withIng
	}
	if h.hasColumn("recipes", "steps_json") {
		var withSteps int
		_ = h.DB.QueryRow(`SELECT COUNT(*) FROM recipes WHERE COALESCE(steps_json,'') != ''`).Scan(&withSteps)
		coverage["withSteps"] = withSteps
	}
	c.JSON(http.StatusOK, gin.H{"coverage": coverage})
}
