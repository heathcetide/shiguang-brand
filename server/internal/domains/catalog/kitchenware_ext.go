// Copyright (c) 2026 heathcetide. All rights reserved.

package catalog

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/heathcetide/DietDigiDose/internal/expressauth"
	"github.com/heathcetide/DietDigiDose/internal/httpx"
)

func (h *Handlers) KitchenwareCatalog(c *gin.Context) {
	table := h.kitchenwareCatalogTable()
	if table == "" {
		c.JSON(http.StatusOK, []any{})
		return
	}
	q := strings.TrimSpace(c.Query("query"))
	sqlText := `SELECT id, name, COALESCE(category,'') FROM ` + table + ` ORDER BY id DESC LIMIT 200`
	var rows *sql.Rows
	var err error
	if q != "" {
		like := "%" + q + "%"
		rows, err = h.DB.Query(`SELECT id, name, COALESCE(category,'') FROM `+table+`
			WHERE name LIKE ? ORDER BY id DESC LIMIT 200`, like)
	} else {
		rows, err = h.DB.Query(sqlText)
	}
	if err != nil {
		c.JSON(http.StatusOK, []any{})
		return
	}
	defer rows.Close()
	items := make([]map[string]any, 0)
	for rows.Next() {
		var id int
		var name, category string
		if err := rows.Scan(&id, &name, &category); err != nil {
			continue
		}
		items = append(items, map[string]any{"id": id, "name": name, "category": category})
	}
	c.JSON(http.StatusOK, items)
}

func (h *Handlers) KitchenwareCapabilities(c *gin.Context) {
	if !h.hasTable("kitchenware_capabilities") {
		c.JSON(http.StatusOK, []any{})
		return
	}
	rows, err := h.DB.Query(`SELECT code, name, COALESCE(description,''), COALESCE(safety_level,'normal')
		FROM kitchenware_capabilities ORDER BY code`)
	if err != nil {
		c.JSON(http.StatusOK, []any{})
		return
	}
	defer rows.Close()
	list := make([]map[string]any, 0)
	for rows.Next() {
		var code, name, description, safety string
		if err := rows.Scan(&code, &name, &description, &safety); err != nil {
			continue
		}
		list = append(list, map[string]any{"code": code, "name": name, "description": description, "safety_level": safety})
	}
	c.JSON(http.StatusOK, list)
}

func (h *Handlers) KitchenwareRecipeCompatibility(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	recipeID, ok := parsePositiveID(c, "id")
	if !ok {
		return
	}
	var exists int
	_ = h.DB.QueryRow(`SELECT id FROM recipes WHERE id=?`, recipeID).Scan(&exists)
	if exists == 0 {
		httpx.SendError(c, http.StatusNotFound, "菜谱不存在", "RECIPE_NOT_FOUND")
		return
	}
	requirements := h.loadRecipeKitchenwareRequirements(recipeID)
	owned := h.loadUserKitchenwareNames(userID)
	blocking := make([]map[string]any, 0)
	evaluated := make([]map[string]any, 0, len(requirements))
	for _, req := range requirements {
		name := asString(req["name"])
		role := asString(req["role"])
		satisfied := false
		for _, own := range owned {
			if strings.Contains(own, name) || strings.Contains(name, own) {
				satisfied = true
				break
			}
		}
		entry := map[string]any{"role": role, "name": name, "satisfied": satisfied, "substitution": nil}
		evaluated = append(evaluated, entry)
		if role == "required" && !satisfied && name != "" {
			blocking = append(blocking, entry)
		}
	}
	c.JSON(http.StatusOK, gin.H{"requirements": evaluated, "blocking": blocking})
}

func (h *Handlers) UpdateKitchenware(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	id, ok := parsePositiveID(c, "id")
	if !ok {
		return
	}
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
	res, err := h.DB.Exec(`UPDATE kitchenware_items SET name=?, category=?, status=?, note=?
		WHERE id=? AND user_id=?`, body.Name, body.Category, body.Status, body.Note, id, userID)
	if err != nil {
		httpx.SendError(c, http.StatusInternalServerError, "更新厨具失败", "KITCHENWARE_FAILED")
		return
	}
	n, _ := res.RowsAffected()
	if n != 1 {
		httpx.SendError(c, http.StatusNotFound, "厨具不存在或无权修改", "KITCHENWARE_NOT_FOUND")
		return
	}
	c.JSON(http.StatusOK, gin.H{"id": id, "name": body.Name, "category": body.Category, "status": body.Status, "note": body.Note})
}

