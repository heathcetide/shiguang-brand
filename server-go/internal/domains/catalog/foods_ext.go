// Copyright (c) 2026 heathcetide. All rights reserved.

package catalog

import (
	"database/sql"
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
	table := h.foodsTable()
	if table == "" {
		c.JSON(http.StatusOK, []any{})
		return
	}
	like := "%" + q + "%"
	limit := 15
	rows, err := h.DB.Query(`SELECT id, name, COALESCE(category,''), COALESCE(unit,'') FROM `+table+`
		WHERE deleted_at IS NULL AND name LIKE ? ORDER BY id DESC LIMIT ?`, like, limit)
	if err != nil {
		rows, err = h.DB.Query(`SELECT id, name, COALESCE(category,''), COALESCE(unit,'') FROM `+table+`
			WHERE name LIKE ? ORDER BY id DESC LIMIT ?`, like, limit)
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
		if err := rows.Scan(&id, &name, &category, &unit); err != nil {
			continue
		}
		list = append(list, map[string]any{"id": id, "name": name, "category": category, "unit": unit})
	}
	c.JSON(http.StatusOK, list)
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
