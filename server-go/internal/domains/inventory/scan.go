// Copyright (c) 2026 heathcetide. All rights reserved.

package inventory

import (
	"encoding/json"
	"regexp"
	"strconv"
	"strings"
)

const scanAcceptanceRule = "inventory-scan-v1"

type scanReviewItem struct {
	FoodName                 string         `json:"foodName"`
	Quantity                 string         `json:"quantity"`
	SuggestedStorageLocation string         `json:"suggestedStorageLocation"`
	EstimatedExpireDays      *int           `json:"estimatedExpireDays,omitempty"`
	Confidence               *float64       `json:"confidence"`
	FieldEvidence            map[string]any `json:"fieldEvidence"`
	MissingFields            []string       `json:"missingFields"`
	SourceItemID             string         `json:"sourceItemId"`
	Acceptance               string         `json:"acceptance"`
	AcceptanceRule           string         `json:"acceptanceRule"`
	Reasons                  []string       `json:"reasons"`
}

var scanQuantityPattern = regexp.MustCompile(`(?i)^(\d+(?:\.\d+)?|半)\s*(?:g|kg|ml|l|克|千克|毫升|升|个|枚|只|袋|盒|瓶|罐|份)$`)

func normalizeScanItems(raw json.RawMessage) []map[string]any {
	var payload any
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil
	}
	items := extractScanItems(payload)
	out := make([]map[string]any, 0, len(items))
	for i, item := range items {
		if i >= 30 {
			break
		}
		name, _ := item["foodName"].(string)
		name = strings.TrimSpace(name)
		if name == "" {
			continue
		}
		qty, _ := item["quantity"].(string)
		qty = strings.TrimSpace(qty)
		loc, _ := item["suggestedStorageLocation"].(string)
		if loc != "冷藏" && loc != "冷冻" && loc != "常温" {
			loc = ""
		}
		var conf *float64
		if c, ok := item["confidence"].(float64); ok && c >= 0 && c <= 1 {
			conf = &c
		}
		presentQty := qty != ""
		presentLoc := loc != ""
		reviewItem := map[string]any{
			"fieldEvidence": map[string]any{
				"food_name":          recognizedEvidence(true),
				"quantity":           recognizedEvidence(presentQty),
				"storage_location":   recognizedEvidence(presentLoc),
				"expiration_date":    recognizedEvidence(false),
			},
			"foodName":                 name,
			"quantity":                 qty,
			"suggestedStorageLocation": loc,
			"confidence":               conf,
		}
		missing := make([]string, 0, 3)
		if qty == "" {
			missing = append(missing, "数量")
		}
		if loc == "" {
			missing = append(missing, "存放位置")
		}
		missing = append(missing, "保质期")
		reviewItem["missingFields"] = missing
		out = append(out, reviewItem)
	}
	return out
}

func extractScanItems(payload any) []map[string]any {
	switch root := payload.(type) {
	case map[string]any:
		if items, ok := root["items"].([]any); ok {
			return toItemMaps(items)
		}
		if arts, ok := root["artifacts"].([]any); ok {
			for _, a := range arts {
				am, _ := a.(map[string]any)
				if am["type"] != "vision" {
					continue
				}
				data, _ := am["data"].(map[string]any)
				if items, ok := data["items"].([]any); ok {
					return toItemMaps(items)
				}
			}
		}
	}
	return nil
}

func toItemMaps(items []any) []map[string]any {
	out := make([]map[string]any, 0, len(items))
	for _, it := range items {
		if m, ok := it.(map[string]any); ok {
			out = append(out, m)
		}
	}
	return out
}

func recognizedEvidence(present bool) map[string]string {
	if present {
		return map[string]string{"status": "estimated", "source": "recognition"}
	}
	return map[string]string{"status": "unknown", "source": "unknown"}
}

func classifyScanAcceptance(jobID string, rawItems []map[string]any, existingNames []string) []scanReviewItem {
	normalize := func(name string) string {
		return strings.ToLower(strings.ReplaceAll(strings.TrimSpace(name), " ", ""))
	}
	counts := make(map[string]int)
	for _, item := range rawItems {
		name, _ := item["foodName"].(string)
		key := normalize(name)
		counts[key]++
	}
	existing := make(map[string]struct{}, len(existingNames))
	for _, n := range existingNames {
		existing[normalize(n)] = struct{}{}
	}
	out := make([]scanReviewItem, 0, len(rawItems))
	for idx, item := range rawItems {
		name, _ := item["foodName"].(string)
		qty, _ := item["quantity"].(string)
		loc, _ := item["suggestedStorageLocation"].(string)
		var conf *float64
		if c, ok := item["confidence"].(float64); ok {
			conf = &c
		}
		fe, _ := item["fieldEvidence"].(map[string]any)
		if fe == nil {
			fe = map[string]any{}
		}
		missing, _ := item["missingFields"].([]any)
		missingStr := make([]string, 0, len(missing))
		for _, m := range missing {
			if s, ok := m.(string); ok {
				missingStr = append(missingStr, s)
			}
		}
		reasons := make([]string, 0, 6)
		key := normalize(name)
		if strings.TrimSpace(jobID) == "" {
			reasons = append(reasons, "缺少识别任务依据")
		}
		if conf == nil || *conf < 0.9 {
			reasons = append(reasons, "识别把握不足")
		}
		if strings.ContainsAny(name, "?？") || strings.Contains(name, "或") || strings.Contains(name, "可能") {
			reasons = append(reasons, "名称存在歧义")
		}
		if counts[key] > 1 {
			reasons = append(reasons, "可能与其他批次重叠")
		}
		if _, ok := existing[key]; ok {
			reasons = append(reasons, "可能与其他批次重叠")
		}
		match := scanQuantityPattern.FindStringSubmatch(strings.TrimSpace(qty))
		qtyOK := false
		if len(match) > 1 {
			val := match[1]
			if val == "半" {
				qtyOK = true
			} else if v := parseFloat(val); v > 0 {
				qtyOK = true
			}
		}
		if !qtyOK {
			reasons = append(reasons, "数量需要确认")
		}
		if loc == "" {
			reasons = append(reasons, "存放位置未知")
		}
		acceptance := "automatic"
		if len(reasons) > 0 {
			acceptance = "review"
		}
		out = append(out, scanReviewItem{
			FoodName:                 strings.TrimSpace(name),
			Quantity:                 qty,
			SuggestedStorageLocation: loc,
			Confidence:               conf,
			FieldEvidence:            fe,
			MissingFields:            missingStr,
			SourceItemID:             jobID + ":" + strconv.Itoa(idx),
			Acceptance:               acceptance,
			AcceptanceRule:           scanAcceptanceRule,
			Reasons:                  reasons,
		})
	}
	return out
}
