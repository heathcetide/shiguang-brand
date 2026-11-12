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
	page, pageSize, offset := parsePageParams(c, 50, 200)
	if table == "" {
		c.JSON(http.StatusOK, gin.H{"items": []any{}, "total": 0, "page": page, "pageSize": pageSize})
		return
	}
	hasImage := h.hasColumn(table, "image_url")
	hasDesc := h.hasColumn(table, "description")
	hasSource := h.hasColumn(table, "source")
	search := strings.TrimSpace(c.Query("search"))
	category := strings.TrimSpace(c.Query("category"))
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
	whereSQL := strings.Join(where, " AND ")
	var total int
	_ = h.DB.QueryRow(`SELECT COUNT(*) FROM `+table+` WHERE `+whereSQL, args...).Scan(&total)

	selectSQL := `SELECT id, name, COALESCE(category,'')`
	if hasImage {
		selectSQL += `, COALESCE(image_url,'')`
	}
	if hasDesc {
		selectSQL += `, COALESCE(description,'')`
	}
	if hasSource {
		selectSQL += `, COALESCE(source,'')`
	}
	// Prefer Chinese catalog names first so admin default view is localized.
	selectSQL += ` FROM ` + table + ` WHERE ` + whereSQL +
		` ORDER BY CASE WHEN name GLOB '*[一-龥]*' THEN 0 ELSE 1 END, id DESC LIMIT ? OFFSET ?`
	queryArgs := append(append([]any{}, args...), pageSize, offset)
	rows, err := h.DB.Query(selectSQL, queryArgs...)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"items": []any{}, "total": 0, "page": page, "pageSize": pageSize})
		return
	}
	defer rows.Close()
	items := make([]map[string]any, 0)
	for rows.Next() {
		var id int
		var name, categoryName string
		scan := []any{&id, &name, &categoryName}
		var imageURL, description, source string
		if hasImage {
			scan = append(scan, &imageURL)
		}
		if hasDesc {
			scan = append(scan, &description)
		}
		if hasSource {
			scan = append(scan, &source)
		}
		if err := rows.Scan(scan...); err != nil {
			continue
		}
		item := map[string]any{"id": id, "name": name, "category": categoryName}
		if hasImage {
			if imageURL != "" {
				item["image_url"] = imageURL
			} else {
				item["image_url"] = nil
			}
		}
		if hasDesc {
			item["description"] = description
		}
		if hasSource {
			item["source"] = source
		}
		items = append(items, item)
	}
	c.JSON(http.StatusOK, gin.H{"items": items, "total": total, "page": page, "pageSize": pageSize})
}

func (h *Handlers) KitchenwareCatalogCreate(c *gin.Context) {
	table := h.kitchenwareCatalogTable()
	if table == "" {
		httpx.SendError(c, http.StatusServiceUnavailable, "厨具目录表不可用", "KITCHENWARE_CATALOG_MISSING")
		return
	}
	var body struct {
		Name        string   `json:"name"`
		Category    string   `json:"category"`
		ImageURL    string   `json:"image_url"`
		Description string   `json:"description"`
		CareNote    string   `json:"care_note"`
		Aliases     []string `json:"aliases"`
	}
	if !bindJSON(c, &body) || strings.TrimSpace(body.Name) == "" {
		if strings.TrimSpace(body.Name) == "" {
			httpx.SendError(c, http.StatusBadRequest, "名称不能为空", "INVALID_BODY")
		}
		return
	}
	desc := strings.TrimSpace(body.Description)
	if desc == "" {
		desc = strings.TrimSpace(body.CareNote)
	}
	cols := []string{"name", "category"}
	vals := []any{strings.TrimSpace(body.Name), body.Category}
	if h.hasColumn(table, "image_url") {
		cols = append(cols, "image_url")
		vals = append(vals, strings.TrimSpace(body.ImageURL))
	}
	if h.hasColumn(table, "description") {
		cols = append(cols, "description")
		vals = append(vals, desc)
	}
	if h.hasColumn(table, "aliases") {
		raw, _ := json.Marshal(body.Aliases)
		cols = append(cols, "aliases")
		vals = append(vals, string(raw))
	}
	if h.hasColumn(table, "source") {
		cols = append(cols, "source")
		vals = append(vals, "official")
	}
	placeholders := make([]string, len(cols))
	for i := range cols {
		placeholders[i] = "?"
	}
	id, err := h.DB.InsertID(`INSERT INTO `+table+` (`+strings.Join(cols, ",")+`) VALUES (`+strings.Join(placeholders, ",")+`)`, vals...)
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
		Name        string   `json:"name"`
		Category    string   `json:"category"`
		ImageURL    string   `json:"image_url"`
		Description string   `json:"description"`
		CareNote    string   `json:"care_note"`
		Aliases     []string `json:"aliases"`
	}
	if !bindJSON(c, &body) {
		return
	}
	desc := strings.TrimSpace(body.Description)
	if desc == "" {
		desc = strings.TrimSpace(body.CareNote)
	}
	sets := []string{"name=COALESCE(NULLIF(?,''), name)", "category=COALESCE(NULLIF(?,''), category)"}
	args := []any{body.Name, body.Category}
	if h.hasColumn(table, "image_url") {
		sets = append(sets, "image_url=?")
		args = append(args, strings.TrimSpace(body.ImageURL))
	}
	if h.hasColumn(table, "description") {
		sets = append(sets, "description=?")
		args = append(args, desc)
	}
	if h.hasColumn(table, "aliases") {
		raw, _ := json.Marshal(body.Aliases)
		sets = append(sets, "aliases=?")
		args = append(args, string(raw))
	}
	args = append(args, id)
	_, err := h.DB.Exec(`UPDATE `+table+` SET `+strings.Join(sets, ", ")+` WHERE id=?`, args...)
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

