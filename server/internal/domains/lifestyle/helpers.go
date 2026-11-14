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
	if f := optionalFloat(v); f != nil {
		return *f
	}
	return 0
}

func optionalFloat(v any) *float64 {
	switch t := v.(type) {
	case nil:
		return nil
	case float64:
		return &t
	case float32:
		f := float64(t)
		return &f
	case int:
		f := float64(t)
		return &f
	case int64:
		f := float64(t)
		return &f
	case json.Number:
		f, err := t.Float64()
		if err != nil {
			return nil
		}
		return &f
	case string:
		s := strings.TrimSpace(t)
		if s == "" {
			return nil
		}
		f, err := strconv.ParseFloat(s, 64)
		if err != nil {
			return nil
		}
		return &f
	default:
		return nil
	}
}

func nullIfEmpty(s string) any {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	return s
}

func setNullFloat(item map[string]any, key string, v sql.NullFloat64) {
	if v.Valid {
		item[key] = v.Float64
	}
}

func mergeHealthPayload(item map[string]any, payload sql.NullString) {
	if !payload.Valid || strings.TrimSpace(payload.String) == "" {
		return
	}
	var parsed map[string]any
	if json.Unmarshal([]byte(payload.String), &parsed) != nil || parsed == nil {
		return
	}
	for k, v := range parsed {
		if _, exists := item[k]; exists && item[k] != nil {
			continue
		}
		item[k] = v
	}
}

func healthLogMap(
	id int, dateKey, recorded string,
	weight, steps, sleep, height, bodyFat, waist, hip, water, hr, sys, dia, glucose, bmi sql.NullFloat64,
	cycle sql.NullString,
) map[string]any {
	item := map[string]any{
		"id": id, "recorded_date": dateKey, "recorded_at": recorded, "date": dateKey,
	}
	setNullFloat(item, "weight", weight)
	setNullFloat(item, "steps", steps)
	setNullFloat(item, "sleep_hours", sleep)
	setNullFloat(item, "height_cm", height)
	setNullFloat(item, "body_fat", bodyFat)
	setNullFloat(item, "waist_cm", waist)
	setNullFloat(item, "hip_cm", hip)
	setNullFloat(item, "water_ml", water)
	setNullFloat(item, "resting_heart_rate", hr)
	setNullFloat(item, "blood_pressure_systolic", sys)
	setNullFloat(item, "blood_pressure_diastolic", dia)
	setNullFloat(item, "blood_glucose_mmol", glucose)
	setNullFloat(item, "bmi", bmi)
	if cycle.Valid && strings.TrimSpace(cycle.String) != "" {
		item["cycle_status"] = cycle.String
	}
	return item
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
	loc, err := time.LoadLocation("Asia/Shanghai")
	if err != nil {
		return time.Now().Format("2006-01-02")
	}
	return time.Now().In(loc).Format("2006-01-02")
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
