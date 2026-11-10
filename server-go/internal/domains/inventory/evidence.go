// Copyright (c) 2026 heathcetide. All rights reserved.

package inventory

import (
	"encoding/json"
	"strings"
)

func quantityEvidenceStatus(metadata any, currentVersion int) string {
	if metadata == nil {
		return ""
	}
	var value map[string]any
	switch t := metadata.(type) {
	case string:
		if strings.TrimSpace(t) == "" {
			return ""
		}
		if err := json.Unmarshal([]byte(t), &value); err != nil {
			return "unknown"
		}
	case map[string]any:
		value = t
	default:
		return "unknown"
	}
	fe, _ := value["field_evidence"].(map[string]any)
	q, _ := fe["quantity"].(map[string]any)
	status, _ := q["status"].(string)
	invVer := asFloat(value["inventory_version"])
	if invVer != float64(currentVersion) {
		return "unknown"
	}
	if status == "known" || status == "estimated" {
		return status
	}
	return "unknown"
}

func fieldEvidenceFromLatestLog(metadataJSON string) map[string]any {
	if metadataJSON == "" {
		return map[string]any{}
	}
	var meta map[string]any
	if err := json.Unmarshal([]byte(metadataJSON), &meta); err != nil {
		return map[string]any{}
	}
	fe, ok := meta["field_evidence"].(map[string]any)
	if !ok || fe == nil {
		return map[string]any{}
	}
	return fe
}
