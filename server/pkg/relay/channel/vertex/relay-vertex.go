package vertex

import (
	"encoding/json"
	"strings"
)

func GetModelRegion(other string, localModelName string) string {
	// if other is json string
	if strings.HasPrefix(other, "{") {
		var m map[string]any
		if err := json.Unmarshal([]byte(other), &m); err != nil {
			return other // return original if parsing fails
		}
		if m[localModelName] != nil {
			if v, ok := m[localModelName].(string); ok {
				return v
			}
		}
		if v, ok := m["default"].(string); ok {
			return v
		}
		return "global"
	}
	return other
}
