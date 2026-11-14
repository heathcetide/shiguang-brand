// Copyright (c) 2026 heathcetide. All rights reserved.

package lifestyle

import (
	"crypto/rand"
	"database/sql"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"
)

func asString(v any) string {
	s, _ := v.(string)
	return s
}

func asFloat(v any) float64 {
	switch t := v.(type) {
	case float64:
		return t
	case float32:
		return float64(t)
	case int:
		return float64(t)
	case int64:
		return float64(t)
	case json.Number:
		f, _ := t.Float64()
		return f
	case string:
		f, err := strconv.ParseFloat(strings.TrimSpace(t), 64)
		if err != nil {
			return 0
		}
		return f
	default:
		return 0
	}
}

func asInt(v any) int {
	return int(asFloat(v))
}

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

func newUUID() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

func nowRFC3339() string {
	return time.Now().UTC().Format(time.RFC3339Nano)
}

func todayDateKey() string {
	return time.Now().UTC().Format("2006-01-02")
}

func parseJSONObject(raw sql.NullString) map[string]any {
	if !raw.Valid || strings.TrimSpace(raw.String) == "" {
		return map[string]any{}
	}
	var out map[string]any
	if json.Unmarshal([]byte(raw.String), &out) != nil || out == nil {
		return map[string]any{}
	}
	return out
}

func marshalJSON(v any) string {
	raw, err := json.Marshal(v)
	if err != nil {
		return "{}"
	}
	return string(raw)
}

func mergeMaps(base map[string]any, patch map[string]any) map[string]any {
	if base == nil {
		base = map[string]any{}
	}
	for k, v := range patch {
		base[k] = v
	}
	return base
}

func planIDStr(id int) string {
	return strconv.Itoa(id)
}
