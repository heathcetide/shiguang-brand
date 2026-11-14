// Copyright (c) 2026 heathcetide. All rights reserved.

package inventory

import (
	"encoding/json"
)

func savedIntakeItems(rows []struct {
	Confirmed string
	Result    string
}) map[string]map[string]any {
	saved := make(map[string]map[string]any)
	for _, row := range rows {
		var payload []map[string]any
		if err := json.Unmarshal([]byte(row.Confirmed), &payload); err != nil {
			continue
		}
		var result struct {
			Items []map[string]any `json:"items"`
		}
		if err := json.Unmarshal([]byte(row.Result), &result); err != nil {
			continue
		}
		for i, item := range payload {
			sourceID, _ := item["source_item_id"].(string)
			if sourceID == "" || i >= len(result.Items) {
				continue
			}
			if _, exists := saved[sourceID]; !exists {
				saved[sourceID] = result.Items[i]
			}
		}
	}
	return saved
}
