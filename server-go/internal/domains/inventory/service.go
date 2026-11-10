// Copyright (c) 2026 heathcetide. All rights reserved.

package inventory

import (
	"database/sql"
	"errors"
	"fmt"
	"github.com/heathcetide/DietDigiDose/internal/dbx"
	"strings"
	"time"
)

type Service struct {
	DB *dbx.DB
}

type APIError struct {
	Status  int
	Message string
	Code    string
}

func (e *APIError) Error() string { return e.Message }

func (s *Service) List(userID int) ([]map[string]any, error) {
	rows, err := s.DB.Query(`
		SELECT id, user_id, food_name, category, quantity, expiration_date, storage_location,
			image_url, is_available, created_at,
			COALESCE(version, 1) AS version,
			quantity_value, quantity_unit, package_size_value, package_size_unit, batch_code, updated_at, COALESCE(note, '') AS note
		FROM inventory_items
		WHERE user_id = ? AND deleted_at IS NULL
		ORDER BY CASE WHEN expiration_date = '' THEN 1 ELSE 0 END, expiration_date ASC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]map[string]any, 0)
	for rows.Next() {
		item, err := scanItemFull(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Service) Create(userID int, body map[string]any) (map[string]any, error) {
	foodName := strings.TrimSpace(asString(body["food_name"]))
	category := strings.TrimSpace(asString(body["category"]))
	quantity := strings.TrimSpace(asString(body["quantity"]))
	expiration := strings.TrimSpace(asString(body["expiration_date"]))
	storage := strings.TrimSpace(asString(body["storage_location"]))
	if storage == "" {
		storage = "冷藏"
	}
	if foodName == "" || category == "" || quantity == "" {
		return nil, &APIError{Status: 400, Message: "食材信息不完整", Code: "INVALID_INVENTORY"}
	}
	qVal := body["quantity_value"]
	qUnit := strings.TrimSpace(asString(body["quantity_unit"]))
	var quantityValue any
	switch t := qVal.(type) {
	case float64:
		quantityValue = fmt.Sprintf("%g", t)
	case int:
		quantityValue = fmt.Sprintf("%d", t)
	case string:
		if strings.TrimSpace(t) != "" {
			quantityValue = strings.TrimSpace(t)
		}
	}
	if quantityValue == nil {
		quantityValue = nil
	}
	var quantityUnit any
	if qUnit != "" {
		quantityUnit = qUnit
	}
	id, err := s.DB.InsertID(`
		INSERT INTO inventory_items (user_id, food_name, category, quantity, expiration_date, storage_location, image_url, is_available, version, quantity_value, quantity_unit, batch_code, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?, ?, CURRENT_TIMESTAMP)`,
		userID, foodName, category, quantity, expiration, storage, nullString(asString(body["image_url"])),
		quantityValue, quantityUnit, nullString(asString(body["batch_code"])))
	if err != nil {
		return nil, err
	}

	_, _ = s.DB.Exec(`INSERT INTO inventory_change_logs
		(user_id, inventory_item_id, action, source, quantity_before, quantity_after, quantity_unit, delta_value, idempotency_key)
		VALUES (?, ?, 'created', 'manual', NULL, NULL, NULL, NULL, ?)`, userID, id, fmt.Sprintf("create:%d", id))
	return s.get(userID, int(id))
}

func (s *Service) Update(userID, itemID int, body map[string]any) (map[string]any, error) {
	item, err := s.get(userID, itemID)
	if err != nil {
		return nil, err
	}
	if item == nil {
		return nil, &APIError{Status: 404, Message: "库存项不存在", Code: "INVENTORY_NOT_FOUND"}
	}
	expectedVersion := int(asFloat(body["version"]))
	if expectedVersion > 0 && int(asFloat(item["version"])) != expectedVersion {
		return nil, &APIError{Status: 409, Message: "库存已被其他操作更新，请刷新后重试", Code: "INVENTORY_VERSION_CONFLICT"}
	}
	foodName := coalesce(asString(body["food_name"]), asString(item["food_name"]))
	category := coalesce(asString(body["category"]), asString(item["category"]))
	quantity := coalesce(asString(body["quantity"]), asString(item["quantity"]))
	expiration := coalesce(asString(body["expiration_date"]), asString(item["expiration_date"]))
	storage := coalesce(asString(body["storage_location"]), asString(item["storage_location"]))
	res, err := s.DB.Exec(`
		UPDATE inventory_items SET food_name=?, category=?, quantity=?, expiration_date=?, storage_location=?, version=version+1
		WHERE id=? AND user_id=? AND deleted_at IS NULL AND version=?`,
		foodName, category, quantity, expiration, storage, itemID, userID, int(asFloat(item["version"])))
	if err != nil {
		return nil, err
	}
	n, _ := res.RowsAffected()
	if n != 1 {
		return nil, &APIError{Status: 409, Message: "库存已被其他操作更新，请刷新后重试", Code: "INVENTORY_VERSION_CONFLICT"}
	}
	return s.get(userID, itemID)
}

func (s *Service) Remove(userID, itemID int) (map[string]any, error) {
	item, err := s.get(userID, itemID)
	if err != nil {
		return nil, err
	}
	if item == nil {
		return nil, &APIError{Status: 404, Message: "库存项不存在", Code: "INVENTORY_NOT_FOUND"}
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	res, err := s.DB.Exec(`UPDATE inventory_items SET deleted_at=?, is_available=0, version=version+1 WHERE id=? AND user_id=? AND deleted_at IS NULL`,
		now, itemID, userID)
	if err != nil {
		return nil, err
	}
	n, _ := res.RowsAffected()
	if n != 1 {
		return nil, &APIError{Status: 404, Message: "库存项不存在", Code: "INVENTORY_NOT_FOUND"}
	}
	return map[string]any{"deleted": true, "id": itemID}, nil
}

func (s *Service) get(userID, itemID int) (map[string]any, error) {
	row := s.DB.QueryRow(itemSelectSQL+` AND deleted_at IS NULL`, itemID, userID)
	item, err := scanItemFull(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return item, err
}

type rowScanner interface {
	Scan(dest ...any) error
}

func asString(v any) string {
	switch t := v.(type) {
	case string:
		return t
	case fmt.Stringer:
		return t.String()
	default:
		return ""
	}
}

func asFloat(v any) float64 {
	switch t := v.(type) {
	case float64:
		return t
	case int:
		return float64(t)
	case int64:
		return float64(t)
	default:
		return 0
	}
}

func coalesce(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

func nullString(v string) any {
	if strings.TrimSpace(v) == "" {
		return nil
	}
	return v
}
