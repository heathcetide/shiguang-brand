// Copyright (c) 2026 heathcetide. All rights reserved.

package inventory

import (
	"crypto/rand"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/heathcetide/DietDigiDose/internal/dbx"
	"strings"
	"time"
)

func newBatchUUID() (string, error) {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16]), nil
}

func (s *Service) ImportShoppingList(userID int, body map[string]any) (map[string]any, error) {
	key := strings.TrimSpace(asString(body["idempotency_key"]))
	if key == "" {
		return nil, &APIError{Status: 400, Message: "请求参数无效", Code: "INVALID_BODY"}
	}
	var existing sql.NullString
	err := s.DB.QueryRow(`SELECT result_json FROM shopping_inventory_imports WHERE user_id=? AND idempotency_key=?`, userID, key).Scan(&existing)
	if err == nil && existing.Valid {
		var items []map[string]any
		_ = json.Unmarshal([]byte(existing.String), &items)
		return map[string]any{"items": items, "repeated": true}, nil
	}
	rawItems, _ := body["items"].([]any)
	if len(rawItems) == 0 {
		return nil, &APIError{Status: 400, Message: "请求参数无效", Code: "INVALID_BODY"}
	}
	tx, err := s.DB.Begin()
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()
	if shopping, ok := body["shopping_items"].([]any); ok && len(shopping) > 0 {
		for _, entry := range shopping {
			m, _ := entry.(map[string]any)
			id := strings.TrimSpace(asString(m["id"]))
			ver := int(asFloat(m["version"]))
			if id == "" || ver <= 0 {
				return nil, &APIError{Status: 409, Message: "采购项已变更或已入库，请刷新清单后重试。", Code: "SHOPPING_ITEM_CONFLICT"}
			}
			res, err := tx.Exec(`
				UPDATE shopping_list_items SET deleted_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP, version=version+1
				WHERE id=? AND user_id=? AND version=? AND checked=1 AND deleted_at IS NULL`, id, userID, ver)
			if err != nil {
				return nil, &APIError{Status: 409, Message: "采购项已变更或已入库，请刷新清单后重试。", Code: "SHOPPING_ITEM_CONFLICT"}
			}
			n, _ := res.RowsAffected()
			if n != 1 {
				return nil, &APIError{Status: 409, Message: "采购项已变更或已入库，请刷新清单后重试。", Code: "SHOPPING_ITEM_CONFLICT"}
			}
		}
	}
	created := make([]map[string]any, 0, len(rawItems))
	for _, raw := range rawItems {
		itemBody, _ := raw.(map[string]any)
		item, err := s.insertItemTx(tx, userID, itemBody, true)
		if err != nil {
			return nil, err
		}
		created = append(created, item)
	}
	payload, _ := json.Marshal(created)
	_, err = tx.Exec(`INSERT INTO shopping_inventory_imports (user_id, idempotency_key, result_json) VALUES (?,?,?)`, userID, key, string(payload))
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"items": created, "repeated": false}, nil
}

func (s *Service) BulkIntake(userID int, body map[string]any) (map[string]any, error) {
	return s.bulkIntake(userID, body, "")
}

