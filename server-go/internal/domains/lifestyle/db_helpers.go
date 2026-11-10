// Copyright (c) 2026 heathcetide. All rights reserved.

package lifestyle

import (
	"database/sql"
	"strings"
	"sync"

	"github.com/gin-gonic/gin"
	"github.com/heathcetide/DietDigiDose/internal/domains/inventory"
	"github.com/heathcetide/DietDigiDose/internal/httpx"
)

type columnCache struct {
	mu    sync.Mutex
	table map[string]map[string]bool
}

func (c *columnCache) has(db *sql.DB, table, column string) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.table == nil {
		c.table = map[string]map[string]bool{}
	}
	if cols, ok := c.table[table]; ok {
		if v, found := cols[column]; found {
			return v
		}
	}
	if !hasTable(db, table) {
		return false
	}
	rows, err := db.Query(`PRAGMA table_info(` + table + `)`)
	if err != nil {
		return false
	}
	defer rows.Close()
	for rows.Next() {
		var cid int
		var name, ctype string
		var notnull, pk int
		var dflt sql.NullString
		if rows.Scan(&cid, &name, &ctype, &notnull, &dflt, &pk) == nil && name == column {
			if c.table[table] == nil {
				c.table[table] = map[string]bool{}
			}
			c.table[table][column] = true
			return true
		}
	}
	if c.table[table] == nil {
		c.table[table] = map[string]bool{}
	}
	c.table[table][column] = false
	return false
}

var lifestyleColumns columnCache

func hasTable(db *sql.DB, name string) bool {
	var n int
	err := db.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?`, name).Scan(&n)
	return err == nil && n > 0
}

func (h *Handlers) hasColumn(table, column string) bool {
	return lifestyleColumns.has(h.DB, table, column)
}

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
