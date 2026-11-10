// Copyright (c) 2026 heathcetide. All rights reserved.

package catalog

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/heathcetide/DietDigiDose/internal/expressauth"
	"github.com/heathcetide/DietDigiDose/internal/httpx"
)

func (h *Handlers) ImportShopping(c *gin.Context) {
	userID, _ := expressauth.UserID(c)
	body, ok := bindJSONMap(c)
	if !ok {
		return
	}
	importKey := asString(body["importKey"])
	rawItems, _ := body["items"].([]any)
	if importKey == "" || len(rawItems) == 0 {
		httpx.SendError(c, http.StatusBadRequest, "请求参数无效", "INVALID_BODY")
		return
	}
	useUUID := h.hasColumn("shopping_list_items", "client_id")
	for _, raw := range rawItems {
		item, _ := raw.(map[string]any)
		name := asString(item["name"])
		if name == "" {
			continue
		}
		amount := asString(item["amount"])
		if amount == "" {
			amount = asString(item["quantity"])
		}
		if amount == "" {
			amount = "适量"
		}
		category := asString(item["category"])
		if category == "" {
			category = "其他"
		}
		clientID := asString(item["clientId"])
		if clientID == "" {
			clientID = importKey + ":" + name + ":" + amount
		}
		if useUUID {
			id, err := newUUID()
			if err != nil {
				httpx.SendError(c, http.StatusInternalServerError, "导入失败", "SHOPPING_IMPORT_FAILED")
				return
			}
			_, err = h.DB.Exec(`INSERT OR IGNORE INTO shopping_list_items
				(id, user_id, client_id, name, amount, category, checked, version)
				VALUES (?, ?, ?, ?, ?, ?, 0, 1)`, id, userID, clientID, name, amount, category)
			if err != nil {
				_, _ = h.DB.Exec(`INSERT OR IGNORE INTO shopping_list_items
					(id, user_id, name, quantity, checked, version) VALUES (?, ?, ?, ?, 0, 1)`, id, userID, name, amount)
			}
			continue
		}
		_, _ = h.DB.Exec(`INSERT INTO shopping_list_items (user_id, name, quantity, checked, version) VALUES (?, ?, ?, 0, 1)`,
			userID, name, amount)
	}
	items := h.listShoppingItems(userID)
	c.JSON(http.StatusOK, gin.H{"items": items})
}

func (h *Handlers) listShoppingItems(userID int) []map[string]any {
	qtyCol := "quantity"
	if h.hasColumn("shopping_list_items", "amount") && !h.hasColumn("shopping_list_items", "quantity") {
		qtyCol = "amount"
	}
	rows, err := h.DB.Query(`SELECT id, name, COALESCE(`+qtyCol+`,''), COALESCE(checked,0), COALESCE(version,1)
		FROM shopping_list_items WHERE user_id=? AND deleted_at IS NULL ORDER BY id DESC`, userID)
	if err != nil {
		return []map[string]any{}
	}
	defer rows.Close()
	list := make([]map[string]any, 0)
	for rows.Next() {
		var checked, version int
		var name, quantity, idRaw string
		if err := rows.Scan(&idRaw, &name, &quantity, &checked, &version); err != nil {
			continue
		}
		idAny := any(idRaw)
		if n, err := strconv.Atoi(idRaw); err == nil {
			idAny = n
		}
		list = append(list, map[string]any{"id": idAny, "name": name, "quantity": quantity, "amount": quantity,
			"checked": checked == 1, "version": version})
	}
	return list
}