func (s *Service) bulkIntake(userID int, body map[string]any, automaticRule string) (map[string]any, error) {
	key := strings.TrimSpace(asString(body["idempotency_key"]))
	source := strings.TrimSpace(asString(body["source"]))
	if key == "" || source == "" {
		return nil, &APIError{Status: 400, Message: "请求参数无效", Code: "INVALID_BODY"}
	}
	var existing sql.NullString
	err := s.DB.QueryRow(`SELECT result_json FROM inventory_intake_batches WHERE user_id=? AND idempotency_key=?`, userID, key).Scan(&existing)
	if err == nil && existing.Valid {
		var stored map[string]any
		_ = json.Unmarshal([]byte(existing.String), &stored)
		stored["repeated"] = true
		return stored, nil
	}
	rawItems, _ := body["items"].([]any)
	if len(rawItems) == 0 {
		return nil, &APIError{Status: 400, Message: "请求参数无效", Code: "INVALID_BODY"}
	}
	sourceRef := nullString(asString(body["source_reference"]))
	tx, err := s.DB.Begin()
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()

	var previousRows []struct{ Confirmed, Result string }
	if sourceRef != nil {
		rows, qErr := tx.Query(`SELECT confirmed_payload_json, result_json FROM inventory_intake_batches
			WHERE user_id=? AND source=? AND source_reference=? ORDER BY created_at, id`, userID, source, sourceRef)
		if qErr == nil {
			defer rows.Close()
			for rows.Next() {
				var c, r string
				if rows.Scan(&c, &r) == nil {
					previousRows = append(previousRows, struct{ Confirmed, Result string }{c, r})
				}
			}
		}
	}
	saved := savedIntakeItems(previousRows)

	acceptedPayload := make([]map[string]any, 0, len(rawItems))
	for _, raw := range rawItems {
		item, _ := raw.(map[string]any)
		if automaticRule == "" {
			if !asBool(item["confirmed"]) {
				return nil, &APIError{Status: 400, Message: "每项都必须由用户确认后才能入库", Code: "INVALID_BODY"}
			}
		}
		cp := cloneMap(item)
		if automaticRule != "" {
			cp["acceptance"] = "automatic"
			cp["acceptance_rule"] = automaticRule
		} else {
			cp["acceptance"] = "manual"
			cp["acceptance_rule"] = nil
		}
		acceptedPayload = append(acceptedPayload, cp)
	}

	added := 0
	resultItems := make([]map[string]any, 0, len(acceptedPayload))
	for _, item := range acceptedPayload {
		sourceItemID := strings.TrimSpace(asString(item["source_item_id"]))
		if sourceItemID != "" {
			if prev, ok := saved[sourceItemID]; ok {
				resultItems = append(resultItems, formatListItem(prev))
				continue
			}
		}
		created, err := s.insertItemTx(tx, userID, item, false)
		if err != nil {
			return nil, err
		}
		added++
		logSource := "manual"
		if source == "image" || source == "receipt" {
			logSource = "ai"
		}
		meta := map[string]any{
			"acceptance":        item["acceptance"],
			"acceptance_rule":   item["acceptance_rule"],
			"inventory_version": created["version"],
			"source":            item["source"],
			"source_reference":  sourceRef,
			"source_item_id":    nullString(sourceItemID),
			"confidence":        item["confidence"],
			"field_evidence":    item["field_evidence"],
		}
		metaJSON, _ := json.Marshal(meta)
		_, _ = tx.Exec(`INSERT INTO inventory_change_logs
			(user_id, inventory_item_id, action, source, quantity_after, quantity_unit, delta_value, idempotency_key, metadata_json)
			VALUES (?, ?, 'created', ?, ?, ?, ?, ?, ?)`,
			userID, created["id"], logSource, created["quantity_value"], created["quantity_unit"], created["quantity_value"],
			fmt.Sprintf("intake:%v", created["id"]), string(metaJSON))
		resultItems = append(resultItems, created)
	}

	batchID, err := newBatchUUID()
	if err != nil {
		return nil, err
	}
	result := map[string]any{"batch_id": batchID, "items": resultItems, "repeated": added == 0}
	resultJSON, _ := json.Marshal(result)
	confirmedJSON, _ := json.Marshal(acceptedPayload)
	_, err = tx.Exec(`INSERT INTO inventory_intake_batches
		(id, user_id, idempotency_key, source, source_reference, confirmed_payload_json, result_json)
		VALUES (?, ?, ?, ?, ?, ?, ?)`,
		batchID, userID, key, source, sourceRef, string(confirmedJSON), string(resultJSON))
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return result, nil
}

func (s *Service) ConsumptionPreview(userID int, body map[string]any) (map[string]any, error) {
	candidates, err := s.listPreviewCandidates(userID)
	if err != nil {
		return nil, err
	}
	rawItems, _ := body["items"].([]any)
	requests := make([]previewRequest, 0, len(rawItems))
	for _, raw := range rawItems {
		m, _ := raw.(map[string]any)
		requests = append(requests, previewRequest{
			FoodName:    strings.TrimSpace(asString(m["food_name"])),
			AmountValue: asFloat(m["amount_value"]),
			Unit:        strings.TrimSpace(asString(m["unit"])),
		})
	}
	asOf := time.Now().UTC().Format("2006-01-02")
	return map[string]any{"items": buildFEFOConsumptionPreview(candidates, requests, asOf)}, nil
}

