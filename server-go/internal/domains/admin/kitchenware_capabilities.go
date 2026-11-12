// Copyright (c) 2026 heathcetide. All rights reserved.

package admin

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"sort"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/heathcetide/DietDigiDose/internal/httpx"
)

func (h *Handlers) KitchenwareCapabilitiesGet(c *gin.Context) {
	id, ok := parseIDParam(c)
	if !ok {
		return
	}
	c.JSON(http.StatusOK, h.capabilityConfiguration(id))
}

func (h *Handlers) KitchenwareCapabilitiesPut(c *gin.Context) {
	id, ok := parseIDParam(c)
	if !ok {
		return
	}
	var body struct {
		Token        string `json:"token"`
		Capabilities []struct {
			Code        string         `json:"code"`
			Constraints map[string]any `json:"constraints"`
		} `json:"capabilities"`
	}
	if !bindJSON(c, &body) {
		return
	}
	current := h.capabilityConfiguration(id)
	if strings.TrimSpace(body.Token) == "" || body.Token != asString(current["token"]) {
		httpx.SendError(c, http.StatusConflict, "能力条件已变化，请重新加载后核对", "KITCHENWARE_CAPABILITY_CONFLICT")
		return
	}
	availableCodes := map[string]struct{}{}
	if list, ok := current["available"].([]map[string]any); ok {
		for _, item := range list {
			availableCodes[asString(item["code"])] = struct{}{}
		}
	}
	seen := map[string]struct{}{}
	for _, cap := range body.Capabilities {
		code := strings.TrimSpace(cap.Code)
		if code == "" {
			httpx.SendError(c, http.StatusBadRequest, "能力代码无效", "INVALID_CAPABILITY")
			return
		}
		if _, ok := availableCodes[code]; !ok {
			httpx.SendError(c, http.StatusBadRequest, "包含未知能力", "UNKNOWN_CAPABILITY")
			return
		}
		if _, dup := seen[code]; dup {
			httpx.SendError(c, http.StatusBadRequest, "能力不能重复", "DUPLICATE_CAPABILITY")
			return
		}
		seen[code] = struct{}{}
	}

	if h.hasTable("kitchenware_catalog_capabilities") {
		_, _ = h.DB.Exec(`DELETE FROM kitchenware_catalog_capabilities WHERE catalog_id=?`, id)
		for _, cap := range body.Capabilities {
			raw, _ := json.Marshal(cap.Constraints)
			_, _ = h.DB.Exec(`INSERT INTO kitchenware_catalog_capabilities (catalog_id, capability_code, constraints_json) VALUES (?,?,?)`,
				id, strings.TrimSpace(cap.Code), string(raw))
		}
	} else {
		// Fallback: persist blob in system_settings.
		raw, _ := json.Marshal(body.Capabilities)
		h.upsertSetting(h.capabilitiesKey(id), string(raw))
	}
	h.recordAudit(c, "kitchenware_capabilities.update", "kitchenware_catalog", strconv.Itoa(id), "更新厨具能力")
	c.JSON(http.StatusOK, h.capabilityConfiguration(id))
}

func (h *Handlers) capabilityConfiguration(id int) map[string]any {
	available := h.listKitchenwareCapabilityCatalog()
	capabilities := h.listKitchenwareCatalogCapabilities(id)
	tokenPayload, _ := json.Marshal(map[string]any{"id": id, "capabilities": capabilities})
	sum := sha256.Sum256(tokenPayload)
	return map[string]any{
		"capabilities": capabilities,
		"available":    available,
		"token":        hex.EncodeToString(sum[:]),
	}
}

func (h *Handlers) listKitchenwareCapabilityCatalog() []map[string]any {
	out := make([]map[string]any, 0)
	if !h.hasTable("kitchenware_capabilities") {
		return out
	}
	rows, err := h.DB.Query(`SELECT code, COALESCE(name, code), COALESCE(safety_level, 'standard')
		FROM kitchenware_capabilities ORDER BY code`)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var code, name, safety string
		if rows.Scan(&code, &name, &safety) != nil {
			continue
		}
		out = append(out, map[string]any{"code": code, "name": name, "safety_level": safety})
	}
	return out
}

func (h *Handlers) listKitchenwareCatalogCapabilities(id int) []map[string]any {
	out := make([]map[string]any, 0)
	if h.hasTable("kitchenware_catalog_capabilities") {
		rows, err := h.DB.Query(`SELECT capability_code, COALESCE(constraints_json, '{}')
			FROM kitchenware_catalog_capabilities WHERE catalog_id=? ORDER BY capability_code`, id)
		if err == nil {
			defer rows.Close()
			for rows.Next() {
				var code, raw string
				if rows.Scan(&code, &raw) != nil {
					continue
				}
				var constraints any
				if json.Unmarshal([]byte(raw), &constraints) != nil {
					constraints = raw
				}
				out = append(out, map[string]any{"code": code, "constraints": constraints})
			}
			return out
		}
	}
	if raw, ok := h.getSetting(h.capabilitiesKey(id)); ok && strings.TrimSpace(raw) != "" {
		var parsed []map[string]any
		if json.Unmarshal([]byte(raw), &parsed) == nil {
			sort.Slice(parsed, func(i, j int) bool {
				return asString(parsed[i]["code"]) < asString(parsed[j]["code"])
			})
			return parsed
		}
		if m := parseJSONMap(raw); len(m) > 0 {
			// legacy map form
			for code, constraints := range m {
				out = append(out, map[string]any{"code": code, "constraints": constraints})
			}
			sort.Slice(out, func(i, j int) bool {
				return asString(out[i]["code"]) < asString(out[j]["code"])
			})
		}
	}
	return out
}
