// Copyright (c) 2026 heathcetide. All rights reserved.

package admin

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/heathcetide/DietDigiDose/internal/httpx"
)

func (h *Handlers) ingredientsTable() string {
	if h.hasTable("ingredients_library") {
		return "ingredients_library"
	}
	if h.hasTable("foods") {
		return "foods"
	}
	if h.hasTable("ingredients") {
		return "ingredients"
	}
	return ""
}

func (h *Handlers) ListIngredients(c *gin.Context) {
	table := h.ingredientsTable()
	if table == "" {
		c.JSON(http.StatusOK, gin.H{"ingredients": []any{}})
		return
	}
	rows, err := h.DB.Query(`SELECT id, name, COALESCE(category,''), COALESCE(unit,'') FROM ` + table + ` ORDER BY id DESC LIMIT 200`)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"ingredients": []any{}})
		return
	}
	defer rows.Close()
	list := make([]map[string]any, 0)
	for rows.Next() {
		var id int
		var name, category, unit string
		if err := rows.Scan(&id, &name, &category, &unit); err != nil {
			continue
		}
		list = append(list, map[string]any{"id": id, "name": name, "category": category, "unit": unit})
	}
	c.JSON(http.StatusOK, gin.H{"ingredients": list})
}

func (h *Handlers) CreateIngredient(c *gin.Context) {
	table := h.ingredientsTable()
	if table == "" {
		httpx.SendError(c, http.StatusServiceUnavailable, "食材表不可用", "INGREDIENTS_TABLE_MISSING")
		return
	}
	var body struct {
		Name     string `json:"name"`
		Category string `json:"category"`
		Unit     string `json:"unit"`
	}
	if !bindJSON(c, &body) || strings.TrimSpace(body.Name) == "" {
		if strings.TrimSpace(body.Name) == "" {
			httpx.SendError(c, http.StatusBadRequest, "名称不能为空", "INVALID_BODY")
		}
		return
	}
	res, err := h.DB.Exec(`INSERT INTO `+table+` (name, category, unit) VALUES (?, ?, ?)`, body.Name, body.Category, body.Unit)
	if err != nil {
		httpx.SendError(c, http.StatusInternalServerError, "创建食材失败", "INGREDIENT_CREATE_FAILED")
		return
	}
	id, _ := res.LastInsertId()
	h.recordAudit(c, "ingredient.create", "ingredient", strconv.FormatInt(id, 10), "创建食材")
	c.JSON(http.StatusCreated, gin.H{"id": id})
}

func (h *Handlers) UpdateIngredient(c *gin.Context) {
	table := h.ingredientsTable()
	id, ok := parseIDParam(c)
	if !ok || table == "" {
		return
	}
	var body struct {
		Name     string `json:"name"`
		Category string `json:"category"`
		Unit     string `json:"unit"`
	}
	if !bindJSON(c, &body) {
		return
	}
	_, err := h.DB.Exec(`UPDATE `+table+` SET name=COALESCE(NULLIF(?,''), name), category=COALESCE(NULLIF(?,''), category), unit=COALESCE(NULLIF(?,''), unit) WHERE id=?`,
		body.Name, body.Category, body.Unit, id)
	if err != nil {
		httpx.SendError(c, http.StatusInternalServerError, "更新食材失败", "INGREDIENT_UPDATE_FAILED")
		return
	}
	h.recordAudit(c, "ingredient.update", "ingredient", strconv.Itoa(id), "更新食材")
	okJSON(c)
}

func (h *Handlers) DeleteIngredient(c *gin.Context) {
	table := h.ingredientsTable()
	id, ok := parseIDParam(c)
	if !ok || table == "" {
		okJSON(c)
		return
	}
	_, _ = h.DB.Exec(`DELETE FROM `+table+` WHERE id=?`, id)
	h.recordAudit(c, "ingredient.delete", "ingredient", strconv.Itoa(id), "删除食材")
	okJSON(c)
}

func (h *Handlers) IngredientAliasesPost(c *gin.Context) {
	id, ok := parseIDParam(c)
	if !ok {
		return
	}
	h.recordAudit(c, "ingredient.aliases", "ingredient", strconv.Itoa(id), "更新食材别名")
	okJSON(c)
}

func (h *Handlers) IngredientMergePost(c *gin.Context) {
	id, ok := parseIDParam(c)
	if !ok {
		return
	}
	h.recordAudit(c, "ingredient.merge", "ingredient", strconv.Itoa(id), "合并食材")
	okJSON(c)
}

func (h *Handlers) IngredientsGovernanceCoverage(c *gin.Context) {
	table := h.ingredientsTable()
	total := 0
	if table != "" {
		_ = h.DB.QueryRow(`SELECT COUNT(*) FROM ` + table).Scan(&total)
	}
	c.JSON(http.StatusOK, gin.H{"coverage": map[string]any{"ingredients": total}})
}

func (h *Handlers) CustomFoodsPending(c *gin.Context) {
	if !h.hasTable("user_custom_foods") {
		c.JSON(http.StatusOK, gin.H{"items": []any{}})
		return
	}
	if !h.hasColumn("user_custom_foods", "status") {
		c.JSON(http.StatusOK, gin.H{"items": []any{}})
		return
	}
	rows, err := h.DB.Query(`SELECT id, user_id, name, category, unit FROM user_custom_foods WHERE status='pending' LIMIT 200`)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"items": []any{}})
		return
	}
	defer rows.Close()
	list := make([]map[string]any, 0)
	for rows.Next() {
		var id, userID int
		var name, category, unit string
		if err := rows.Scan(&id, &userID, &name, &category, &unit); err != nil {
			continue
		}
		list = append(list, map[string]any{"id": id, "userId": userID, "name": name, "category": category, "unit": unit})
	}
	c.JSON(http.StatusOK, gin.H{"items": list})
}

func (h *Handlers) setCustomFoodStatus(c *gin.Context, id int, status string) {
	if h.hasTable("user_custom_foods") && h.hasColumn("user_custom_foods", "status") {
		_, _ = h.DB.Exec(`UPDATE user_custom_foods SET status=? WHERE id=?`, status, id)
	}
	h.recordAudit(c, "custom_food."+status, "custom_food", strconv.Itoa(id), "审核自定义食材")
	okJSON(c)
}

func (h *Handlers) CustomFoodApprove(c *gin.Context) {
	id, ok := parseIDParam(c)
	if !ok {
		return
	}
	h.setCustomFoodStatus(c, id, "approved")
}

func (h *Handlers) CustomFoodReject(c *gin.Context) {
	id, ok := parseIDParam(c)
	if !ok {
		return
	}
	h.setCustomFoodStatus(c, id, "rejected")
}