func (s *Service) Consume(userID int, body map[string]any) (map[string]any, error) {
	key := strings.TrimSpace(asString(body["idempotency_key"]))
	if key == "" {
		return nil, &APIError{Status: 400, Message: "请求参数无效", Code: "INVALID_BODY"}
	}
	var existing sql.NullString
	err := s.DB.QueryRow(`SELECT result_json FROM inventory_consumption_requests WHERE user_id=? AND idempotency_key=?`, userID, key).Scan(&existing)
	if err == nil && existing.Valid {
		var stored map[string]any
		_ = json.Unmarshal([]byte(existing.String), &stored)
		stored["repeated"] = true
		return stored, nil
	}
	source := strings.TrimSpace(asString(body["source"]))
	if source == "" {
		source = "manual"
	}
	rawItems, _ := body["items"].([]any)
	if len(rawItems) == 0 {
		return nil, &APIError{Status: 400, Message: "扣减列表不能为空", Code: "INVALID_BODY"}
	}
	lines := make([]consumptionLine, 0, len(rawItems))
	for _, raw := range rawItems {
		m, _ := raw.(map[string]any)
		line := consumptionLine{
			ItemID:  int(asFloat(m["item_id"])),
			Version: int(asFloat(m["version"])),
			Mode:    strings.TrimSpace(asString(m["mode"])),
		}
		if av, ok := m["amount_value"]; ok && av != nil {
			v := asFloat(av)
			line.AmountValue = &v
		}
		line.Unit = strings.TrimSpace(asString(m["unit"]))
		lines = append(lines, line)
	}
	tx, err := s.DB.Begin()
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()
	changes, err := s.applyConsumptionsTx(tx, userID, lines, key, source, nil)
	if err != nil {
		return nil, err
	}
	items := make([]map[string]any, 0, len(lines))
	for _, line := range lines {
		item, err := s.getOwnedTx(tx, userID, line.ItemID, true)
		if err != nil {
			return nil, err
		}
		if item != nil {
			items = append(items, item)
		}
	}
	response := map[string]any{"changes": changes, "items": items, "repeated": false}
	payload, _ := json.Marshal(response)
	_, err = tx.Exec(`INSERT INTO inventory_consumption_requests (user_id, idempotency_key, result_json) VALUES (?,?,?)`, userID, key, string(payload))
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return response, nil
}

func (s *Service) Evidence(userID, itemID int) (map[string]any, error) {
	item, err := s.get(userID, itemID)
	if err != nil {
		return nil, err
	}
	if item == nil {
		return nil, &APIError{Status: 404, Message: "食材不存在或无权查看", Code: "INVENTORY_NOT_FOUND"}
	}
	var meta sql.NullString
	_ = s.DB.QueryRow(`SELECT metadata_json FROM inventory_change_logs
		WHERE user_id=? AND inventory_item_id=? AND metadata_json IS NOT NULL AND metadata_json != ''
		ORDER BY id DESC LIMIT 1`, userID, itemID).Scan(&meta)
	return map[string]any{
		"item_id":           itemID,
		"inventory_version": item["version"],
		"field_evidence":    fieldEvidenceFromLatestLog(nullStr(meta)),
	}, nil
}

