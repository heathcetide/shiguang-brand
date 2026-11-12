// Copyright (c) 2026 heathcetide. All rights reserved.

package inventory

import (
	"math"
	"strconv"
	"strings"
)

var inventoryUnits = map[string]struct {
	family string
	factor float64
	label  string
}{
	"g":       {family: "mass", factor: 1, label: "g"},
	"kg":      {family: "mass", factor: 1000, label: "kg"},
	"ml":      {family: "volume", factor: 1, label: "ml"},
	"l":       {family: "volume", factor: 1000, label: "L"},
	"piece":   {family: "piece", factor: 1, label: "个"},
	"serving": {family: "serving", factor: 1, label: "份"},
	"bag":     {family: "bag", factor: 1, label: "袋"},
	"box":     {family: "box", factor: 1, label: "盒"},
	"bottle":  {family: "bottle", factor: 1, label: "瓶"},
	"can":     {family: "can", factor: 1, label: "罐"},
}

func isInventoryUnit(u string) bool {
	_, ok := inventoryUnits[u]
	return ok
}

var chineseInventoryUnitAliases = map[string]string{
	"克": "g", "千克": "kg", "公斤": "kg", "毫升": "ml", "升": "l",
	"个": "piece", "只": "piece", "片": "piece", "颗": "piece", "根": "piece",
	"头": "piece", "块": "piece", "把": "piece",
	"杯": "serving", "份": "serving",
	"袋": "bag", "盒": "box", "瓶": "bottle", "罐": "can",
}

// canonicalizeInventoryUnit maps display/legacy Chinese units onto the shared contract enum.
// Unknown values become empty so clients can keep quantity text without failing schema checks.
func canonicalizeInventoryUnit(unit string) string {
	trimmed := strings.TrimSpace(unit)
	if trimmed == "" {
		return ""
	}
	if isInventoryUnit(trimmed) {
		return trimmed
	}
	if mapped, ok := chineseInventoryUnitAliases[trimmed]; ok {
		return mapped
	}
	return ""
}

func roundQty(v float64) float64 {
	return math.Round(v*1000) / 1000
}

func convertQuantity(value float64, from, to string) (float64, error) {
	src, ok1 := inventoryUnits[from]
	tgt, ok2 := inventoryUnits[to]
	if !ok1 || !ok2 {
		return 0, &APIError{Status: 400, Message: "单位无效", Code: "INVENTORY_UNIT_MISMATCH"}
	}
	if src.family != tgt.family {
		return 0, &APIError{Status: 400, Message: src.label + " 与 " + tgt.label + " 不能安全换算", Code: "INVENTORY_UNIT_MISMATCH"}
	}
	if src.factor == tgt.factor {
		return roundQty(value), nil
	}
	if src.factor > tgt.factor {
		return roundQty(value * (src.factor / tgt.factor)), nil
	}
	return roundQty(value / (tgt.factor / src.factor)), nil
}

func normalizeFoodName(value string) string {
	lower := strings.ToLower(strings.TrimSpace(value))
	var b strings.Builder
	for _, r := range lower {
		switch r {
		case ' ', '·', '、', '，', ',', '。', '(', ')', '（', '）', '/', '\\', '_', '-':
			continue
		default:
			b.WriteRune(r)
		}
	}
	return b.String()
}

func inventoryFoodNamesMatch(left, right string) bool {
	a := normalizeFoodName(left)
	b := normalizeFoodName(right)
	if a == "" || b == "" {
		return false
	}
	return strings.Contains(a, b) || strings.Contains(b, a)
}

type previewCandidate struct {
	ID                     int
	FoodName               string
	QuantityValue          *float64
	QuantityUnit           *string
	ExpirationDate         string
	BatchCode              *string
	Version                int
	QuantityEvidenceStatus string
}

type previewRequest struct {
	FoodName    string
	AmountValue float64
	Unit        string
}

