// Copyright (c) 2026 heathcetide. All rights reserved.

package inventory

import (
	"database/sql"
	"encoding/json"
	"strconv"
	"strings"
)

func asBool(v any) bool {
	switch t := v.(type) {
	case bool:
		return t
	case float64:
		return t != 0
	default:
		return false
	}
}

func parseFloat(s string) float64 {
	v, _ := strconv.ParseFloat(strings.TrimSpace(s), 64)
	return v
}

func parseNullFloat(v sql.NullString) any {
	if !v.Valid || strings.TrimSpace(v.String) == "" {
		return nil
	}
	return parseFloat(v.String)
}

func nullStringPtr(v sql.NullString) any {
	if !v.Valid || v.String == "" {
		return nil
	}
	return v.String
}

func nullStr(v sql.NullString) string {
	if v.Valid {
		return v.String
	}
	return ""
}

func parseMetadataObject(v sql.NullString) map[string]any {
	if !v.Valid || v.String == "" {
		return map[string]any{}
	}
	var meta map[string]any
	if err := json.Unmarshal([]byte(v.String), &meta); err != nil || meta == nil {
		return map[string]any{}
	}
	return meta
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

func structuredQty(item map[string]any) (*float64, *string) {
	var val *float64
	var unit *string
	switch v := item["quantity_value"].(type) {
	case float64:
		val = &v
	case int:
		f := float64(v)
		val = &f
	case string:
		if strings.TrimSpace(v) != "" {
			f := parseFloat(v)
			val = &f
		}
	}
	if u := strings.TrimSpace(asString(item["quantity_unit"])); u != "" {
		unit = &u
	}
	return val, unit
}

func cloneMap(in map[string]any) map[string]any {
	out := make(map[string]any, len(in))
	for k, v := range in {
		out[k] = v
	}
	return out
}

func formatListItem(item map[string]any) map[string]any {
	out := make(map[string]any, len(item))
	for k, v := range item {
		out[k] = v
	}
	if _, ok := out["is_available"]; ok {
		out["is_available"] = asBool(out["is_available"])
	}
	if v, ok := out["version"]; ok {
		out["version"] = int(asFloat(v))
		if out["version"] == 0 {
			out["version"] = 1
		}
	}
	return out
}

func scanItemFull(row rowScanner) (map[string]any, error) {
	var (
		id, userID, isAvailable, version  int
		foodName, category, quantity      string
		expiration, storage               string
		imageURL, createdAt, updatedAt    sql.NullString
		qVal, qUnit, pkgUnit, batch, note sql.NullString
		pkgVal                            sql.NullFloat64
	)
	if err := row.Scan(&id, &userID, &foodName, &category, &quantity, &expiration, &storage,
		&imageURL, &isAvailable, &createdAt, &version, &qVal, &qUnit, &pkgVal, &pkgUnit, &batch, &updatedAt, &note); err != nil {
		return nil, err
	}
	item := map[string]any{
		"id": id, "food_name": foodName, "category": category,
		"quantity": quantity, "expiration_date": expiration, "storage_location": storage,
		"is_available": isAvailable == 1, "version": version,
	}
	if imageURL.Valid {
		item["image_url"] = imageURL.String
	} else {
		item["image_url"] = nil
	}
	if createdAt.Valid {
		item["created_at"] = createdAt.String
	}
	if updatedAt.Valid {
		item["updated_at"] = updatedAt.String
	}
	if qVal.Valid && qVal.String != "" {
		item["quantity_value"] = parseFloat(qVal.String)
	} else {
		item["quantity_value"] = nil
	}
	if qUnit.Valid && qUnit.String != "" {
		if unit := canonicalizeInventoryUnit(qUnit.String); unit != "" {
			item["quantity_unit"] = unit
		} else {
			item["quantity_unit"] = nil
			item["quantity_value"] = nil
		}
	} else {
		item["quantity_unit"] = nil
	}
	if pkgVal.Valid {
		item["package_size_value"] = pkgVal.Float64
	}
	if pkgUnit.Valid && pkgUnit.String != "" {
		if unit := canonicalizeInventoryUnit(pkgUnit.String); unit != "" {
			item["package_size_unit"] = unit
		} else {
			item["package_size_unit"] = nil
			delete(item, "package_size_value")
		}
	}
	if batch.Valid && batch.String != "" {
		item["batch_code"] = batch.String
	}
	if note.Valid && note.String != "" {
		item["note"] = note.String
	}
	return item, nil
}
