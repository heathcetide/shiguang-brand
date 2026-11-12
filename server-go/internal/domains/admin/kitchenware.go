// Copyright (c) 2026 heathcetide. All rights reserved.

package admin

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
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
	hasQuality := h.hasColumn(table, "quality_status")
	hasAliases := h.hasColumn(table, "aliases")
	search := strings.TrimSpace(firstNonEmpty(c.Query("search"), c.Query("q")))
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
	if hasQuality {
		selectSQL += `, COALESCE(quality_status,'needs_review')`
	}
	if hasAliases {
		selectSQL += `, COALESCE(aliases,'[]')`
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
		var imageURL, description, source, quality, aliases string
		if hasImage {
			scan = append(scan, &imageURL)
		}
		if hasDesc {
			scan = append(scan, &description)
		}
		if hasSource {
			scan = append(scan, &source)
		}
		if hasQuality {
			scan = append(scan, &quality)
		}
		if hasAliases {
			scan = append(scan, &aliases)
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
		if hasQuality {
			item["quality_status"] = quality
		} else {
			item["quality_status"] = "trusted"
		}
		if hasAliases {
			item["aliases"] = aliases
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
	status := strings.TrimSpace(c.Query("status"))
	if status == "" {
		status = "pending"
	}
	if status != "pending" && status != "approved" && status != "rejected" {
		httpx.SendError(c, http.StatusBadRequest, "审核状态无效", "INVALID_STATUS")
		return
	}
	empty := gin.H{"items": []any{}, "hasMore": false}
	if !h.hasTable("kitchenware_mapping_reviews") {
		c.JSON(http.StatusOK, empty)
		return
	}
	rows, err := h.DB.Query(`SELECT id, raw_name, normalized_name, source_type, COALESCE(source_id,''),
		status, COALESCE(confidence,0), suggested_catalog_id, COALESCE(created_at,''), COALESCE(reviewed_at,'')
		FROM kitchenware_mapping_reviews WHERE status=? ORDER BY id LIMIT 201`, status)
	if err != nil {
		c.JSON(http.StatusOK, empty)
		return
	}
	defer rows.Close()
	items := make([]map[string]any, 0)
	for rows.Next() {
		var id int
		var confidence float64
		var suggested sql.NullInt64
		var rawName, normalized, sourceType, sourceID, rowStatus, createdAt, reviewedAt string
		if err := rows.Scan(&id, &rawName, &normalized, &sourceType, &sourceID, &rowStatus, &confidence, &suggested, &createdAt, &reviewedAt); err != nil {
			continue
		}
		var suggestedID any
		if suggested.Valid {
			suggestedID = suggested.Int64
		}
		var source any = sourceID
		if sourceID == "" {
			source = nil
		}
		var reviewed any
		if reviewedAt != "" {
			reviewed = reviewedAt
		}
		item := map[string]any{
			"id": id, "raw_name": rawName, "normalized_name": normalized,
			"source_type": sourceType, "source_id": source, "status": rowStatus,
			"confidence": confidence, "suggested_catalog_id": suggestedID,
			"created_at": createdAt, "reviewed_at": reviewed,
		}
		item["token"] = mappingReviewToken(item)
		items = append(items, item)
	}
	hasMore := len(items) > 200
	if hasMore {
		items = items[:200]
	}
	c.JSON(http.StatusOK, gin.H{"items": items, "hasMore": hasMore})
}

func (h *Handlers) KitchenwareMappingReviewPost(c *gin.Context) {
	id, ok := parseIDParam(c)
	if !ok {
		return
	}
	var body struct {
		Decision  string `json:"decision"`
		Token     string `json:"token"`
		CatalogID int    `json:"catalogId"`
	}
	if !bindJSON(c, &body) {
		return
	}
	if body.Decision != "approved" && body.Decision != "rejected" {
		httpx.SendError(c, http.StatusBadRequest, "审核请求无效", "INVALID_BODY")
		return
	}
	if body.Decision == "approved" && body.CatalogID <= 0 {
		httpx.SendError(c, http.StatusBadRequest, "审核请求无效", "INVALID_BODY")
		return
	}
	if !h.hasTable("kitchenware_mapping_reviews") {
		httpx.SendError(c, http.StatusNotFound, "映射审核不存在", "MAPPING_NOT_FOUND")
		return
	}
	var rawName, normalized, sourceType, sourceID, status, createdAt, reviewedAt string
	var confidence float64
	var suggested sql.NullInt64
	err := h.DB.QueryRow(`SELECT raw_name, normalized_name, source_type, COALESCE(source_id,''), status,
		COALESCE(confidence,0), suggested_catalog_id, COALESCE(created_at,''), COALESCE(reviewed_at,'')
		FROM kitchenware_mapping_reviews WHERE id=?`, id).
		Scan(&rawName, &normalized, &sourceType, &sourceID, &status, &confidence, &suggested, &createdAt, &reviewedAt)
	if err == sql.ErrNoRows {
		httpx.SendError(c, http.StatusNotFound, "映射审核不存在", "MAPPING_NOT_FOUND")
		return
	}
	if err != nil {
		httpx.SendError(c, http.StatusInternalServerError, "读取失败", "MAPPING_READ_FAILED")
		return
	}
	var suggestedID any
	if suggested.Valid {
		suggestedID = suggested.Int64
	}
	var source any = sourceID
	if sourceID == "" {
		source = nil
	}
	var reviewed any
	if reviewedAt != "" {
		reviewed = reviewedAt
	}
	row := map[string]any{
		"id": id, "raw_name": rawName, "normalized_name": normalized,
		"source_type": sourceType, "source_id": source, "status": status,
		"confidence": confidence, "suggested_catalog_id": suggestedID,
		"created_at": createdAt, "reviewed_at": reviewed,
	}
	if status != "pending" || mappingReviewToken(row) != body.Token {
		httpx.SendError(c, http.StatusConflict, "审核内容已变化，请刷新后核对", "MAPPING_STALE")
		return
	}
	if body.Decision == "approved" {
		table := h.kitchenwareCatalogTable()
		if table == "" {
			httpx.SendError(c, http.StatusConflict, "请选择当前已审核的标准厨具", "CATALOG_MISSING")
			return
		}
		var catalogName, quality, aliasesRaw string
		hasQuality := h.hasColumn(table, "quality_status")
		hasAliases := h.hasColumn(table, "aliases")
		selectSQL := `SELECT name`
		if hasQuality {
			selectSQL += `, COALESCE(quality_status,'')`
		} else {
			selectSQL += `, 'trusted'`
		}
		if hasAliases {
			selectSQL += `, COALESCE(aliases,'[]')`
		} else {
			selectSQL += `, '[]'`
		}
		selectSQL += ` FROM ` + table + ` WHERE id=?`
		if err := h.DB.QueryRow(selectSQL, body.CatalogID).Scan(&catalogName, &quality, &aliasesRaw); err != nil {
			httpx.SendError(c, http.StatusConflict, "请选择当前已审核的标准厨具", "CATALOG_MISSING")
			return
		}
		if hasQuality && quality != "trusted" {
			httpx.SendError(c, http.StatusConflict, "请选择当前已审核的标准厨具", "CATALOG_UNTRUSTED")
			return
		}
		aliases := parseStringList(aliasesRaw)
		if !aliasContains(aliases, catalogName, rawName) {
			aliases = append(aliases, rawName)
			if hasAliases {
				encoded, _ := json.Marshal(aliases)
				_, _ = h.DB.Exec(`UPDATE `+table+` SET aliases=? WHERE id=?`, string(encoded), body.CatalogID)
			}
		}
		_, err = h.DB.Exec(`UPDATE kitchenware_mapping_reviews SET status=?, suggested_catalog_id=?, reviewed_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
			"approved", body.CatalogID, id)
	} else {
		_, err = h.DB.Exec(`UPDATE kitchenware_mapping_reviews SET status=?, reviewed_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
			"rejected", id)
	}
	if err != nil {
		httpx.SendError(c, http.StatusInternalServerError, "审核未完成，请刷新核对后重试。", "MAPPING_UPDATE_FAILED")
		return
	}
	h.recordAudit(c, "kitchenware_mapping."+body.Decision, "kitchenware_mapping", strconv.Itoa(id),
		"厨具映射 "+body.Decision+"："+rawName)
	okJSON(c)
}

func mappingReviewToken(row map[string]any) string {
	payload, _ := json.Marshal([]any{
		row["id"], row["raw_name"], row["normalized_name"], row["source_type"], row["source_id"],
		row["confidence"], row["suggested_catalog_id"], row["status"], row["created_at"], row["reviewed_at"],
	})
	sum := sha256.Sum256(payload)
	return hex.EncodeToString(sum[:])
}

func parseStringList(raw string) []string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	var values []string
	if err := json.Unmarshal([]byte(raw), &values); err == nil {
		return values
	}
	parts := strings.FieldsFunc(raw, func(r rune) bool { return r == '、' || r == ',' || r == '，' })
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part != "" {
			out = append(out, part)
		}
	}
	return out
}

func aliasContains(aliases []string, catalogName, rawName string) bool {
	needle := strings.TrimSpace(strings.ToLower(rawName))
	if needle == "" {
		return true
	}
	if strings.TrimSpace(strings.ToLower(catalogName)) == needle {
		return true
	}
	for _, alias := range aliases {
		if strings.TrimSpace(strings.ToLower(alias)) == needle {
			return true
		}
	}
	return false
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
