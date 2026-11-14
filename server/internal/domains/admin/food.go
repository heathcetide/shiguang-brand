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
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("pageSize", "50"))
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 200 {
		pageSize = 50
	}
	if table == "" {
		c.JSON(http.StatusOK, gin.H{"items": []any{}, "total": 0, "page": page, "pageSize": pageSize})
		return
	}
	search := strings.TrimSpace(c.Query("search"))
	category := strings.TrimSpace(c.Query("category"))
	source := strings.TrimSpace(c.Query("source"))
	where := []string{"1=1"}
	args := make([]any, 0)
	if search != "" {
		where = append(where, "name LIKE ?")
		args = append(args, "%"+search+"%")
	}
	if category != "" && category != "全部" {
		where = append(where, "category=?")
		args = append(args, category)
	}
	if source != "" && source != "全部" && h.hasColumn(table, "source") {
		where = append(where, "source=?")
		args = append(args, source)
	}
	whereSQL := strings.Join(where, " AND ")
	var total int
	countArgs := append([]any{}, args...)
	_ = h.DB.QueryRow(`SELECT COUNT(*) FROM `+table+` WHERE `+whereSQL, countArgs...).Scan(&total)
	offset := (page - 1) * pageSize
	selectSQL := `SELECT id, name, COALESCE(category,''), COALESCE(unit,'')`
	if h.hasColumn(table, "calories_100g") {
		selectSQL += `, COALESCE(calories_100g,0), COALESCE(protein_100g,0), COALESCE(carbs_100g,0), COALESCE(fat_100g,0)`
	} else {
		selectSQL += `, 0, 0, 0, 0`
	}
	if h.hasColumn(table, "source") {
		selectSQL += `, COALESCE(source,'')`
	} else {
		selectSQL += `, ''`
	}
	hasImage := h.hasColumn(table, "image_url")
	hasBrands := h.hasColumn(table, "brands")
	hasBarcode := h.hasColumn(table, "barcode")
	if hasImage {
		selectSQL += `, COALESCE(image_url,'')`
	}
	if hasBrands {
		selectSQL += `, COALESCE(brands,'')`
	}
	if hasBarcode {
		selectSQL += `, COALESCE(barcode,'')`
	}
	selectSQL += ` FROM ` + table + ` WHERE ` + whereSQL + ` ORDER BY id DESC LIMIT ? OFFSET ?`
	args = append(args, pageSize, offset)
	rows, err := h.DB.Query(selectSQL, args...)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"items": []any{}, "total": 0, "page": page, "pageSize": pageSize})
		return
	}
	defer rows.Close()
	list := make([]map[string]any, 0)
	for rows.Next() {
		var id int
		var name, category, unit, sourceName string
		var calories, protein, carbs, fat float64
		scan := []any{&id, &name, &category, &unit, &calories, &protein, &carbs, &fat, &sourceName}
		var imageURL, brands, barcode string
		if hasImage {
			scan = append(scan, &imageURL)
		}
		if hasBrands {
			scan = append(scan, &brands)
		}
		if hasBarcode {
			scan = append(scan, &barcode)
		}
		if err := rows.Scan(scan...); err != nil {
			continue
		}
		item := map[string]any{
			"id": id, "name": name, "category": category, "unit": unit,
			"calories_100g": calories, "protein_100g": protein, "carbs_100g": carbs, "fat_100g": fat,
			"source": sourceName,
		}
		if hasImage && imageURL != "" {
			item["image_url"] = imageURL
		} else {
			item["image_url"] = nil
		}
		if hasBrands {
			item["brands"] = brands
		}
		if hasBarcode {
			item["barcode"] = barcode
		}
		list = append(list, item)
	}
	c.JSON(http.StatusOK, gin.H{"items": list, "ingredients": list, "total": total, "page": page, "pageSize": pageSize})
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
	id, err := h.DB.InsertID(`INSERT INTO `+table+` (name, category, unit) VALUES (?, ?, ?)`, body.Name, body.Category, body.Unit)
	if err != nil {
		httpx.SendError(c, http.StatusInternalServerError, "创建食材失败", "INGREDIENT_CREATE_FAILED")
		return
	}

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
	if !h.hasTable("user_custom_foods") || !h.hasColumn("user_custom_foods", "status") {
		c.JSON(http.StatusOK, []any{})
		return
	}
	rows, err := h.DB.Query(`SELECT id, user_id, name, COALESCE(category,''), COALESCE(unit,'') FROM user_custom_foods WHERE status='pending' LIMIT 200`)
	if err != nil {
		c.JSON(http.StatusOK, []any{})
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
		list = append(list, map[string]any{"id": id, "user_id": userID, "userId": userID, "name": name, "category": category, "unit": unit})
	}
	// Express returns a bare array; keep that contract for the admin UI.
	c.JSON(http.StatusOK, list)
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
