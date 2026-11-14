// Copyright (c) 2026 heathcetide. All rights reserved.

package lifestyle

import (
	"github.com/heathcetide/DietDigiDose/internal/dbx"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/heathcetide/DietDigiDose/internal/domains/inventory"
	"github.com/heathcetide/DietDigiDose/internal/httpx"
)

func hasTable(db *dbx.DB, name string) bool { return db.HasTable(name) }

func (h *Handlers) hasColumn(table, column string) bool { return h.DB.HasColumn(table, column) }

func (h *Handlers) inventorySvc() *inventory.Service {
	if h.Inventory != nil {
		return h.Inventory
	}
	return &inventory.Service{DB: h.DB}
}

func idempotencyFromBody(body map[string]any) string {
	key := strings.TrimSpace(asString(body["idempotency_key"]))
	if key == "" {
		key = strings.TrimSpace(asString(body["idempotencyKey"]))
	}
	return key
}

func versionFromBody(body map[string]any) int {
	if v := asInt(body["version"]); v > 0 {
		return v
	}
	return asInt(body["plan_version"])
}

func writeInventoryErr(c *gin.Context, err error) {
	if e, ok := err.(*inventory.APIError); ok {
		httpx.SendError(c, e.Status, e.Message, e.Code)
		return
	}
	httpx.SendError(c, 500, "服务器内部错误", "INTERNAL_ERROR")
}