func (h *Handlers) MaintainKitchenware(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	id, ok := parsePositiveID(c, "id")
	if !ok {
		return
	}
	res, err := h.DB.Exec(`UPDATE kitchenware_items SET status='良好' WHERE id=? AND user_id=?`, id, userID)
	if err != nil {
		httpx.SendError(c, http.StatusInternalServerError, "保养记录失败", "KITCHENWARE_FAILED")
		return
	}
	n, _ := res.RowsAffected()
	if n != 1 {
		httpx.SendError(c, http.StatusNotFound, "厨具不存在或无权修改", "KITCHENWARE_NOT_FOUND")
		return
	}
	var name, category, status, note string
	_ = h.DB.QueryRow(`SELECT name, category, COALESCE(status,''), COALESCE(note,'')
		FROM kitchenware_items WHERE id=? AND user_id=?`, id, userID).Scan(&name, &category, &status, &note)
	c.JSON(http.StatusOK, gin.H{"id": id, "name": name, "category": category, "status": status, "note": note})
}

func (h *Handlers) loadRecipeKitchenwareRequirements(recipeID int) []map[string]any {
	if h.hasTable("recipe_kitchenware_requirements") {
		capCol := "''"
		if h.hasColumn("recipe_kitchenware_requirements", "capability_code") {
			capCol = "COALESCE(r.capability_code,'')"
		}
		rows, err := h.DB.Query(`SELECT COALESCE(role,'required'), `+capCol+`, COALESCE(c.capability_code,''), COALESCE(c.name,'')
			FROM recipe_kitchenware_requirements r
			LEFT JOIN kitchenware_catalog c ON c.id = r.catalog_id
			WHERE r.recipe_id = ?`, recipeID)
		if err == nil {
			defer rows.Close()
			out := make([]map[string]any, 0)
			for rows.Next() {
				var role, reqCap, catCap, name string
				if err := rows.Scan(&role, &reqCap, &catCap, &name); err != nil {
					continue
				}
				cap := reqCap
				if cap == "" {
					cap = catCap
				}
				if name == "" {
					name = cap
				}
				out = append(out, map[string]any{"role": role, "name": name, "capability": cap})
			}
			if len(out) > 0 {
				return out
			}
		}
	}
	if h.hasColumn("recipes", "required_kitchenware_json") || h.hasColumn("recipes", "optional_kitchenware_json") {
		var requiredJSON, optionalJSON sql.NullString
		q := `SELECT COALESCE(required_kitchenware_json,'[]'), COALESCE(optional_kitchenware_json,'[]') FROM recipes WHERE id=?`
		if !h.hasColumn("recipes", "required_kitchenware_json") {
			q = `SELECT '[]', COALESCE(optional_kitchenware_json,'[]') FROM recipes WHERE id=?`
		} else if !h.hasColumn("recipes", "optional_kitchenware_json") {
			q = `SELECT COALESCE(required_kitchenware_json,'[]'), '[]' FROM recipes WHERE id=?`
		}
		if err := h.DB.QueryRow(q, recipeID).Scan(&requiredJSON, &optionalJSON); err == nil {
			return parseKitchenwareJSON(requiredJSON.String, optionalJSON.String)
		}
	}
	return []map[string]any{}
}

func (h *Handlers) loadUserKitchenwareNames(userID int) []string {
	rows, err := h.DB.Query(`SELECT name FROM kitchenware_items WHERE user_id=? AND deleted_at IS NULL`, userID)
	if err != nil {
		rows, err = h.DB.Query(`SELECT name FROM kitchenware_items WHERE user_id=?`, userID)
	}
	if err != nil {
		return nil
	}
	defer rows.Close()
	names := make([]string, 0)
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err == nil && strings.TrimSpace(name) != "" {
			names = append(names, strings.TrimSpace(name))
		}
	}
	return names
}

func parseKitchenwareJSON(required, optional string) []map[string]any {
	out := make([]map[string]any, 0)
	for _, raw := range []struct {
		text string
		role string
	}{{required, "required"}, {optional, "optional"}} {
		if strings.TrimSpace(raw.text) == "" {
			continue
		}
		var items []any
		if err := json.Unmarshal([]byte(raw.text), &items); err != nil {
			continue
		}
		for _, item := range items {
			name := asString(item)
			if name == "" {
				if m, ok := item.(map[string]any); ok {
					name = asString(m["name"])
				}
			}
			if name != "" {
				out = append(out, map[string]any{"role": raw.role, "name": name})
			}
		}
	}
	return out
}