func (s *Service) History(userID, itemID int) ([]map[string]any, error) {
	item, err := s.getIncludeDeleted(userID, itemID)
	if err != nil {
		return nil, err
	}
	if item == nil {
		return nil, &APIError{Status: 404, Message: "食材不存在或无权查看", Code: "INVENTORY_NOT_FOUND"}
	}
	rows, err := s.DB.Query(`
		SELECT id, action, source, quantity_before, quantity_after, quantity_unit, delta_value, metadata_json, created_at
		FROM inventory_change_logs WHERE user_id=? AND inventory_item_id=?
		ORDER BY created_at DESC, id DESC`, userID, itemID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]map[string]any, 0)
	for rows.Next() {
		var (
			id                                      int
			action, source, createdAt               string
			qBefore, qAfter, qUnit, delta, metadata sql.NullString
		)
		if err := rows.Scan(&id, &action, &source, &qBefore, &qAfter, &qUnit, &delta, &metadata, &createdAt); err != nil {
			return nil, err
		}
		entry := map[string]any{
			"id": id, "action": action, "source": source, "created_at": createdAt,
			"quantity_before": parseNullFloat(qBefore), "quantity_after": parseNullFloat(qAfter),
			"quantity_unit": nullStringPtr(qUnit), "delta_value": parseNullFloat(delta),
			"metadata": parseMetadataObject(metadata),
		}
		out = append(out, entry)
	}
	return out, rows.Err()
}

func (s *Service) ReviewScan(userID int, jobID string) (map[string]any, error) {
	var status, result sql.NullString
	err := s.DB.QueryRow(`SELECT status, result_json FROM inventory_scan_jobs WHERE id=? AND user_id=?`, jobID, userID).Scan(&status, &result)
	if errors.Is(err, sql.ErrNoRows) {
		// Fall back to agent_runs style payload when scan job is stored on agent_runs.
		err = s.DB.QueryRow(`SELECT status, COALESCE(result_json,'{}') FROM agent_runs WHERE id=? AND user_id=?`, jobID, userID).Scan(&status, &result)
	}
	if err != nil {
		return nil, &APIError{Status: 404, Message: "识别任务不存在或无权访问", Code: "INVENTORY_NOT_FOUND"}
	}
	if strings.TrimSpace(nullStr(status)) != "completed" {
		return nil, &APIError{Status: 409, Message: "识别尚未完成，请稍后重试", Code: "INVENTORY_CONFLICT"}
	}
	inv, err := s.List(userID)
	if err != nil {
		return nil, err
	}
	names := make([]string, 0)
	for _, item := range inv {
		if asBool(item["is_available"]) {
			names = append(names, asString(item["food_name"]))
		}
	}
	raw := nullStr(result)
	if raw == "" {
		raw = "{}"
	}
	items := classifyScanAcceptance(jobID, normalizeScanItems(json.RawMessage(raw)), names)
	return map[string]any{"jobId": jobID, "items": items}, nil
}

func (s *Service) AcceptScan(userID int, jobID string) (map[string]any, error) {
	review, err := s.ReviewScan(userID, jobID)
	if err != nil {
		return nil, err
	}
	rawItems, _ := review["items"].([]scanReviewItem)
	intakeItems := make([]any, 0)
	for _, item := range rawItems {
		if item.Acceptance != "automatic" {
			continue
		}
		fe := item.FieldEvidence
		if fe == nil {
			fe = map[string]any{}
		}
		fe["expiration_date"] = map[string]string{"status": "unknown", "source": "unknown"}
		intakeItems = append(intakeItems, map[string]any{
			"food_name": item.FoodName, "category": "其他", "quantity": item.Quantity,
			"expiration_date": "", "storage_location": item.SuggestedStorageLocation,
			"confirmed": false, "source": "image", "source_item_id": item.SourceItemID,
			"confidence": item.Confidence, "field_evidence": fe,
		})
	}
	body := map[string]any{
		"idempotency_key":  "automatic-scan:" + jobID,
		"source":           "image",
		"source_reference": jobID,
		"items":            intakeItems,
	}
	response, err := s.bulkIntake(userID, body, scanAcceptanceRule)
	if err != nil {
		return nil, err
	}
	saved, _ := s.savedScanItems(userID, jobID)
	undone, _ := s.undoneScanItemIDs(userID, jobID)
	undoneSet := make(map[int]struct{}, len(undone))
	for _, id := range undone {
		undoneSet[id] = struct{}{}
	}
	filtered := make([]map[string]any, 0)
	savedIDs := make([]string, 0)
	for sourceID, item := range saved {
		savedIDs = append(savedIDs, sourceID)
		id := int(asFloat(item["id"]))
		if _, ok := undoneSet[id]; !ok {
			filtered = append(filtered, formatListItem(item))
		}
	}
	undoneSource := make([]string, 0)
	for sourceID, item := range saved {
		id := int(asFloat(item["id"]))
		if _, ok := undoneSet[id]; ok {
			undoneSource = append(undoneSource, sourceID)
		}
	}
	response["jobId"] = jobID
	response["items"] = filtered
	response["savedSourceItemIds"] = savedIDs
	response["undoneSourceItemIds"] = undoneSource
	return response, nil
}

