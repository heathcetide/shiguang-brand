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

func (h *Handlers) kitchenwareCatalogTable() string {
	if h.hasTable("kitchenware_catalog") {
		return "kitchenware_catalog"
	}
	if h.hasTable("kitchenware") {
		return "kitchenware"
	}
	return ""
}

func (h *Handlers) KitchenwareCatalogList(c *gin.Context) {
	table := h.kitchenwareCatalogTable()
	if table == "" {
		emptyJSONArray(c, "items")
		return
	}
	rows, err := h.DB.Query(`SELECT id, name, COALESCE(category,'') FROM ` + table + ` ORDER BY id DESC LIMIT 200`)
	if err != nil {
		emptyJSONArray(c, "items")
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
	c.JSON(http.StatusOK, gin.H{"items": items})
}

func (h *Handlers) KitchenwareCatalogCreate(c *gin.Context) {
	table := h.kitchenwareCatalogTable()
	if table == "" {
		httpx.SendError(c, http.StatusServiceUnavailable, "厨具目录表不可用", "KITCHENWARE_CATALOG_MISSING")
		return
	}
	var body struct {
		Name     string `json:"name"`
		Category string `json:"category"`
	}
	if !bindJSON(c, &body) || strings.TrimSpace(body.Name) == "" {
		if strings.TrimSpace(body.Name) == "" {
			httpx.SendError(c, http.StatusBadRequest, "名称不能为空", "INVALID_BODY")
		}
		return
	}
	id, err := h.DB.InsertID(`INSERT INTO `+table+` (name, category) VALUES (?, ?)`, body.Name, body.Category)
	if err != nil {
		httpx.SendError(c, http.StatusInternalServerError, "创建失败", "KITCHENWARE_CREATE_FAILED")
		return
	}

	h.recordAudit(c, "kitchenware_catalog.create", "kitchenware_catalog", strconv.FormatInt(id, 10), "创建厨具目录")
	c.JSON(http.StatusCreated, gin.H{"id": id})
}

func (h *Handlers) KitchenwareCatalogUpdate(c *gin.Context) {
	table := h.kitchenwareCatalogTable()
	id, ok := parseIDParam(c)
	if !ok || table == "" {
		if table == "" {
			httpx.SendError(c, http.StatusServiceUnavailable, "厨具目录表不可用", "KITCHENWARE_CATALOG_MISSING")
		}
		return
	}
	var body struct {
		Name     string `json:"name"`
		Category string `json:"category"`
	}
	if !bindJSON(c, &body) {
		return
	}
	_, err := h.DB.Exec(`UPDATE `+table+` SET name=COALESCE(NULLIF(?,''), name), category=COALESCE(NULLIF(?,''), category) WHERE id=?`,
		body.Name, body.Category, id)
	if err != nil {
		httpx.SendError(c, http.StatusInternalServerError, "更新失败", "KITCHENWARE_UPDATE_FAILED")
		return
	}
	h.recordAudit(c, "kitchenware_catalog.update", "kitchenware_catalog", strconv.Itoa(id), "更新厨具目录")
	okJSON(c)
}

func (h *Handlers) KitchenwareCatalogDelete(c *gin.Context) {
	table := h.kitchenwareCatalogTable()
	id, ok := parseIDParam(c)
	if !ok || table == "" {
		okJSON(c)
		return
	}
	_, _ = h.DB.Exec(`DELETE FROM `+table+` WHERE id=?`, id)
	h.recordAudit(c, "kitchenware_catalog.delete", "kitchenware_catalog", strconv.Itoa(id), "删除厨具目录")
	okJSON(c)
}

func (h *Handlers) KitchenwareMappingReviews(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"reviews": []any{}})
}

func (h *Handlers) KitchenwareMappingReviewPost(c *gin.Context) {
	id := c.Param("id")
	h.recordAudit(c, "kitchenware_mapping.review", "kitchenware_mapping", id, "处理映射审核")
	okJSON(c)
}

func (h *Handlers) capabilitiesKey(id int) string {
	return "kitchenware.capabilities." + strconv.Itoa(id)
}

func (h *Handlers) KitchenwareCapabilitiesGet(c *gin.Context) {
	id, ok := parseIDParam(c)
	if !ok {
		return
	}
	v, found := h.getSetting(h.capabilitiesKey(id))
	if !found {
		c.JSON(http.StatusOK, gin.H{"capabilities": map[string]any{}})
		return
	}
	c.JSON(http.StatusOK, gin.H{"capabilities": parseJSONMap(v)})
}

func (h *Handlers) KitchenwareCapabilitiesPut(c *gin.Context) {
	id, ok := parseIDParam(c)
	if !ok {
		return
	}
	var body map[string]any
	if !bindJSON(c, &body) {
		return
	}
	raw, _ := json.Marshal(body)
	h.upsertSetting(h.capabilitiesKey(id), string(raw))
	h.recordAudit(c, "kitchenware_capabilities.update", "kitchenware_catalog", strconv.Itoa(id), "更新厨具能力")
	okJSON(c)
}

func (h *Handlers) KitchenwareAdminList(c *gin.Context) {
	if !h.hasTable("kitchenware_items") {
		emptyJSONArray(c, "items")
		return
	}
	rows, err := h.DB.Query(`SELECT id, user_id, name, category, COALESCE(status,'') FROM kitchenware_items ORDER BY id DESC LIMIT 200`)
	if err != nil {
		emptyJSONArray(c, "items")
		return
	}
	defer rows.Close()
	items := make([]map[string]any, 0)
	for rows.Next() {
		var id, userID int
		var name, category, status string
		if err := rows.Scan(&id, &userID, &name, &category, &status); err != nil {
			continue
		}
		items = append(items, map[string]any{"id": id, "userId": userID, "name": name, "category": category, "status": status})
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

func (h *Handlers) KitchenwareStatusPut(c *gin.Context) {
	id, ok := parseIDParam(c)
	if !ok {
		return
	}
	var body struct {
		Status string `json:"status"`
	}
	if !bindJSON(c, &body) {
		return
	}
	if h.hasTable("kitchenware_items") {
		_, _ = h.DB.Exec(`UPDATE kitchenware_items SET status=? WHERE id=?`, body.Status, id)
	}
	h.recordAudit(c, "kitchenware.status.update", "kitchenware", strconv.Itoa(id), "更新厨具状态")
	okJSON(c)
}

func (h *Handlers) KitchenwareDelete(c *gin.Context) {
	id, ok := parseIDParam(c)
	if !ok {
		return
	}
	if h.hasTable("kitchenware_items") {
		_, _ = h.DB.Exec(`DELETE FROM kitchenware_items WHERE id=?`, id)
	}
	h.recordAudit(c, "kitchenware.delete", "kitchenware", strconv.Itoa(id), "删除用户厨具")
	okJSON(c)
}