func buildFEFOConsumptionPreview(candidates []previewCandidate, requests []previewRequest, asOfDate string) []map[string]any {
	available := make(map[int]float64)
	for _, c := range candidates {
		if c.QuantityValue != nil {
			available[c.ID] = *c.QuantityValue
		}
	}
	out := make([]map[string]any, 0, len(requests))
	for _, request := range requests {
		remaining := request.AmountValue
		nameAvailable := false
		uncertainQuantity := false
		nextAvailable := make(map[int]float64, len(available))
		for k, v := range available {
			nextAvailable[k] = v
		}
		deductions := make([]map[string]any, 0)
		for _, item := range candidates {
			if remaining <= 0 {
				break
			}
			if asOfDate != "" && len(item.ExpirationDate) == 10 && item.ExpirationDate < asOfDate {
				continue
			}
			if !inventoryFoodNamesMatch(item.FoodName, request.FoodName) {
				continue
			}
			nameAvailable = true
			if item.QuantityEvidenceStatus != "" && item.QuantityEvidenceStatus != "known" {
				uncertainQuantity = true
				continue
			}
			unit := ""
			if item.QuantityUnit != nil {
				unit = *item.QuantityUnit
			}
			value := nextAvailable[item.ID]
			if item.QuantityValue == nil || unit == "" || !isInventoryUnit(unit) || !isFinitePositive(value) {
				uncertainQuantity = true
				continue
			}
			if value <= 0 {
				continue
			}
			availableInRequest, err := convertQuantity(value, unit, request.Unit)
			if err != nil {
				uncertainQuantity = true
				continue
			}
			amount := remaining
			if amount > availableInRequest {
				amount = availableInRequest
			}
			allocated, err := convertQuantity(amount, request.Unit, unit)
			if err != nil {
				uncertainQuantity = true
				continue
			}
			rest := roundQty(value - allocated)
			mode := "amount"
			if rest == 0 {
				mode = "all"
			}
			batchCode := any(nil)
			if item.BatchCode != nil {
				batchCode = *item.BatchCode
			}
			deductions = append(deductions, map[string]any{
				"item_id":         item.ID,
				"version":         item.Version,
				"food_name":       item.FoodName,
				"expiration_date": item.ExpirationDate,
				"batch_code":      batchCode,
				"mode":            mode,
				"amount_value":    allocated,
				"unit":            unit,
			})
			nextAvailable[item.ID] = rest
			remaining = roundQty(remaining - amount)
		}
		covered := roundQty(request.AmountValue - remaining)
		missing := roundQty(remaining)
		if len(deductions) == 0 && uncertainQuantity {
			missing = request.AmountValue
			covered = 0
		}
		fullyCovered := missing == 0
		for k, v := range nextAvailable {
			available[k] = v
		}
		status := "unavailable"
		if fullyCovered {
			status = "sufficient"
		} else if uncertainQuantity {
			status = "unknown"
		} else if nameAvailable {
			status = "insufficient"
		}
		out = append(out, map[string]any{
			"food_name":       request.FoodName,
			"requested_value": request.AmountValue,
			"unit":            request.Unit,
			"covered_value":   covered,
			"missing_value":   missing,
			"fully_covered":   fullyCovered,
			"name_available":  nameAvailable,
			"quantity_status": status,
			"deductions":      deductions,
		})
	}
	return out
}

func isFinitePositive(v float64) bool {
	return !math.IsNaN(v) && !math.IsInf(v, 0) && v > 0
}

type consumptionLine struct {
	ItemID      int
	Version     int
	Mode        string
	AmountValue *float64
	Unit        string
}

func calculateConsumption(
	storedValue *float64,
	storedUnit *string,
	foodName string,
	displayQty string,
	itemVersion int,
	line consumptionLine,
) (remaining *float64, amountUsed *float64, available bool, nextQty string, err error) {
	if line.Mode != "amount" && line.Mode != "all" {
		return nil, nil, false, "", &APIError{Status: 400, Message: "扣减模式无效", Code: "INVALID_CONSUMPTION_MODE"}
	}
	if line.Version != itemVersion {
		return nil, nil, false, "", &APIError{Status: 409, Message: "库存已在其他设备更新，请刷新后重试", Code: "INVENTORY_VERSION_CONFLICT"}
	}
	var used *float64
	rem := 0.0
	avail := false
	if line.Mode == "amount" {
		if storedValue == nil || storedUnit == nil || *storedValue <= 0 {
			return nil, nil, false, "", &APIError{Status: 400, Message: "「" + foodName + "」没有可安全部分扣减的结构化数量", Code: "STRUCTURED_QUANTITY_REQUIRED"}
		}
		if line.AmountValue == nil || !isInventoryUnit(line.Unit) || *line.AmountValue <= 0 {
			return nil, nil, false, "", &APIError{Status: 400, Message: "扣减数量必须大于 0", Code: "INVALID_CONSUMPTION_AMOUNT"}
		}
		consumed, convErr := convertQuantity(*line.AmountValue, line.Unit, *storedUnit)
		if convErr != nil {
			return nil, nil, false, "", convErr
		}
		if consumed > *storedValue {
			return nil, nil, false, "", &APIError{Status: 409, Message: "「" + foodName + "」的剩余数量不足", Code: "INVENTORY_INSUFFICIENT"}
		}
		used = &consumed
		rem = roundQty(*storedValue - consumed)
		avail = rem > 0
	} else {
		if storedValue != nil {
			used = storedValue
		}
		rem = 0
		avail = false
	}
	next := displayQty
	if storedUnit != nil && storedValue != nil {
		next = formatDisplayQuantity(rem, *storedUnit)
	}
	return &rem, used, avail, next, nil
}

func formatDisplayQuantity(value float64, unit string) string {
	def := inventoryUnits[unit]
	s := strings.TrimRight(strings.TrimRight(strconv.FormatFloat(value, 'f', 3, 64), "0"), ".")
	return s + def.label
}