func (s *Service) UndoScan(userID int, jobID string) (map[string]any, error) {
	if _, err := s.ReviewScan(userID, jobID); err != nil {
		return nil, err
	}
	saved, err := s.savedScanItems(userID, jobID)
	if err != nil {
		return nil, err
	}
	undone := 0
	seen := make(map[int]map[string]any)
	for _, item := range saved {
		id := int(asFloat(item["id"]))
		if prev, ok := seen[id]; !ok || int(asFloat(prev["version"])) < int(asFloat(item["version"])) {
			seen[id] = item
		}
	}
	for _, item := range seen {
		id := int(asFloat(item["id"]))
		version := int(asFloat(item["version"]))
		key := fmt.Sprintf("intake-undo:%s:%d", jobID, id)
		var logID int
		err := s.DB.QueryRow(`SELECT id FROM inventory_change_logs WHERE user_id=? AND idempotency_key=?`, userID, key).Scan(&logID)
		if err == nil {
			continue
		}
		var currentVersion int
		var deleted sql.NullString
		err = s.DB.QueryRow(`SELECT version, deleted_at FROM inventory_items WHERE id=? AND user_id=?`, id, userID).Scan(&currentVersion, &deleted)
		if err != nil || deleted.Valid && deleted.String != "" || currentVersion != version {
			return nil, &APIError{Status: 409, Message: "部分食材已被消耗或修改，整批未撤销。请到库存查看当前数量后手动纠正。", Code: "INVENTORY_VERSION_CONFLICT"}
		}
		now := time.Now().UTC().Format(time.RFC3339Nano)
		res, err := s.DB.Exec(`UPDATE inventory_items SET deleted_at=?, is_available=0, version=version+1 WHERE id=? AND user_id=?`, now, id, userID)
		if err != nil {
			return nil, err
		}
		n, _ := res.RowsAffected()
		if n != 1 {
			return nil, &APIError{Status: 409, Message: "部分食材已被消耗或修改，整批未撤销。请到库存查看当前数量后手动纠正。", Code: "INVENTORY_VERSION_CONFLICT"}
		}
		meta, _ := json.Marshal(map[string]any{"intake_undo_job": jobID})
		_, _ = s.DB.Exec(`INSERT INTO inventory_change_logs
			(user_id, inventory_item_id, action, source, quantity_before, quantity_after, quantity_unit, delta_value, idempotency_key, metadata_json)
			VALUES (?, ?, 'removed', 'manual', ?, ?, ?, 0, ?, ?)`,
			userID, id, item["quantity_value"], item["quantity_value"], item["quantity_unit"], key, string(meta))
		undone++
	}
	return map[string]any{"undone": undone, "repeated": undone == 0}, nil
}

func (s *Service) savedScanItems(userID int, jobID string) (map[string]map[string]any, error) {
	rows, err := s.DB.Query(`SELECT confirmed_payload_json, result_json FROM inventory_intake_batches
		WHERE user_id=? AND source='image' AND source_reference=? ORDER BY created_at, id`, userID, jobID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var batch []struct{ Confirmed, Result string }
	for rows.Next() {
		var c, r string
		if rows.Scan(&c, &r) == nil {
			batch = append(batch, struct{ Confirmed, Result string }{c, r})
		}
	}
	return savedIntakeItems(batch), rows.Err()
}

func (s *Service) undoneScanItemIDs(userID int, jobID string) ([]int, error) {
	rows, err := s.DB.Query(`SELECT inventory_item_id FROM inventory_change_logs WHERE user_id=? AND action='removed' AND metadata_json LIKE ?`, userID, "%\"intake_undo_job\":\""+jobID+"\"%")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]int, 0)
	for rows.Next() {
		var id int
		if rows.Scan(&id) == nil {
			out = append(out, id)
		}
	}
	return out, rows.Err()
}