func (h *Handlers) KitchenwareAdminList(c *gin.Context) {
	page, pageSize, offset := parsePageParams(c, 50, 200)
	if !h.hasTable("kitchenware_items") {
		c.JSON(http.StatusOK, gin.H{"items": []any{}, "total": 0, "page": page, "pageSize": pageSize})
		return
	}
	search := strings.TrimSpace(firstNonEmpty(c.Query("search"), c.Query("q")))
	category := strings.TrimSpace(c.Query("category"))
	status := strings.TrimSpace(c.Query("status"))
	where := []string{"1=1"}
	args := make([]any, 0)
	if h.hasColumn("kitchenware_items", "deleted_at") {
		where = append(where, "k.deleted_at IS NULL")
	}
	if search != "" {
		where = append(where, "(k.name LIKE ? OR COALESCE(k.note,'') LIKE ? OR COALESCE(u.username,'') LIKE ?)")
		like := "%" + search + "%"
		args = append(args, like, like, like)
	}
	if category != "" && category != "全部" {
		where = append(where, "k.category=?")
		args = append(args, category)
	}
	if status != "" && status != "全部" {
		where = append(where, "COALESCE(k.status,'')=?")
		args = append(args, status)
	}
	whereSQL := strings.Join(where, " AND ")
	var total int
	_ = h.DB.QueryRow(`SELECT COUNT(*) FROM kitchenware_items k LEFT JOIN users u ON u.id=k.user_id WHERE `+whereSQL, args...).Scan(&total)

	hasImage := h.hasColumn("kitchenware_items", "image_url")
	hasNote := h.hasColumn("kitchenware_items", "note")
	hasPurchase := h.hasColumn("kitchenware_items", "purchase_date")
	hasMaintained := h.hasColumn("kitchenware_items", "last_maintained_at")
	hasCreated := h.hasColumn("kitchenware_items", "created_at")
	selectSQL := `SELECT k.id, k.user_id, k.name, COALESCE(k.category,''), COALESCE(k.status,''), COALESCE(u.username,'')`
	if hasImage {
		selectSQL += `, COALESCE(k.image_url,'')`
	} else {
		selectSQL += `, ''`
	}
	if hasNote {
		selectSQL += `, COALESCE(k.note,'')`
	} else {
		selectSQL += `, ''`
	}
	if hasPurchase {
		selectSQL += `, COALESCE(k.purchase_date,'')`
	} else {
		selectSQL += `, ''`
	}
	if hasMaintained {
		selectSQL += `, COALESCE(k.last_maintained_at,'')`
	} else {
		selectSQL += `, ''`
	}
	if hasCreated {
		selectSQL += `, COALESCE(k.created_at,'')`
	} else {
		selectSQL += `, ''`
	}
	selectSQL += ` FROM kitchenware_items k LEFT JOIN users u ON u.id=k.user_id WHERE ` + whereSQL + ` ORDER BY k.id DESC LIMIT ? OFFSET ?`
	queryArgs := append(append([]any{}, args...), pageSize, offset)
	rows, err := h.DB.Query(selectSQL, queryArgs...)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"items": []any{}, "total": 0, "page": page, "pageSize": pageSize})
		return
	}
	defer rows.Close()
	items := make([]map[string]any, 0)
	for rows.Next() {
		var id, userID int
		var name, categoryName, statusName, owner, imageURL, note, purchase, maintained, created string
		if err := rows.Scan(&id, &userID, &name, &categoryName, &statusName, &owner, &imageURL, &note, &purchase, &maintained, &created); err != nil {
			continue
		}
		items = append(items, map[string]any{
			"id": id, "user_id": userID, "userId": userID,
			"name": name, "category": categoryName, "status": statusName,
			"owner_username": owner, "image_url": nullIfEmpty(imageURL),
			"note": nullIfEmpty(note), "purchase_date": nullIfEmpty(purchase),
			"last_maintained_at": nullIfEmpty(maintained), "created_at": created,
		})
	}
	c.JSON(http.StatusOK, gin.H{"items": items, "total": total, "page": page, "pageSize": pageSize})
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
