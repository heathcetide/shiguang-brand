// Copyright (c) 2026 heathcetide. All rights reserved.

package catalog

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/heathcetide/DietDigiDose/internal/httpx"
)

func (h *Handlers) SearchFoods(c *gin.Context) {
	q := strings.TrimSpace(c.Query("q"))
	if q == "" {
		q = strings.TrimSpace(c.Query("query"))
	}
	if q == "" {
		httpx.SendError(c, http.StatusBadRequest, "搜索词不能为空", "INVALID_QUERY")
		return
	}
	if h.hasColumn("ingredients_library", "base_data_payload") && h.hasTable("nutrition_source_samples") {
		h.searchReferenceFoods(c, q)
		return
	}
	table := h.foodsTable()
	if table == "" {
		c.JSON(http.StatusOK, []any{})
		return
	}
	like := "%" + q + "%"
	limit := 15
	hasMacros := h.hasColumn(table, "calories_100g")
	querySQL := `SELECT id, name, COALESCE(category,''), COALESCE(unit,'') FROM ` + table + `
		WHERE deleted_at IS NULL AND name LIKE ? ORDER BY id DESC LIMIT ?`
	fallbackSQL := `SELECT id, name, COALESCE(category,''), COALESCE(unit,'') FROM ` + table + `
		WHERE name LIKE ? ORDER BY id DESC LIMIT ?`
	if hasMacros {
		querySQL = `SELECT id, name, COALESCE(category,''), COALESCE(unit,''),
			calories_100g, protein_100g, fat_100g, carbs_100g FROM ` + table + `
			WHERE deleted_at IS NULL AND name LIKE ? ORDER BY id DESC LIMIT ?`
		fallbackSQL = `SELECT id, name, COALESCE(category,''), COALESCE(unit,''),
			calories_100g, protein_100g, fat_100g, carbs_100g FROM ` + table + `
			WHERE name LIKE ? ORDER BY id DESC LIMIT ?`
	}
	rows, err := h.DB.Query(querySQL, like, limit)
	if err != nil {
		rows, err = h.DB.Query(fallbackSQL, like, limit)
	}
	if err != nil {
		httpx.SendError(c, http.StatusInternalServerError, "搜索失败", "FOOD_SEARCH_FAILED")
		return
	}
	defer rows.Close()
	list := make([]map[string]any, 0)
	for rows.Next() {
		var id int
		var name, category, unit string
		item := map[string]any{}
		if hasMacros {
			var cal, protein, fat, carbs sql.NullFloat64
			if err := rows.Scan(&id, &name, &category, &unit, &cal, &protein, &fat, &carbs); err != nil {
				continue
			}
			item = map[string]any{"id": id, "name": name, "category": category, "unit": unit}
			if cal.Valid {
				item["calories_100g"] = cal.Float64
			}
			if protein.Valid {
				item["protein_100g"] = protein.Float64
			}
			if fat.Valid {
				item["fat_100g"] = fat.Float64
			}
			if carbs.Valid {
				item["carbs_100g"] = carbs.Float64
			}
		} else {
			if err := rows.Scan(&id, &name, &category, &unit); err != nil {
				continue
			}
			item = map[string]any{"id": id, "name": name, "category": category, "unit": unit}
		}
		list = append(list, item)
	}
	c.JSON(http.StatusOK, list)
}