func (s *Service) listPreviewCandidates(userID int) ([]previewCandidate, error) {
	rows, err := s.DB.Query(`
		SELECT id, food_name, quantity_value, quantity_unit, expiration_date, batch_code, version,
			(SELECT metadata_json FROM inventory_change_logs e WHERE e.inventory_item_id=inventory_items.id AND e.user_id=inventory_items.user_id
			 AND e.metadata_json IS NOT NULL ORDER BY e.id DESC LIMIT 1) AS quantity_evidence
		FROM inventory_items
		WHERE user_id=? AND is_available=1 AND deleted_at IS NULL
		ORDER BY CASE WHEN expiration_date='' THEN 1 ELSE 0 END, expiration_date ASC, id ASC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]previewCandidate, 0)
	for rows.Next() {
		var (
			id, version                  int
			foodName, expiration         string
			qVal, qUnit, batch, evidence sql.NullString
		)
		if err := rows.Scan(&id, &foodName, &qVal, &qUnit, &expiration, &batch, &version, &evidence); err != nil {
			return nil, err
		}
		var evidenceMeta any
		if evidence.Valid {
			evidenceMeta = evidence.String
		}
		c := previewCandidate{ID: id, FoodName: foodName, ExpirationDate: expiration, Version: version,
			QuantityEvidenceStatus: quantityEvidenceStatus(evidenceMeta, version),
		}
		if qVal.Valid && qVal.String != "" {
			v := parseFloat(qVal.String)
			c.QuantityValue = &v
		}
		if qUnit.Valid && qUnit.String != "" {
			u := qUnit.String
			c.QuantityUnit = &u
		}
		if batch.Valid && batch.String != "" {
			b := batch.String
			c.BatchCode = &b
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func (s *Service) applyConsumptionsTx(tx *dbx.Tx, userID int, lines []consumptionLine, idempotencyKey, source string, extraMeta map[string]any) ([]map[string]any, error) {
	changes := make([]map[string]any, 0, len(lines))
	for index, line := range lines {
		item, err := s.getOwnedTx(tx, userID, line.ItemID, false)
		if err != nil {
			return nil, err
		}
		if item == nil || !asBool(item["is_available"]) {
			return nil, &APIError{Status: 409, Message: "库存食材不存在、已用完或不属于当前账号", Code: "INVENTORY_CONFLICT"}
		}
		storedValue, storedUnit := structuredQty(item)
		remaining, used, available, nextQty, err := calculateConsumption(
			storedValue, storedUnit, asString(item["food_name"]), asString(item["quantity"]), int(asFloat(item["version"])), line)
		if err != nil {
			return nil, err
		}
		var after any
		if storedValue != nil {
			after = *remaining
		}
		res, err := tx.Exec(`UPDATE inventory_items SET quantity=?, quantity_value=?, is_available=?, version=version+1, updated_at=CURRENT_TIMESTAMP
			WHERE id=? AND user_id=? AND version=? AND is_available=1 AND deleted_at IS NULL`,
			nextQty, after, boolToInt(available), line.ItemID, userID, line.Version)
		if err != nil {
			return nil, err
		}
		n, _ := res.RowsAffected()
		if n != 1 {
			return nil, &APIError{Status: 409, Message: "库存已变化，请刷新后重试", Code: "INVENTORY_VERSION_CONFLICT"}
		}
		action := "consume_partial"
		if line.Mode == "all" {
			action = "consume_all"
		}
		meta := map[string]any{"inventory_version": line.Version + 1, "field_evidence": map[string]any{}}
		for k, v := range extraMeta {
			meta[k] = v
		}
		metaJSON, _ := json.Marshal(meta)
		var delta any
		if used != nil {
			d := -(*used)
			delta = d
		}
		_, err = tx.Exec(`INSERT INTO inventory_change_logs
			(user_id, inventory_item_id, action, source, quantity_before, quantity_after, quantity_unit, delta_value, idempotency_key, metadata_json)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			userID, line.ItemID, action, source, storedValue, after, storedUnit, delta,
			fmt.Sprintf("%s:%d:%d", idempotencyKey, line.ItemID, index), string(metaJSON))
		if err != nil {
			return nil, err
		}
		change := map[string]any{
			"item_id": line.ItemID, "quantity_before": storedValue, "quantity_after": after,
			"quantity_unit": storedUnit, "consumed_value": used, "is_available": available, "version": line.Version + 1,
		}
		changes = append(changes, change)
	}
	return changes, nil
}