// searchReferenceFoods exposes source samples without automatically binding a
// generic food concept to them. Consumers must explicitly confirm scope/weight.
func (h *Handlers) searchReferenceFoods(c *gin.Context, query string) {
	like := "%" + query + "%"
	rows, err := h.DB.Query(`SELECT id,name,COALESCE(category,''),COALESCE(unit,''),
		COALESCE(source,''),COALESCE(source_ref,''),COALESCE(source_version,''),
		COALESCE(data_license,''),COALESCE(quality_status,'needs_review')
		FROM ingredients_library WHERE (name LIKE ? OR aliases_json LIKE ?)
		AND quality_status IN ('reference','trusted') ORDER BY CASE WHEN name=? THEN 0 ELSE 1 END,id LIMIT 15`, like, like, query)
	if err != nil {
		httpx.SendError(c, http.StatusInternalServerError, "搜索失败", "FOOD_SEARCH_FAILED")
		return
	}
	items := make([]map[string]any, 0)
	for rows.Next() {
		var id int
		var name, category, unit, source, ref, version, license, quality string
		if err := rows.Scan(&id, &name, &category, &unit, &source, &ref, &version, &license, &quality); err != nil {
			rows.Close()
			httpx.SendError(c, http.StatusInternalServerError, "搜索失败", "FOOD_SEARCH_FAILED")
			return
		}
		items = append(items, map[string]any{"id": id, "name": name, "category": category, "unit": unit,
			"source": source, "source_ref": ref, "source_version": version, "data_license": license,
			"quality_status": quality, "nutrition_basis": "unknown", "automatic_calculation_allowed": false,
			"calories_100g": nil, "protein_100g": nil, "fat_100g": nil, "carbs_100g": nil})
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		httpx.SendError(c, http.StatusInternalServerError, "搜索失败", "FOOD_SEARCH_FAILED")
		return
	}
	// Close the list cursor before nested queries (SQLite may use one connection).
	for _, item := range items {
		references := make([]any, 0)
		samples, err := h.DB.Query(`SELECT sample_id,display_name,source_kind,source_url,data_license,scope,nutrients_json
			FROM nutrition_source_samples WHERE ingredient_id=? ORDER BY dataset_id,sample_id`, item["id"])
		if err != nil {
			httpx.SendError(c, http.StatusInternalServerError, "读取营养参考失败", "FOOD_SEARCH_FAILED")
			return
		}
		for samples.Next() {
			var id, name, kind, url, license, scope, nutrients string
			if err := samples.Scan(&id, &name, &kind, &url, &license, &scope, &nutrients); err != nil {
				samples.Close()
				httpx.SendError(c, http.StatusInternalServerError, "读取营养参考失败", "FOOD_SEARCH_FAILED")
				return
			}
			var parsed any
			if json.Unmarshal([]byte(nutrients), &parsed) != nil {
				samples.Close()
				httpx.SendError(c, http.StatusInternalServerError, "营养参考格式错误", "FOOD_SEARCH_FAILED")
				return
			}
			references = append(references, map[string]any{"id": id, "display_name": name, "source_kind": kind,
				"source_url": url, "source_license": license, "scope": scope, "basis": "per_100g_edible_portion",
				"nutrients_per_100g": parsed, "requires_scope_confirmation": true, "automatic_runtime_binding": false})
		}
		err = samples.Err()
		samples.Close()
		if err != nil {
			httpx.SendError(c, http.StatusInternalServerError, "读取营养参考失败", "FOOD_SEARCH_FAILED")
			return
		}
		item["nutrition_references"] = references
	}
	c.JSON(http.StatusOK, items)
}

func (h *Handlers) FoodByBarcode(c *gin.Context) {
	code := strings.TrimSpace(c.Param("code"))
	if !barcodePattern.MatchString(code) {
		httpx.SendError(c, http.StatusBadRequest, "条码格式无效", "INVALID_BARCODE")
		return
	}
	table := h.foodsTable()
	if table == "" || !h.hasColumn(table, "barcode") {
		httpx.SendError(c, http.StatusNotFound, "食品库暂未收录该条码", "BARCODE_NOT_FOUND")
		return
	}
	var id int
	var name, category, barcode, imageURL sql.NullString
	err := h.DB.QueryRow(`SELECT id, name, COALESCE(category,''), COALESCE(barcode,''), COALESCE(image_url,'')
		FROM `+table+` WHERE barcode=? AND (deleted_at IS NULL OR deleted_at='') LIMIT 1`, code).
		Scan(&id, &name, &category, &barcode, &imageURL)
	if err == sql.ErrNoRows {
		httpx.SendError(c, http.StatusNotFound, "食品库暂未收录该条码", "BARCODE_NOT_FOUND")
		return
	}
	if err != nil {
		httpx.SendError(c, http.StatusInternalServerError, "查询失败", "BARCODE_LOOKUP_FAILED")
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"id": id, "name": name.String, "category": category.String, "barcode": code,
		"image_url": emptyNil(imageURL.String),
	})
}