func (s *Service) insertItemTx(tx *dbx.Tx, userID int, body map[string]any, logCreate bool) (map[string]any, error) {
	foodName := strings.TrimSpace(asString(body["food_name"]))
	category := strings.TrimSpace(asString(body["category"]))
	quantity := strings.TrimSpace(asString(body["quantity"]))
	if quantity == "" {
		quantity = "1份"
	}
	expiration := strings.TrimSpace(asString(body["expiration_date"]))
	storage := strings.TrimSpace(asString(body["storage_location"]))
	if storage == "" {
		storage = "冷藏"
	}
	if foodName == "" || category == "" {
		return nil, &APIError{Status: 400, Message: "食材信息不完整", Code: "INVALID_INVENTORY"}
	}
	var qVal, qUnit, pkgVal, pkgUnit, batch any
	if v, ok := body["quantity_value"]; ok && v != nil {
		qVal = asFloat(v)
	}
	if u := strings.TrimSpace(asString(body["quantity_unit"])); u != "" {
		qUnit = u
	}
	if v, ok := body["package_size_value"]; ok && v != nil {
		pkgVal = asFloat(v)
	}
	if u := strings.TrimSpace(asString(body["package_size_unit"])); u != "" {
		pkgUnit = u
	}
	if b := strings.TrimSpace(asString(body["batch_code"])); b != "" {
		batch = b
	}
	id, err := tx.InsertID(`
		INSERT INTO inventory_items (user_id, food_name, category, quantity, expiration_date, storage_location, image_url,
			is_available, quantity_value, quantity_unit, package_size_value, package_size_unit, batch_code, version)
		VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, 1)`,
		userID, foodName, category, quantity, expiration, storage, nullString(asString(body["image_url"])),
		qVal, qUnit, pkgVal, pkgUnit, batch)
	if err != nil {
		return nil, err
	}

	itemID := int(id)
	if logCreate {
		_, _ = tx.Exec(`INSERT INTO inventory_change_logs
			(user_id, inventory_item_id, action, source, quantity_before, quantity_after, quantity_unit, delta_value, idempotency_key)
			VALUES (?, ?, 'created', 'manual', NULL, ?, ?, ?, ?)`,
			userID, itemID, qVal, qUnit, qVal, fmt.Sprintf("create:%d", itemID))
	}
	return s.getOwnedTx(tx, userID, itemID, false)
}

func (s *Service) getIncludeDeleted(userID, itemID int) (map[string]any, error) {
	row := s.DB.QueryRow(itemSelectSQL, itemID, userID)
	item, err := scanItemFull(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return item, err
}

func (s *Service) getOwnedTx(tx *dbx.Tx, userID, itemID int, includeDeleted bool) (map[string]any, error) {
	q := itemSelectSQL
	if !includeDeleted {
		q += ` AND deleted_at IS NULL`
	}
	row := tx.QueryRow(q, itemID, userID)
	item, err := scanItemFull(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return item, err
}

const itemSelectSQL = `
	SELECT id, user_id, food_name, category, quantity, expiration_date, storage_location,
		image_url, is_available, created_at,
		COALESCE(version, 1) AS version,
		quantity_value, quantity_unit, package_size_value, package_size_unit, batch_code, updated_at, note
	FROM inventory_items WHERE id=? AND user_id=?`
